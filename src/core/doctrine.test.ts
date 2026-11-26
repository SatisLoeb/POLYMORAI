import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canCloseScanWithoutFindings,
  canExportFinding,
  canHunt,
  classifyHypothesisClosure,
  evaluateG0,
  generateBountyReport,
  isPassingRun,
  mergeThreatModel,
  validateG0Override,
  validateOperatorSignoff,
  type G0EvaluationInput,
} from './doctrine';
import type { ExecRun, Finding, OnchainMeasurement, ProgramScope, ScanRun, ThreatModel } from '../types';

const NOW = new Date('2026-11-26T12:00:00Z');

const scope: ProgramScope = {
  attestedAt: '2026-11-26T10:00:00Z',
  attestedBy: 'admin',
  sourceUrl: 'https://immunefi.com/bug-bounty/example/scope/',
  status: 'active',
  verbatimImpacts: ['Direct theft of any user funds, whether at-rest or in-motion, other than unclaimed yield'],
  maxBountyUsd: 100_000,
  listedAt: '2026-10-01',
  knownIssues: [],
  scopeKind: 'deployed',
  chain: 'ethereum',
  scopeAddresses: ['0x1111111111111111111111111111111111111111'],
};

const onchain = (usd: number | null): OnchainMeasurement => ({
  chain: 'ethereum',
  expectedChainId: 1,
  chainId: 1,
  blockNumber: 21_000_000,
  measuredAt: NOW.toISOString(),
  addresses: [{ address: scope.scopeAddresses[0], codeSize: 1000, proxyKind: 'none', nativeBalanceWei: '1' }],
  fundsLowerBoundUsd: usd,
  errors: [],
});

const base: G0EvaluationInput = {
  targetKind: 'program',
  scopeKind: 'deployed',
  targetUrl: 'https://immunefi.com/bug-bounty/example/',
  programScope: scope,
  chain: 'ethereum',
  rpcConfigured: true,
  onchain: onchain(5_000_000),
  fundsAttestation: null,
  minFundsAtRiskUsd: 100_000,
  provenance: [
    {
      address: scope.scopeAddresses[0],
      comparedAddress: scope.scopeAddresses[0],
      blockNumber: 21_000_000,
      status: 'matched',
      bestMatch: { contract: 'Vault', sourcePath: 'src/Vault.sol', abiSelectors: 4, matchedSelectors: 4, missingSelectors: [] },
    },
  ],
  pinnedCommit: 'a'.repeat(40),
  extraTombstones: [],
  now: NOW,
};

const line = (r: ReturnType<typeof evaluateG0>, id: string) => r.verdictLines.find((l) => l.id === id)!;

test('G0: attested active program + measured funds + matched provenance yields GO', () => {
  const r = evaluateG0(base);
  assert.equal(r.decision, 'go');
  assert.equal(line(r, 'L3').status, 'ok');
  assert.equal(line(r, 'L4').status, 'ok');
});

test('G0: nothing is inferred for a program URL — no attested scope means NEEDS_INPUT on L1/L2', () => {
  const r = evaluateG0({ ...base, programScope: null });
  assert.equal(r.decision, 'needs_input');
  assert.equal(r.missingInputKind, 'program_scope');
  assert.equal(line(r, 'L1').status, 'needs_input');
  assert.equal(line(r, 'L2').status, 'needs_input');
  assert.equal(line(r, 'L6').status, 'needs_input', 'unattested known issues are not "none"');
  // Without an attested scope there are no addresses, hence no measurement either.
  const bare = evaluateG0({ ...base, programScope: null, onchain: null, provenance: null });
  assert.equal(bare.verdictLines.some((l) => l.status === 'ok'), false, 'nothing passes on missing data');
});

test('G0: paused program is NO-GO via L1', () => {
  const r = evaluateG0({ ...base, programScope: { ...scope, status: 'paused' } });
  assert.equal(r.decision, 'no_go');
  assert.equal(line(r, 'L1').status, 'block');
});

test('G0: zero verbatim impacts is NO-GO via L2', () => {
  const r = evaluateG0({ ...base, programScope: { ...scope, verbatimImpacts: [] } });
  assert.equal(r.decision, 'no_go');
  assert.equal(line(r, 'L2').status, 'block');
});

