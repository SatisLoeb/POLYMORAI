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
  mergeThreatModel,
  validateG0Override,
  validateOperatorSignoff,
} from './doctrine';
import type { Finding, ScanRun, ThreatModel } from '../types';

const baseProgramInput = {
  targetKind: 'program' as const,
  scopeKind: 'deployed' as const,
  programActive: true,
  programStatusText: 'Active',
  programArtifactUrl: 'https://immunefi.com/bug-bounty/aegis-vault/',
  verbatimImpacts: ['Direct theft of any user funds, whether at-rest or in-motion'],
  chain: 'ethereum',
  rpcConfigured: true,
  fundsAtRiskUsd: 18_400_000,
  minFundsAtRiskUsd: 100_000,
  blockNumber: 21240811,
  contractAddress: '0x71cE5f02A9aC31fA402aE2aA0f114bB19283C911',
  provenanceMatch: 'matched' as const,
  pinnedCommit: '9f84c21e88a904f2a109c3b8e4f912a6c7b40e12',
  dwellDays: 42,
  knownIssuesCount: 2,
  tombstones: ['Rounding dust <= 1 wei in previewRedeem'],
};

test('G0: active program with RPC and funds above threshold yields GO', () => {
  const report = evaluateG0(baseProgramInput);
  assert.equal(report.decision, 'go');
  assert.equal(report.verdictLines.length, 6);
  assert.equal(report.verdictLines.find((l) => l.id === 'L1')?.status, 'ok');
  assert.equal(report.verdictLines.find((l) => l.id === 'L3')?.status, 'ok');
});

test('G0: paused program produces NO-GO via L1 block', () => {
  const report = evaluateG0({
    ...baseProgramInput,
    programActive: false,
    programStatusText: 'Paused',
  });
  assert.equal(report.decision, 'no_go');
  assert.equal(report.verdictLines.find((l) => l.id === 'L1')?.status, 'block');
});

test('G0: 0 verbatim impact lines produces NO-GO via L2 block', () => {
  const report = evaluateG0({
    ...baseProgramInput,
    verbatimImpacts: [],
  });
  assert.equal(report.decision, 'no_go');
  assert.equal(report.verdictLines.find((l) => l.id === 'L2')?.status, 'block');
});

test('G0: deployed scope without RPC produces NEEDS_INPUT', () => {
  const report = evaluateG0({
    ...baseProgramInput,
    rpcConfigured: false,
  });
  assert.equal(report.decision, 'needs_input');
  assert.equal(report.missingInputKind, 'rpc');
  assert.equal(report.missingChain, 'ethereum');
  assert.equal(report.verdictLines.find((l) => l.id === 'L3')?.status, 'needs_input');
});

test('G0: lab mode sets L1/L2 to n/a and evaluates GO without inventing impacts', () => {
  const report = evaluateG0({
    ...baseProgramInput,
    targetKind: 'local',
    scopeKind: 'commit_anchored',
    verbatimImpacts: [],
    rpcConfigured: false,
    provenanceMatch: 'n/a',
  });
  assert.equal(report.decision, 'go');
  assert.equal(report.verdictLines.find((l) => l.id === 'L1')?.status, 'n/a');
  assert.equal(report.verdictLines.find((l) => l.id === 'L2')?.status, 'n/a');
  assert.equal(report.verdictLines.find((l) => l.id === 'L3')?.status, 'n/a');
});

test('G0: high dwell warns on L5 but never kills alone', () => {
  const report = evaluateG0({
    ...baseProgramInput,
    dwellDays: 420,
  });
  assert.equal(report.decision, 'go');
  assert.equal(report.verdictLines.find((l) => l.id === 'L5')?.status, 'warn');
});

test('L7: G0 override requires at least 20 characters', () => {
  assert.equal(validateG0Override('too short').ok, false);
  assert.equal(
    validateG0Override('Analyse exploratoire sur un fork interne du protocole avant réouverture').ok,
    true
  );
});

test('L1: hunting gate blocks assisted mode and NO-GO scans', () => {
  const noGo = evaluateG0({ ...baseProgramInput, programActive: false });
  const go = evaluateG0(baseProgramInput);
  assert.equal(canHunt({ executionMode: 'assisted', g0: go }), false);
  assert.equal(canHunt({ executionMode: 'guided_autonomous', g0: noGo }), false);
  assert.equal(canHunt({ executionMode: 'guided_autonomous', g0: go }), true);
  assert.equal(
    canHunt({
      executionMode: 'guided_autonomous',
      g0: { ...noGo, decision: 'go_override' },
    }),
    true
  );
});

test('L3: sign-off rejects commit_anchored_na on deployed scope and accepts it on commit_anchored', () => {
  const payload = {
    impactJustification: 'Direct drain of 100% of deposited WETH shares in one tx.',
    preconditionJustification: 'Permissionless call without privileged roles or legitimate path.',
    deploymentCheck: 'commit_anchored_na' as const,
    deploymentJustification: 'Audited against pinned commit sha in contest repository.',
  };
  assert.equal(validateOperatorSignoff(payload, 'deployed').ok, false);
  assert.equal(validateOperatorSignoff(payload, 'commit_anchored').ok, true);

  const deployedOk = validateOperatorSignoff(
    {
      ...payload,
      deploymentCheck: 'verified_at_block',
      blockNumber: 21240811,
    },
    'deployed'
  );
  assert.equal(deployedOk.ok, true);
});

