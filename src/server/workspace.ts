import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { IngestResult } from '../types';
import { runCommand, which, type RunResult, type SandboxSpec } from './exec';
import type { BuiltContract } from './provenance';

const GIT_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 20 * 60_000;
const MAX_TEST_CORPUS_BYTES = 24 * 1024 * 1024;
const SKIP_COPY = new Set(['out', 'cache', 'broadcast', 'cache_forge', 'zkout']);

export const SHA_RE = /^[0-9a-f]{7,40}$/i;

export class WorkspaceError extends Error {}

/** Only public https remotes. No ssh (would use the operator's keys), no file://, no local paths. */
export function validateRepoUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new WorkspaceError('URL de dépôt invalide.');
  }
  if (u.protocol !== 'https:') throw new WorkspaceError('Seuls les dépôts https:// sont acceptés.');
  if (u.username || u.password) throw new WorkspaceError('Identifiants interdits dans l’URL du dépôt.');
  if (u.hostname === 'github.com') {
    const parts = u.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    if (parts.length < 2) throw new WorkspaceError('URL GitHub attendue : https://github.com/<owner>/<repo>.');
    return `https://github.com/${parts[0]}/${parts[1]}.git`;
  }
  return u.toString();
}

/** git with no user/system config (no credential helpers, no insteadOf to ssh), https only. */
function gitEnv(): Record<string, string> {
  return {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    // Operator-level override (tests use 'https:file'); never derived from the target.
    GIT_ALLOW_PROTOCOL: process.env.POLYMORPHE_GIT_ALLOW_PROTOCOL || 'https',
    GIT_LFS_SKIP_SMUDGE: '1',
    GCM_INTERACTIVE: 'never',
  };
}

const GIT_HARDENING = [
  '-c', 'core.symlinks=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'url.https://github.com/.insteadOf=git@github.com:',
  '-c', 'url.https://github.com/.insteadOf=ssh://git@github.com/',
];

export async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<RunResult> {
  return runCommand({
    cmd: 'git',
    args: [...GIT_HARDENING, ...args],
    cwd,
    env: gitEnv(),
    timeoutMs: GIT_TIMEOUT_MS,
    signal,
  });
}

async function gitOk(cwd: string, args: string[], what: string, signal?: AbortSignal): Promise<string> {
  const r = await git(cwd, args, signal);
  if (r.exitCode !== 0) throw new WorkspaceError(`${what} a échoué (exit ${r.exitCode}) :\n${r.output.slice(-4000)}`);
  return r.output.trim();
}

export async function cloneRepo(
  repoUrl: string,
  dest: string,
  commit: string | undefined,
  signal?: AbortSignal
): Promise<{ commit: string; log: string }> {
  const url = validateRepoUrl(repoUrl);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const logs: string[] = [];
  logs.push(await gitOk(path.dirname(dest), ['clone', '--filter=blob:none', '--no-checkout', '--', url, dest], 'git clone', signal));
  await gitOk(dest, ['config', 'core.symlinks', 'false'], 'git config');
  const ref = commit?.trim() || 'HEAD';
  if (commit && !SHA_RE.test(commit.trim())) throw new WorkspaceError('Commit épinglé invalide (SHA hexadécimal attendu).');
  const has = await git(dest, ['cat-file', '-e', `${ref}^{commit}`]);
  if (has.exitCode !== 0 && commit) {
    logs.push(await gitOk(dest, ['fetch', '--filter=blob:none', 'origin', commit.trim()], 'git fetch du commit', signal));
  }
  logs.push(await gitOk(dest, ['checkout', '--detach', ref], 'git checkout', signal));
  logs.push(await gitOk(dest, ['submodule', 'update', '--init', '--recursive', '--jobs', '4'], 'git submodule update', signal));
  const sha = await gitOk(dest, ['rev-parse', 'HEAD'], 'git rev-parse');
  return { commit: sha, log: logs.filter(Boolean).join('\n') };
}