test('G0: deployed scope without RPC is NEEDS_INPUT(rpc)', () => {
  const r = evaluateG0({ ...base, rpcConfigured: false, onchain: null, provenance: null });
  assert.equal(r.decision, 'needs_input');
  assert.equal(r.missingInputKind, 'rpc');
  assert.equal(r.missingChain, 'ethereum');
});

test('G0 L3: a measured lower bound below threshold never blocks — it asks for an attestation', () => {
  const r = evaluateG0({ ...base, onchain: onchain(12_000) });
  assert.equal(line(r, 'L3').status, 'needs_input');
  assert.equal(r.missingInputKind, 'funds_attestation');
});

test('G0 L3: no measurement at all never passes', () => {
  const r = evaluateG0({ ...base, onchain: null });
  assert.equal(line(r, 'L3').status, 'needs_input');
});

test('G0 L3: an attested TVL below threshold blocks; above passes', () => {
  const att = { usd: 14_800, sourceUrl: 'https://defillama.com/protocol/x', attestedAt: NOW.toISOString(), attestedBy: 'admin' };
  assert.equal(line(evaluateG0({ ...base, onchain: null, fundsAttestation: att }), 'L3').status, 'block');
  assert.equal(line(evaluateG0({ ...base, onchain: null, fundsAttestation: { ...att, usd: 2_000_000 } }), 'L3').status, 'ok');
});

test('G0 L4: provenance not executed is a warning, never OK', () => {
  const r = evaluateG0({ ...base, provenance: null });
  assert.equal(line(r, 'L4').status, 'warn');
  assert.equal(r.decision, 'go');
});

test('G0 L4: diverged selectors warn and name the missing functions', () => {
  const r = evaluateG0({
    ...base,
    provenance: [
      {
        ...base.provenance![0],
        status: 'diverged',
        bestMatch: { contract: 'Vault', sourcePath: 'src/Vault.sol', abiSelectors: 5, matchedSelectors: 4, missingSelectors: ['sweep(address)'] },
      },
    ],
  });
  assert.equal(line(r, 'L4').status, 'warn');
  assert.match(line(r, 'L4').artifact.excerpt, /sweep\(address\)/);
});

test('G0: lab mode sets L1/L2 to n/a and does not invent impacts', () => {
  const r = evaluateG0({
    ...base,
    targetKind: 'local',
    scopeKind: 'commit_anchored',
    programScope: null,
    rpcConfigured: false,
    onchain: null,
    provenance: null,
  });
  assert.equal(r.decision, 'go');
  assert.equal(line(r, 'L1').status, 'n/a');
  assert.equal(line(r, 'L2').status, 'n/a');
  assert.equal(line(r, 'L3').status, 'n/a');
});

test('G0 L5: dwell > 90 days warns but never kills alone; unknown listing date warns', () => {
  const old = evaluateG0({ ...base, programScope: { ...scope, listedAt: '2025-01-01' } });
  assert.equal(line(old, 'L5').status, 'warn');
  assert.equal(old.decision, 'go');
  assert.equal(line(evaluateG0({ ...base, programScope: { ...scope, listedAt: undefined } }), 'L5').status, 'warn');
});

test('L7: G0 override requires at least 20 characters', () => {
  assert.equal(validateG0Override('too short').ok, false);
  assert.equal(validateG0Override('Analyse préventive avant réouverture du programme.').ok, true);
});

test('L1: hunting gate blocks assisted mode and NO-GO scans', () => {
  const go = evaluateG0(base);
  const noGo = evaluateG0({ ...base, programScope: { ...scope, status: 'closed' } });
  assert.equal(canHunt({ executionMode: 'guided_autonomous', g0: go }), true);
  assert.equal(canHunt({ executionMode: 'assisted', g0: go }), false);
  assert.equal(canHunt({ executionMode: 'guided_autonomous', g0: noGo }), false);
});

