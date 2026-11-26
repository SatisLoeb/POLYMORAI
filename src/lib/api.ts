import type {
  AdvancedSnapshot,
  AuthStatus,
  ChainSetting,
  ExecRun,
  DeploymentCheckKind,
  DoctorCheck,
  ExportFormat,
  Finding,
  FindingSeverity,
  FixReviewRecord,
  LlmSettings,
  ScanRun,
  ThreatModel,
} from '../types';

export interface ScanSummary extends ScanRun {
  findingsCount: number;
}

export interface EnrichedFinding extends Finding {
  programName: string;
  targetKind: ScanRun['targetKind'];
  scopeKind: ScanRun['scopeKind'];
}

export const AUTH_REQUIRED_EVENT = 'polymorphe:auth-required';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'AUTH_REQUIRED') {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
  if (!res.ok) {
    throw new Error(data.error || `Erreur HTTP ${res.status}`);
  }
  return data as T;
}

export interface ProgramScopeInput {
  sourceUrl: string;
  status: 'active' | 'paused' | 'closed';
  verbatimImpacts: string[];
  maxBountyUsd: number | null;
  listedAt?: string;
  knownIssues: string[];
  scopeKind: 'deployed' | 'commit_anchored';
  chain: string;
  scopeAddresses: string[];
  repoUrl?: string;
  pinnedCommit?: string;
}