function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Copy a local project, dropping symlinks (they could point anywhere on the host) and build outputs. */
export async function copyLocal(srcRaw: string, dest: string): Promise<{ commit: string; log: string }> {
  const src = path.resolve(expandHome(srcRaw.trim()));
  const st = fs.statSync(src, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new WorkspaceError(`Chemin local introuvable ou non-répertoire : ${src}`);
  fs.rmSync(dest, { recursive: true, force: true });
  let skippedLinks = 0;
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (from) => {
      const rel = path.relative(src, from);
      if (rel && SKIP_COPY.has(rel.split(path.sep)[0])) return false;
      if (fs.lstatSync(from).isSymbolicLink()) {
        skippedLinks += 1;
        return false;
      }
      return true;
    },
  });
  // Only rev-parse: status/diff would hash the worktree and could run clean filters
  // declared in the copied .git/config.
  let commit = 'worktree';
  if (fs.existsSync(path.join(dest, '.git'))) {
    const head = await git(dest, ['rev-parse', 'HEAD']);
    if (head.exitCode === 0) commit = `${head.output.trim()}+worktree`;
  }
  return { commit, log: `Copie locale de ${src} (${skippedLinks} lien(s) symbolique(s) ignoré(s)).` };
}

/** Locate the Foundry project root: the repo root, or the shallowest foundry.toml (monorepos). */
export function findProjectDir(repoDir: string): string {
  if (fs.existsSync(path.join(repoDir, 'foundry.toml'))) return repoDir;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: repoDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (depth > 3) continue;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ['node_modules', 'lib', '.git', 'out', 'cache'].includes(ent.name)) continue;
      const sub = path.join(dir, ent.name);
      if (fs.existsSync(path.join(sub, 'foundry.toml'))) return sub;
      queue.push({ dir: sub, depth: depth + 1 });
    }
  }
  return repoDir;
}

export interface FoundryLayout {
  src: string;
  test: string;
  out: string;
}

function isEscapingPath(p: string): boolean {
  return path.isAbsolute(p) || path.normalize(p).split(path.sep).includes('..');
}

/**
 * Neutralise the foundry.toml knobs that turn a build into code execution or host file access:
 * ffi, solc pointing at a binary path, fs_permissions, allow_paths, absolute remappings.
 * Env FOUNDRY_FFI=false is also set at run time; this is defence in depth.
 */
export function sanitizeFoundryConfig(projectDir: string): { changes: string[]; layout: FoundryLayout } {
  const changes: string[] = [];
  const layout: FoundryLayout = { src: 'src', test: 'test', out: 'out' };
  const tomlPath = path.join(projectDir, 'foundry.toml');

  if (fs.existsSync(tomlPath)) {
    let doc: Record<string, unknown>;
    try {
      doc = parseToml(fs.readFileSync(tomlPath, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      throw new WorkspaceError(`foundry.toml illisible : ${err instanceof Error ? err.message : String(err)}`);
    }
    const profiles = (doc.profile ?? {}) as Record<string, Record<string, unknown>>;
    for (const [name, p] of Object.entries(profiles)) {
      if (!p || typeof p !== 'object') continue;
      if (p.ffi) {
        p.ffi = false;
        changes.push(`profile.${name}.ffi -> false`);
      }
      if (p.fs_permissions !== undefined) {
        p.fs_permissions = [{ access: 'read', path: './' }];
        changes.push(`profile.${name}.fs_permissions -> read ./ uniquement`);
      }
      for (const key of ['solc', 'solc_version']) {
        const v = p[key];
        if (typeof v === 'string' && /[\\/]/.test(v)) {
          delete p[key];
          changes.push(`profile.${name}.${key} (chemin binaire "${v}") supprimé`);
        }
      }
      for (const key of ['allow_paths', 'include_paths']) {
        if (p[key] !== undefined) {
          delete p[key];
          changes.push(`profile.${name}.${key} supprimé`);
        }
      }
      if (Array.isArray(p.remappings)) {
        const kept = p.remappings.filter((r) => {
          const target = String(r).split('=').slice(1).join('=');
          return !isEscapingPath(target);
        });
        if (kept.length !== p.remappings.length) {
          changes.push(`profile.${name}.remappings : ${p.remappings.length - kept.length} entrée(s) hors projet supprimée(s)`);
          p.remappings = kept;
        }
      }
      for (const key of ['src', 'test', 'script', 'out', 'cache_path', 'broadcast']) {
        const v = p[key];
        if (typeof v === 'string' && isEscapingPath(v)) {
          throw new WorkspaceError(`foundry.toml : profile.${name}.${key}="${v}" sort du projet — build refusé.`);
        }
      }
      if (Array.isArray(p.libs) && p.libs.some((l) => isEscapingPath(String(l)))) {
        throw new WorkspaceError(`foundry.toml : profile.${name}.libs sort du projet — build refusé.`);
      }
    }
    const def = profiles.default ?? {};
    if (typeof def.src === 'string') layout.src = def.src;
    if (typeof def.test === 'string') layout.test = def.test;
    if (typeof def.out === 'string') layout.out = def.out;
    if (changes.length) fs.writeFileSync(tomlPath, stringifyToml(doc));
  } else {
    changes.push('foundry.toml absent : configuration Foundry par défaut');
  }

  const remapTxt = path.join(projectDir, 'remappings.txt');
  if (fs.existsSync(remapTxt)) {
    const lines = fs.readFileSync(remapTxt, 'utf8').split('\n');
    const kept = lines.filter((l) => !l.includes('=') || !isEscapingPath(l.split('=').slice(1).join('=').trim()));
    if (kept.length !== lines.length) {
      fs.writeFileSync(remapTxt, kept.join('\n'));
      changes.push(`remappings.txt : ${lines.length - kept.length} entrée(s) hors projet supprimée(s)`);
    }
  }
  return { changes, layout };
}

export function forgeEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    FOUNDRY_FFI: 'false',
    FOUNDRY_DISABLE_NIGHTLY_WARNING: '1',
    ...extra,
  };
}

