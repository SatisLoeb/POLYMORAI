import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canCloseScanWithoutFindings,
  canHunt,
  evaluateG0,
  isPassingRun,
} from '../core/doctrine';
import type {
  ExecRun,
  ExecRunKind,
  Finding,
  FixReviewRecord,
  ProvenanceResult,
  ScanRun,
  ScanStepKey,
  StepStatus,
  TargetKind,
} from '../types';
import { probeSandbox } from './exec';
import {
  buildSourceContext,
  generateHypothesesWithGemini,
  generateThreatModelWithGemini,
  isGeminiConfigured,
  runDisconfirmerWithGemini,
  verifyFileLine,
} from './gemini';
import { compareProvenance } from './provenance';
import { replayPoc } from './replay';
import { fetchComparableCode, measureOnchain } from './rpc';
import type { Store } from './store';
import {
  cloneRepo,
  copyLocal,
  findProjectDir,
  forgeBuild,
  ingestProject,
  readArtifacts,
  sanitizeFoundryConfig,
  WorkspaceError,
} from './workspace';

export type EventSink = (scanId: string, type: string, payload: unknown) => void;

interface Job {
  scanId: string;
  label: string;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<void>;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function hhmmss() {
  return nowIso().slice(11, 19);
}

export function classifyTarget(raw: string): {
  targetKind: TargetKind;
  scopeKind: ScanRun['scopeKind'];
  programName: string;
  pinnedCommit?: string;
} {
  const t = raw.trim();
  if (t.startsWith('/') || t.startsWith('./') || t.startsWith('~/')) {
    const base = t.split('/').filter(Boolean).pop() || 'local-target';
    return { targetKind: 'local', scopeKind: 'commit_anchored', programName: `${base} (Labo)` };
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new WorkspaceError('Cible non reconnue : URL https, dépôt Git ou chemin local absolu attendu.');
  }
  if (u.protocol !== 'https:') throw new WorkspaceError('Seules les URL https:// sont acceptées.');
  const parts = u.pathname.split('/').filter(Boolean);
  if (['github.com', 'gitlab.com', 'bitbucket.org'].includes(u.hostname) && parts.length >= 2) {
    const pin = (parts[2] === 'tree' || parts[2] === 'commit') && /^[0-9a-f]{7,40}$/i.test(parts[3] ?? '')
      ? parts[3]
      : undefined;
    return {
      targetKind: 'repo',
      scopeKind: 'commit_anchored',
      programName: `${parts[0]}/${parts[1].replace(/\.git$/, '')} (Labo)`,
      pinnedCommit: pin,
    };
  }
  // Program page: the name is a label only; every program fact must be attested by the operator.
  const slug = parts.filter((p) => !['bug-bounty', 'bounties', 'information', 'scope', 'contests'].includes(p)).pop();
  return {
    targetKind: 'program',
    scopeKind: 'deployed',
    programName: `${slug ?? u.hostname} — ${u.hostname}`,
  };
}

export function buildScanRecord(
  target: string,
  meta: ReturnType<typeof classifyTarget>,
  opts: { chain: string; surface: ScanRun['surface']; repoCount: number; tokensLimit: number }
): ScanRun {
  const id = newId('scan');
  const now = nowIso();
  const step = (key: ScanStepKey, detail: string) => ({ key, status: 'pending' as const, detail, updatedAt: now });
  return {
    id,
    taskId: `task-${id}`,
    targetUrl: target,
    programName: meta.programName,
    targetKind: meta.targetKind,
    scopeKind: meta.scopeKind,
    chain: opts.chain,
    maxBountyUsd: null,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    surface: opts.surface,
    repoCount: Math.max(1, Math.min(20, opts.repoCount)),
    executionMode: 'guided_autonomous',
    workerCount: 1,
    budget: {
      tokensUsed: 0,
      tokensLimit: opts.tokensLimit,
      elapsedSeconds: 0,
      maxSeconds: 1800,
      history: [{ tokensK: 0, hypothesesClosed: 0, findingsCount: 0 }],
    },
    steps: [
      {
        key: 'intake',
        status: 'done',
        detail:
          meta.targetKind === 'program'
            ? 'Page programme : statut, impacts et scope à attester (rien n’est déduit de l’URL).'
            : `Mode labo (${meta.targetKind}).`,
        updatedAt: now,
      },
      step('clone_build', 'En attente.'),
      step('ingest', 'En attente.'),
      step('g0', 'En attente.'),
      step('threat_model', 'En attente de G0.'),
      step('hunt', 'En attente de G0.'),
      step('candidates', 'Aucun finding.'),
    ],
    g0: { decision: 'needs_input', evaluatedAt: now, verdictLines: [] },
    ingest: {
      buildOk: false,
      foundryFfiDisabled: true,
      npmScriptsIgnored: true,
      sandbox: 'none',
      buildLog: '',
      contractsCount: 0,
      sourceFiles: [],
      untestedMonetaryFunctions: [],
      negativeSpaceSummary: 'Ingest non exécuté.',
      staticHits: [],
    },
    threatModel: {
      provenance: 'pipeline_auto',
      updatedAt: now,
      summary: '',
      verbatimImpacts: [],
      exclusions: [],
      tombstones: [],
      invariants: [],
      trustBoundaries: [],
    },
    hypotheses: [],
    hunterLogs: [
      { id: newId('log'), timestamp: now.slice(11, 19), role: 'system', message: `Scan créé (${meta.targetKind} / ${meta.scopeKind}).` },
    ],
    seamEvents: [],
  };
}

export class Engine {
  private queue: Job[] = [];
  private current: Job | null = null;
  private sandboxOk: boolean | null = null;

