import { GoogleGenAI, Type } from '@google/genai';
import type { DisconfirmerReview, Finding, Hypothesis, ScanRun, ThreatModel } from '../types';

export const GEMINI_MODEL = 'gemini-4-neon';

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

function createClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Clé GEMINI_API_KEY absente côté serveur. Veuillez sélectionner une clé API dans Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateThreatModelWithGemini(
  scan: ScanRun,
  model = GEMINI_MODEL
): Promise<Pick<ThreatModel, 'summary' | 'invariants' | 'trustBoundaries'>> {
  const ai = createClient();

  const prompt = `Tu es l'agent threat_modeler de Polymorphe pour un audit smart contract.
Cible : ${scan.programName} (${scan.targetUrl})
Mode : ${scan.targetKind} · Scope : ${scan.scopeKind} · Chaîne : ${scan.chain}
Impacts verbatim (R12) : ${JSON.stringify(scan.threatModel.verbatimImpacts)}
Exclusions : ${JSON.stringify(scan.threatModel.exclusions)}
Tombstones historiques (R16) : ${JSON.stringify(scan.threatModel.tombstones)}
Fonctions monétaires non testées (Ingest Door A) : ${JSON.stringify(scan.ingest.untestedMonetaryFunctions)}
Hits statiques : ${JSON.stringify(scan.ingest.staticHits)}

Produis un threat model concis en français adapté à un chasseur de bounty :
- summary : 2 à 3 phrases précises sur la surface d'attaque prioritaire.
- invariants : 3 à 5 invariants critiques vérifiables en Foundry/Halmos.
- trustBoundaries : 2 à 4 frontières de confiance explicites (rôles permissionless vs privilégiés vs relayers Web2).
N'invente aucun impact en dehors des impacts verbatim fournis.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction:
        'Tu es un auditeur smart contract senior. Réponds strictement en JSON valide conforme au schéma demandé, sans jargon superflu.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING, description: 'Synthèse concise de la surface d’attaque.' },
          invariants: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Liste d’invariants critiques.',
          },
          trustBoundaries: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Frontières de confiance.',
          },
        },
        required: ['summary', 'invariants', 'trustBoundaries'],
      },
    },
  });

  const raw = (response.text ?? '').trim();
  const parsed = JSON.parse(raw) as {
    summary: string;
    invariants: string[];
    trustBoundaries: string[];
  };

  return {
    summary: parsed.summary || scan.threatModel.summary,
    invariants: Array.isArray(parsed.invariants) ? parsed.invariants : scan.threatModel.invariants,
    trustBoundaries: Array.isArray(parsed.trustBoundaries)
      ? parsed.trustBoundaries
      : scan.threatModel.trustBoundaries,
  };
}

export async function generateHypothesesWithGemini(
  scan: ScanRun,
  model = GEMINI_MODEL
): Promise<Array<Pick<Hypothesis, 'door' | 'title' | 'targetFileLine'>>> {
  const ai = createClient();

  const existingTitles = scan.hypotheses.map((h) => h.title);
  const prompt = `Tu es le planner SC de Polymorphe (R6). Génère exactement 3 nouvelles hypothèses d'audit distinctes et non redondantes pour ${scan.programName}.
Threat model : ${scan.threatModel.summary}
Invariants : ${JSON.stringify(scan.threatModel.invariants)}
Tombstones (R16) : ${JSON.stringify(scan.threatModel.tombstones)}
Fonctions non testées (Door A) : ${JSON.stringify(scan.ingest.untestedMonetaryFunctions)}
Hypothèses déjà existantes (ne pas dupliquer) : ${JSON.stringify(existingTitles)}

Pour chaque hypothèse, choisis door parmi : "door_a_untested", "invariant", "seam", "tombstone_sibling".
Indique un titre précis en français et une cible file:line réaliste issue du dépôt.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction:
        'Tu es un chercheur en sécurité smart contract. Réponds uniquement en JSON valide respectant le schéma.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            door: {
              type: Type.STRING,
              description: 'One of: door_a_untested, invariant, seam, tombstone_sibling',
            },
            title: { type: Type.STRING, description: 'Titre précis de l’hypothèse en français.' },
            targetFileLine: {
              type: Type.STRING,
              description: 'Fichier et numéro de ligne ciblés, ex: src/Vault.sol:142',
            },
          },
          required: ['door', 'title', 'targetFileLine'],
        },
      },
    },
  });

  const raw = (response.text ?? '[]').trim();
  const parsed = JSON.parse(raw) as Array<{
    door: string;
    title: string;
    targetFileLine: string;
  }>;

  const validDoors = new Set(['door_a_untested', 'invariant', 'seam', 'tombstone_sibling']);
  return parsed.slice(0, 3).map((item) => ({
    door: (validDoors.has(item.door) ? item.door : 'invariant') as Hypothesis['door'],
    title: item.title,
    targetFileLine: item.targetFileLine || 'src/Contract.sol:1',
  }));
}

export async function runDisconfirmerWithGemini(
  finding: Finding,
  scan: ScanRun,
  model = GEMINI_MODEL
): Promise<DisconfirmerReview> {
  const ai = createClient();

  const prompt = `Tu es l'agent disconfirmer de Polymorphe (LOCK #4, R10, R13).
Ta mission : tenter de contredire ce candidat finding en appliquant le test de l'alternative légitime (R13 : peut-on reconstruire l'état final avec les seules fonctions prévues ?) et vérifier s'il tombe dans une exclusion ou un tombstone.
Règle R10 : tu ne peux que signaler ("clear" ou "flagged"), jamais tuer le finding.

Programme : ${scan.programName}
Exclusions : ${JSON.stringify(scan.threatModel.exclusions)}
Tombstones : ${JSON.stringify(scan.threatModel.tombstones)}
Finding : ${finding.title} (${finding.affectedFileLine})
Résumé : ${finding.summary}
Code affecté :
${finding.affectedCode}
PoC :
${finding.pocSource}`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction:
        'Tu es un contre-vérificateur adversarial smart contract. Réponds en français strictement en JSON valide.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          status: { type: Type.STRING, description: 'clear or flagged' },
          legitimateAlternativeTest: {
            type: Type.STRING,
            description: 'Résultat concis du test R13 d’alternative légitime (1-2 phrases).',
          },
          notes: {
            type: Type.STRING,
            description: 'Notes de contre-vérification (préconditions, exclusions, risques de faux positif).',
          },
        },
        required: ['status', 'legitimateAlternativeTest', 'notes'],
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  const parsed = JSON.parse(raw) as {
    status: string;
    legitimateAlternativeTest: string;
    notes: string;
  };

  return {
    status: parsed.status === 'flagged' ? 'flagged' : 'clear',
    ranAt: new Date().toISOString(),
    legitimateAlternativeTest:
      parsed.legitimateAlternativeTest || finding.disconfirmer.legitimateAlternativeTest,
    notes: parsed.notes || finding.disconfirmer.notes,
    canKillFinding: false,
  };
}
