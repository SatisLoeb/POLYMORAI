import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import type { DisconfirmerReview, Finding, Hypothesis, ScanRun, ThreatModel } from '../types';
import { extractFunction } from './workspace';

export const GEMINI_MODEL = 'gemini-4-neon';
const MAX_CONTEXT_CHARS = 60_000;

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

function createClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Clé GEMINI_API_KEY absente côté serveur (variable d’environnement / Secrets).');
  }
  // Header kept from the AI Studio template (the hosted runtime expects it).
  return new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
}

export interface LlmUsage {
  tokens: number;
}

function usageOf(response: { usageMetadata?: { totalTokenCount?: number } }): LlmUsage {
  return { tokens: response.usageMetadata?.totalTokenCount ?? 0 };
}

function parseJson<T>(raw: string | undefined, what: string): T {
  try {
    return JSON.parse((raw ?? '').trim()) as T;
  } catch {
    throw new Error(`Réponse ${what} non-JSON du modèle.`);
  }
}

/**
 * Real code context: the source file list plus the bodies of the Door A functions,
 * read from the prepared workspace. Without a workspace, there is no context to give.
 */
export function buildSourceContext(scan: ScanRun, projectDir: string | null): string {
  if (!projectDir) return '';
  const parts: string[] = [];
  parts.push(`Fichiers sources (${scan.ingest.sourceFiles.length}) :\n${scan.ingest.sourceFiles.join('\n')}`);
  let budget = MAX_CONTEXT_CHARS - parts[0].length;
  for (const fn of scan.ingest.untestedMonetaryFunctions) {
    if (budget <= 0) break;
    const file = fn.fileLine.split(':')[0];
    let src = '';
    try {
      src = fs.readFileSync(path.join(projectDir, file), 'utf8');
    } catch {
      continue;
    }
    const decl = extractFunction(src, fn.functionName);
    if (!decl) continue;
    const block = `// ${fn.fileLine} — ${fn.contract}.${fn.functionName} (non testée)\n${decl.body.slice(0, 6000)}`;
    parts.push(block);
    budget -= block.length;
  }
  return parts.join('\n\n');
}