export const api = {
  listScans: () => request<{ scans: ScanSummary[] }>('/api/scans'),

  createScan: (payload: {
    targetUrl: string;
    rpcUrl?: string;
    surface?: 'all' | 'onchain' | 'seam';
    repoCount?: number;
  }) =>
    request<{ scan: ScanRun }>('/api/scans', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getScan: (id: string) =>
    request<{ scan: ScanRun; findings: Finding[] }>(`/api/scans/${encodeURIComponent(id)}`),

  provideScanInput: (id: string, payload: { rpcUrl: string; chain?: string }) =>
    request<{ scan: ScanRun; findings: Finding[] }>(`/api/scans/${encodeURIComponent(id)}/input`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  overrideG0: (id: string, reason: string) =>
    request<{ scan: ScanRun; findings: Finding[] }>(
      `/api/scans/${encodeURIComponent(id)}/override-g0`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),

  extendBudget: (id: string, addTokens = 50_000) =>
    request<{ scan: ScanRun }>(`/api/scans/${encodeURIComponent(id)}/budget`, {
      method: 'POST',
      body: JSON.stringify({ addTokens }),
    }),

  submitProgramScope: (id: string, payload: ProgramScopeInput) =>
    request<{ scan: ScanRun; findings: Finding[] }>(`/api/scans/${encodeURIComponent(id)}/program-scope`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitFundsAttestation: (id: string, payload: { usd: number; sourceUrl: string }) =>
    request<{ scan: ScanRun; findings: Finding[] }>(`/api/scans/${encodeURIComponent(id)}/funds-attestation`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  rebuildScan: (id: string) =>
    request<{ scan: ScanRun; findings: Finding[] }>(`/api/scans/${encodeURIComponent(id)}/rebuild`, {
      method: 'POST',
      body: '{}',
    }),

  listRuns: (scanId: string) =>
    request<{ runs: Omit<ExecRun, 'output'>[] }>(`/api/scans/${encodeURIComponent(scanId)}/runs`),

  getRun: (runId: string) => request<{ run: ExecRun }>(`/api/runs/${encodeURIComponent(runId)}`),

  runHypothesisTest: (scanId: string, hypId: string, pocSource: string) =>
    request<{ run: ExecRun; scan: ScanRun }>(
      `/api/scans/${encodeURIComponent(scanId)}/hypotheses/${encodeURIComponent(hypId)}/test`,
      { method: 'POST', body: JSON.stringify({ pocSource }) }
    ),

  addHypothesis: (
    scanId: string,
    payload: { title: string; door: string; targetFileLine: string }
  ) =>
    request<{ scan: ScanRun }>(`/api/scans/${encodeURIComponent(scanId)}/hypotheses`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  stopScan: (id: string) =>
    request<{ scan: ScanRun }>(`/api/scans/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      body: '{}',
    }),

  updateThreatModel: (id: string, patch: Partial<ThreatModel>) =>
    request<{ threatModel: ThreatModel; scan: ScanRun }>(
      `/api/scans/${encodeURIComponent(id)}/threat-model`,
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      }
    ),

  closeHypothesis: (
    scanId: string,
    hypId: string,
    payload: {
      outcome: 'candidate' | 'killed_by_artifact' | 'abandoned_unproven';
      artifactId?: string;
      reason: string;
    }
  ) =>
    request<{ scan: ScanRun }>(
      `/api/scans/${encodeURIComponent(scanId)}/hypotheses/${encodeURIComponent(hypId)}/close`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createFindingFromPoc: (
    taskId: string,
    payload: {
      title: string;
      severity: FindingSeverity;
      affectedFileLine: string;
      summary: string;
      pocSource: string;
      verbatimImpactLine?: string;
      recommendation?: string;
    }
  ) =>
    request<{ finding: Finding }>(
      `/api/tasks/${encodeURIComponent(taskId)}/findings/from-poc`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  listFindings: () => request<{ findings: EnrichedFinding[] }>('/api/findings'),

  getFinding: (id: string) =>
    request<{ finding: Finding; scan: ScanRun; replayRun: ExecRun | null }>(
      `/api/findings/${encodeURIComponent(id)}`
    ),

  setFindingImpact: (id: string, verbatimImpactLine: string) =>
    request<{ finding: Finding }>(`/api/findings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ verbatimImpactLine }),
    }),

  replayFinding: (id: string) =>
    request<{ finding: Finding }>(`/api/findings/${encodeURIComponent(id)}/replay`, {
      method: 'POST',
      body: '{}',
    }),

  patchFindingStatus: (id: string, status: 'rejected' | 'hold' | 'candidate') =>
    request<{ finding: Finding }>(`/api/findings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  signoffFinding: (
    id: string,
    payload: {
      impactJustification: string;
      preconditionJustification: string;
      deploymentCheck: DeploymentCheckKind;
      deploymentJustification: string;
      blockNumber?: number;
    }
  ) =>
    request<{ finding: Finding }>(`/api/findings/${encodeURIComponent(id)}/signoff`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  exportFinding: (id: string, format: ExportFormat) =>
    request<{ filename: string; content: string; format: ExportFormat }>(
      `/api/findings/${encodeURIComponent(id)}/export`,
      {
        method: 'POST',
        body: JSON.stringify({ format }),
      }
    ),

  runFixReview: (id: string, prOrCommitUrl: string) =>
    request<{ fixReview: FixReviewRecord; finding: Finding }>(
      `/api/findings/${encodeURIComponent(id)}/fix-review`,
      {
        method: 'POST',
        body: JSON.stringify({ prOrCommitUrl }),
      }
    ),

  generateThreatModelAI: (scanId: string) =>
    request<{ threatModel: ThreatModel; scan: ScanRun; model: string }>(
      `/api/scans/${encodeURIComponent(scanId)}/ai/threat-model`,
      { method: 'POST', body: '{}' }
    ),

  generateHypothesesAI: (scanId: string) =>
    request<{ scan: ScanRun; model: string }>(
      `/api/scans/${encodeURIComponent(scanId)}/ai/hypotheses`,
      { method: 'POST', body: '{}' }
    ),

  runDisconfirmerAI: (findingId: string) =>
    request<{ finding: Finding; model: string }>(
      `/api/findings/${encodeURIComponent(findingId)}/ai/disconfirmer`,
      { method: 'POST', body: '{}' }
    ),

  getDoctor: () => request<{ checks: DoctorCheck[] }>('/api/doctor'),

  getSettings: () =>
    request<{
      llm: LlmSettings;
      chains: ChainSetting[];
      execution: { allowUnsandboxedExecution: boolean; sandboxAvailable: boolean };
      setupCompleted: boolean;
      user: string;
    }>('/api/settings'),

  saveExecution: (allowUnsandboxedExecution: boolean) =>
    request<{ execution: { allowUnsandboxedExecution: boolean } }>('/api/settings/execution', {
      method: 'PUT',
      body: JSON.stringify({ allowUnsandboxedExecution }),
    }),

  saveChains: (chains: ChainSetting[]) =>
    request<{ chains: ChainSetting[] }>('/api/settings/chains', {
      method: 'PUT',
      body: JSON.stringify({ chains }),
    }),

  saveLlm: (payload: { provider?: string; model?: string; defaultTokenBudget?: number }) =>
    request<{ llm: LlmSettings }>('/api/settings/llm', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getAdvanced: () => request<AdvancedSnapshot>('/api/advanced'),

  completeSetup: (payload: {
    setupToken: string;
    password: string;
    llmModel?: string;
    chainRpcs?: Array<{ chain: string; rpcUrl: string }>;
  }) =>
    request<{ ok: boolean }>('/api/setup/complete', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (username: string, password: string) =>
    request<{ ok: boolean; user: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),

  authStatus: () => request<AuthStatus>('/api/auth/status'),
};

export function subscribeScanEvents(scanId: string, onUpdate: () => void): () => void {
  const es = new EventSource(`/api/scans/${encodeURIComponent(scanId)}/events`);
  es.addEventListener('scan_updated', onUpdate);
  es.addEventListener('threat_model_updated', onUpdate);
  es.addEventListener('hypothesis_updated', onUpdate);
  return () => {
    es.close();
  };
}