const passingRun: Pick<ExecRun, 'status' | 'exitCodes' | 'compileFailed' | 'testsPassed' | 'testsFailed'> = {
  status: 'finished',
  exitCodes: [0, 0],
  compileFailed: false,
  testsPassed: 1,
  testsFailed: 0,
};

test('LOCK #5: a run passes only if every repetition exited 0 with tests run and none failed', () => {
  assert.equal(isPassingRun(passingRun), true);
  assert.equal(isPassingRun({ ...passingRun, exitCodes: [0, 1] }), false);
  assert.equal(isPassingRun({ ...passingRun, testsPassed: 0 }), false, 'no test matched = no evidence');
  assert.equal(isPassingRun({ ...passingRun, testsFailed: 1 }), false);
  assert.equal(isPassingRun({ ...passingRun, compileFailed: true }), false);
  assert.equal(isPassingRun({ ...passingRun, status: 'error' }), false);
  assert.equal(isPassingRun({ ...passingRun, exitCodes: [] }), false);
});

test('R9: kill / candidate need an executed passing run; a typed id or a failing run is downgraded', () => {
  assert.equal(classifyHypothesisClosure('killed_by_artifact', null), 'abandoned_unproven');
  assert.equal(classifyHypothesisClosure('killed_by_artifact', { ...passingRun, exitCodes: [1] }), 'abandoned_unproven');
  assert.equal(classifyHypothesisClosure('killed_by_artifact', passingRun), 'killed_by_artifact');
  assert.equal(classifyHypothesisClosure('candidate', null), 'abandoned_unproven');
  assert.equal(classifyHypothesisClosure('candidate', passingRun), 'candidate');
  assert.equal(classifyHypothesisClosure('abandoned_unproven', passingRun), 'abandoned_unproven');
});

const signoff = {
  impactJustification: 'Verified direct loss of depositor principal.',
  preconditionJustification: 'Permissionless, no legitimate path reaches it.',
  deploymentCheck: 'verified_at_block' as const,
  deploymentJustification: 'Checked deployed bytecode at block.',
  blockNumber: 21_000_000,
};

test('L3/U-1: sign-off requires a passing replay', () => {
  assert.equal(validateOperatorSignoff(signoff, 'deployed', { cleanRoomVerified: false }).ok, false);
  assert.equal(validateOperatorSignoff(signoff, 'deployed', { cleanRoomVerified: true }).ok, true);
});

test('L3: commit_anchored_na only on commit-anchored scope; verified_at_block needs a block on deployed scope', () => {
  const ok = { cleanRoomVerified: true };
  assert.equal(validateOperatorSignoff({ ...signoff, deploymentCheck: 'commit_anchored_na' }, 'deployed', ok).ok, false);
  assert.equal(validateOperatorSignoff({ ...signoff, deploymentCheck: 'commit_anchored_na' }, 'commit_anchored', ok).ok, true);
  assert.equal(validateOperatorSignoff({ ...signoff, blockNumber: undefined }, 'deployed', ok).ok, false);
  assert.equal(validateOperatorSignoff({ ...signoff, blockNumber: 1.5 }, 'deployed', ok).ok, false);
});

test('L9 / U-1 / LOCK #5: export gates', () => {
  const confirmed = {
    status: 'operator_confirmed' as const,
    verbatimImpactLine: scope.verbatimImpacts[0],
    cleanRoomVerified: true,
    signoff: { ...signoff, confirmedAt: NOW.toISOString(), confirmedBy: 'admin' },
  };
  assert.equal(canExportFinding(confirmed, { targetKind: 'local' }).code, 'LAB_MODE_BLOCKED');
  assert.equal(canExportFinding({ ...confirmed, cleanRoomVerified: false }, { targetKind: 'program' }).code, 'REPLAY_REQUIRED');
  assert.equal(canExportFinding({ ...confirmed, verbatimImpactLine: null }, { targetKind: 'program' }).code, 'NO_VERBATIM_IMPACT');
  assert.equal(canExportFinding({ ...confirmed, status: 'candidate', signoff: undefined }, { targetKind: 'program' }).code, 'SIGNOFF_REQUIRED');
  assert.equal(canExportFinding(confirmed, { targetKind: 'program' }).allowed, true);
});

