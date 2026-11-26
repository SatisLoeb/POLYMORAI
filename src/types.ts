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

export type MissingInputKind = 'program_scope' | 'rpc' | 'funds_attestation' | 'build_fix';

export interface G0VerdictLine {
  id: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
  ruleRef: string;
  label: string;
  status: G0LineStatus;
  value: string;
  detail: string;
  /** Set when status === 'needs_input': which operator input unblocks this line. */
  needs?: MissingInputKind;
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
  missingInputKind?: MissingInputKind;
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

/**
 * Program facts copied by the operator from the program page.
 * Nothing in here is inferred by Polymorphe: every field is an attestation with a source.
 */
export interface ProgramScope {
  attestedAt: string;
  attestedBy: string;
  sourceUrl: string;
  status: 'active' | 'paused' | 'closed';
  verbatimImpacts: string[];
  maxBountyUsd: number | null;
  /** ISO date the program (or the in-scope asset) was listed — feeds L5 dwell. */
  listedAt?: string;
  knownIssues: string[];
  scopeKind: 'deployed' | 'commit_anchored';
  chain: string;
  scopeAddresses: string[];
  repoUrl?: string;
  pinnedCommit?: string;
}

export interface FundsAttestation {
  usd: number;
  sourceUrl: string;
  attestedAt: string;
  attestedBy: string;
}

export interface AddressMeasurement {
  address: string;
  codeSize: number;
  proxyKind: 'none' | 'eip1967' | 'eip1967_beacon' | 'eip1167';
  implementation?: string;
  implementationCodeSize?: number;
  nativeBalanceWei: string;
}

export interface OnchainMeasurement {
  chain: string;
  expectedChainId: number | null;
  chainId: number;
  blockNumber: number;
  measuredAt: string;
  addresses: AddressMeasurement[];
  nativeUsd?: {
    feed: string;
    description: string;
    answer: string;
    decimals: number;
    updatedAt: number;
  };
  /** Native balances priced by the on-chain feed. A LOWER bound: ERC-20 holdings are not counted. */
  fundsLowerBoundUsd: number | null;
  errors: string[];
}

export interface ProvenanceResult {
  address: string;
  /** Address whose bytecode was compared (implementation when the scope address is a proxy). */
  comparedAddress: string;
  blockNumber: number;
  status: 'matched' | 'diverged' | 'no_match' | 'no_code';
  bestMatch?: {
    contract: string;
    sourcePath: string;
    abiSelectors: number;
    matchedSelectors: number;
    missingSelectors: string[];
  };
}

export interface IngestResult {
  buildOk: boolean;
  foundryFfiDisabled: boolean;
  npmScriptsIgnored: boolean;
  sandbox: 'bwrap' | 'none';
  buildLog: string;
  buildRunId?: string;
  contractsCount: number;
  sourceFiles: string[];
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
  provenance?: ProvenanceResult[];
  provenanceMatch?: {
    chain: string;
    address: string;
    blockNumber: number;
    pinnedCommit: string;
    status: 'matched' | 'diverged' | 'n/a';
  };
}

export interface WorkspaceInfo {
  source: 'git' | 'local';
  repoUrl: string;
  commit: string;
  preparedAt: string;
  /** Foundry project root, relative to the repo root ('' when it is the root). */
  projectDir: string;
  layout: { src: string; test: string; out: string };
  sanitizedConfig: string[];
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
  /** false when the LLM pointed at a file/line that does not exist in the workspace. */
  targetVerified: boolean;
  outcome: HypothesisOutcome;
  /** Id of an executed run (ExecRun) — the only thing that can justify a kill or a candidate. */
  artifactId?: string;
  reason?: string;
  testRunIds: string[];
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

export type ExecRunKind = 'build' | 'poc_replay' | 'kill_test' | 'fix_review';

/** One executed command. The only artifact type allowed to back a verdict. */
export interface ExecRun {
  id: string;
  scanId: string;
  kind: ExecRunKind;
  /** findingId / hypothesisId / fixReviewId the run belongs to. */
  subjectId?: string;
  status: 'queued' | 'running' | 'finished' | 'error' | 'cancelled';
  command: string;
  commit: string;
  sandbox: 'bwrap' | 'none';
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** Exit code of each repetition (clean-room replays run twice). */
  exitCodes: number[];
  compileFailed: boolean;
  testsPassed: number;
  testsFailed: number;
  /** true only if every repetition exited 0 with at least one passing test and zero failures. */
  passed: boolean;
  output: string;
  error?: string;
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingStatus =
  | 'replaying'
  | 'replay_failed'
  | 'candidate'
  | 'operator_confirmed'
  | 'rejected'
  | 'hold';
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
  status: 'clear' | 'flagged' | 'not_run';
  ranAt: string | null;
  model?: string;
  legitimateAlternativeTest: string;
  notes: string;
  canKillFinding: false;
}

export interface FixReviewRecord {
  id: string;
  findingId: string;
  prOrCommitUrl: string;
  ranAt: string;
  status: 'running' | 'finished' | 'error';
  baseCommit: string;
  headCommit: string;
  verdict: 'fixed' | 'still_reproducible' | 'inconclusive' | 'pending';
  runId?: string;
  pocReplayExitCode: number | null;
  pocReplayOutput: string;
  siblingSinks: Array<{
    fileLine: string;
    functionName: string;
    status: 'clean' | 'vulnerable_sibling';
    note: string;
  }>;
  summaryMarkdown: string;
  error?: string;
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
  replayRunId?: string;
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
  programScope?: ProgramScope;
  fundsAttestation?: FundsAttestation;
  onchain?: OnchainMeasurement;
  workspace?: WorkspaceInfo;
  ingest: IngestResult;
  threatModel: ThreatModel;
  hypotheses: Hypothesis[];
  hunterLogs: HunterLogEntry[];
  seamEvents: DappSeamEvent[];
}

export interface ChainSetting {
  chain: string;
  label: string;
  chainId: number | null;
  rpcUrl: string;
  rpcConfigured: boolean;
  /** Chainlink <native>/USD aggregator used to price native balances. Verified via description() at read time. */
  nativeUsdFeed: string;
  nativeUsdFeedDescription: string;
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

export interface AuthStatus {
  setupRequired: boolean;
  setupTokenRequired: boolean;
  authenticated: boolean;
  user: string | null;
}

export type ExportFormat = 'immunefi' | 'cantina' | 'sherlock';
export type Locale = 'fr' | 'en';