  constructor(private store: Store, private emit: EventSink) {}

  // ---------------------------------------------------------------- helpers

  scan(id: string): ScanRun | undefined {
    return this.store.state.scans.find((s) => s.id === id);
  }

  findingsOf(scanId: string): Finding[] {
    return this.store.state.findings.filter((f) => f.scanId === scanId);
  }

  run(id: string | undefined): ExecRun | null {
    if (!id) return null;
    return this.store.state.runs.find((r) => r.id === id) ?? null;
  }

  repoDir(scanId: string): string {
    return path.join(this.store.workspacesDir(), scanId, 'repo');
  }

  projectDir(scan: ScanRun): string | null {
    if (!scan.workspace || !scan.ingest.buildOk) return null;
    return path.join(this.repoDir(scan.id), scan.workspace.projectDir);
  }

  /** Resolves once the job queue is empty (tests, graceful shutdown). */
  async idle(pollMs = 200): Promise<void> {
    while (this.current || this.queue.length) await new Promise((r) => setTimeout(r, pollMs));
  }

  isBusy(scanId: string): boolean {
    return this.current?.scanId === scanId || this.queue.some((j) => j.scanId === scanId);
  }

  async sandboxAvailable(): Promise<boolean> {
    if (this.sandboxOk === null) this.sandboxOk = await probeSandbox();
    return this.sandboxOk;
  }

  /** Sandbox HOME for untrusted execution, null for (explicitly allowed) unsandboxed, throws otherwise. */
  private async sandboxHome(): Promise<string | null> {
    if (await this.sandboxAvailable()) return this.store.sandboxHome();
    if (this.store.state.settings.allowUnsandboxedExecution) return null;
    throw new WorkspaceError(
      'Sandbox bwrap indisponible : exécution de code non fiable refusée. Installez bubblewrap ou autorisez explicitement l’exécution hors sandbox dans Réglages.'
    );
  }

  private touch(scan: ScanRun, type = 'scan_updated') {
    scan.updatedAt = nowIso();
    this.store.commit();
    this.emit(scan.id, type, { scanId: scan.id, status: scan.status });
  }

  private setStep(scan: ScanRun, key: ScanStepKey, status: StepStatus, detail: string) {
    const step = scan.steps.find((s) => s.key === key);
    if (step) {
      step.status = status;
      step.detail = detail;
      step.updatedAt = nowIso();
    }
  }

  private log(scan: ScanRun, role: 'planner' | 'worker' | 'disconfirmer' | 'system', message: string, tokensUsed?: number) {
    scan.hunterLogs.push({ id: newId('log'), timestamp: hhmmss(), role, message, tokensUsed });
  }

