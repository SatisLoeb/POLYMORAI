import type {
  AdvancedSnapshot,
  ChainSetting,
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erreur HTTP ${res.status}`);
  }
  return data as T;
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

  stopScan: (id: string) =>
    request<{ scan: ScanRun }>(`/api/scans/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
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
    request<{ finding: Finding; scan: ScanRun }>(`/api/findings/${encodeURIComponent(id)}`),

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
      { method: 'POST' }
    ),

  generateHypothesesAI: (scanId: string) =>
    request<{ scan: ScanRun; model: string }>(
      `/api/scans/${encodeURIComponent(scanId)}/ai/hypotheses`,
      { method: 'POST' }
    ),

  runDisconfirmerAI: (findingId: string) =>
    request<{ finding: Finding; model: string }>(
      `/api/findings/${encodeURIComponent(findingId)}/ai/disconfirmer`,
      { method: 'POST' }
    ),

  getDoctor: () => request<{ checks: DoctorCheck[] }>('/api/doctor'),

  getSettings: () =>
    request<{ llm: LlmSettings; chains: ChainSetting[]; setupCompleted: boolean; user: string }>(
      '/api/settings'
    ),

  saveChains: (chains: ChainSetting[]) =>
    request<{ chains: ChainSetting[] }>('/api/settings/chains', {
      method: 'PUT',
      body: JSON.stringify({ chains }),
    }),

  saveLlm: (payload: {
    provider?: string;
    model?: string;
    defaultTokenBudget?: number;
    apiKeyUpdated?: boolean;
  }) =>
    request<{ llm: LlmSettings }>('/api/settings/llm', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getAdvanced: () => request<AdvancedSnapshot>('/api/advanced'),

  completeSetup: (payload: {
    llmModel?: string;
    llmKeyConfigured?: boolean;
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