test('L9 & U-1: bounty export blocked in lab mode and before sign-off', () => {
  const baseFinding: Pick<Finding, 'status' | 'verbatimImpactLine' | 'signoff'> = {
    status: 'candidate',
    verbatimImpactLine: 'Direct theft of any user funds',
  };
  assert.equal(canExportFinding(baseFinding, { targetKind: 'program' }).code, 'SIGNOFF_REQUIRED');
  assert.equal(
    canExportFinding(
      {
        ...baseFinding,
        status: 'operator_confirmed',
        signoff: {
          confirmedAt: new Date().toISOString(),
          confirmedBy: 'admin',
          impactJustification: 'Confirmed drain',
          preconditionJustification: 'Permissionless',
          deploymentCheck: 'commit_anchored_na',
          deploymentJustification: 'Commit checked',
        },
      },
      { targetKind: 'local' }
    ).code,
    'LAB_MODE_BLOCKED'
  );
  assert.equal(
    canExportFinding(
      {
        ...baseFinding,
        status: 'operator_confirmed',
        signoff: {
          confirmedAt: new Date().toISOString(),
          confirmedBy: 'admin',
          impactJustification: 'Confirmed drain',
          preconditionJustification: 'Permissionless',
          deploymentCheck: 'verified_at_block',
          deploymentJustification: 'Checked at block',
          blockNumber: 21240811,
        },
      },
      { targetKind: 'program' }
    ).allowed,
    true
  );
});

test('L8 & R9: scan closure without findings requires all hypotheses closed; missing artifact downgrades to abandoned_unproven', () => {
  assert.equal(canCloseScanWithoutFindings([]), false);
  assert.equal(
    canCloseScanWithoutFindings([{ outcome: 'killed_by_artifact' }, { outcome: 'in_progress' }]),
    false
  );
  assert.equal(
    canCloseScanWithoutFindings([
      { outcome: 'killed_by_artifact' },
      { outcome: 'abandoned_unproven' },
    ]),
    true
  );

  assert.equal(classifyHypothesisClosure('killed_by_artifact', undefined), 'abandoned_unproven');
  assert.equal(classifyHypothesisClosure('killed_by_artifact', ''), 'abandoned_unproven');
  assert.equal(classifyHypothesisClosure('killed_by_artifact', 'art-forge-91'), 'killed_by_artifact');
});

test('G10: threat model partial merge preserves untouched fields and upgrades provenance', () => {
  const existing: ThreatModel = {
    provenance: 'pipeline_auto',
    updatedAt: '2026-11-25T10:00:00.000Z',
    summary: 'Initial summary',
    verbatimImpacts: ['Direct theft'],
    exclusions: ['Frontend phishing'],
    tombstones: ['Dust rounding'],
    invariants: ['totalAssets >= totalSupply'],
    trustBoundaries: ['Owner multisig 3/5'],
  };
  const updated = mergeThreatModel(existing, {
    invariants: ['totalAssets >= totalSupply', 'sharePrice monotonic across flash loan'],
  });
  assert.equal(updated.provenance, 'operator_approved');
  assert.equal(updated.summary, 'Initial summary');
  assert.deepEqual(updated.verbatimImpacts, ['Direct theft']);
  assert.equal(updated.invariants.length, 2);
});

test('Export report produces English markdown with Immunefi header', () => {
  const report = generateBountyReport(
    {
      id: 'FND-001',
      scanId: 'scan-1',
      title: 'First-depositor share inflation',
      severity: 'critical',
      status: 'operator_confirmed',
      source: 'autonomous_hunter',
      createdAt: '2026-11-26T00:00:00Z',
      summary: 'Attacker inflates share price via direct transfer.',
      verbatimImpactLine: 'Direct theft of any user funds',
      affectedFileLine: 'src/Vault.sol:142',
      affectedCode: 'function deposit(uint256 assets) external {}',
      pocFile: 'test/PoC.t.sol',
      pocSource: 'contract PoC {}',
      pocReplayCommand: 'forge test --match-test testExploit -vvvv',
      pocReplayTrace: '[PASS] testExploit()',
      cleanRoomVerified: true,
      disconfirmer: {
        status: 'clear',
        ranAt: '2026-11-26T00:05:00Z',
        legitimateAlternativeTest: 'No legitimate call sequence reproduces stolen principal.',
        notes: 'Verified clean.',
        canKillFinding: false,
      },
      recommendation: 'Use virtual shares offset.',
      signoff: {
        confirmedAt: '2026-11-26T00:10:00Z',
        confirmedBy: 'admin',
        impactJustification: 'Verified direct loss of depositor principal.',
        preconditionJustification: 'Permissionless on empty vault.',
        deploymentCheck: 'verified_at_block',
        deploymentJustification: 'Checked on mainnet block.',
        blockNumber: 21240811,
      },
      fixReviews: [],
    },
    {
      programName: 'Aegis Vault',
      chain: 'ethereum',
      ingest: {
        provenanceMatch: {
          chain: 'ethereum',
          address: '0x1',
          blockNumber: 21240811,
          pinnedCommit: '9f84c21',
          status: 'matched',
        },
      },
    } as unknown as ScanRun,
    'immunefi'
  );
  assert.match(report.filename, /fnd-001-immunefi\.md/);
  assert.match(report.content, /Immunefi Bug Bounty Report/);
  assert.match(report.content, /Verified at block 21240811/);
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