  private newRun(scan: ScanRun, kind: ExecRunKind, subjectId?: string): ExecRun {
    const run: ExecRun = {
      id: newId(`run-${kind}`),
      scanId: scan.id,
      kind,
      subjectId,
      status: 'queued',
      command: '',
      commit: scan.workspace?.commit ?? 'unknown',
      sandbox: 'none',
      exitCodes: [],
      compileFailed: false,
      testsPassed: 0,
      testsFailed: 0,
      passed: false,
      output: '',
    };
    this.store.state.runs.push(run);
    return run;
  }

  recomputeStatus(scan: ScanRun) {
    if (this.isBusy(scan.id)) {
      scan.status = 'running';
      return;
    }
    if (scan.status === 'stopped') return;
    if (scan.g0.decision === 'no_go') {
      scan.status = 'no_go';
      return;
    }
    if (scan.g0.decision === 'needs_input') {
      scan.status = 'needs_input';
      return;
    }
    const buildStep = scan.steps.find((s) => s.key === 'clone_build');
    if (scan.targetKind !== 'program' && buildStep?.status === 'failed') {
      scan.status = 'failed';
      return;
    }
    if (scan.budget.tokensUsed >= scan.budget.tokensLimit) {
      scan.status = 'stopped';
      return;
    }
    const open = scan.hypotheses.some((h) => h.outcome === 'in_progress');
    const findings = this.findingsOf(scan.id).length;
    if (canHunt(scan) && !open && (findings > 0 || canCloseScanWithoutFindings(scan.hypotheses))) {
      scan.status = 'done';
    } else {
      scan.status = 'hunting';
    }
    const cand = this.findingsOf(scan.id);
    const verified = cand.filter((f) => f.cleanRoomVerified).length;
    this.setStep(
      scan,
      'candidates',
      cand.length ? 'done' : 'pending',
      cand.length ? `${cand.length} finding(s), ${verified} rejoué(s) avec succès.` : 'Aucun finding.'
    );
  }

  private refreshElapsed(scan: ScanRun) {
    const ms = this.store.state.runs
      .filter((r) => r.scanId === scan.id)
      .reduce((acc, r) => acc + (r.durationMs ?? 0), 0);
    scan.budget.elapsedSeconds = Math.round(ms / 1000);
  }

  // ------------------------------------------------------------------ queue

  /** LOCK #2: a single worker executes jobs one at a time. */
  enqueue(scanId: string, label: string, run: (signal: AbortSignal) => Promise<void>) {
    this.queue.push({ scanId, label, controller: new AbortController(), run });
    const scan = this.scan(scanId);
    if (scan) {
      this.recomputeStatus(scan);
      this.touch(scan);
    }
    void this.pump();
  }

  cancel(scanId: string): number {
    let n = 0;
    this.queue = this.queue.filter((j) => {
      if (j.scanId === scanId) {
        n++;
        return false;
      }
      return true;
    });
    if (this.current?.scanId === scanId) {
      this.current.controller.abort();
      n++;
    }
    return n;
  }

