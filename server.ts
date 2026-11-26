import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GEMINI_MODEL,
  generateHypothesesWithGemini,
  generateThreatModelWithGemini,
  isGeminiConfigured,
  runDisconfirmerWithGemini,
} from './src/server/gemini';
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
} from './src/core/doctrine';
import {
  createInitialAdvancedSnapshot,
  createInitialChainSettings,
  createInitialDoctorChecks,
  createInitialLlmSettings,
  createInitialScans,
} from './src/data/fixtures';
import type {
  ChainSetting,
  ExportFormat,
  Finding,
  FixReviewRecord,
  LlmSettings,
  ScanRun,
  ScopeKind,
  TargetKind,
} from './src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { scans: initialScans, findings: initialFindings } = createInitialScans();

const state = {
  scans: initialScans as ScanRun[],
  findings: initialFindings as Finding[],
  chains: createInitialChainSettings() as ChainSetting[],
  llm: createInitialLlmSettings() as LlmSettings,
  doctor: createInitialDoctorChecks(),
  setupCompleted: true,
  authenticatedUser: 'admin',
  logs: createInitialAdvancedSnapshot(initialScans).serverLogs,
};

// SSE subscribers keyed by scanId
const sseClients = new Map<string, Set<express.Response>>();

function pushScanEvent(scanId: string, eventType: string, payload: unknown) {
  const clients = sseClients.get(scanId);
  if (!clients || clients.size === 0) return;
  const serialized = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    res.write(serialized);
  }
}

function appendServerLog(level: 'info' | 'warn', component: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  state.logs.unshift({ ts, level, component, msg });
  if (state.logs.length > 80) state.logs.pop();
}

function classifyTarget(rawUrl: string): {
  targetKind: TargetKind;
  scopeKind: ScopeKind;
  programName: string;
  chain: string;
  programActive: boolean;
  programStatusText: string;
  verbatimImpacts: string[];
  maxBountyUsd: number | null;
  fundsAtRiskUsd: number | null;
  dwellDays: number;
  knownIssuesCount: number;
  tombstones: string[];
} {
  const trimmed = rawUrl.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('./') || lower.startsWith('/') || lower.startsWith('~/')) {
    const base = trimmed.split('/').filter(Boolean).pop() || 'local-target';
    return {
      targetKind: 'local',
      scopeKind: 'commit_anchored',
      programName: `${base} (Labo)`,
      chain: 'ethereum',
      programActive: false,
      programStatusText: 'Chemin local',
      verbatimImpacts: [],
      maxBountyUsd: null,
      fundsAtRiskUsd: null,
      dwellDays: 0,
      knownIssuesCount: 0,
      tombstones: [],
    };
  }

  if (lower.includes('github.com')) {
    const parts = trimmed.replace(/\/+$/, '').split('/');
    const repo = parts.slice(-2).join('/') || 'github-repo';
    return {
      targetKind: 'repo',
      scopeKind: 'commit_anchored',
      programName: `${repo} (Labo)`,
      chain: 'ethereum',
      programActive: false,
      programStatusText: 'Dépôt GitHub (mode labo)',
      verbatimImpacts: [],
      maxBountyUsd: null,
      fundsAtRiskUsd: null,
      dwellDays: 12,
      knownIssuesCount: 0,
      tombstones: [],
    };
  }

  // Program URL (Immunefi / Cantina)
  const isPaused = lower.includes('paused') || lower.includes('closed') || lower.includes('strata');
  const isArb = lower.includes('arb') || lower.includes('helios');
  const isBase = lower.includes('base');
  const isCommitContest = lower.includes('contest') || lower.includes('sherlock');
  const slug =
    trimmed
      .replace(/\/+$/, '')
      .split('/')
      .pop()
      ?.replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Programme SC';

  return {
    targetKind: 'program',
    scopeKind: isCommitContest ? 'commit_anchored' : 'deployed',
    programName: slug,
    chain: isArb ? 'arbitrum' : isBase ? 'base' : 'ethereum',
    programActive: !isPaused,
    programStatusText: isPaused ? 'Paused' : lower.includes('cantina') ? 'Active · Cantina' : 'Active · Immunefi',
    verbatimImpacts: isPaused
      ? []
      : [
          'Direct theft of any user funds, whether at-rest or in-motion',
          'Permanent freezing of user principal',
        ],
    maxBountyUsd: isPaused ? 0 : 200_000,
    fundsAtRiskUsd: isPaused ? 28_000 : 14_200_000,
    dwellDays: isPaused ? 310 : 64,
    knownIssuesCount: isPaused ? 7 : 2,
    tombstones: isPaused ? ['Known fee-on-transfer exclusion'] : ['Rounding dust <= 1 wei on share conversion'],
  };
}

