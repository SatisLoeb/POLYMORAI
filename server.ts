import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  canCloseScanWithoutFindings,
  canExportFinding,
  canHunt,
  classifyHypothesisClosure,
  generateBountyReport,
  mergeThreatModel,
  validateG0Override,
  validateOperatorSignoff,
} from './src/core/doctrine';
import { Auth, PASSWORD_MAX, PASSWORD_MIN, requestUser } from './src/server/auth';
import { buildScanRecord, classifyTarget, Engine, newId } from './src/server/engine';
import { probeSandbox, toolVersion } from './src/server/exec';
import { isGeminiConfigured, verifyFileLine } from './src/server/gemini';
import { validatePocSource } from './src/server/replay';
import { ADDRESS_RE } from './src/server/rpc';
import { Store } from './src/server/store';
import { extractFunction, SHA_RE, validateRepoUrl, WorkspaceError } from './src/server/workspace';
import type {
  AdvancedSnapshot,
  ChainSetting,
  DoctorCheck,
  ExportFormat,
  Finding,
  FindingSeverity,
  ProgramScope,
  ScanRun,
} from './src/types';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.POLYMORPHE_DATA_DIR || path.join(__dirname, '.polymorphe-data');
const store = new Store(DATA_DIR);
const auth = new Auth(store);

// SSE subscribers keyed by scanId
const sseClients = new Map<string, Set<express.Response>>();
function pushScanEvent(scanId: string, eventType: string, payload: unknown) {
  const clients = sseClients.get(scanId);
  if (!clients || clients.size === 0) return;
  const serialized = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(serialized);
}

const engine = new Engine(store, pushScanEvent);

// Runs interrupted by a restart did not finish: say so instead of leaving them "running".
for (const run of store.state.runs) {
  if (run.status === 'running' || run.status === 'queued') {
    run.status = 'error';
    run.error = 'Interrompu par un redémarrage du serveur.';
    run.passed = false;
  }
}
for (const f of store.state.findings) {
  if (f.status === 'replaying') f.status = 'replay_failed';
  for (const fr of f.fixReviews) if (fr.status === 'running') {
    fr.status = 'error';
    fr.verdict = 'inconclusive';
    fr.error = 'Interrompu par un redémarrage du serveur.';
  }
}
for (const s of store.state.scans) {
  for (const step of s.steps) if (step.status === 'running') {
    step.status = 'failed';
    step.detail = 'Interrompu par un redémarrage du serveur.';
  }
  engine.recomputeStatus(s);
}
store.commit();

// ------------------------------------------------------------------ helpers

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

type Handler = (req: express.Request, res: express.Response) => unknown | Promise<unknown>;
function h(fn: Handler) {
  return async (req: express.Request, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
      if (err instanceof WorkspaceError) return res.status(400).json({ error: err.message });
      const msg = err instanceof Error ? err.message : 'Erreur interne.';
      store.log('warn', 'http', `${req.method} ${req.path} : ${msg.slice(0, 300)}`);
      return res.status(500).json({ error: msg });
    }
  };
}

function getScan(id: string): ScanRun {
  const scan = engine.scan(id);
  if (!scan) throw new HttpError(404, 'Scan introuvable.');
  return scan;
}

function getFinding(id: string): { finding: Finding; scan: ScanRun } {
  const finding = store.state.findings.find((f) => f.id === id);
  if (!finding) throw new HttpError(404, 'Finding introuvable.');
  return { finding, scan: getScan(finding.scanId) };
}

function str(v: unknown, max = 4000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function httpsUrl(v: unknown, what: string): string {
  const s = str(v, 2000);
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
    return u.toString();
  } catch {
    throw new HttpError(400, `${what} : URL http(s) valide requise.`);
  }
}

function lines(v: unknown, maxItems = 300): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
  return arr
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((x) => x.slice(0, 4000));
}

function findChain(name: string): ChainSetting {
  const c = store.state.chains.find((x) => x.chain === name);
  if (!c) throw new HttpError(400, `Chaîne inconnue : ${name}. Ajoutez-la dans Réglages.`);
  return c;
}

function scanPayload(scan: ScanRun) {
  return { scan, findings: engine.findingsOf(scan.id) };
}

const SEVERITIES: FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

// ------------------------------------------------------------------- server