export function forgeCommand(): string | null {
  return which('forge');
}

export async function forgeBuild(projectDir: string, sandbox: SandboxSpec | null, signal?: AbortSignal): Promise<RunResult> {
  const forge = forgeCommand();
  if (!forge) {
    return { exitCode: 127, output: 'forge introuvable dans PATH.', timedOut: false, cancelled: false, durationMs: 0 };
  }
  return runCommand({
    cmd: forge,
    args: ['build', '--color', 'never'],
    cwd: projectDir,
    env: forgeEnv(),
    timeoutMs: BUILD_TIMEOUT_MS,
    sandbox,
    signal,
  });
}

interface RawArtifact {
  abi?: Array<{ type: string; name?: string; stateMutability?: string }>;
  methodIdentifiers?: Record<string, string>;
  deployedBytecode?: { object?: string };
  metadata?: { settings?: { compilationTarget?: Record<string, string> } };
  ast?: { absolutePath?: string };
}

export interface ArtifactEntry extends BuiltContract {
  concrete: boolean;
  mutating: Array<{ name: string; mutability: string }>;
}

function walkJson(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'build-info') walkJson(p, acc);
    } else if (ent.isFile() && ent.name.endsWith('.json')) {
      acc.push(p);
    }
  }
  return acc;
}