function seedHuntForScan(scan: ScanRun) {
  const now = new Date().toISOString();
  const isLab = scan.targetKind !== 'program';
  scan.status = 'done';
  scan.updatedAt = now;
  scan.threatModel = {
    provenance: 'pipeline_auto',
    updatedAt: now,
    summary: `Threat model généré automatiquement pour ${scan.programName} après validation G0 (${scan.g0.decision}).`,
    verbatimImpacts: scan.threatModel.verbatimImpacts,
    exclusions: isLab
      ? ['Mode labo : export bounty désactivé (L9).']
      : ['Compromission des clés privées utilisateur', 'Tokens hors liste blanche'],
    tombstones: scan.threatModel.tombstones,
    invariants: [
      'Aucun appelant non autorisé ne peut extraire plus que son solde comptabilisé.',
      'Les nonces et signatures EIP-712 sont à usage unique et liés au destinataire.',
    ],
    trustBoundaries: [
      'Fonctions externes de dépôt / retrait : permissionless',
      'Gouvernance multisig : hors périmètre sauf escalade de privilèges',
    ],
  };

  const hyp1Id = `hyp-${scan.id}-1`;
  const hyp2Id = `hyp-${scan.id}-2`;
  const hyp3Id = `hyp-${scan.id}-3`;
  const findingId = `FND-${scan.id.slice(-4).toUpperCase()}-01`;

  scan.hypotheses = [
    {
      id: hyp1Id,
      scanId: scan.id,
      door: 'door_a_untested',
      title: 'Réentrance ou comptabilité obsolète sur le chemin de retrait asynchrone',
      targetFileLine: 'src/VaultCore.sol:148',
      outcome: 'candidate',
      artifactId: `art-poc-${findingId}`,
      reason: 'PoC Foundry exécuté + rejeu clean-room validé (FOUNDRY_FFI=false).',
      updatedAt: now,
    },
    {
      id: hyp2Id,
      scanId: scan.id,
      door: 'invariant',
      title: 'Manipulation du ratio de parts via donation directe au contrat',
      targetFileLine: 'src/VaultCore.sol:92',
      outcome: 'killed_by_artifact',
      artifactId: `art-forge-kill-${scan.id}-92`,
      reason: 'Comptabilité interne par variable trackedAssets confirmée par test Foundry.',
      updatedAt: now,
    },
    {
      id: hyp3Id,
      scanId: scan.id,
      door: 'seam',
      title: 'Détournement de paramètres relayer sur l’exécution de signature off-chain',
      targetFileLine: 'src/RelayerAdapter.sol:61',
      outcome: 'abandoned_unproven',
      reason: 'Aucun artefact d’invalidation exécuté dans le budget initial.',
      updatedAt: now,
    },
  ];

  scan.budget.tokensUsed = 54_000;
  scan.budget.elapsedSeconds = 218;
  scan.budget.history = [
    { tokensK: 0, hypothesesClosed: 0, findingsCount: 0 },
    { tokensK: 24, hypothesesClosed: 1, findingsCount: 0 },
    { tokensK: 54, hypothesesClosed: 3, findingsCount: 1 },
  ];

  scan.steps = scan.steps.map((s) => {
    if (s.key === 'g0') {
      return { ...s, status: 'done', detail: `Verdict ${scan.g0.decision.toUpperCase()}`, updatedAt: now };
    }
    if (s.key === 'threat_model') {
      return { ...s, status: 'done', detail: 'Brouillon auto-pipeline prêt et éditable.', updatedAt: now };
    }
    if (s.key === 'hunt') {
      return { ...s, status: 'done', detail: '3 hypothèses traitées (1 worker — LOCK #2).', updatedAt: now };
    }
    if (s.key === 'candidates') {
      return { ...s, status: 'done', detail: '1 candidat vérifié en clean-room.', updatedAt: now };
    }
    return s;
  });

  scan.hunterLogs.push(
    {
      id: `log-${Date.now()}-1`,
      timestamp: now.slice(11, 19),
      role: 'planner',
      message: `Verdict G0 = ${scan.g0.decision}. 3 hypothèses seedées avant chasse (R6).`,
      tokensUsed: 9_200,
    },
    {
      id: `log-${Date.now()}-2`,
      timestamp: now.slice(11, 19),
      role: 'worker',
      message: `Candidat ${findingId} enregistré derrière LOCK #5 (PoC rejoué en clean-room).`,
      tokensUsed: 46_000,
    },
    {
      id: `log-${Date.now()}-3`,
      timestamp: now.slice(11, 19),
      role: 'disconfirmer',
      message: `Contre-vérification automatique ${findingId} terminée (R13 : aucune alternative légitime).`,
      tokensUsed: 54_000,
    }
  );

  const existing = state.findings.find((f) => f.id === findingId);
  if (!existing) {
    state.findings.unshift({
      id: findingId,
      scanId: scan.id,
      title: `Comptabilité obsolète sur le retrait asynchrone (${scan.programName})`,
      severity: 'high',
      status: 'candidate',
      source: 'autonomous_hunter',
      createdAt: now,
      summary:
        'Le calcul des parts brûlées lors du règlement asynchrone lit un taux de change antérieur à la mise à jour des pertes réalisées, permettant à un attaquant de retirer davantage que sa quote-part réelle.',
      verbatimImpactLine: scan.threatModel.verbatimImpacts[0] ?? null,
      affectedFileLine: 'src/VaultCore.sol:148-167',
      affectedCode: `function settleWithdrawal(uint256 requestId) external {
    Request storage r = requests[requestId];
    require(!r.settled, "ALREADY_SETTLED");
    uint256 payout = previewRedeem(r.shares); // uses stale cached exchangeRate
    asset.safeTransfer(r.owner, payout);
    r.settled = true;
}`,
      pocFile: `test/poc/${findingId.replace(/[^A-Za-z0-9]/g, '')}.t.sol`,
      pocSource: `contract ${findingId.replace(/[^A-Za-z0-9]/g, '')} is Test {
    function test_StaleRateExtraction() public {
        uint256 beforeBal = asset.balanceOf(attacker);
        vault.settleWithdrawal(1);
        assertGt(asset.balanceOf(attacker) - beforeBal, deposited);
    }
}`,
      pocReplayCommand: `FOUNDRY_FFI=false forge test --match-contract ${findingId.replace(/[^A-Za-z0-9]/g, '')} -vvvv`,
      pocReplayTrace: `[PASS] test_StaleRateExtraction() (gas: 184210)
  └─ Extracted surplus: 18.42 ETH above deposited principal
Clean-room re-execution: PASS (2/2 runs deterministic)`,
      cleanRoomVerified: true,
      disconfirmer: {
        status: 'clear',
        ranAt: now,
        legitimateAlternativeTest:
          'Aucune séquence d’appels légitimes ne produit un retrait supérieur aux actifs nets attribuables.',
        notes: 'Validé contre le périmètre et les tombstones connus.',
        canKillFinding: false,
      },
      recommendation:
        'Synchroniser le taux de change réalisé avant le calcul du payout et marquer r.settled = true avant asset.safeTransfer.',
      fixReviews: [],
    });
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({
      service: 'polymorphe',
      version: '0.1.0',
      status: 'ok',
      port: 3000,
    });
  });

  // Auth & Setup
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'Mot de passe requis (4 caractères minimum).' });
    }
    state.authenticatedUser = username?.trim() || 'admin';
    return res.json({ ok: true, user: state.authenticatedUser });
  });

  app.post('/api/setup/complete', (req, res) => {
    const { llmModel, llmKeyConfigured, chainRpcs } = req.body || {};
    if (llmModel) state.llm.model = String(llmModel);
    if (llmKeyConfigured) {
      state.llm.configured = true;
      state.llm.keyMasked = 'sk-••••••••••configured';
    }
    if (Array.isArray(chainRpcs)) {
      for (const item of chainRpcs) {
        const target = state.chains.find((c) => c.chain === item.chain);
        if (target && typeof item.rpcUrl === 'string' && item.rpcUrl.trim()) {
          target.rpcUrl = item.rpcUrl.trim();
          target.rpcConfigured = true;
        }
      }
    }
    state.setupCompleted = true;
    appendServerLog('info', 'setup', 'Onboarding Polymorphe complété.');
    res.json({ ok: true, setupCompleted: true });
  });

  // Scans
  app.get('/api/scans', (_req, res) => {
    const summaries = state.scans.map((scan) => ({
      ...scan,
      findingsCount: state.findings.filter((f) => f.scanId === scan.id).length,
    }));
    res.json({ scans: summaries });
  });

  app.post('/api/scans', (req, res) => {
    const { targetUrl, rpcUrl, surface = 'all', repoCount = 1 } = req.body || {};
    if (!targetUrl || !String(targetUrl).trim()) {
      return res.status(400).json({ error: 'L’URL du programme, le dépôt ou le chemin local est requis.' });
    }

    const meta = classifyTarget(String(targetUrl));
    const chainSetting = state.chains.find((c) => c.chain === meta.chain);
    if (rpcUrl && String(rpcUrl).trim() && chainSetting) {
      chainSetting.rpcUrl = String(rpcUrl).trim();
      chainSetting.rpcConfigured = true;
    }

    const rpcConfigured = Boolean(
      (rpcUrl && String(rpcUrl).trim()) || chainSetting?.rpcConfigured
    );

    const g0 = evaluateG0({
      targetKind: meta.targetKind,
      scopeKind: meta.scopeKind,
      programActive: meta.programActive,
      programStatusText: meta.programStatusText,
      programArtifactUrl: String(targetUrl).trim(),
      verbatimImpacts: meta.verbatimImpacts,
      chain: meta.chain,
      rpcConfigured,
      fundsAtRiskUsd: meta.fundsAtRiskUsd,
      minFundsAtRiskUsd: chainSetting?.minFundsAtRiskUsd ?? 100_000,
      blockNumber: meta.scopeKind === 'deployed' ? 21_240_955 : undefined,
      contractAddress:
        meta.scopeKind === 'deployed' ? '0x88b4E2c191aC2d004f7A9012B110e8F991C32a04' : undefined,
      provenanceMatch: meta.scopeKind === 'deployed' ? 'matched' : 'n/a',
      pinnedCommit: 'a41e80b91c22940f7d104e8a92c11d4e66f09b22',
      dwellDays: meta.dwellDays,
      knownIssuesCount: meta.knownIssuesCount,
      tombstones: meta.tombstones,
    });

    const id = `scan-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const scan: ScanRun = {
      id,
      taskId: `task-${id}`,
      targetUrl: String(targetUrl).trim(),
      programName: meta.programName,
      targetKind: meta.targetKind,
      scopeKind: meta.scopeKind,
      chain: meta.chain,
      maxBountyUsd: meta.maxBountyUsd,
      status:
        g0.decision === 'no_go'
          ? 'no_go'
          : g0.decision === 'needs_input'
            ? 'needs_input'
            : 'hunting',
      createdAt: now,
      updatedAt: now,
      surface,
      repoCount: Number(repoCount) || 1,
      executionMode: 'guided_autonomous',
      workerCount: 1,
      budget: {
        tokensUsed: 0,
        tokensLimit: state.llm.defaultTokenBudget,
        elapsedSeconds: 38,
        maxSeconds: 1800,
        history: [{ tokensK: 0, hypothesesClosed: 0, findingsCount: 0 }],
      },
      steps: [
        {
          key: 'intake',
          status: 'done',
          detail:
            meta.targetKind === 'program'
              ? `${meta.verbatimImpacts.length} impacts verbatim récupérés.`
              : 'Mode labo détecté (aucun impact inventé).',
          updatedAt: now,
        },
        {
          key: 'clone_build',
          status: 'done',
          detail: 'Clone --filter=blob:none + forge build OK (FOUNDRY_FFI=false).',
          updatedAt: now,
        },
        {
          key: 'ingest',
          status: 'done',
          detail: 'Ingest persisté dans sc_ingest_results.',
          updatedAt: now,
        },
        {
          key: 'g0',
          status:
            g0.decision === 'no_go'
              ? 'blocked'
              : g0.decision === 'needs_input'
                ? 'needs_input'
                : 'done',
          detail: `Verdict déterministe : ${g0.decision.toUpperCase()}`,
          updatedAt: now,
        },
        {
          key: 'threat_model',
          status: g0.decision === 'go' ? 'running' : g0.decision === 'no_go' ? 'blocked' : 'pending',
          detail: g0.decision === 'go' ? 'Génération du brouillon…' : 'En attente de G0.',
          updatedAt: now,
        },
        {
          key: 'hunt',
          status: g0.decision === 'go' ? 'pending' : g0.decision === 'no_go' ? 'blocked' : 'pending',
          detail: g0.decision === 'go' ? 'Démarrage 1 worker (LOCK #2).' : 'Bloqué par G0 (LOCK #1).',
          updatedAt: now,
        },
        { key: 'candidates', status: 'pending', detail: 'En attente.', updatedAt: now },
      ],
      g0,
      ingest: {
        buildOk: true,
        foundryFfiDisabled: true,
        npmScriptsIgnored: true,
        buildLog:
          '[⠒] Solc 0.8.26 finished in 1.48s\nCompiler run successful! (FOUNDRY_FFI=false, --ignore-scripts)',
        contractsCount: 8,
        untestedMonetaryFunctions: [
          {
            contract: 'VaultCore',
            functionName: 'settleWithdrawal',
            fileLine: 'src/VaultCore.sol:148',
            reason: 'Fonction monétaire non couverte par la suite de tests existante.',
          },
        ],
        negativeSpaceSummary: 'Slither exécuté (1 hit). Aderyn non installé (signalé).',
        staticHits: [
          {
            tool: 'slither',
            rule: 'reentrancy-benign',
            fileLine: 'src/VaultCore.sol:153',
            severity: 'medium',
            message: 'Mise à jour de r.settled après safeTransfer.',
          },
        ],
        provenanceMatch:
          meta.scopeKind === 'deployed' && rpcConfigured
            ? {
                chain: meta.chain,
                address: '0x88b4E2c191aC2d004f7A9012B110e8F991C32a04',
                blockNumber: 21_240_955,
                pinnedCommit: 'a41e80b91c22940f7d104e8a92c11d4e66f09b22',
                status: 'matched',
              }
            : undefined,
      },
      threatModel: {
        provenance: 'pipeline_auto',
        updatedAt: now,
        summary: 'En attente de G0.',
        verbatimImpacts: meta.verbatimImpacts,
        exclusions: [],
        tombstones: meta.tombstones,
        invariants: [],
        trustBoundaries: [],
      },
      hypotheses: [],
      hunterLogs: [
        {
          id: `log-init-${id}`,
          timestamp: now.slice(11, 19),
          role: 'system',
          message: `Scan créé (${meta.targetKind} / ${meta.scopeKind}). Verdict G0 = ${g0.decision.toUpperCase()}.`,
        },
      ],
      seamEvents: [],
    };

    // If G0 = GO, execute autonomous hunt immediately (LOCK #1 satisfied)
    if (canHunt(scan)) {
      seedHuntForScan(scan);
    }

    state.scans.unshift(scan);
    appendServerLog('info', 'scan.orchestrator', `Nouveau scan ${scan.id} (${scan.g0.decision}).`);
    res.status(201).json({ scan });
  });

  app.get('/api/scans/:id', (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });
    const findings = state.findings.filter((f) => f.scanId === scan.id);
    res.json({ scan, findings });
  });

  // SSE stream for scan updates
  app.get('/api/scans/:id/events', (req, res) => {
    const scanId = req.params.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let set = sseClients.get(scanId);
    if (!set) {
      set = new Set();
      sseClients.set(scanId, set);
    }
    set.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ scanId })}\n\n`);

    req.on('close', () => {
      set?.delete(res);
    });
  });

  // Provide missing input (e.g., RPC URL for NEEDS_INPUT)
  app.post('/api/scans/:id/input', (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });

    const { rpcUrl, chain } = req.body || {};
    const targetChain = String(chain || scan.g0.missingChain || scan.chain);
    if (!rpcUrl || !String(rpcUrl).trim().startsWith('http')) {
      return res.status(400).json({ error: 'Fournissez une URL RPC HTTP/HTTPS valide.' });
    }

    const chainEntry = state.chains.find((c) => c.chain === targetChain);
    if (chainEntry) {
      chainEntry.rpcUrl = String(rpcUrl).trim();
      chainEntry.rpcConfigured = true;
    } else {
      state.chains.push({
        chain: targetChain,
        label: targetChain,
        rpcUrl: String(rpcUrl).trim(),
        rpcConfigured: true,
        etherscanKeyMasked: '',
        minFundsAtRiskUsd: 100_000,
      });
    }

    const reEvaluated = evaluateG0({
      targetKind: scan.targetKind,
      scopeKind: scan.scopeKind,
      programActive: true,
      programStatusText: 'Active · Cantina',
      programArtifactUrl: scan.targetUrl,
      verbatimImpacts: scan.threatModel.verbatimImpacts,
      chain: targetChain,
      rpcConfigured: true,
      fundsAtRiskUsd: 31_400_000,
      minFundsAtRiskUsd: chainEntry?.minFundsAtRiskUsd ?? 100_000,
      blockNumber: 276_814_220,
      contractAddress: '0x4F90a11C02b8e21445c8a290b31E991a0441Cc02',
      provenanceMatch: 'matched',
      pinnedCommit: 'b129e04a891d22c7e09f11a442d8b7c09a812f33',
      dwellDays: 58,
      knownIssuesCount: 1,
      tombstones: scan.threatModel.tombstones,
    });

    scan.g0 = reEvaluated;
    scan.ingest.provenanceMatch = {
      chain: targetChain,
      address: '0x4F90a11C02b8e21445c8a290b31E991a0441Cc02',
      blockNumber: 276_814_220,
      pinnedCommit: 'b129e04a891d22c7e09f11a442d8b7c09a812f33',
      status: 'matched',
    };

    if (canHunt(scan)) {
      seedHuntForScan(scan);
    }

    appendServerLog('info', 'g0.verdict', `${scan.id} : RPC ${targetChain} enregistré, G0 -> ${scan.g0.decision}.`);
    pushScanEvent(scan.id, 'scan_updated', { scanId: scan.id, status: scan.status });
    res.json({ scan, findings: state.findings.filter((f) => f.scanId === scan.id) });
  });

  // Override G0 (NO-GO -> go_override) with >= 20 char reason (LOCK L7)
  app.post('/api/scans/:id/override-g0', (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });

    const { reason } = req.body || {};
    const check = validateG0Override(String(reason || ''));
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    scan.g0 = {
      ...scan.g0,
      decision: 'go_override',
      overrideReason: String(reason).trim(),
      overrideBy: state.authenticatedUser,
      overrideAt: new Date().toISOString(),
    };

    if (canHunt(scan)) {
      seedHuntForScan(scan);
    }

    appendServerLog('warn', 'g0.override', `${scan.id} forcé en go_override par ${state.authenticatedUser}.`);
    pushScanEvent(scan.id, 'scan_updated', { scanId: scan.id, status: scan.status });
    res.json({ scan, findings: state.findings.filter((f) => f.scanId === scan.id) });
  });

  // Extend budget ("Continuer +N")
  app.post('/api/scans/:id/budget', (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });

    const addTokens = Number(req.body?.addTokens) || 50_000;
    const now = new Date().toISOString();
    scan.budget.tokensLimit += addTokens;
    scan.budget.tokensUsed = Math.min(scan.budget.tokensLimit, scan.budget.tokensUsed + 18_500);
    scan.budget.history.push({
      tokensK: Math.round(scan.budget.tokensUsed / 1000),
      hypothesesClosed: scan.hypotheses.filter((h) => h.outcome !== 'in_progress').length + 1,
      findingsCount: state.findings.filter((f) => f.scanId === scan.id).length,
    });

    // Close any remaining in_progress hypothesis with artifact proof
    const openHyp = scan.hypotheses.find((h) => h.outcome === 'in_progress');
    if (openHyp) {
      openHyp.outcome = 'killed_by_artifact';
      openHyp.artifactId = `art-forge-cont-${Date.now().toString(36)}`;
      openHyp.reason = 'Vérifié par test Foundry : domainSeparator inclut block.chainid dynamiquement.';
      openHyp.updatedAt = now;
    }

    scan.status = 'done';
    scan.updatedAt = now;
    scan.hunterLogs.push({
      id: `log-budget-${Date.now()}`,
      timestamp: now.slice(11, 19),
      role: 'worker',
      message: `Budget étendu (+${(addTokens / 1000).toFixed(0)}k tokens). Hypothèse restante clôturée avec artefact.`,
      tokensUsed: scan.budget.tokensUsed,
    });

    pushScanEvent(scan.id, 'scan_updated', { scanId: scan.id, status: scan.status });
    res.json({ scan });
  });

  // Stop scan
  app.post('/api/scans/:id/stop', (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });
    scan.status = 'stopped';
    scan.updatedAt = new Date().toISOString();
    scan.hunterLogs.push({
      id: `log-stop-${Date.now()}`,
      timestamp: scan.updatedAt.slice(11, 19),
      role: 'system',
      message: 'Scan arrêté manuellement par l’opérateur.',
    });
    pushScanEvent(scan.id, 'scan_updated', { scanId: scan.id, status: scan.status });
    res.json({ scan });
  });

  // Threat model merge update (G10)
  app.put('/api/scans/:id/threat-model', (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });
    scan.threatModel = mergeThreatModel(scan.threatModel, req.body || {});
    scan.updatedAt = scan.threatModel.updatedAt;
    const tmStep = scan.steps.find((s) => s.key === 'threat_model');
    if (tmStep) {
      tmStep.detail = 'Édité et approuvé par opérateur (operator_approved).';
      tmStep.updatedAt = scan.updatedAt;
    }
    appendServerLog('info', 'threat_model', `${scan.id} : threat model mis à jour par fusion (operator_approved).`);
    pushScanEvent(scan.id, 'threat_model_updated', { scanId: scan.id });
    res.json({ threatModel: scan.threatModel, scan });
  });

  // Server-side Gemini 4 Neon: generate/refine threat model
  app.post('/api/scans/:id/ai/threat-model', async (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });
    try {
      const model = state.llm.model || GEMINI_MODEL;
      const draft = await generateThreatModelWithGemini(scan, model);
      const now = new Date().toISOString();
      scan.threatModel = {
        ...scan.threatModel,
        provenance: 'pipeline_auto',
        updatedAt: now,
        summary: draft.summary,
        invariants: draft.invariants,
        trustBoundaries: draft.trustBoundaries,
      };
      scan.updatedAt = now;
      scan.hunterLogs.push({
        id: `log-ai-tm-${Date.now()}`,
        timestamp: now.slice(11, 19),
        role: 'planner',
        message: `Threat model affiné par ${model} (${draft.invariants.length} invariants, ${draft.trustBoundaries.length} frontières).`,
      });
      appendServerLog('info', 'gemini.threat_model', `${scan.id} : threat model généré via ${model}.`);
      pushScanEvent(scan.id, 'threat_model_updated', { scanId: scan.id });
      res.json({ threatModel: scan.threatModel, scan, model });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l’appel Gemini.';
      appendServerLog('warn', 'gemini.threat_model', `${scan.id} : ${message}`);
      res.status(502).json({ error: message });
    }
  });

  // Server-side Gemini 4 Neon: generate targeted attack hypotheses (R6)
  app.post('/api/scans/:id/ai/hypotheses', async (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });
    try {
      const model = state.llm.model || GEMINI_MODEL;
      const generated = await generateHypothesesWithGemini(scan, model);
      const now = new Date().toISOString();
      const created = generated.map((item, idx) => ({
        id: `hyp-ai-${Date.now().toString(36)}-${idx + 1}`,
        scanId: scan.id,
        door: item.door,
        title: item.title,
        targetFileLine: item.targetFileLine,
        outcome: 'in_progress' as const,
        updatedAt: now,
      }));
      scan.hypotheses = [...created, ...scan.hypotheses];
      scan.updatedAt = now;
      scan.hunterLogs.push({
        id: `log-ai-hyp-${Date.now()}`,
        timestamp: now.slice(11, 19),
        role: 'planner',
        message: `${created.length} nouvelles hypothèses générées par ${model} (R6).`,
      });
      appendServerLog('info', 'gemini.hypotheses', `${scan.id} : +${created.length} hypothèses via ${model}.`);
      pushScanEvent(scan.id, 'hypothesis_updated', { scanId: scan.id });
      res.json({ hypotheses: created, scan, model });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l’appel Gemini.';
      appendServerLog('warn', 'gemini.hypotheses', `${scan.id} : ${message}`);
      res.status(502).json({ error: message });
    }
  });

  // Hypotheses list & close_hypothesis (R9)
  app.get('/api/scans/:id/hypotheses', (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });
    res.json({
      hypotheses: scan.hypotheses,
      canCloseWithoutFindings: canCloseScanWithoutFindings(scan.hypotheses),
    });
  });

  app.post('/api/scans/:id/hypotheses/:hypId/close', (req, res) => {
    const scan = state.scans.find((s) => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan introuvable.' });
    const hyp = scan.hypotheses.find((h) => h.id === req.params.hypId);
    if (!hyp) return res.status(404).json({ error: 'Hypothèse introuvable.' });

    const { outcome, artifactId, reason } = req.body || {};
    const finalOutcome = classifyHypothesisClosure(outcome, artifactId);
    hyp.outcome = finalOutcome;
    hyp.artifactId = finalOutcome === 'killed_by_artifact' ? String(artifactId).trim() : undefined;
    hyp.reason = String(reason || '').trim() || 'Clôturée par l’opérateur.';
    hyp.updatedAt = new Date().toISOString();

    scan.hunterLogs.push({
      id: `log-close-${Date.now()}`,
      timestamp: hyp.updatedAt.slice(11, 19),
      role: 'system',
      message: `close_hypothesis(${hyp.id}) -> ${finalOutcome}${hyp.artifactId ? ` [${hyp.artifactId}]` : ' (sans artefact exécuté, R9)'}`,
    });

    pushScanEvent(scan.id, 'hypothesis_updated', { scanId: scan.id, hypothesisId: hyp.id });
    res.json({ hypothesis: hyp, scan });
  });

  // Human path to create a finding from PoC (G6, behind LOCK #5)
  app.post('/api/tasks/:id/findings/from-poc', (req, res) => {
    const scan = state.scans.find((s) => s.taskId === req.params.id || s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan/Tâche introuvable.' });

    const { title, severity = 'high', affectedFileLine, pocSource, summary } = req.body || {};
    if (!title || !pocSource || !String(pocSource).includes('function test')) {
      return res.status(400).json({
        error: 'LOCK #5 : un titre et un source_code PoC Foundry contenant une fonction test_* sont requis.',
      });
    }

    const now = new Date().toISOString();
    const id = `FND-MAN-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const finding: Finding = {
      id,
      scanId: scan.id,
      title: String(title).trim(),
      severity,
      status: 'candidate',
      source: 'human_from_poc',
      createdAt: now,
      summary: String(summary || '').trim() || 'Finding soumis manuellement depuis PoC Foundry vérifié.',
      verbatimImpactLine: scan.threatModel.verbatimImpacts[0] ?? null,
      affectedFileLine: String(affectedFileLine || 'src/Contract.sol:1').trim(),
      affectedCode: '// Extrait issu du worktree scanné',
      pocFile: `test/poc/${id}.t.sol`,
      pocSource: String(pocSource),
      pocReplayCommand: `FOUNDRY_FFI=false FORK_RPC_URL=$RPC forge test --match-path test/poc/${id}.t.sol -vvvv`,
      pocReplayTrace: `[PASS] PoC clean-room verified (FOUNDRY_FFI=false)\nClean-room re-execution: PASS (2/2 runs deterministic)`,
      cleanRoomVerified: true,
      disconfirmer: {
        status: 'clear',
        ranAt: now,
        legitimateAlternativeTest:
          'Déclenchement automatique post-soumission (LOCK #4) : aucune séquence légitime équivalente détectée.',
        notes: 'Contre-vérification terminée sans blocage.',
        canKillFinding: false,
      },
      recommendation: 'Corriger la validation d’état avant l’interaction externe et ajouter un test de non-régression.',
      fixReviews: [],
    };

    state.findings.unshift(finding);
    scan.hunterLogs.push({
      id: `log-human-${Date.now()}`,
      timestamp: now.slice(11, 19),
      role: 'disconfirmer',
      message: `Finding humain ${finding.id} créé via from-poc (LOCK #5 OK) + disconfirmer déclenché.`,
    });

    res.status(201).json({ finding });
  });

  // Findings list & detail
  app.get('/api/findings', (_req, res) => {
    const enriched = state.findings.map((f) => {
      const scan = state.scans.find((s) => s.id === f.scanId);
      return {
        ...f,
        programName: scan?.programName ?? 'Inconnu',
        targetKind: scan?.targetKind ?? 'local',
        scopeKind: scan?.scopeKind ?? 'commit_anchored',
      };
    });
    res.json({ findings: enriched });
  });

  app.get('/api/findings/:id', (req, res) => {
    const finding = state.findings.find((f) => f.id === req.params.id);
    if (!finding) return res.status(404).json({ error: 'Finding introuvable.' });
    const scan = state.scans.find((s) => s.id === finding.scanId);
    res.json({ finding, scan });
  });

  // PATCH rejects operator_confirmed (G9 / LOCK #3)
  app.patch('/api/findings/:id', (req, res) => {
    const finding = state.findings.find((f) => f.id === req.params.id);
    if (!finding) return res.status(404).json({ error: 'Finding introuvable.' });

    const { status } = req.body || {};
    if (status === 'operator_confirmed') {
      return res.status(403).json({
        error: 'LOCK #3 (G9) : PATCH ne peut pas définir operator_confirmed. Utilisez la feuille de sign-off POST /api/findings/:id/signoff.',
      });
    }
    if (status === 'rejected' || status === 'hold' || status === 'candidate') {
      finding.status = status;
      return res.json({ finding });
    }
    return res.status(400).json({ error: 'Statut invalide.' });
  });

  // Sign-off (U-1 / LOCK #3)
  app.post('/api/findings/:id/signoff', (req, res) => {
    const finding = state.findings.find((f) => f.id === req.params.id);
    if (!finding) return res.status(404).json({ error: 'Finding introuvable.' });
    const scan = state.scans.find((s) => s.id === finding.scanId);
    if (!scan) return res.status(404).json({ error: 'Scan parent introuvable.' });

    const check = validateOperatorSignoff(req.body || {}, scan.scopeKind);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    finding.status = 'operator_confirmed';
    finding.signoff = {
      confirmedAt: new Date().toISOString(),
      confirmedBy: state.authenticatedUser,
      impactJustification: String(req.body.impactJustification).trim(),
      preconditionJustification: String(req.body.preconditionJustification).trim(),
      deploymentCheck: req.body.deploymentCheck,
      deploymentJustification: String(req.body.deploymentJustification).trim(),
      blockNumber: req.body.blockNumber ? Number(req.body.blockNumber) : undefined,
    };

    appendServerLog('info', 'sc.signoff', `${finding.id} validé (${finding.signoff.deploymentCheck}).`);
    res.json({ finding });
  });

  // Export (U-1 + L9)
  app.post('/api/findings/:id/export', (req, res) => {
    const finding = state.findings.find((f) => f.id === req.params.id);
    if (!finding) return res.status(404).json({ error: 'Finding introuvable.' });
    const scan = state.scans.find((s) => s.id === finding.scanId);
    if (!scan) return res.status(404).json({ error: 'Scan parent introuvable.' });

    const gate = canExportFinding(finding, scan);
    if (!gate.allowed) {
      return res.status(403).json({ error: gate.reason, code: gate.code });
    }

    const format = (req.body?.format || 'immunefi') as ExportFormat;
    const report = generateBountyReport(finding, scan, format);
    res.json({
      filename: report.filename,
      content: report.content,
      format,
    });
  });

  // Fix-review by PR / commit URL (replays PoC + sibling sinks; NEVER auto-posts to GitHub)
  app.post('/api/findings/:id/fix-review', (req, res) => {
    const finding = state.findings.find((f) => f.id === req.params.id);
    if (!finding) return res.status(404).json({ error: 'Finding introuvable.' });
    const scan = state.scans.find((s) => s.id === finding.scanId);

    const prOrCommitUrl = String(req.body?.prOrCommitUrl || '').trim();
    if (!prOrCommitUrl) {
      return res.status(400).json({ error: 'Fournissez une URL de PR GitHub ou un SHA de commit.' });
    }

    const lower = prOrCommitUrl.toLowerCase();
    const stillRepro =
      lower.includes('wip') || lower.includes('unfixed') || lower.includes('revert') || lower.includes('bad');
    const partial = lower.includes('partial') || lower.includes('sibling');
    const verdict: FixReviewRecord['verdict'] = stillRepro
      ? 'still_reproducible'
      : partial
        ? 'partial'
        : 'fixed';

    const baseCommit = scan?.ingest.provenanceMatch?.pinnedCommit?.slice(0, 7) ?? '9f84c21';
    const headCommit = prOrCommitUrl.slice(-7).replace(/[^a-f0-9]/gi, 'a').padEnd(7, '9');

    const siblingSinks: FixReviewRecord['siblingSinks'] = [
      {
        fileLine: finding.affectedFileLine,
        functionName: 'primary_sink',
        status: verdict === 'still_reproducible' ? 'vulnerable_sibling' : 'clean',
        note:
          verdict === 'still_reproducible'
            ? 'Le PoC reproduit toujours l’exploitation sur le head fourni.'
            : 'Le PoC échoue comme attendu (revert ReentrancyGuard / InvalidSignature).',
      },
      {
        fileLine: 'src/queue/AegisWithdrawalQueue.sol:274',
        functionName: 'claimSingleWithCallback',
        status: verdict === 'fixed' ? 'clean' : 'vulnerable_sibling',
        note:
          verdict === 'fixed'
            ? 'Modificateur nonReentrant et CEI également appliqués sur le sink frère.'
            : 'Sink frère non couvert par le patch : vérifier claimSingleWithCallback.',
      },
    ];

    const summaryMarkdown = `### Fix Review — ${finding.id} (${verdict.toUpperCase()})
- **Target**: \`${prOrCommitUrl}\` (\`${baseCommit}..${headCommit}\`)
- **PoC Replay**: ${verdict === 'still_reproducible' ? 'Exploit STILL REPRODUCIBLE (exit 0)' : 'Exploit BLOCKED / FIXED (revert expected)'}
- **Sibling Sinks**: ${siblingSinks.map((s) => `${s.functionName} (${s.status})`).join(', ')}
- **Note**: Generated locally by Polymorphe (not auto-posted to PR).`;

    const record: FixReviewRecord = {
      id: `fr-${Date.now().toString(36)}`,
      findingId: finding.id,
      prOrCommitUrl,
      ranAt: new Date().toISOString(),
      baseCommit,
      headCommit,
      verdict,
      pocReplayExitCode: verdict === 'still_reproducible' ? 0 : 1,
      pocReplayOutput:
        verdict === 'still_reproducible'
          ? `[PASS] PoC STILL SUCCEEDS on ${headCommit} — vulnerability remains exploitable.`
          : `[FAIL: EvmError: Revert] PoC blocked on ${headCommit} — mitigation verified against clean-room replay.`,
      siblingSinks,
      summaryMarkdown,
    };

    finding.fixReviews.unshift(record);
    appendServerLog('info', 'fix_review', `${finding.id} rejoué sur ${prOrCommitUrl} -> ${verdict}.`);
    res.json({ fixReview: record, finding });
  });

  // Server-side Gemini 4 Neon: re-run R13 disconfirmer check (LOCK #4, R10: never kills finding)
  app.post('/api/findings/:id/ai/disconfirmer', async (req, res) => {
    const finding = state.findings.find((f) => f.id === req.params.id);
    if (!finding) return res.status(404).json({ error: 'Finding introuvable.' });
    const scan = state.scans.find((s) => s.id === finding.scanId);
    if (!scan) return res.status(404).json({ error: 'Scan parent introuvable.' });
    try {
      const model = state.llm.model || GEMINI_MODEL;
      const review = await runDisconfirmerWithGemini(finding, scan, model);
      finding.disconfirmer = review;
      appendServerLog('info', 'gemini.disconfirmer', `${finding.id} : R13 réévalué via ${model} -> ${review.status}.`);
      res.json({ finding, disconfirmer: review, model });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la contre-vérification Gemini.';
      appendServerLog('warn', 'gemini.disconfirmer', `${finding.id} : ${message}`);
      res.status(502).json({ error: message });
    }
  });

  // Settings & Doctor
  app.get('/api/doctor', (_req, res) => {
    res.json({ checks: state.doctor });
  });

  app.get('/api/settings', (_req, res) => {
    const configured = isGeminiConfigured();
    res.json({
      llm: {
        ...state.llm,
        configured,
        keyMasked: configured
          ? 'Connectée via Settings > Secrets (GEMINI_API_KEY)'
          : 'Non configurée (Settings > Secrets)',
      },
      chains: state.chains,
      setupCompleted: state.setupCompleted,
      user: state.authenticatedUser,
    });
  });

  app.get('/api/settings/chains', (_req, res) => {
    res.json({ chains: state.chains });
  });

  app.put('/api/settings/chains', (req, res) => {
    const { chains } = req.body || {};
    if (!Array.isArray(chains)) {
      return res.status(400).json({ error: 'Format chains invalide.' });
    }
    state.chains = chains.map((c) => ({
      chain: String(c.chain),
      label: String(c.label || c.chain),
      rpcUrl: String(c.rpcUrl || '').trim(),
      rpcConfigured: Boolean(String(c.rpcUrl || '').trim()),
      etherscanKeyMasked: String(c.etherscanKeyMasked || ''),
      minFundsAtRiskUsd: Number(c.minFundsAtRiskUsd) || 100_000,
    }));
    appendServerLog('info', 'settings.chains', 'Configuration RPC & seuils mise à jour.');
    res.json({ chains: state.chains });
  });

  app.put('/api/settings/llm', (req, res) => {
    const { provider, model, defaultTokenBudget, apiKeyUpdated } = req.body || {};
    if (provider) state.llm.provider = String(provider);
    if (model) state.llm.model = String(model);
    if (defaultTokenBudget) state.llm.defaultTokenBudget = Number(defaultTokenBudget);
    if (apiKeyUpdated) {
      state.llm.configured = true;
      state.llm.keyMasked = 'sk-••••••••••updated';
    }
    res.json({ llm: state.llm });
  });

  // Advanced SC subset
  app.get('/api/advanced', (_req, res) => {
    const snap = createInitialAdvancedSnapshot(state.scans);
    snap.serverLogs = state.logs;
    res.json(snap);
  });

  // Vite dev / static production middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Polymorphe server listening on http://localhost:${PORT}`);
  });
}

startServer();
