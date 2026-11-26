import fs from 'node:fs';
import path from 'node:path';
import type { ChainSetting, ExecRun, Finding, ScanRun } from '../types';

export interface SessionRecord {
  tokenHash: string;
  user: string;
  createdAt: string;
  expiresAt: string;
}

export interface ServerLogEntry {
  ts: string;
  level: 'info' | 'warn';
  component: string;
  msg: string;
}

export interface PersistedState {
  version: 1;
  auth: {
    user: string;
    passwordHash: string | null;
    sessions: SessionRecord[];
  };
  scans: ScanRun[];
  findings: Finding[];
  runs: ExecRun[];
  chains: ChainSetting[];
  llm: {
    provider: string;
    model: string;
    defaultTokenBudget: number;
  };
  settings: {
    /** Refuse to execute untrusted builds when no sandbox is available, unless the operator opts in. */
    allowUnsandboxedExecution: boolean;
  };
  logs: ServerLogEntry[];
}

/**
 * Chainlink <native>/USD aggregators. Not trusted blindly: the RPC layer reads description()
 * and refuses the feed unless it matches nativeUsdFeedDescription.
 */
export function defaultChains(): ChainSetting[] {
  return [
    {
      chain: 'ethereum',
      label: 'Ethereum Mainnet',
      chainId: 1,
      rpcUrl: '',
      rpcConfigured: false,
      nativeUsdFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
      nativeUsdFeedDescription: 'ETH / USD',
      etherscanKeyMasked: '',
      minFundsAtRiskUsd: 100_000,
    },
    {
      chain: 'arbitrum',
      label: 'Arbitrum One',
      chainId: 42161,
      rpcUrl: '',
      rpcConfigured: false,
      nativeUsdFeed: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
      nativeUsdFeedDescription: 'ETH / USD',
      etherscanKeyMasked: '',
      minFundsAtRiskUsd: 100_000,
    },
    {
      chain: 'base',
      label: 'Base Mainnet',
      chainId: 8453,
      rpcUrl: '',
      rpcConfigured: false,
      nativeUsdFeed: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
      nativeUsdFeedDescription: 'ETH / USD',
      etherscanKeyMasked: '',
      minFundsAtRiskUsd: 100_000,
    },
    {
      chain: 'optimism',
      label: 'OP Mainnet',
      chainId: 10,
      rpcUrl: '',
      rpcConfigured: false,
      nativeUsdFeed: '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
      nativeUsdFeedDescription: 'ETH / USD',
      etherscanKeyMasked: '',
      minFundsAtRiskUsd: 100_000,
    },
  ];
}

function emptyState(): PersistedState {
  return {
    version: 1,
    auth: { user: 'admin', passwordHash: null, sessions: [] },
    scans: [],
    findings: [],
    runs: [],
    chains: defaultChains(),
    llm: { provider: 'Google Gemini', model: 'gemini-4-neon', defaultTokenBudget: 150_000 },
    settings: { allowUnsandboxedExecution: false },
    logs: [],
  };
}

export class Store {
  readonly dataDir: string;
  readonly file: string;
  state: PersistedState;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    this.file = path.join(this.dataDir, 'state.json');
    this.state = this.load();
  }

  private load(): PersistedState {
    if (!fs.existsSync(this.file)) {
      const fresh = emptyState();
      this.writeAtomic(fresh);
      return fresh;
    }
    const raw = fs.readFileSync(this.file, 'utf8');
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1) {
      throw new Error(`state.json version ${String((parsed as { version?: unknown }).version)} non supportée.`);
    }
    const base = emptyState();
    return {
      ...base,
      ...parsed,
      auth: { ...base.auth, ...parsed.auth },
      llm: { ...base.llm, ...parsed.llm },
      settings: { ...base.settings, ...parsed.settings },
      chains: parsed.chains?.length ? parsed.chains : base.chains,
    };
  }

  private writeAtomic(state: PersistedState) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(state));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }

  /** Persist the current in-memory state. Call after every mutation. */
  commit() {
    this.writeAtomic(this.state);
  }

  log(level: 'info' | 'warn', component: string, msg: string) {
    const ts = new Date().toISOString().slice(11, 19);
    this.state.logs.unshift({ ts, level, component, msg });
    if (this.state.logs.length > 200) this.state.logs.length = 200;
  }

  workspacesDir(): string {
    const dir = path.join(this.dataDir, 'workspaces');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  sandboxHome(): string {
    const dir = path.join(this.dataDir, 'sandbox-home');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
}