export function readArtifacts(projectDir: string, layout: FoundryLayout): ArtifactEntry[] {
  const outDir = path.join(projectDir, layout.out);
  const entries: ArtifactEntry[] = [];
  const seen = new Set<string>();
  for (const file of walkJson(outDir)) {
    let raw: RawArtifact;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8')) as RawArtifact;
    } catch {
      continue;
    }
    if (!raw.abi) continue;
    const target = raw.metadata?.settings?.compilationTarget;
    const sourcePath = (target && Object.keys(target)[0]) || raw.ast?.absolutePath || path.basename(path.dirname(file));
    const name = (target && Object.values(target)[0]) || path.basename(file).split('.')[0];
    const key = `${sourcePath}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mi = raw.methodIdentifiers ?? {};
    const signatures: Record<string, string> = {};
    for (const [sig, sel] of Object.entries(mi)) signatures[sel.toLowerCase()] = sig;
    entries.push({
      name,
      sourcePath,
      selectors: Object.values(mi).map((s) => s.toLowerCase()),
      signatures,
      concrete: (raw.deployedBytecode?.object ?? '0x').replace(/^0x/, '').length > 0,
      mutating: raw.abi
        .filter((e) => e.type === 'function' && (e.stateMutability === 'nonpayable' || e.stateMutability === 'payable'))
        .map((e) => ({ name: e.name ?? '', mutability: e.stateMutability ?? '' }))
        .filter((f) => f.name),
    });
  }
  return entries;
}

function listSol(dir: string, root: string, acc: string[] = [], limit = 2000): string[] {
  if (!fs.existsSync(dir) || acc.length >= limit) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (acc.length >= limit) break;
    if (ent.isSymbolicLink()) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!['node_modules', 'lib', 'out', 'cache', '.git'].includes(ent.name)) listSol(p, root, acc, limit);
    } else if (ent.isFile() && ent.name.endsWith('.sol')) {
      acc.push(path.relative(root, p));
    }
  }
  return acc;
}

const MONEY_RE =
  /\b(safeTransferFrom|safeTransfer|transferFrom|transfer|sendValue|_mint|_burn|mint|burn|withdraw|deposit|redeem|claim|borrow|repay|liquidat\w*|swap|flashLoan)\b|\.call\{\s*value/;

/** Body of `function name(` starting at its line, by brace matching (bounded). */
export function extractFunction(source: string, name: string): { line: number; body: string } | null {
  const re = new RegExp(`function\\s+${name.replace(/[^A-Za-z0-9_$]/g, '')}\\s*\\(`);
  const m = re.exec(source);
  if (!m) return null;
  const line = source.slice(0, m.index).split('\n').length;
  let depth = 0;
  let started = false;
  let end = source.length;
  for (let i = m.index; i < source.length && i < m.index + 40_000; i++) {
    const c = source[i];
    if (c === '{') {
      depth++;
      started = true;
    } else if (c === '}') {
      depth--;
      if (started && depth === 0) {
        end = i + 1;
        break;
      }
    } else if (c === ';' && !started) {
      end = i + 1; // declaration without body
      break;
    }
  }
  return { line, body: source.slice(m.index, end) };
}

/**
 * Door A, executed: state-changing functions declared under src/ that no file of the
 * test suite ever names. Pure text evidence — no LLM involved.
 */
export function ingestProject(
  projectDir: string,
  layout: FoundryLayout,
  artifacts: ArtifactEntry[]
): Pick<IngestResult, 'contractsCount' | 'sourceFiles' | 'untestedMonetaryFunctions' | 'negativeSpaceSummary'> {
  const srcPrefix = `${layout.src.replace(/\/+$/, '')}/`;
  const inSrc = artifacts.filter((a) => a.sourcePath.startsWith(srcPrefix));
  const contractsCount = inSrc.filter((a) => a.concrete).length;
  const sourceFiles = listSol(path.join(projectDir, layout.src), projectDir, [], 500);

  const testFiles = [
    ...listSol(path.join(projectDir, layout.test), projectDir),
    ...listSol(projectDir, projectDir).filter((f) => f.endsWith('.t.sol') && !f.startsWith(layout.test)),
  ];
  let corpus = '';
  for (const f of testFiles) {
    if (corpus.length > MAX_TEST_CORPUS_BYTES) break;
    try {
      corpus += fs.readFileSync(path.join(projectDir, f), 'utf8') + '\n';
    } catch {
      // unreadable file: skip
    }
  }

  const untested: IngestResult['untestedMonetaryFunctions'] = [];
  const seen = new Set<string>();
  const sourceCache = new Map<string, string>();
  for (const a of inSrc) {
    let source = sourceCache.get(a.sourcePath);
    if (source === undefined) {
      try {
        source = fs.readFileSync(path.join(projectDir, a.sourcePath), 'utf8');
      } catch {
        source = '';
      }
      sourceCache.set(a.sourcePath, source);
    }
    for (const fn of a.mutating) {
      const key = `${a.sourcePath}:${fn.name}`;
      if (seen.has(key)) continue;
      const decl = extractFunction(source, fn.name);
      if (!decl) continue; // inherited from outside this file: not this contract's own surface
      seen.add(key);
      const called = new RegExp(`(\\.|\\b)${fn.name}\\s*(\\(|\\{|\\.selector)`).test(corpus);
      if (called) continue;
      const money = MONEY_RE.exec(decl.body);
      untested.push({
        contract: a.name,
        functionName: fn.name,
        fileLine: `${a.sourcePath}:${decl.line}`,
        reason:
          `Fonction ${fn.mutability} jamais nommée dans ${testFiles.length} fichier(s) de test` +
          (money ? ` — le corps contient « ${money[0]} »` : ''),
      });
    }
  }
  untested.sort((x, y) => Number(y.reason.includes('«')) - Number(x.reason.includes('«')));

  return {
    contractsCount,
    sourceFiles,
    untestedMonetaryFunctions: untested.slice(0, 80),
    negativeSpaceSummary:
      `${testFiles.length} fichier(s) de test lus, ${inSrc.length} contrat(s)/abstract(s) sous ${layout.src}/, ` +
      `${untested.length} fonction(s) mutatrice(s) jamais nommée(s) par les tests. ` +
      'Analyse statique (Slither/Aderyn) non exécutée par cette version.',
  };
}