async function startServer() {
  const app = express();
  if (process.env.K_SERVICE) app.set('trust proxy', 1); // Cloud Run front end
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', express.json({ limit: '2mb' }));
  app.use('/api', Auth.csrfGuard);

  // ---- public
  app.get('/api/health', (_req, res) => {
    res.json({ service: 'polymorphe', version: '0.2.0', status: 'ok' });
  });

  app.get('/api/auth/status', (req, res) => {
    const user = auth.sessionUser(req);
    res.json({
      setupRequired: auth.setupRequired,
      setupTokenRequired: auth.setupRequired,
      authenticated: Boolean(user),
      user,
    });
  });

  app.post('/api/auth/login', h((req, res) => {
    const ip = req.ip ?? 'unknown';
    const wait = auth.lockoutRemaining(ip);
    if (wait) throw new HttpError(429, `Trop d’échecs. Réessayez dans ${wait} s.`);
    if (auth.setupRequired) throw new HttpError(409, 'Instance non initialisée : passez par /setup.');
    const { username, password } = req.body || {};
    if (!auth.login(username, password)) {
      auth.recordFailure(ip);
      store.log('warn', 'auth', `Échec de connexion depuis ${ip}.`);
      store.commit();
      throw new HttpError(401, 'Identifiants invalides.');
    }
    auth.issueSession(req, res);
    store.log('info', 'auth', `Connexion ${store.state.auth.user}.`);
    store.commit();
    res.json({ ok: true, user: store.state.auth.user });
  }));

  app.post('/api/setup/complete', h((req, res) => {
    if (!auth.setupRequired) throw new HttpError(409, 'Instance déjà initialisée.');
    const ip = req.ip ?? 'unknown';
    const wait = auth.lockoutRemaining(ip);
    if (wait) throw new HttpError(429, `Trop d’échecs. Réessayez dans ${wait} s.`);
    const { setupToken, password, llmModel, chainRpcs } = req.body || {};
    if (!auth.checkSetupToken(setupToken)) {
      auth.recordFailure(ip);
      throw new HttpError(403, 'Jeton d’initialisation invalide (affiché dans la console du serveur et dans <data>/setup-token).');
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new HttpError(400, `Mot de passe : ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.`);
    }
    const model = str(llmModel, 80);
    if (model) {
      if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new HttpError(400, 'Nom de modèle invalide.');
      store.state.llm.model = model;
    }
    if (Array.isArray(chainRpcs)) {
      for (const item of chainRpcs) {
        const target = store.state.chains.find((c) => c.chain === item?.chain);
        const url = str(item?.rpcUrl, 2000);
        if (target && url) {
          target.rpcUrl = httpsUrl(url, `RPC ${target.chain}`);
          target.rpcConfigured = true;
        }
      }
    }
    auth.setPassword(password);
    store.log('info', 'setup', 'Instance initialisée.');
    store.commit();
    auth.issueSession(req, res);
    res.json({ ok: true, setupCompleted: true });
  }));

  // ---- everything below requires a session
  app.use('/api', auth.middleware());

  app.post('/api/auth/logout', (req, res) => {
    auth.revokeSession(req, res);
    res.json({ ok: true });
  });

  // Scans
  app.get('/api/scans', (_req, res) => {
    res.json({
      scans: store.state.scans.map((scan) => ({ ...scan, findingsCount: engine.findingsOf(scan.id).length })),
    });
  });

  app.post('/api/scans', h((req, res) => {
    const { targetUrl, rpcUrl, surface = 'all', repoCount = 1 } = req.body || {};
    const target = str(targetUrl, 2000);
    if (!target) throw new HttpError(400, 'L’URL du programme, le dépôt ou le chemin local est requis.');
    if (!['all', 'onchain', 'seam'].includes(surface)) throw new HttpError(400, 'Surface invalide.');
    const meta = classifyTarget(target);
    if (meta.targetKind === 'repo') validateRepoUrl(target);

    const chain = 'ethereum';
    if (str(rpcUrl)) {
      const c = findChain(chain);
      c.rpcUrl = httpsUrl(rpcUrl, 'RPC');
      c.rpcConfigured = true;
    }

    const scan = buildScanRecord(target, meta, { chain, surface, repoCount: Number(repoCount) || 1, tokensLimit: store.state.llm.defaultTokenBudget });
    store.state.scans.unshift(scan);
    store.log('info', 'scan.orchestrator', `Nouveau scan ${scan.id} (${meta.targetKind}).`);
    store.commit();
    engine.startPipeline(scan, { rebuild: true });
    res.status(201).json({ scan });
  }));

  app.get('/api/scans/:id', h((req, res) => {
    res.json(scanPayload(getScan(req.params.id)));
  }));

  app.get('/api/scans/:id/events', h((req, res) => {
    const scanId = getScan(req.params.id).id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    let set = sseClients.get(scanId);
    if (!set) {
      set = new Set();
      sseClients.set(scanId, set);
    }
    set.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ scanId })}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      set?.delete(res);
    });
  }));

  // Operator attestation of the program page (L1, L2, L5, L6 + scope for L3/L4)
  app.post('/api/scans/:id/program-scope', h((req, res) => {
    const scan = getScan(req.params.id);
    if (scan.targetKind !== 'program') throw new HttpError(409, 'Scope programme réservé aux cibles « programme ».');
    const b = req.body || {};
    if (!['active', 'paused', 'closed'].includes(b.status)) throw new HttpError(400, 'Statut : active, paused ou closed.');
    if (!['deployed', 'commit_anchored'].includes(b.scopeKind)) throw new HttpError(400, 'scopeKind : deployed ou commit_anchored.');
    const chain = findChain(str(b.chain, 40) || 'ethereum');
    const addresses = lines(b.scopeAddresses, 100);
    const bad = addresses.filter((a) => !ADDRESS_RE.test(a));
    if (bad.length) throw new HttpError(400, `Adresse(s) invalide(s) : ${bad.slice(0, 3).join(', ')}`);
    const listedAt = str(b.listedAt, 40);
    if (listedAt && Number.isNaN(Date.parse(listedAt))) throw new HttpError(400, 'Date de listing invalide.');
    const maxBounty = b.maxBountyUsd === null || b.maxBountyUsd === '' || b.maxBountyUsd === undefined ? null : Number(b.maxBountyUsd);
    if (maxBounty !== null && (!Number.isFinite(maxBounty) || maxBounty < 0)) throw new HttpError(400, 'Prime max invalide.');
    const repoUrl = str(b.repoUrl, 2000) ? validateRepoUrl(str(b.repoUrl, 2000)) : undefined;
    const pinnedCommit = str(b.pinnedCommit, 64) || undefined;
    if (pinnedCommit && !SHA_RE.test(pinnedCommit)) throw new HttpError(400, 'Commit : SHA hexadécimal attendu.');

    const scope: ProgramScope = {
      attestedAt: new Date().toISOString(),
      attestedBy: requestUser(req),
      sourceUrl: httpsUrl(b.sourceUrl || scan.targetUrl, 'Source'),
      status: b.status,
      verbatimImpacts: lines(b.verbatimImpacts),
      maxBountyUsd: maxBounty,
      listedAt: listedAt || undefined,
      knownIssues: lines(b.knownIssues),
      scopeKind: b.scopeKind,
      chain: chain.chain,
      scopeAddresses: addresses,
      repoUrl,
      pinnedCommit,
    };
    const prev = scan.programScope;
    const rebuild = !scan.workspace || prev?.repoUrl !== repoUrl || prev?.pinnedCommit !== pinnedCommit;
    scan.programScope = scope;
    scan.hunterLogs.push({
      id: newId('log'),
      timestamp: scope.attestedAt.slice(11, 19),
      role: 'system',
      message: `Scope programme attesté par ${scope.attestedBy} (${scope.verbatimImpacts.length} impacts, ${addresses.length} adresse(s)).`,
    });
    store.commit();
    engine.startPipeline(scan, { rebuild: rebuild && Boolean(repoUrl) });
    res.json(scanPayload(scan));
  }));

  // Missing RPC (NEEDS_INPUT): store once in chain settings, then re-measure
  app.post('/api/scans/:id/input', h((req, res) => {
    const scan = getScan(req.params.id);
    const chain = findChain(str(req.body?.chain, 40) || scan.programScope?.chain || scan.chain);
    chain.rpcUrl = httpsUrl(req.body?.rpcUrl, 'RPC');
    chain.rpcConfigured = true;
    store.log('info', 'settings.chains', `RPC ${chain.chain} enregistré.`);
    store.commit();
    engine.startPipeline(scan, { rebuild: false });
    res.json(scanPayload(scan));
  }));

  app.post('/api/scans/:id/funds-attestation', h((req, res) => {
    const scan = getScan(req.params.id);
    const usd = Number(req.body?.usd);
    if (!Number.isFinite(usd) || usd < 0) throw new HttpError(400, 'Montant USD invalide.');
    scan.fundsAttestation = {
      usd,
      sourceUrl: httpsUrl(req.body?.sourceUrl, 'Source du TVL'),
      attestedAt: new Date().toISOString(),
      attestedBy: requestUser(req),
    };
    store.commit();
    engine.startPipeline(scan, { rebuild: false });
    res.json(scanPayload(scan));
  }));

  app.post('/api/scans/:id/rebuild', h((req, res) => {
    const scan = getScan(req.params.id);
    if (engine.isBusy(scan.id)) throw new HttpError(409, 'Un job est déjà en cours sur ce scan.');
    if (scan.status === 'stopped') scan.status = 'running';
    engine.startPipeline(scan, { rebuild: true });
    res.json(scanPayload(scan));
  }));

  // Override G0 (L7)
  app.post('/api/scans/:id/override-g0', h((req, res) => {
    const scan = getScan(req.params.id);
    const reason = str(req.body?.reason, 2000);
    const check = validateG0Override(reason);
    if (!check.ok) throw new HttpError(400, check.error!);
    scan.g0 = {
      ...scan.g0,
      decision: 'go_override',
      overrideReason: reason,
      overrideBy: requestUser(req),
      overrideAt: new Date().toISOString(),
    };
    store.log('warn', 'g0.override', `${scan.id} forcé en go_override par ${requestUser(req)}.`);
    store.commit();
    engine.startPipeline(scan, { rebuild: false });
    res.json(scanPayload(scan));
  }));

  // Extend budget: raises the limit. Closes nothing, produces no artifact.
  app.post('/api/scans/:id/budget', h((req, res) => {
    const scan = getScan(req.params.id);
    const add = Number(req.body?.addTokens);
    if (!Number.isInteger(add) || add <= 0 || add > 5_000_000) throw new HttpError(400, 'addTokens : entier entre 1 et 5 000 000.');
    scan.budget.tokensLimit += add;
    if (scan.status === 'stopped') scan.status = 'hunting';
    scan.hunterLogs.push({
      id: newId('log'),
      timestamp: new Date().toISOString().slice(11, 19),
      role: 'system',
      message: `Budget étendu de ${add.toLocaleString('fr-FR')} tokens par ${requestUser(req)}.`,
    });
    engine.recomputeStatus(scan);
    store.commit();
    pushScanEvent(scan.id, 'scan_updated', { scanId: scan.id });
    res.json({ scan });
  }));

  app.post('/api/scans/:id/stop', h((req, res) => {
    const scan = getScan(req.params.id);
    const cancelled = engine.cancel(scan.id);
    scan.status = 'stopped';
    scan.hunterLogs.push({
      id: newId('log'),
      timestamp: new Date().toISOString().slice(11, 19),
      role: 'system',
      message: `Scan arrêté par l’opérateur (${cancelled} job(s) annulé(s)).`,
    });
    store.commit();
    pushScanEvent(scan.id, 'scan_updated', { scanId: scan.id });
    res.json({ scan });
  }));

  // Threat model (G10 merge)
  app.put('/api/scans/:id/threat-model', h((req, res) => {
    const scan = getScan(req.params.id);
    scan.threatModel = mergeThreatModel(scan.threatModel, req.body || {});
    const tm = scan.steps.find((s) => s.key === 'threat_model');
    if (tm) {
      tm.status = 'done';
      tm.detail = 'Édité et approuvé par l’opérateur (operator_approved).';
      tm.updatedAt = scan.threatModel.updatedAt;
    }
    store.commit();
    pushScanEvent(scan.id, 'threat_model_updated', { scanId: scan.id });
    res.json({ threatModel: scan.threatModel, scan });
  }));

  app.post('/api/scans/:id/ai/threat-model', h(async (req, res) => {
    const scan = getScan(req.params.id);
    if (!canHunt(scan)) throw new HttpError(409, 'LOCK #1 : G0 doit être GO ou override.');
    if (!isGeminiConfigured()) throw new HttpError(409, 'GEMINI_API_KEY non configurée.');
    if (!engine.projectDir(scan)) throw new HttpError(409, 'Build requis : le threat model doit être ancré dans le code.');
    try {
      await engine.draftThreatModel(scan);
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : 'Erreur Gemini.');
    }
    res.json({ threatModel: scan.threatModel, scan, model: store.state.llm.model });
  }));

  app.post('/api/scans/:id/ai/hypotheses', h(async (req, res) => {
    const scan = getScan(req.params.id);
    if (!canHunt(scan)) throw new HttpError(409, 'LOCK #1 : G0 doit être GO ou override.');
    if (!isGeminiConfigured()) throw new HttpError(409, 'GEMINI_API_KEY non configurée.');
    let created;
    try {
      created = await engine.draftHypotheses(scan);
    } catch (err) {
      if (err instanceof WorkspaceError) throw new HttpError(409, err.message);
      throw new HttpError(502, err instanceof Error ? err.message : 'Erreur Gemini.');
    }
    engine.recomputeStatus(scan);
    store.commit();
    res.json({ hypotheses: created, scan, model: store.state.llm.model });
  }));

  // Hypotheses (R6 / R9)
  app.get('/api/scans/:id/hypotheses', h((req, res) => {
    const scan = getScan(req.params.id);
    res.json({ hypotheses: scan.hypotheses, canCloseWithoutFindings: canCloseScanWithoutFindings(scan.hypotheses) });
  }));

  app.post('/api/scans/:id/hypotheses', h((req, res) => {
    const scan = getScan(req.params.id);
    if (!canHunt(scan)) throw new HttpError(409, 'LOCK #1 : G0 doit être GO ou override.');
    const title = str(req.body?.title, 500);
    const door = req.body?.door;
    if (!title) throw new HttpError(400, 'Titre requis.');
    if (!['door_a_untested', 'invariant', 'seam', 'tombstone_sibling'].includes(door)) throw new HttpError(400, 'Door invalide.');
    const targetFileLine = str(req.body?.targetFileLine, 300);
    const hyp = {
      id: newId('hyp'),
      scanId: scan.id,
      door,
      title,
      targetFileLine,
      targetVerified: verifyFileLine(engine.projectDir(scan), targetFileLine),
      outcome: 'in_progress' as const,
      testRunIds: [],
      updatedAt: new Date().toISOString(),
    };
    scan.hypotheses.unshift(hyp);
    engine.recomputeStatus(scan);
    store.commit();
    pushScanEvent(scan.id, 'hypothesis_updated', { scanId: scan.id });
    res.status(201).json({ hypothesis: hyp, scan });
  }));

  app.post('/api/scans/:id/hypotheses/:hypId/test', h((req, res) => {
    const scan = getScan(req.params.id);
    if (!canHunt(scan)) throw new HttpError(409, 'LOCK #1 : G0 doit être GO ou override.');
    if (!engine.projectDir(scan)) throw new HttpError(409, 'Build requis.');
    const run = engine.submitHypothesisTest(scan, req.params.hypId, validatePocSource(req.body?.pocSource));
    res.status(202).json({ run, scan });
  }));

  app.post('/api/scans/:id/hypotheses/:hypId/close', h((req, res) => {
    const scan = getScan(req.params.id);
    const hyp = scan.hypotheses.find((x) => x.id === req.params.hypId);
    if (!hyp) throw new HttpError(404, 'Hypothèse introuvable.');
    const { outcome, artifactId } = req.body || {};
    if (!['candidate', 'killed_by_artifact', 'abandoned_unproven'].includes(outcome)) throw new HttpError(400, 'Outcome invalide.');
    const run = engine.run(str(artifactId, 100));
    const ownRun = run && run.scanId === scan.id && run.subjectId === hyp.id ? run : null;
    if (outcome !== 'abandoned_unproven' && str(artifactId) && !ownRun) {
      throw new HttpError(400, 'R9 : artifactId doit désigner un run exécuté de CETTE hypothèse.');
    }
    const finalOutcome = classifyHypothesisClosure(outcome, ownRun);
    hyp.outcome = finalOutcome;
    hyp.artifactId = finalOutcome === 'abandoned_unproven' ? undefined : ownRun!.id;
    hyp.reason = str(req.body?.reason, 2000) || 'Clôturée par l’opérateur.';
    hyp.updatedAt = new Date().toISOString();
    scan.hunterLogs.push({
      id: newId('log'),
      timestamp: hyp.updatedAt.slice(11, 19),
      role: 'system',
      message: `close_hypothesis(${hyp.id}) -> ${finalOutcome}${hyp.artifactId ? ` [${hyp.artifactId}]` : outcome !== finalOutcome ? ' (rétrogradé : aucun run passant, R9)' : ''}`,
    });
    engine.recomputeStatus(scan);
    store.commit();
    pushScanEvent(scan.id, 'hypothesis_updated', { scanId: scan.id, hypothesisId: hyp.id });
    res.json({ hypothesis: hyp, scan });
  }));

  app.get('/api/runs/:id', h((req, res) => {
    const run = engine.run(req.params.id);
    if (!run) throw new HttpError(404, 'Run introuvable.');
    res.json({ run });
  }));

  app.get('/api/scans/:id/runs', h((req, res) => {
    const scan = getScan(req.params.id);
    res.json({ runs: store.state.runs.filter((r) => r.scanId === scan.id).map(({ output, ...rest }) => rest) });
  }));

  // Human path to a finding: PoC replayed in clean room before it becomes a candidate (LOCK #5)
  app.post('/api/tasks/:id/findings/from-poc', h((req, res) => {
    const scan = store.state.scans.find((s) => s.taskId === req.params.id || s.id === req.params.id);
    if (!scan) throw new HttpError(404, 'Scan/Tâche introuvable.');
    const projectDir = engine.projectDir(scan);
    if (!projectDir) throw new HttpError(409, 'Build requis : un PoC se rejoue contre le code construit.');
    const b = req.body || {};
    const title = str(b.title, 300);
    if (!title) throw new HttpError(400, 'Titre requis.');
    const severity = SEVERITIES.includes(b.severity) ? (b.severity as FindingSeverity) : null;
    if (!severity) throw new HttpError(400, 'Sévérité invalide.');
    const pocSource = validatePocSource(b.pocSource);
    const affectedFileLine = str(b.affectedFileLine, 300);
    if (!verifyFileLine(projectDir, affectedFileLine)) {
      throw new HttpError(400, `${affectedFileLine || 'fichier:ligne'} introuvable dans le workspace construit.`);
    }
    const impacts = scan.programScope?.verbatimImpacts ?? [];
    const impact = str(b.verbatimImpactLine, 4000);
    if (impact && !impacts.includes(impact)) throw new HttpError(400, 'La ligne d’impact doit être une des lignes verbatim attestées.');

    const [file, lineStr] = affectedFileLine.split(':');
    const src = fs.readFileSync(path.join(projectDir, file), 'utf8');
    const srcLines = src.split('\n');
    const lineNo = Number(lineStr);
    const fnName = /function\s+([A-Za-z0-9_$]+)/.exec(srcLines.slice(Math.max(0, lineNo - 1), lineNo + 2).join('\n'))?.[1];
    const affectedCode = (fnName && extractFunction(src, fnName)?.body) || srcLines.slice(lineNo - 1, lineNo + 24).join('\n');

    const now = new Date().toISOString();
    const id = newId('FND').toUpperCase();
    const finding: Finding = {
      id,
      scanId: scan.id,
      title,
      severity,
      status: 'replaying',
      source: 'human_from_poc',
      createdAt: now,
      summary: str(b.summary, 8000),
      verbatimImpactLine: impact || null,
      affectedFileLine,
      affectedCode: affectedCode.slice(0, 12_000),
      pocFile: `${scan.workspace!.layout.test}/polymorphe/${id.replace(/[^A-Za-z0-9_]/g, '_')}.t.sol`,
      pocSource,
      pocReplayCommand: '',
      pocReplayTrace: '',
      cleanRoomVerified: false,
      disconfirmer: {
        status: 'not_run',
        ranAt: null,
        legitimateAlternativeTest: '',
        notes: '',
        canKillFinding: false,
      },
      recommendation: str(b.recommendation, 8000),
      fixReviews: [],
    };
    store.state.findings.unshift(finding);
    engine.submitFindingReplay(scan, finding);
    res.status(202).json({ finding });
  }));

  // Findings
  app.get('/api/findings', (_req, res) => {
    res.json({
      findings: store.state.findings.map((f) => {
        const scan = engine.scan(f.scanId);
        return {
          ...f,
          programName: scan?.programName ?? 'Inconnu',
          targetKind: scan?.targetKind ?? 'local',
          scopeKind: scan?.scopeKind ?? 'commit_anchored',
        };
      }),
    });
  });

  app.get('/api/findings/:id', h((req, res) => {
    const { finding, scan } = getFinding(req.params.id);
    res.json({ finding, scan, replayRun: engine.run(finding.replayRunId) });
  }));

  // PATCH rejects operator_confirmed (G9 / LOCK #3)
  app.patch('/api/findings/:id', h((req, res) => {
    const { finding, scan } = getFinding(req.params.id);
    const { status, verbatimImpactLine } = req.body || {};
    if (status === 'operator_confirmed') {
      throw new HttpError(403, 'LOCK #3 (G9) : utilisez la feuille de sign-off POST /api/findings/:id/signoff.');
    }
    if (verbatimImpactLine !== undefined) {
      const impact = str(verbatimImpactLine, 4000);
      if (impact && !(scan.programScope?.verbatimImpacts ?? []).includes(impact)) {
        throw new HttpError(400, 'La ligne d’impact doit être une des lignes verbatim attestées.');
      }
      if (finding.status === 'operator_confirmed') throw new HttpError(409, 'Finding déjà validé : impact figé.');
      finding.verbatimImpactLine = impact || null;
    }
    if (status !== undefined) {
      if (!['rejected', 'hold', 'candidate'].includes(status)) throw new HttpError(400, 'Statut invalide.');
      if (status === 'candidate' && !finding.cleanRoomVerified) {
        throw new HttpError(409, 'LOCK #5 : « candidat » exige un rejeu clean-room réussi.');
      }
      finding.status = status;
    }
    store.commit();
    res.json({ finding });
  }));

  app.post('/api/findings/:id/replay', h((req, res) => {
    const { finding, scan } = getFinding(req.params.id);
    if (!engine.projectDir(scan)) throw new HttpError(409, 'Build requis.');
    if (finding.status === 'operator_confirmed') throw new HttpError(409, 'Finding déjà validé.');
    finding.status = 'replaying';
    engine.submitFindingReplay(scan, finding);
    res.status(202).json({ finding });
  }));

  app.post('/api/findings/:id/signoff', h((req, res) => {
    const { finding, scan } = getFinding(req.params.id);
    const b = req.body || {};
    const check = validateOperatorSignoff(
      {
        impactJustification: str(b.impactJustification, 8000),
        preconditionJustification: str(b.preconditionJustification, 8000),
        deploymentCheck: b.deploymentCheck,
        deploymentJustification: str(b.deploymentJustification, 8000),
        blockNumber: b.blockNumber === undefined || b.blockNumber === null ? undefined : Number(b.blockNumber),
      },
      scan.scopeKind,
      finding
    );
    if (!check.ok) throw new HttpError(400, check.error!);
    finding.status = 'operator_confirmed';
    finding.signoff = {
      confirmedAt: new Date().toISOString(),
      confirmedBy: requestUser(req),
      impactJustification: str(b.impactJustification, 8000),
      preconditionJustification: str(b.preconditionJustification, 8000),
      deploymentCheck: b.deploymentCheck,
      deploymentJustification: str(b.deploymentJustification, 8000),
      blockNumber: b.blockNumber ? Number(b.blockNumber) : undefined,
    };
    store.log('info', 'sc.signoff', `${finding.id} validé par ${requestUser(req)} (${finding.signoff.deploymentCheck}).`);
    store.commit();
    res.json({ finding });
  }));

  app.post('/api/findings/:id/export', h((req, res) => {
    const { finding, scan } = getFinding(req.params.id);
    const gate = canExportFinding(finding, scan);
    if (!gate.allowed) throw new HttpError(403, gate.reason!, gate.code);
    const format = (['immunefi', 'cantina', 'sherlock'].includes(req.body?.format) ? req.body.format : 'immunefi') as ExportFormat;
    const report = generateBountyReport(finding, scan, format, engine.run(finding.replayRunId) ?? undefined);
    res.json({ filename: report.filename, content: report.content, format });
  }));

  // Fix-review: replays the PoC on the PR head / commit. Never posts anything to GitHub.
  app.post('/api/findings/:id/fix-review', h((req, res) => {
    const { finding, scan } = getFinding(req.params.id);
    if (!finding.cleanRoomVerified) throw new HttpError(409, 'Le PoC doit d’abord passer sur le commit de base.');
    if (!engine.projectDir(scan) || scan.workspace?.source !== 'git') {
      throw new HttpError(409, 'Fix-review : workspace Git construit requis (pas de remote pour une copie locale).');
    }
    const input = str(req.body?.prOrCommitUrl, 500);
    let fetchRef: string;
    if (SHA_RE.test(input)) {
      fetchRef = input;
    } else {
      let u: URL;
      try {
        u = new URL(input);
      } catch {
        throw new HttpError(400, 'URL de PR GitHub, URL de commit ou SHA attendu.');
      }
      const parts = u.pathname.split('/').filter(Boolean);
      const repo = `https://github.com/${parts[0]}/${parts[1]}.git`;
      if (u.hostname !== 'github.com' || parts.length < 4) throw new HttpError(400, 'URL GitHub de PR ou de commit attendue.');
      if (repo.toLowerCase() !== scan.workspace.repoUrl.toLowerCase()) {
        throw new HttpError(400, `La PR/commit doit appartenir à ${scan.workspace.repoUrl}.`);
      }
      if (parts[2] === 'pull' && /^\d+$/.test(parts[3])) fetchRef = `pull/${parts[3]}/head`;
      else if (parts[2] === 'commit' && SHA_RE.test(parts[3])) fetchRef = parts[3];
      else throw new HttpError(400, 'URL GitHub de PR (/pull/N) ou de commit (/commit/SHA) attendue.');
    }
    const record = engine.submitFixReview(scan, finding, input, fetchRef);
    res.status(202).json({ fixReview: record, finding });
  }));

  // Disconfirmer (LOCK #4, R10: never kills a finding)
  app.post('/api/findings/:id/ai/disconfirmer', h(async (req, res) => {
    const { finding, scan } = getFinding(req.params.id);
    if (!isGeminiConfigured()) throw new HttpError(409, 'GEMINI_API_KEY non configurée.');
    if (!finding.cleanRoomVerified) throw new HttpError(409, 'Disconfirmer : un rejeu réussi est requis d’abord.');
    try {
      await engine.disconfirm(scan, finding);
    } catch (err) {
      if (err instanceof WorkspaceError) throw new HttpError(409, err.message);
      throw new HttpError(502, err instanceof Error ? err.message : 'Erreur Gemini.');
    }
    res.json({ finding, disconfirmer: finding.disconfirmer, model: store.state.llm.model });
  }));

  // Settings & doctor
  let doctorCache: { at: number; checks: DoctorCheck[] } | null = null;
  app.get('/api/doctor', h(async (_req, res) => {
    if (!doctorCache || Date.now() - doctorCache.at > 60_000) {
      const spec: Array<Omit<DoctorCheck, 'installed' | 'version'> & { args?: string[] }> = [
        { tool: 'forge', category: 'sc', required: true, installCmd: 'curl -L https://foundry.paradigm.xyz | bash && foundryup', impact: 'Build, ingest et rejeu des PoC.' },
        { tool: 'git', category: 'core', required: true, installCmd: 'apt-get install -y git', impact: 'Clone blobless, checkout du commit épinglé, fetch des PR.' },
        { tool: 'bwrap', category: 'core', required: true, installCmd: 'apt-get install -y bubblewrap', impact: 'Sandbox des builds et des PoC (code non fiable).' },
        { tool: 'cast', category: 'sc', required: false, installCmd: 'foundryup', impact: 'Non utilisé par le serveur (lectures RPC natives) ; utile en manuel.' },
        { tool: 'anvil', category: 'sc', required: false, installCmd: 'foundryup', impact: 'Non utilisé par cette version.' },
        { tool: 'slither', category: 'sc', required: false, installCmd: 'pipx install slither-analyzer', impact: 'Non exécuté par cette version (analyse statique manuelle).' },
        { tool: 'aderyn', category: 'sc', required: false, installCmd: 'cargo install aderyn', impact: 'Non exécuté par cette version.' },
        { tool: 'halmos', category: 'sc', required: false, installCmd: 'pipx install halmos', impact: 'Non exécuté par cette version.' },
      ];
      const checks: DoctorCheck[] = [];
      for (const s of spec) {
        const version = await toolVersion(s.tool, s.args);
        let installed = version !== null;
        let v = version ?? 'Non installé';
        if (s.tool === 'bwrap' && installed) {
          installed = await probeSandbox();
          if (!installed) v = `${v} — namespaces refusés (sandbox inutilisable)`;
        }
        checks.push({ tool: s.tool, category: s.category, required: s.required, installCmd: s.installCmd, impact: s.impact, installed, version: v });
      }
      checks.push({
        tool: 'GEMINI_API_KEY',
        category: 'core',
        required: false,
        installed: isGeminiConfigured(),
        version: isGeminiConfigured() ? 'configurée' : 'absente',
        installCmd: 'export GEMINI_API_KEY=… (ou Secrets AI Studio)',
        impact: 'Brouillons threat model, hypothèses et disconfirmer.',
      });
      doctorCache = { at: Date.now(), checks };
    }
    res.json({ checks: doctorCache.checks });
  }));

  app.get('/api/settings', h(async (_req, res) => {
    const configured = isGeminiConfigured();
    res.json({
      llm: {
        ...store.state.llm,
        configured,
        keyMasked: configured ? 'GEMINI_API_KEY présente (environnement serveur)' : 'GEMINI_API_KEY absente',
      },
      chains: store.state.chains,
      execution: {
        allowUnsandboxedExecution: store.state.settings.allowUnsandboxedExecution,
        sandboxAvailable: await engine.sandboxAvailable(),
      },
      setupCompleted: !auth.setupRequired,
      user: store.state.auth.user,
    });
  }));

  app.get('/api/settings/chains', (_req, res) => {
    res.json({ chains: store.state.chains });
  });

  app.put('/api/settings/chains', h((req, res) => {
    const { chains } = req.body || {};
    if (!Array.isArray(chains) || chains.length === 0 || chains.length > 50) throw new HttpError(400, 'Format chains invalide.');
    store.state.chains = chains.map((c: Partial<ChainSetting>) => {
      const chain = str(c.chain, 40);
      if (!/^[a-z0-9-]+$/.test(chain)) throw new HttpError(400, `Identifiant de chaîne invalide : ${chain}`);
      const rpcUrl = str(c.rpcUrl, 2000);
      const feed = str(c.nativeUsdFeed, 42);
      if (feed && !ADDRESS_RE.test(feed)) throw new HttpError(400, `Feed invalide pour ${chain}.`);
      const chainId = c.chainId === null || c.chainId === undefined || (c.chainId as unknown) === '' ? null : Number(c.chainId);
      if (chainId !== null && (!Number.isInteger(chainId) || chainId <= 0)) throw new HttpError(400, `chainId invalide pour ${chain}.`);
      return {
        chain,
        label: str(c.label, 80) || chain,
        chainId,
        rpcUrl: rpcUrl ? httpsUrl(rpcUrl, `RPC ${chain}`) : '',
        rpcConfigured: Boolean(rpcUrl),
        nativeUsdFeed: feed,
        nativeUsdFeedDescription: str(c.nativeUsdFeedDescription, 80) || 'ETH / USD',
        etherscanKeyMasked: '',
        minFundsAtRiskUsd: Math.max(0, Number(c.minFundsAtRiskUsd) || 0),
      };
    });
    store.log('info', 'settings.chains', 'Configuration RPC & seuils mise à jour.');
    store.commit();
    res.json({ chains: store.state.chains });
  }));

  app.put('/api/settings/llm', h((req, res) => {
    const { provider, model, defaultTokenBudget } = req.body || {};
    if (provider !== undefined) store.state.llm.provider = str(provider, 80) || store.state.llm.provider;
    if (model !== undefined) {
      const m = str(model, 80);
      if (!/^[A-Za-z0-9._-]+$/.test(m)) throw new HttpError(400, 'Nom de modèle invalide.');
      store.state.llm.model = m;
    }
    if (defaultTokenBudget !== undefined) {
      const n = Number(defaultTokenBudget);
      if (!Number.isInteger(n) || n < 1000 || n > 10_000_000) throw new HttpError(400, 'Budget : entier entre 1 000 et 10 000 000.');
      store.state.llm.defaultTokenBudget = n;
    }
    store.commit();
    const configured = isGeminiConfigured();
    res.json({ llm: { ...store.state.llm, configured, keyMasked: configured ? 'GEMINI_API_KEY présente' : 'GEMINI_API_KEY absente' } });
  }));

  app.put('/api/settings/execution', h((req, res) => {
    const v = req.body?.allowUnsandboxedExecution;
    if (typeof v !== 'boolean') throw new HttpError(400, 'allowUnsandboxedExecution : booléen requis.');
    store.state.settings.allowUnsandboxedExecution = v;
    store.log('warn', 'settings.execution', `Exécution hors sandbox ${v ? 'AUTORISÉE' : 'interdite'} par ${requestUser(req)}.`);
    store.commit();
    res.json({ execution: store.state.settings });
  }));

  app.get('/api/advanced', (_req, res) => {
    const model = store.state.llm.model;
    const llmOn = isGeminiConfigured();
    const snap: AdvancedSnapshot = {
      llmPool: [
        { id: 'slot-1', provider: store.state.llm.provider, model, role: 'planner (threat model + hypothèses)', active: llmOn },
        { id: 'slot-2', provider: store.state.llm.provider, model, role: 'disconfirmer (R13)', active: llmOn },
      ],
      agents: [
        {
          name: 'threat_modeler',
          role: 'Brouillon post-build ancré dans le code réel (pipeline_auto)',
          lock: 'R12, R16, G10 (merge)',
          guidanceExcerpt: 'Reçoit la liste des fichiers et le corps des fonctions Door A. N’invente aucun impact hors des lignes verbatim attestées.',
        },
        {
          name: 'planner',
          role: 'Génère des hypothèses ; chaque file:line est vérifié contre le workspace',
          lock: 'R6, LOCK #1',
          guidanceExcerpt: 'Une hypothèse ne se ferme en kill ou candidat que via un run forge exécuté et passant (R9).',
        },
        {
          name: 'disconfirmer',
          role: 'Contre-vérification après un rejeu réussi',
          lock: 'LOCK #4, R10, R13',
          guidanceExcerpt: 'Reçoit la sortie réelle du rejeu. Signale uniquement ; ne peut jamais tuer un candidat.',
        },
      ],
      skills: [
        { name: 'sc-foundry-cleanroom', scope: 'PoC Verification', enabled: true, description: 'forge test dans une copie fraîche, FOUNDRY_FFI=false, sandbox bwrap, deux répétitions.' },
        { name: 'sc-fix-review-replay', scope: 'Fix Review', enabled: true, description: 'Rejoue le PoC sur la tête de PR / le commit. Aucune publication sur GitHub.' },
        { name: 'sc-patchlag-siblings', scope: 'Fix Review', enabled: false, description: 'Recherche des sinks frères : non implémentée.' },
        { name: 'sc-web2-web3-seam', scope: 'Web2 ↔ Web3', enabled: false, description: 'Capture dApp : non implémentée.' },
      ],
      mcpTools: [],
      serverLogs: store.state.logs,
      capturedTraffic: [],
    };
    res.json(snap);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Route API inconnue.' });
  });

  // Vite dev / static production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || (process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1');
  app.listen(PORT, HOST, () => {
    console.log(`Polymorphe server listening on http://${HOST}:${PORT}`);
    console.log(`Data directory: ${store.dataDir}`);
    if (auth.setupToken) {
      console.log(`Setup token (first run only): ${auth.setupToken}`);
    }
  });
}

startServer();
