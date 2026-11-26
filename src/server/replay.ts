import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceInfo } from '../types';
import { runCommand, type SandboxSpec } from './exec';
import { forgeCommand, forgeEnv, git, sanitizeFoundryConfig, WorkspaceError } from './workspace';

const TEST_TIMEOUT_MS = 15 * 60_000;
const MAX_POC_BYTES = 200 * 1024;
const COPY_SKIP_TOP = new Set(['out', 'cache', 'broadcast', 'zkout']);

export interface ForgeTestSummary {
  compileFailed: boolean;
  testsPassed: number;
  testsFailed: number;
}

/** Parse `forge test` output. Prefer the per-suite result lines; fall back to [PASS]/[FAIL] markers. */
export function parseForgeTestOutput(output: string, exitCode: number): ForgeTestSummary {
  let passed = 0;
  let failed = 0;
  let suites = 0;
  for (const m of output.matchAll(/Suite result:\s*\w+\.\s*(\d+) passed;\s*(\d+) failed/g)) {
    suites++;
    passed += Number(m[1]);
    failed += Number(m[2]);
  }
  if (suites === 0) {
    passed = (output.match(/^\s*\[PASS\]/gm) ?? []).length;
    failed = (output.match(/^\s*\[FAIL/gm) ?? []).length > 0 ? 1 : 0;
  }
  const ranTests = suites > 0 || /\[(PASS|FAIL)/.test(output);
  const compileFailed =
    /Compiler run failed|Error \(\d{4}\)|error\[\d+\]:/.test(output) || (exitCode !== 0 && !ranTests);
  return { compileFailed, testsPassed: passed, testsFailed: failed };
}

export function validatePocSource(src: unknown): string {
  if (typeof src !== 'string' || !src.trim()) throw new WorkspaceError('Source PoC vide.');
  if (Buffer.byteLength(src) > MAX_POC_BYTES) throw new WorkspaceError('Source PoC > 200 Ko.');
  if (!/pragma\s+solidity/.test(src)) {
    throw new WorkspaceError('LOCK #5 : fichier Solidity complet attendu (pragma solidity + imports).');
  }
  if (!/function\s+test\w*\s*\(/.test(src)) {
    throw new WorkspaceError('LOCK #5 : le PoC doit contenir au moins une fonction test*().');
  }
  return src;
}

export function pocUsesFork(src: string): boolean {
  return /createSelectFork|createFork|FORK_RPC_URL|ETH_RPC_URL|rpcUrl\s*\(/.test(src);
}

export interface ReplayRequest {
  repoDir: string;
  workspace: WorkspaceInfo;
  runDir: string;
  pocSource: string;
  /** File stem, [A-Za-z0-9_] only. */
  pocName: string;
  repetitions: number;
  sandboxHome: string | null;
  forkRpcUrl?: string;
  /** Fix review: ref to fetch from origin and check out before running the PoC. */
  fetchRef?: string;
  signal?: AbortSignal;
}

export interface ReplayResult extends ForgeTestSummary {
  commit: string;
  command: string;
  exitCodes: number[];
  output: string;
  durationMs: number;
  cancelled: boolean;
}

export async function replayPoc(req: ReplayRequest): Promise<ReplayResult> {
  const started = Date.now();
  const forge = forgeCommand();
  if (!forge) throw new WorkspaceError('forge introuvable dans PATH.');
  const stem = req.pocName.replace(/[^A-Za-z0-9_]/g, '_');

  const repo = path.join(req.runDir, 'repo');
  fs.rmSync(req.runDir, { recursive: true, force: true });
  fs.mkdirSync(req.runDir, { recursive: true, mode: 0o700 });
  const keepGit = Boolean(req.fetchRef);
  const projectRel = req.workspace.projectDir;
  fs.cpSync(req.repoDir, repo, {
    recursive: true,
    filter: (from) => {
      const rel = path.relative(req.repoDir, from);
      if (!rel) return true;
      if (!keepGit && (rel === '.git' || rel.startsWith(`.git${path.sep}`))) return false;
      const relToProject = projectRel ? path.relative(path.join(req.repoDir, projectRel), from) : rel;
      const top = relToProject.split(path.sep)[0];
      if (!relToProject.startsWith('..') && COPY_SKIP_TOP.has(top)) return false;
      return !fs.lstatSync(from).isSymbolicLink();
    },
  });

  const log: string[] = [];
  let commit = req.workspace.commit;
  let layout = req.workspace.layout;
  const projectDir = path.join(repo, projectRel);

  if (req.fetchRef) {
    const fetch = await git(repo, ['fetch', '--filter=blob:none', 'origin', req.fetchRef], req.signal);
    log.push(`$ git fetch origin ${req.fetchRef}\n${fetch.output}`);
    if (fetch.exitCode !== 0) throw new WorkspaceError(`git fetch ${req.fetchRef} a échoué :\n${fetch.output.slice(-3000)}`);
    const co = await git(repo, ['checkout', '--detach', '--force', 'FETCH_HEAD'], req.signal);
    log.push(`$ git checkout FETCH_HEAD\n${co.output}`);
    if (co.exitCode !== 0) throw new WorkspaceError(`git checkout a échoué :\n${co.output.slice(-3000)}`);
    const sub = await git(repo, ['submodule', 'update', '--init', '--recursive', '--jobs', '4'], req.signal);
    log.push(`$ git submodule update\n${sub.output}`);
    if (sub.exitCode !== 0) throw new WorkspaceError(`git submodule update a échoué :\n${sub.output.slice(-3000)}`);
    const head = await git(repo, ['rev-parse', 'HEAD']);
    commit = head.output.trim();
    // The checkout restored the head's own foundry.toml: sanitise again.
    const sanitized = sanitizeFoundryConfig(projectDir);
    layout = sanitized.layout;
    if (sanitized.changes.length) log.push(`config neutralisée : ${sanitized.changes.join(' ; ')}`);
  }

  const testRel = path.join(layout.test, 'polymorphe', `${stem}.t.sol`);
  const testAbs = path.join(projectDir, testRel);
  fs.mkdirSync(path.dirname(testAbs), { recursive: true });
  fs.writeFileSync(testAbs, req.pocSource);

  const env: Record<string, string> = forgeEnv();
  const usesFork = pocUsesFork(req.pocSource);
  if (usesFork && req.forkRpcUrl) {
    env.FORK_RPC_URL = req.forkRpcUrl;
    env.ETH_RPC_URL = req.forkRpcUrl;
  }
  const args = ['test', '--match-path', testRel, '-vvv', '--color', 'never'];
  const command =
    `FOUNDRY_FFI=false${usesFork && req.forkRpcUrl ? ' FORK_RPC_URL=<rpc>' : ''} forge ${args.join(' ')}` +
    ` (commit ${commit}, ${req.repetitions} répétition(s)${req.sandboxHome ? ', sandbox bwrap' : ', SANS sandbox'})`;

  const sandbox: SandboxSpec | null = req.sandboxHome ? { home: req.sandboxHome, writable: [req.runDir] } : null;
  const exitCodes: number[] = [];
  let summary: ForgeTestSummary = { compileFailed: false, testsPassed: 0, testsFailed: 0 };
  let cancelled = false;
  for (let i = 0; i < req.repetitions; i++) {
    const r = await runCommand({
      cmd: forge,
      args,
      cwd: projectDir,
      env,
      timeoutMs: TEST_TIMEOUT_MS,
      sandbox,
      signal: req.signal,
    });
    exitCodes.push(r.exitCode);
    log.push(`=== run ${i + 1}/${req.repetitions} — exit ${r.exitCode} — ${Math.round(r.durationMs / 1000)} s ===\n${r.output}`);
    const s = parseForgeTestOutput(r.output, r.exitCode);
    if (i === 0) summary = s;
    else {
      // Any disagreement between repetitions is a non-determinism: keep the worst.
      summary = {
        compileFailed: summary.compileFailed || s.compileFailed,
        testsPassed: Math.min(summary.testsPassed, s.testsPassed),
        testsFailed: Math.max(summary.testsFailed, s.testsFailed),
      };
    }
    if (r.cancelled) {
      cancelled = true;
      break;
    }
    if (s.compileFailed) break; // repeating a compile failure proves nothing
  }

  return {
    ...summary,
    commit,
    command,
    exitCodes,
    output: log.join('\n\n'),
    durationMs: Date.now() - started,
    cancelled,
  };
}