export async function generateThreatModelWithGemini(
  scan: ScanRun,
  model: string,
  sourceContext: string
): Promise<Pick<ThreatModel, 'summary' | 'invariants' | 'trustBoundaries'> & LlmUsage> {
  const ai = createClient();
  const prompt = `Tu es l'agent threat_modeler de Polymorphe pour un audit smart contract.
Cible : ${scan.programName} (${scan.targetUrl}) — commit ${scan.workspace?.commit ?? 'inconnu'}
Mode : ${scan.targetKind} · Scope : ${scan.scopeKind} · Chaîne : ${scan.chain}
Impacts verbatim (R12) : ${JSON.stringify(scan.threatModel.verbatimImpacts)}
Exclusions : ${JSON.stringify(scan.threatModel.exclusions)}
Tombstones (R16) : ${JSON.stringify(scan.threatModel.tombstones)}

CODE RÉEL DU DÉPÔT :
${sourceContext || '(aucun code disponible)'}

Produis un threat model concis en français :
- summary : 2 à 3 phrases sur la surface d'attaque prioritaire, en citant les fonctions réelles ci-dessus.
- invariants : 3 à 5 invariants vérifiables en Foundry.
- trustBoundaries : 2 à 4 frontières de confiance explicites.
N'invente aucun impact hors des impacts verbatim, ni aucune fonction absente du code fourni.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: 'Tu es un auditeur smart contract senior. Réponds strictement en JSON valide conforme au schéma.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          invariants: { type: Type.ARRAY, items: { type: Type.STRING } },
          trustBoundaries: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['summary', 'invariants', 'trustBoundaries'],
      },
    },
  });

  const parsed = parseJson<{ summary?: string; invariants?: unknown; trustBoundaries?: unknown }>(response.text, 'threat model');
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    invariants: strings(parsed.invariants),
    trustBoundaries: strings(parsed.trustBoundaries),
    ...usageOf(response),
  };
}

/** Check that `file:line` exists in the workspace; LLM-chosen locations are untrusted. */
export function verifyFileLine(projectDir: string | null, fileLine: string): boolean {
  if (!projectDir) return false;
  const m = /^([^:]+\.sol):(\d+)/.exec(fileLine.trim());
  if (!m) return false;
  const rel = path.normalize(m[1]);
  if (path.isAbsolute(rel) || rel.startsWith('..')) return false;
  try {
    const lines = fs.readFileSync(path.join(projectDir, rel), 'utf8').split('\n').length;
    const n = Number(m[2]);
    return n >= 1 && n <= lines;
  } catch {
    return false;
  }
}

export async function generateHypothesesWithGemini(
  scan: ScanRun,
  model: string,
  sourceContext: string
): Promise<{ items: Array<Pick<Hypothesis, 'door' | 'title' | 'targetFileLine'>> } & LlmUsage> {
  const ai = createClient();
  const existingTitles = scan.hypotheses.map((h) => h.title);
  const prompt = `Tu es le planner SC de Polymorphe (R6). Génère exactement 3 nouvelles hypothèses d'attaque distinctes pour ${scan.programName}.
Posture : voleur — "où l'argent sort-il ?", pas "est-ce sûr ?".
Threat model : ${scan.threatModel.summary}
Invariants : ${JSON.stringify(scan.threatModel.invariants)}
Tombstones (R16, ne pas re-proposer) : ${JSON.stringify(scan.threatModel.tombstones)}
Hypothèses existantes (ne pas dupliquer) : ${JSON.stringify(existingTitles)}

CODE RÉEL DU DÉPÔT :
${sourceContext}

Pour chaque hypothèse : door parmi "door_a_untested", "invariant", "seam", "tombstone_sibling" ;
un titre précis en français ; targetFileLine = un chemin ET une ligne qui existent dans le code fourni (ex: src/Vault.sol:142).`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: 'Tu es un chercheur en sécurité smart contract. Réponds uniquement en JSON valide respectant le schéma.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            door: { type: Type.STRING },
            title: { type: Type.STRING },
            targetFileLine: { type: Type.STRING },
          },
          required: ['door', 'title', 'targetFileLine'],
        },
      },
    },
  });

  const parsed = parseJson<Array<{ door?: string; title?: string; targetFileLine?: string }>>(response.text, 'hypothèses');
  const validDoors = new Set(['door_a_untested', 'invariant', 'seam', 'tombstone_sibling']);
  const items = (Array.isArray(parsed) ? parsed : [])
    .filter((x) => typeof x.title === 'string' && x.title.trim())
    .slice(0, 3)
    .map((item) => ({
      door: (validDoors.has(String(item.door)) ? item.door : 'invariant') as Hypothesis['door'],
      title: String(item.title).trim(),
      targetFileLine: String(item.targetFileLine ?? '').trim(),
    }));
  return { items, ...usageOf(response) };
}

export async function runDisconfirmerWithGemini(
  finding: Finding,
  scan: ScanRun,
  model: string
): Promise<DisconfirmerReview & LlmUsage> {
  const ai = createClient();
  const prompt = `Tu es l'agent disconfirmer de Polymorphe (LOCK #4, R10, R13).
Mission : tenter de contredire ce candidat. Test R13 : peut-on reconstruire le MÊME état final (même valeur gardée, même perte) avec les seules fonctions prévues (withdraw / repay / close…) ? Si oui, le bug n'ajoute rien.
Vérifie aussi s'il tombe dans une exclusion ou un tombstone.
R10 : tu ne peux que signaler ("clear" ou "flagged"), jamais tuer le finding.

Programme : ${scan.programName}
Exclusions : ${JSON.stringify(scan.threatModel.exclusions)}
Tombstones : ${JSON.stringify(scan.threatModel.tombstones)}
Finding : ${finding.title} (${finding.affectedFileLine})
Résumé : ${finding.summary}
Code affecté :
${finding.affectedCode}
PoC :
${finding.pocSource}
Sortie réelle du rejeu :
${finding.pocReplayTrace.slice(-8000)}`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: 'Tu es un contre-vérificateur adversarial smart contract. Réponds en français strictement en JSON valide.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          status: { type: Type.STRING },
          legitimateAlternativeTest: { type: Type.STRING },
          notes: { type: Type.STRING },
        },
        required: ['status', 'legitimateAlternativeTest', 'notes'],
      },
    },
  });

  const parsed = parseJson<{ status?: string; legitimateAlternativeTest?: string; notes?: string }>(response.text, 'disconfirmer');
  return {
    status: parsed.status === 'clear' ? 'clear' : 'flagged',
    ranAt: new Date().toISOString(),
    model,
    legitimateAlternativeTest: String(parsed.legitimateAlternativeTest ?? ''),
    notes: String(parsed.notes ?? ''),
    canKillFinding: false,
    ...usageOf(response),
  };
}