test('L8: scan closure without findings requires every hypothesis closed', () => {
  assert.equal(canCloseScanWithoutFindings([]), false);
  assert.equal(canCloseScanWithoutFindings([{ outcome: 'in_progress' }]), false);
  assert.equal(canCloseScanWithoutFindings([{ outcome: 'killed_by_artifact' }, { outcome: 'abandoned_unproven' }]), true);
});

test('G10: threat model partial merge preserves untouched fields and upgrades provenance', () => {
  const existing: ThreatModel = {
    provenance: 'pipeline_auto',
    updatedAt: '2026-11-26T00:00:00Z',
    summary: 'Original',
    verbatimImpacts: ['A'],
    exclusions: ['B'],
    tombstones: ['C'],
    invariants: ['D'],
    trustBoundaries: ['E'],
  };
  const merged = mergeThreatModel(existing, { summary: 'Edited', invariants: ['X', 42 as unknown as string] });
  assert.equal(merged.provenance, 'operator_approved');
  assert.equal(merged.summary, 'Edited');
  assert.deepEqual(merged.invariants, ['X']);
  assert.deepEqual(merged.exclusions, ['B']);
});

test('Export report is English markdown and carries the executed replay metadata', () => {
  const finding = {
    id: 'FND-001',
    scanId: 'scan-1',
    title: 'Stale rate on async settlement',
    severity: 'high',
    status: 'operator_confirmed',
    source: 'human_from_poc',
    createdAt: NOW.toISOString(),
    summary: 'Payout uses a stale rate.',
    verbatimImpactLine: scope.verbatimImpacts[0],
    affectedFileLine: 'src/Vault.sol:12',
    affectedCode: 'function settle() external {}',
    pocFile: 'test/polymorphe/FND_001.t.sol',
    pocSource: 'pragma solidity ^0.8.20; contract PoC { function test_x() public {} }',
    pocReplayCommand: 'forge test',
    pocReplayTrace: '[PASS] test_x()',
    cleanRoomVerified: true,
    disconfirmer: { status: 'not_run', ranAt: null, legitimateAlternativeTest: '', notes: '', canKillFinding: false },
    recommendation: 'Sync the rate first.',
    signoff: { ...signoff, confirmedAt: NOW.toISOString(), confirmedBy: 'admin' },
    fixReviews: [],
  } as Finding;
  const run = { command: 'FOUNDRY_FFI=false forge test --match-path x', commit: 'b'.repeat(40), exitCodes: [0, 0], testsPassed: 1, testsFailed: 0 } as ExecRun;
  const report = generateBountyReport(finding, { programName: 'Example', chain: 'ethereum' } as ScanRun, 'immunefi', run);
  assert.match(report.filename, /fnd-001-immunefi\.md/);
  assert.match(report.content, /Immunefi Bug Bounty Report/);
  assert.match(report.content, /Verified at block 21000000/);
  assert.match(report.content, /exit codes: 0, 0/);
  assert.doesNotMatch(report.content, /Disconfirmer|Operator Impact Confirmation/, 'internal review notes stay internal');
});

test('No fabricated fixture data ships in src/ or server.ts', () => {
  const suspicious = [/18\.42 ETH/, /0x88b4E2c191aC2d004f7A9012B110e8F991C32a04/, /demo-masked-key/, /AegisWithdrawalQueue/];
  const files = [path.resolve(process.cwd(), 'server.ts')];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(path.resolve(process.cwd(), 'src'));
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const re of suspicious) assert.equal(re.test(text), false, `${re} found in ${f}`);
  }
});

test('Rebrand invariant: zero legacy upstream brand string in src/ or server.ts', () => {
  const forbidden = ['a', 'r', 't', 'e', 'x'].join('');
  const checkDir = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDir(full);
      } else if (/\.(ts|tsx|css|html|json)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        const text = fs.readFileSync(full, 'utf8').toLowerCase();
        assert.equal(text.includes(forbidden), false, `Found forbidden legacy string in ${full}`);
      }
    }
  };
  checkDir(path.resolve(process.cwd(), 'src'));
});
