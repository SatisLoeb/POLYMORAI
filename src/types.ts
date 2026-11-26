export type TargetKind = 'program' | 'repo' | 'local';
export type ScopeKind = 'deployed' | 'commit_anchored' | 'mixed';
export type ScanStatus =
  | 'running'
  | 'needs_input'
  | 'no_go'
  | 'hunting'
  | 'done'
  | 'failed'
  | 'stopped';

export type G0Decision = 'go' | 'no_go' | 'needs_input' | 'go_override';
export type G0LineStatus = 'ok' | 'warn' | 'block' | 'n/a' | 'needs_input';

export type ScanStepKey =
  | 'intake'
  | 'clone_build'
  | 'ingest'
  | 'g0'
  | 'threat_model'
  | 'hunt'
  | 'candidates';

export type StepStatus = 'pending' | 'running' | 'done' | 'blocked' | 'needs_input' | 'failed';

export interface G0VerdictLine {
  id: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
  ruleRef: string;
  label: string;
  status: G0LineStatus;
  value: string;
  detail: string;
  artifact: {
    id: string;
    source: string;
    blockNumber?: number;
    chain?: string;
    commitSha?: string;
    excerpt: string;
  };
}

export interface G0Report {
  decision: G0Decision;
  evaluatedAt: string;
  overrideReason?: string;
  overrideBy?: string;
  overrideAt?: string;
  missingInputKind?: 'rpc' | 'build_fix';
  missingChain?: string;
  verdictLines: G0VerdictLine[];
}

export interface ScanStep {
  key: ScanStepKey;
  status: StepStatus;
  detail: string;
  updatedAt: string;
  artifactSummary?: string;
}

export interface IngestResult {
  buildOk: boolean;
  foundryFfiDisabled: boolean;
  npmScriptsIgnored: boolean;
  buildLog: string;
  contractsCount: number;
  untestedMonetaryFunctions: Array<{
    contract: string;
    functionName: string;
    fileLine: string;
    reason: string;
  }>;
  negativeSpaceSummary: string;
  staticHits: Array<{
    tool: 'slither' | 'aderyn' | 'halmos';
    rule: string;
    fileLine: string;
    severity: 'high' | 'medium' | 'info';
    message: string;
  }>;
  provenanceMatch?: {
    chain: string;
    address: string;
    blockNumber: number;
    pinnedCommit: string;
    status: 'matched' | 'diverged' | 'n/a';
  };
}

export interface ThreatModel {
  provenance: 'pipeline_auto' | 'operator_approved';
  updatedAt: string;
  summary: string;
  verbatimImpacts: string[];
  exclusions: string[];
  tombstones: string[];
  invariants: string[];
  trustBoundaries: string[];
}

export type HypothesisOutcome =
  | 'in_progress'
  | 'candidate'
  | 'killed_by_artifact'
  | 'abandoned_unproven';

export interface Hypothesis {
  id: string;
  scanId: string;
  door: 'door_a_untested' | 'invariant' | 'seam' | 'tombstone_sibling';
  title: string;
  targetFileLine: string;
  outcome: HypothesisOutcome;
  artifactId?: string;
  reason?: string;
  updatedAt: string;
}

export interface HunterLogEntry {
  id: string;
  timestamp: string;
  role: 'planner' | 'worker' | 'disconfirmer' | 'system';
  message: string;
  tokensUsed?: number;
}

export interface BudgetPoint {
  tokensK: number;
  hypothesesClosed: number;
  findingsCount: number;
}

export interface DappSeamEvent {
  id: string;
  timestamp: string;
  origin: string;
  method: string;
  contractAddress: string;
  functionSig: string;
  calldataPreview: string;
  anvilTempdir: string;
  replayStatus: 'replayed_ok' | 'reverted' | 'pending';
  notes: string;
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingStatus = 'candidate' | 'operator_confirmed' | 'rejected' | 'hold';
export type DeploymentCheckKind = 'verified_at_block' | 'commit_anchored_na';

export interface OperatorSignoff {
  confirmedAt: string;
  confirmedBy: string;
  impactJustification: string;
  preconditionJustification: string;
  deploymentCheck: DeploymentCheckKind;
  deploymentJustification: string;
  blockNumber?: number;
}

export interface DisconfirmerReview {
  status: 'clear' | 'flagged';
  ranAt: string;
  legitimateAlternativeTest: string;
  notes: string;
  canKillFinding: false;
}

export interface FixReviewRecord {
  id: string;
  findingId: string;
  prOrCommitUrl: string;
  ranAt: string;
  baseCommit: string;
  headCommit: string;
  verdict: 'fixed' | 'still_reproducible' | 'partial';
  pocReplayExitCode: number;
  pocReplayOutput: string;
  siblingSinks: Array<{
    fileLine: string;
    functionName: string;
    status: 'clean' | 'vulnerable_sibling';
    note: string;
  }>;
  summaryMarkdown: string;
}

export interface Finding {
  id: string;
  scanId: string;
  title: string;
  severity: FindingSeverity;
  status: FindingStatus;
  source: 'autonomous_hunter' | 'human_from_poc';
  createdAt: string;
  summary: string;
  verbatimImpactLine: string | null;
  affectedFileLine: string;
  affectedCode: string;
  pocFile: string;
  pocSource: string;
  pocReplayCommand: string;
  pocReplayTrace: string;
  cleanRoomVerified: boolean;
  disconfirmer: DisconfirmerReview;
  recommendation: string;
  signoff?: OperatorSignoff;
  fixReviews: FixReviewRecord[];
}

export interface ScanRun {
  id: string;
  taskId: string;
  targetUrl: string;
  programName: string;
  targetKind: TargetKind;
  scopeKind: ScopeKind;
  chain: string;
  maxBountyUsd: number | null;
  status: ScanStatus;
  createdAt: string;
  updatedAt: string;
  surface: 'all' | 'onchain' | 'seam';
  repoCount: number;
  executionMode: 'guided_autonomous' | 'assisted';
  workerCount: 1;
  budget: {
    tokensUsed: number;
    tokensLimit: number;
    elapsedSeconds: number;
    maxSeconds: number;
    history: BudgetPoint[];
  };
  steps: ScanStep[];
  g0: G0Report;
  ingest: IngestResult;
  threatModel: ThreatModel;
  hypotheses: Hypothesis[];
  hunterLogs: HunterLogEntry[];
  seamEvents: DappSeamEvent[];
}

export interface ChainSetting {
  chain: string;
  label: string;
  rpcUrl: string;
  rpcConfigured: boolean;
  etherscanKeyMasked: string;
  minFundsAtRiskUsd: number;
}

export interface DoctorCheck {
  tool: string;
  category: 'sc' | 'recon' | 'core';
  required: boolean;
  installed: boolean;
  version: string;
  installCmd: string;
  impact: string;
}

export interface LlmSettings {
  provider: string;
  model: string;
  keyMasked: string;
  configured: boolean;
  defaultTokenBudget: number;
}

export interface AdvancedSnapshot {
  llmPool: Array<{ id: string; provider: string; model: string; role: string; active: boolean }>;
  agents: Array<{ name: string; role: string; lock: string; guidanceExcerpt: string }>;
  skills: Array<{ name: string; scope: string; enabled: boolean; description: string }>;
  mcpTools: Array<{ name: string; gate: string; description: string }>;
  serverLogs: Array<{ ts: string; level: 'info' | 'warn'; component: string; msg: string }>;
  capturedTraffic: DappSeamEvent[];
}

export type ExportFormat = 'immunefi' | 'cantina' | 'sherlock';
export type Locale = 'fr' | 'en';
