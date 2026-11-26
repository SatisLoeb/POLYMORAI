import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_HEAD = 48 * 1024;
const OUTPUT_TAIL = 160 * 1024;

export interface RunResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

export interface SandboxSpec {
  /** Directory mounted read-write and used as HOME (solc / foundry caches). */
  home: string;
  /** Additional read-write directories (the workdir). */
  writable: string[];
}

export interface RunOptions {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  sandbox?: SandboxSpec | null;
  signal?: AbortSignal;
}

/** Resolve an executable on PATH to its real path (null when absent). */
export function which(tool: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, tool);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Keep the head and the tail of long outputs (the verdict lines are at the end). */
class OutputBuffer {
  private head = '';
  private tail = '';
  private dropped = 0;

  push(chunk: string) {
    if (this.head.length < OUTPUT_HEAD) {
      const take = OUTPUT_HEAD - this.head.length;
      this.head += chunk.slice(0, take);
      chunk = chunk.slice(take);
    }
    if (!chunk) return;
    this.tail += chunk;
    if (this.tail.length > OUTPUT_TAIL) {
      this.dropped += this.tail.length - OUTPUT_TAIL;
      this.tail = this.tail.slice(this.tail.length - OUTPUT_TAIL);
    }
  }

  toString(): string {
    return this.dropped > 0
      ? `${this.head}\n… [${this.dropped} octets tronqués] …\n${this.tail}`
      : this.head + this.tail;
  }
}

function sandboxArgs(spec: SandboxSpec, cmdPath: string, cwd: string, env: Record<string, string>): string[] {
  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    '--share-net',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/bin', '/bin',
    '--ro-bind-try', '/sbin', '/sbin',
    '--ro-bind-try', '/lib', '/lib',
    '--ro-bind-try', '/lib32', '/lib32',
    '--ro-bind-try', '/lib64', '/lib64',
    '--ro-bind', '/etc', '/etc',
    '--ro-bind-try', '/run/systemd/resolve', '/run/systemd/resolve',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
  ];
  const toolDir = path.dirname(cmdPath);
  if (!toolDir.startsWith('/usr/') && !toolDir.startsWith('/bin')) {
    args.push('--ro-bind', toolDir, toolDir);
  }
  args.push('--bind', spec.home, spec.home);
  for (const w of spec.writable) args.push('--bind', w, w);
  for (const [k, v] of Object.entries(env)) args.push('--setenv', k, v);
  args.push('--chdir', cwd, '--', cmdPath);
  return args;
}

/**
 * Run a command with an explicit minimal environment. When `sandbox` is set, the command
 * runs under bubblewrap: the host filesystem is invisible except system dirs (read-only),
 * the tool's own directory (read-only), the sandbox HOME and the workdir.
 */
export function runCommand(opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const cmdPath = path.isAbsolute(opts.cmd) ? opts.cmd : which(opts.cmd);
  if (!cmdPath) {
    return Promise.resolve({
      exitCode: 127,
      output: `${opts.cmd}: introuvable dans PATH`,
      timedOut: false,
      cancelled: false,
      durationMs: 0,
    });
  }

  const toolDir = path.dirname(cmdPath);
  const baseEnv: Record<string, string> = {
    PATH: [toolDir, '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    NO_COLOR: '1',
    ...(opts.sandbox ? { HOME: opts.sandbox.home } : { HOME: process.env.HOME ?? '/tmp' }),
    ...(opts.env ?? {}),
  };

  let file: string;
  let args: string[];
  let env: Record<string, string>;
  if (opts.sandbox) {
    const bwrap = which('bwrap');
    if (!bwrap) {
      return Promise.resolve({
        exitCode: 126,
        output: 'bwrap introuvable : exécution sandboxée impossible.',
        timedOut: false,
        cancelled: false,
        durationMs: 0,
      });
    }
    file = bwrap;
    args = [...sandboxArgs(opts.sandbox, cmdPath, opts.cwd, baseEnv), ...opts.args];
    env = { PATH: '/usr/bin:/bin' };
  } else {
    file = cmdPath;
    args = opts.args;
    env = baseEnv;
  }

  return new Promise((resolve) => {
    const out = new OutputBuffer();
    let timedOut = false;
    let cancelled = false;
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already exited
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, opts.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      killGroup();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d: Buffer) => out.push(d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => out.push(d.toString('utf8')));
    child.on('error', (err) => out.push(`\n[spawn error] ${err.message}\n`));
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (timedOut) out.push(`\n[timeout après ${Math.round(opts.timeoutMs / 1000)} s — processus tué]\n`);
      if (cancelled) out.push('\n[annulé par l’opérateur]\n');
      resolve({
        exitCode: code ?? (sig ? 128 + 9 : 1),
        output: out.toString(),
        timedOut,
        cancelled,
        durationMs: Date.now() - started,
      });
    });
  });
}

let sandboxProbe: Promise<boolean> | null = null;

/** Executed probe: can bubblewrap actually create the namespaces here? */
export function probeSandbox(): Promise<boolean> {
  if (!sandboxProbe) {
    sandboxProbe = (async () => {
      const bwrap = which('bwrap');
      if (!bwrap) return false;
      const res = await runCommand({
        cmd: bwrap,
        args: ['--die-with-parent', '--unshare-all', '--share-net', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', 'true'],
        cwd: '/',
        timeoutMs: 10_000,
      });
      return res.exitCode === 0;
    })();
  }
  return sandboxProbe;
}

export async function toolVersion(tool: string, args = ['--version']): Promise<string | null> {
  const bin = which(tool);
  if (!bin) return null;
  const res = await runCommand({ cmd: bin, args, cwd: '/', timeoutMs: 10_000 });
  if (res.exitCode !== 0) return null;
  return res.output.split('\n').find((l) => l.trim())?.trim() ?? '';
}