  private async pump() {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    const scan = this.scan(job.scanId);
    try {
      await job.run(job.controller.signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.log('warn', 'engine', `${job.scanId} · ${job.label} : ${msg.slice(0, 300)}`);
      if (scan) this.log(scan, 'system', `${job.label} : échec — ${msg.slice(0, 500)}`);
    } finally {
      this.current = null;
      if (scan) {
        this.refreshElapsed(scan);
        this.recomputeStatus(scan);
        this.touch(scan);
      }
      void this.pump();
    }
  }

  // --------------------------------------------------------------- pipeline

  repoSource(scan: ScanRun): { kind: 'git'; url: string; commit?: string } | { kind: 'local'; path: string } | null {
    if (scan.targetKind === 'local') return { kind: 'local', path: scan.targetUrl };
    if (scan.targetKind === 'repo') {
      return { kind: 'git', url: scan.targetUrl, commit: classifyTarget(scan.targetUrl).pinnedCommit ?? scan.workspace?.commit };
    }
    if (scan.programScope?.repoUrl) {
      return { kind: 'git', url: scan.programScope.repoUrl, commit: scan.programScope.pinnedCommit };
    }
    return null;
  }

  /** Full pipeline: prepare + build + ingest (when a repo is known), then measure + G0, then LLM drafts. */
  startPipeline(scan: ScanRun, opts: { rebuild: boolean }) {
    this.enqueue(scan.id, 'pipeline', async (signal) => {
      if (opts.rebuild || !scan.workspace) await this.prepareAndBuild(scan, signal);
      await this.measureAndEvaluate(scan);
      await this.autoDrafts(scan);
    });
  }

  private async prepareAndBuild(scan: ScanRun, signal: AbortSignal) {
    const source = this.repoSource(scan);
    if (!source && scan.targetKind === 'program' && !scan.programScope) {
      this.setStep(scan, 'clone_build', 'pending', 'En attente du scope programme attesté (dépôt + commit).');
      this.setStep(scan, 'ingest', 'pending', 'En attente du build.');
      this.touch(scan);
      return;
    }
    if (!source) {
      this.setStep(scan, 'clone_build', 'blocked', 'Aucun dépôt fourni dans le scope du programme.');
      this.setStep(scan, 'ingest', 'blocked', 'Pas de code à ingérer.');
      this.touch(scan);
      return;
    }
    const sandboxHome = await this.sandboxHome().catch((err: Error) => {
      this.setStep(scan, 'clone_build', 'failed', err.message);
      this.touch(scan);
      throw err;
    });

    this.setStep(scan, 'clone_build', 'running', source.kind === 'git' ? `git clone ${source.url}…` : 'Copie locale…');
    this.touch(scan);
    const repoDir = this.repoDir(scan.id);
    let prepared: { commit: string; log: string };
    try {
      prepared = source.kind === 'git'
        ? await cloneRepo(source.url, repoDir, source.commit, signal)
        : await copyLocal(source.path, repoDir);
    } catch (err) {
      this.setStep(scan, 'clone_build', 'failed', err instanceof Error ? err.message.slice(0, 300) : 'Préparation échouée.');
      scan.ingest.buildOk = false;
      scan.ingest.buildLog = err instanceof Error ? err.message : String(err);
      this.touch(scan);
      throw err;
    }

    const projectDir = findProjectDir(repoDir);
    const { changes, layout } = sanitizeFoundryConfig(projectDir);
    scan.workspace = {
      source: source.kind,
      repoUrl: source.kind === 'git' ? source.url : source.path,
      commit: prepared.commit,
      preparedAt: nowIso(),
      projectDir: path.relative(repoDir, projectDir),
      layout,
      sanitizedConfig: changes,
    };

    const run = this.newRun(scan, 'build');
    run.status = 'running';
    run.startedAt = nowIso();
    run.sandbox = sandboxHome ? 'bwrap' : 'none';
    run.commit = prepared.commit;
    run.command = `FOUNDRY_FFI=false forge build (${scan.workspace.projectDir || '.'}, commit ${prepared.commit}${sandboxHome ? ', sandbox bwrap' : ', SANS sandbox'})`;
    this.setStep(scan, 'clone_build', 'running', `forge build @ ${prepared.commit.slice(0, 12)}…`);
    this.touch(scan);

    const res = await forgeBuild(projectDir, sandboxHome ? { home: sandboxHome, writable: [repoDir] } : null, signal);
    run.status = res.cancelled ? 'cancelled' : 'finished';
    run.finishedAt = nowIso();
    run.durationMs = res.durationMs;
    run.exitCodes = [res.exitCode];
    run.compileFailed = res.exitCode !== 0;
    run.passed = res.exitCode === 0;
    run.output = res.output;

    scan.ingest = {
      ...scan.ingest,
      buildOk: res.exitCode === 0,
      foundryFfiDisabled: true,
      npmScriptsIgnored: true,
      sandbox: sandboxHome ? 'bwrap' : 'none',
      buildRunId: run.id,
      buildLog:
        `${prepared.log}\n` +
        (changes.length ? `Config neutralisée : ${changes.join(' ; ')}\n` : '') +
        `$ ${run.command}\n${res.output}`,
    };

    if (res.exitCode !== 0) {
      this.setStep(scan, 'clone_build', 'failed', `forge build exit ${res.exitCode}${res.timedOut ? ' (timeout)' : ''} — voir le log.`);
      this.setStep(scan, 'ingest', 'blocked', 'Build en échec.');
      this.log(scan, 'system', `forge build a échoué (exit ${res.exitCode}) sur ${prepared.commit}.`);
      this.touch(scan);
      return;
    }
    this.setStep(scan, 'clone_build', 'done', `Build OK @ ${prepared.commit.slice(0, 12)} (${Math.round(res.durationMs / 1000)} s, ${run.sandbox}).`);

    this.setStep(scan, 'ingest', 'running', 'Lecture des artefacts…');
    this.touch(scan);
    const artifacts = readArtifacts(projectDir, layout);
    const ing = ingestProject(projectDir, layout, artifacts);
    scan.ingest = { ...scan.ingest, ...ing };
    this.setStep(
      scan,
      'ingest',
      'done',
      `${ing.contractsCount} contrat(s) concret(s), ${ing.untestedMonetaryFunctions.length} fonction(s) mutatrice(s) non testée(s).`
    );
    this.log(scan, 'system', `Ingest : ${ing.negativeSpaceSummary}`);
    this.touch(scan);
  }

  private chainOf(scan: ScanRun) {
    const name = scan.programScope?.chain ?? scan.chain;
    return this.store.state.chains.find((c) => c.chain === name) ?? null;
  }

  /** Executed RPC measurement + provenance, then the deterministic G0. */
  async measureAndEvaluate(scan: ScanRun) {
    const chain = this.chainOf(scan);
    if (scan.programScope) {
      scan.chain = scan.programScope.chain;
      scan.scopeKind = scan.programScope.scopeKind;
      scan.maxBountyUsd = scan.programScope.maxBountyUsd;
      scan.threatModel.verbatimImpacts = scan.programScope.verbatimImpacts;
      scan.threatModel.tombstones = [...new Set([...scan.threatModel.tombstones, ...scan.programScope.knownIssues])];
    }
    const deployed = scan.scopeKind !== 'commit_anchored';
    const addresses = scan.programScope?.scopeAddresses ?? [];
    let provenance: ProvenanceResult[] | null = null;

    if (deployed && chain?.rpcConfigured && addresses.length > 0) {
      this.setStep(scan, 'g0', 'running', `Lecture RPC ${chain.chain} (${addresses.length} adresse(s))…`);
      this.touch(scan);
      try {
        scan.onchain = await measureOnchain(chain, addresses);
        const projectDir = this.projectDir(scan);
        if (projectDir && scan.workspace) {
          const contracts = readArtifacts(projectDir, scan.workspace.layout);
          provenance = [];
          for (const m of scan.onchain.addresses) {
            const { comparedAddress, code } = await fetchComparableCode(chain, m, scan.onchain.blockNumber);
            provenance.push(compareProvenance(m.address, comparedAddress, scan.onchain.blockNumber, code, contracts));
          }
          scan.ingest.provenance = provenance;
          const first = provenance[0];
          scan.ingest.provenanceMatch = first
            ? {
                chain: chain.chain,
                address: first.address,
                blockNumber: first.blockNumber,
                pinnedCommit: scan.workspace.commit,
                status: provenance.every((p) => p.status === 'matched') ? 'matched' : 'diverged',
              }
            : undefined;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(scan, 'system', `Mesure on-chain échouée : ${msg}`);
        scan.onchain = undefined;
      }
    }

    scan.g0 = {
      ...evaluateG0({
        targetKind: scan.targetKind,
        scopeKind: scan.scopeKind,
        targetUrl: scan.targetUrl,
        programScope: scan.programScope ?? null,
        chain: scan.chain,
        rpcConfigured: Boolean(chain?.rpcConfigured),
        onchain: scan.onchain ?? null,
        fundsAttestation: scan.fundsAttestation ?? null,
        minFundsAtRiskUsd: chain?.minFundsAtRiskUsd ?? 100_000,
        provenance,
        pinnedCommit: scan.workspace?.commit,
        extraTombstones: scan.threatModel.tombstones,
        now: new Date(),
      }),
      // An override survives re-evaluation: it is the operator's logged decision.
      ...(scan.g0.decision === 'go_override'
        ? {
            decision: 'go_override' as const,
            overrideReason: scan.g0.overrideReason,
            overrideBy: scan.g0.overrideBy,
            overrideAt: scan.g0.overrideAt,
          }
        : {}),
    };
    const d = scan.g0.decision;
    this.setStep(
      scan,
      'g0',
      d === 'no_go' ? 'blocked' : d === 'needs_input' ? 'needs_input' : 'done',
      `Verdict déterministe : ${d.toUpperCase()}`
    );
    const huntable = canHunt(scan);
    this.setStep(scan, 'threat_model', huntable ? 'pending' : d === 'no_go' ? 'blocked' : 'pending',
      huntable ? 'Prêt (brouillon LLM ou édition manuelle).' : 'En attente de G0.');
    this.setStep(scan, 'hunt', huntable ? 'pending' : d === 'no_go' ? 'blocked' : 'pending',
      huntable ? (this.projectDir(scan) ? 'Prêt.' : 'Build requis pour tester des hypothèses.') : 'Bloqué par G0 (LOCK #1).');
    this.log(scan, 'system', `G0 réévalué : ${d.toUpperCase()}.`);
    this.store.log('info', 'g0.verdict', `${scan.id} -> ${d}`);
    this.touch(scan);
  }

  private budgetLeft(scan: ScanRun): boolean {
    return scan.budget.tokensUsed < scan.budget.tokensLimit;
  }

  private spend(scan: ScanRun, tokens: number) {
    scan.budget.tokensUsed += tokens;
    scan.budget.history.push({
      tokensK: Math.round(scan.budget.tokensUsed / 1000),
      hypothesesClosed: scan.hypotheses.filter((h) => h.outcome !== 'in_progress').length,
      findingsCount: this.findingsOf(scan.id).length,
    });
  }

  /** Threat model + first hypotheses, only when allowed (G0), configured (key), affordable (budget) and grounded (build). */
  private async autoDrafts(scan: ScanRun) {
    if (!canHunt(scan) || !isGeminiConfigured() || !this.projectDir(scan)) return;
    if (scan.threatModel.provenance === 'pipeline_auto' && !scan.threatModel.summary && this.budgetLeft(scan)) {
      await this.draftThreatModel(scan).catch((err: Error) => this.log(scan, 'planner', `Threat model LLM : ${err.message}`));
    }
    if (scan.hypotheses.length === 0 && this.budgetLeft(scan)) {
      await this.draftHypotheses(scan).catch((err: Error) => this.log(scan, 'planner', `Hypothèses LLM : ${err.message}`));
    }
  }

  async draftThreatModel(scan: ScanRun) {
    if (!this.budgetLeft(scan)) throw new WorkspaceError('Budget tokens épuisé : prolongez-le.');
    const model = this.store.state.llm.model;
    this.setStep(scan, 'threat_model', 'running', `Brouillon ${model}…`);
    this.touch(scan);
    const draft = await generateThreatModelWithGemini(scan, model, buildSourceContext(scan, this.projectDir(scan)));
    this.spend(scan, draft.tokens);
    scan.threatModel = {
      ...scan.threatModel,
      provenance: 'pipeline_auto',
      updatedAt: nowIso(),
      summary: draft.summary,
      invariants: draft.invariants,
      trustBoundaries: draft.trustBoundaries,
    };
    this.setStep(scan, 'threat_model', 'done', 'Brouillon LLM (pipeline_auto) — à relire et approuver.');
    this.log(scan, 'planner', `Threat model : ${draft.invariants.length} invariants via ${model}.`, draft.tokens);
    this.touch(scan, 'threat_model_updated');
  }

  async draftHypotheses(scan: ScanRun) {
    if (!this.budgetLeft(scan)) throw new WorkspaceError('Budget tokens épuisé : prolongez-le.');
    const projectDir = this.projectDir(scan);
    if (!projectDir) throw new WorkspaceError('Build requis : sans code, les hypothèses ne seraient pas ancrées.');
    const model = this.store.state.llm.model;
    const out = await generateHypothesesWithGemini(scan, model, buildSourceContext(scan, projectDir));
    this.spend(scan, out.tokens);
    const now = nowIso();
    const created = out.items.map((item) => ({
      id: newId('hyp'),
      scanId: scan.id,
      door: item.door,
      title: item.title,
      targetFileLine: item.targetFileLine,
      targetVerified: verifyFileLine(projectDir, item.targetFileLine),
      outcome: 'in_progress' as const,
      testRunIds: [],
      updatedAt: now,
    }));
    scan.hypotheses = [...created, ...scan.hypotheses];
    const unverified = created.filter((h) => !h.targetVerified).length;
    this.setStep(scan, 'hunt', 'running', `${scan.hypotheses.filter((h) => h.outcome === 'in_progress').length} hypothèse(s) ouverte(s).`);
    this.log(scan, 'planner', `${created.length} hypothèse(s) via ${model}${unverified ? ` (${unverified} file:line introuvable(s) dans le dépôt)` : ''}.`, out.tokens);
    this.touch(scan, 'hypothesis_updated');
    return created;
  }

  // ------------------------------------------------------------------ runs

  private async execReplay(
    scan: ScanRun,
    run: ExecRun,
    pocSource: string,
    pocName: string,
    repetitions: number,
    signal: AbortSignal,
    fetchRef?: string
  ) {
    const projectDir = this.projectDir(scan);
    if (!projectDir || !scan.workspace) throw new WorkspaceError('Workspace non construit.');
    const sandboxHome = await this.sandboxHome();
    const runDir = path.join(this.store.workspacesDir(), scan.id, 'runs', run.id);
    run.status = 'running';
    run.startedAt = nowIso();
    run.sandbox = sandboxHome ? 'bwrap' : 'none';
    this.touch(scan);
    try {
      const chain = this.chainOf(scan);
      const res = await replayPoc({
        repoDir: this.repoDir(scan.id),
        workspace: scan.workspace,
        runDir,
        pocSource,
        pocName,
        repetitions,
        sandboxHome,
        forkRpcUrl: chain?.rpcConfigured ? chain.rpcUrl : undefined,
        fetchRef,
        signal,
      });
      run.status = res.cancelled ? 'cancelled' : 'finished';
      run.command = res.command;
      run.commit = res.commit;
      run.exitCodes = res.exitCodes;
      run.compileFailed = res.compileFailed;
      run.testsPassed = res.testsPassed;
      run.testsFailed = res.testsFailed;
      run.output = res.output;
      run.durationMs = res.durationMs;
      run.passed = isPassingRun(run);
    } catch (err) {
      run.status = 'error';
      run.error = err instanceof Error ? err.message : String(err);
      run.output = run.error;
      run.passed = false;
    } finally {
      run.finishedAt = nowIso();
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  }

  /** LOCK #5: the human path to a finding goes through an executed clean-room replay (2 repetitions). */
  submitFindingReplay(scan: ScanRun, finding: Finding) {
    const run = this.newRun(scan, 'poc_replay', finding.id);
    finding.replayRunId = run.id;
    this.store.commit();
    this.enqueue(scan.id, `rejeu ${finding.id}`, async (signal) => {
      await this.execReplay(scan, run, finding.pocSource, finding.id, 2, signal);
      finding.pocReplayCommand = run.command;
      finding.pocReplayTrace = run.output.slice(-12_000);
      finding.cleanRoomVerified = run.passed;
      finding.status = run.passed ? 'candidate' : 'replay_failed';
      this.log(
        scan,
        'worker',
        `Rejeu ${finding.id} : ${run.passed ? 'PASS' : 'ÉCHEC'} (exit ${run.exitCodes.join('/') || '—'}, ${run.testsPassed} pass / ${run.testsFailed} fail${run.compileFailed ? ', compilation échouée' : ''}).`
      );
      this.touch(scan);
      if (run.passed && isGeminiConfigured() && this.budgetLeft(scan)) {
        await this.disconfirm(scan, finding).catch((err: Error) =>
          this.log(scan, 'disconfirmer', `Disconfirmer : ${err.message}`)
        );
      }
    });
  }

  async disconfirm(scan: ScanRun, finding: Finding) {
    if (!this.budgetLeft(scan)) throw new WorkspaceError('Budget tokens épuisé : prolongez-le.');
    const model = this.store.state.llm.model;
    const review = await runDisconfirmerWithGemini(finding, scan, model);
    this.spend(scan, review.tokens);
    const { tokens, ...rest } = review;
    finding.disconfirmer = rest;
    this.log(scan, 'disconfirmer', `R13 ${finding.id} -> ${review.status} (${model}).`, tokens);
    this.touch(scan);
  }

  /** R9: the artifact behind a kill / candidate closure is an executed test run. */
  submitHypothesisTest(scan: ScanRun, hypId: string, pocSource: string): ExecRun {
    const hyp = scan.hypotheses.find((h) => h.id === hypId);
    if (!hyp) throw new WorkspaceError('Hypothèse introuvable.');
    const run = this.newRun(scan, 'kill_test', hyp.id);
    hyp.testRunIds = [...(hyp.testRunIds ?? []), run.id];
    this.store.commit();
    this.enqueue(scan.id, `test ${hyp.id}`, async (signal) => {
      await this.execReplay(scan, run, pocSource, `H_${hyp.id.replace(/[^A-Za-z0-9]/g, '_')}`, 2, signal);
      this.log(scan, 'worker', `Test ${hyp.id} : ${run.passed ? 'PASS' : 'ÉCHEC'} [${run.id}].`);
      this.touch(scan, 'hypothesis_updated');
    });
    return run;
  }

  submitFixReview(scan: ScanRun, finding: Finding, prOrCommitUrl: string, fetchRef: string): FixReviewRecord {
    const run = this.newRun(scan, 'fix_review', finding.id);
    const record: FixReviewRecord = {
      id: newId('fr'),
      findingId: finding.id,
      prOrCommitUrl,
      ranAt: nowIso(),
      status: 'running',
      baseCommit: scan.workspace?.commit ?? 'unknown',
      headCommit: fetchRef,
      verdict: 'pending',
      runId: run.id,
      pocReplayExitCode: null,
      pocReplayOutput: '',
      siblingSinks: [],
      summaryMarkdown: '',
    };
    finding.fixReviews.unshift(record);
    this.store.commit();
    this.enqueue(scan.id, `fix-review ${finding.id}`, async (signal) => {
      await this.execReplay(scan, run, finding.pocSource, `FR_${finding.id}`, 1, signal, fetchRef);
      record.status = run.status === 'error' ? 'error' : 'finished';
      record.headCommit = run.commit;
      record.pocReplayExitCode = run.exitCodes[0] ?? null;
      record.pocReplayOutput = run.output.slice(-12_000);
      record.error = run.error;
      record.verdict =
        run.status !== 'finished' || run.compileFailed || run.testsPassed + run.testsFailed === 0
          ? 'inconclusive'
          : run.passed
            ? 'still_reproducible'
            : 'fixed';
      const verdictText = {
        fixed: 'PoC FAILS on head — exploit no longer reproduces',
        still_reproducible: 'PoC STILL PASSES on head — exploit reproduces',
        inconclusive: 'Inconclusive — PoC did not compile or did not run on head',
        pending: 'pending',
      }[record.verdict];
      record.summaryMarkdown = `### Fix Review — ${finding.id} (${record.verdict.toUpperCase()})
- **Target**: \`${prOrCommitUrl}\` (\`${record.baseCommit.slice(0, 12)}..${record.headCommit.slice(0, 12)}\`)
- **PoC replay**: ${verdictText} (exit ${record.pocReplayExitCode ?? 'n/a'}, ${run.testsPassed} passed / ${run.testsFailed} failed)
- **Sibling sinks**: not analysed by this version
- **Command**: \`${run.command}\``;
      this.log(scan, 'worker', `Fix-review ${finding.id} sur ${record.headCommit.slice(0, 12)} -> ${record.verdict}.`);
      this.touch(scan);
    });
    return record;
  }
}
