import type {
  DeploymentCheckKind,
  ExportFormat,
  Finding,
  G0Decision,
  G0Report,
  G0VerdictLine,
  Hypothesis,
  HypothesisOutcome,
  OperatorSignoff,
  ScanRun,
  ScopeKind,
  TargetKind,
  ThreatModel,
} from '../types';

export interface G0EvaluationInput {
  targetKind: TargetKind;
  scopeKind: ScopeKind;
  programActive: boolean;
  programStatusText: string;
  programArtifactUrl: string;
  verbatimImpacts: string[];
  chain: string;
  rpcConfigured: boolean;
  fundsAtRiskUsd: number | null;
  minFundsAtRiskUsd: number;
  blockNumber?: number;
  contractAddress?: string;
  provenanceMatch: 'matched' | 'diverged' | 'n/a';
  pinnedCommit?: string;
  dwellDays: number;
  knownIssuesCount: number;
  tombstones: string[];
}

/**
 * Pure deterministic G0 evaluator (no LLM, no hardcoded decisions).
 * Implements R1-R4, R11, R12, R15, R16 and Doctrine Lock L7.
 */
export function evaluateG0(input: G0EvaluationInput): G0Report {
  const isLab = input.targetKind !== 'program';
  const lines: G0VerdictLine[] = [];

  // L1 — Payer / Active program (R4)
  if (isLab) {
    lines.push({
      id: 'L1',
      ruleRef: 'R4',
      label: 'Payeur / Programme actif',
      status: 'n/a',
      value: 'Mode labo (sans programme)',
      detail: 'Cible locale ou dépôt GitHub sans programme de bounty associé.',
      artifact: {
        id: 'art-l1-lab',
        source: input.programArtifactUrl,
        excerpt: `target_kind=${input.targetKind} · scope_kind=${input.scopeKind}`,
      },
    });
  } else {
    lines.push({
      id: 'L1',
      ruleRef: 'R4',
      label: 'Payeur / Programme actif',
      status: input.programActive ? 'ok' : 'block',
      value: input.programActive ? 'Actif' : input.programStatusText || 'En pause / Fermé',
      detail: input.programActive
        ? 'Programme ouvert aux soumissions avec payeur vérifié.'
        : 'Programme en pause ou fermé : aucun investissement de chasse justifié (R4).',
      artifact: {
        id: 'art-l1-program',
        source: input.programArtifactUrl,
        excerpt: `status="${input.programStatusText}" · active=${String(input.programActive)}`,
      },
    });
  }

  // L2 — At least one verbatim impact line (R12)
  if (isLab) {
    lines.push({
      id: 'L2',
      ruleRef: 'R12',
      label: 'Impacts verbatim',
      status: 'n/a',
      value: '0 (Mode labo)',
      detail: 'Aucun impact inventé par défaut en mode labo ; export bounty bloqué (L9).',
      artifact: {
        id: 'art-l2-lab',
        source: input.programArtifactUrl,
        excerpt: 'verbatim_impacts=[] (default synthesis disabled)',
      },
    });
  } else {
    const count = input.verbatimImpacts.length;
    lines.push({
      id: 'L2',
      ruleRef: 'R12',
      label: 'Impacts verbatim',
      status: count > 0 ? 'ok' : 'block',
      value: `${count} ligne${count > 1 ? 's' : ''}`,
      detail:
        count > 0
          ? 'Lignes d’impact copiées mot pour mot depuis la page du programme.'
          : 'Aucune ligne d’impact verbatim disponible : impossible de qualifier une prime (R12).',
      artifact: {
        id: 'art-l2-impacts',
        source: input.programArtifactUrl,
        excerpt:
          count > 0
            ? input.verbatimImpacts.slice(0, 2).join(' | ')
            : 'verbatim_impacts=[] (missing required impact scope)',
      },
    });
  }

  // L3 — Funds-at-risk at current block (R1, R15)
  if (input.scopeKind === 'commit_anchored') {
    lines.push({
      id: 'L3',
      ruleRef: 'R1, R15',
      label: 'Fonds à risque (bloc courant)',
      status: 'n/a',
      value: 'Scope ancré sur commit',
      detail: 'Périmètre audité sur un commit précis sans déploiement mainnet requis.',
      artifact: {
        id: 'art-l3-commit',
        source: input.programArtifactUrl,
        commitSha: input.pinnedCommit,
        excerpt: `scope_kind=commit_anchored · commit=${input.pinnedCommit ?? 'HEAD'}`,
      },
    });
  } else if (!input.rpcConfigured) {
    lines.push({
      id: 'L3',
      ruleRef: 'R1, R15',
      label: 'Fonds à risque (bloc courant)',
      status: 'needs_input',
      value: `RPC ${input.chain} manquant`,
      detail: `Fournissez un endpoint RPC pour ${input.chain} afin de vérifier le TVL et le bytecode au bloc courant.`,
      artifact: {
        id: 'art-l3-rpc-missing',
        source: `chain_settings://${input.chain}`,
        chain: input.chain,
        excerpt: `rpc_url=unset for chain=${input.chain} (required for deployed scope)`,
      },
    });
  } else {
    const funds = input.fundsAtRiskUsd ?? 0;
    const aboveThreshold = funds >= input.minFundsAtRiskUsd;
    lines.push({
      id: 'L3',
      ruleRef: 'R1, R15',
      label: 'Fonds à risque (bloc courant)',
      status: aboveThreshold ? 'ok' : 'block',
      value: `$${funds.toLocaleString('en-US')}`,
      detail: aboveThreshold
        ? `Supérieur au seuil configuré ($${input.minFundsAtRiskUsd.toLocaleString('en-US')}) au bloc ${input.blockNumber ?? 'courant'}.`
        : `Sous le seuil configuré ($${input.minFundsAtRiskUsd.toLocaleString('en-US')}) : exposition insuffisante (R1).`,
      artifact: {
        id: 'art-l3-funds',
        source: `rpc://${input.chain}/eth_call`,
        chain: input.chain,
        blockNumber: input.blockNumber,
        excerpt: `address=${input.contractAddress ?? 'scope'} · block=${input.blockNumber ?? 0} · tvl_usd=${funds}`,
      },
    });
  }

  // L4 — Bytecode <-> Repo provenance (R11)
  if (input.provenanceMatch === 'n/a' || input.scopeKind === 'commit_anchored') {
    lines.push({
      id: 'L4',
      ruleRef: 'R11',
      label: 'Provenance bytecode ↔ dépôt',
      status: 'n/a',
      value: 'Non applicable',
      detail: 'Vérification on-chain non requise pour un scope non déployé.',
      artifact: {
        id: 'art-l4-na',
        source: 'git://log',
        commitSha: input.pinnedCommit,
        excerpt: `pinned_commit=${input.pinnedCommit ?? 'HEAD'}`,
      },
    });
  } else if (!input.rpcConfigured) {
    lines.push({
      id: 'L4',
      ruleRef: 'R11',
      label: 'Provenance bytecode ↔ dépôt',
      status: 'needs_input',
      value: 'En attente du RPC',
      detail: 'La comparaison bytecode déployé vs dépôt requiert un RPC configuré.',
      artifact: {
        id: 'art-l4-wait-rpc',
        source: `chain_settings://${input.chain}`,
        chain: input.chain,
        excerpt: 'eth_getCode deferred until RPC is configured',
      },
    });
  } else {
    const matched = input.provenanceMatch === 'matched';
    lines.push({
      id: 'L4',
      ruleRef: 'R11',
      label: 'Provenance bytecode ↔ dépôt',
      status: matched ? 'ok' : 'warn',
      value: matched ? `Aligné (${input.pinnedCommit?.slice(0, 7) ?? 'HEAD'})` : `Divergence — épinglé ${input.pinnedCommit?.slice(0, 7) ?? 'commit'}`,
      detail: matched
        ? 'Le bytecode on-chain correspond exactement au commit vérifié.'
        : 'Divergence détectée entre HEAD et le bytecode déployé ; le commit exact on-chain a été épinglé.',
      artifact: {
        id: 'art-l4-prov',
        source: `rpc://${input.chain}/eth_getCode`,
        chain: input.chain,
        blockNumber: input.blockNumber,
        commitSha: input.pinnedCommit,
        excerpt: `contract=${input.contractAddress ?? '0x0'} · match=${input.provenanceMatch} · pinned=${input.pinnedCommit ?? 'unknown'}`,
      },
    });
  }

  // L5 — Saturation / dwell (R3) — warns to orient toward seams (R2), never kills alone
  const highDwell = input.dwellDays >= 180;
  lines.push({
    id: 'L5',
    ruleRef: 'R3, R2',
    label: 'Saturation / Ancienneté (dwell)',
    status: highDwell ? 'warn' : 'ok',
    value: `${input.dwellDays} jours · ${input.knownIssuesCount} known issues`,
    detail: highDwell
      ? 'Programme mature : priorité orientée vers les coutures web2↔web3, upgrades et fonctions non testées (R2). Ne bloque jamais seul.'
      : 'Ancienneté modérée : surface principale et coutures toutes deux pertinentes.',
    artifact: {
      id: 'art-l5-dwell',
      source: input.programArtifactUrl,
      excerpt: `dwell_days=${input.dwellDays} · known_issues=${input.knownIssuesCount} · bias=${highDwell ? 'seams_and_door_a' : 'balanced'}`,
    },
  });

  // L6 — Tombstones (R16)
  lines.push({
    id: 'L6',
    ruleRef: 'R16',
    label: 'Tombstones & exclusions',
    status: input.tombstones.length > 0 ? 'warn' : 'ok',
    value: `${input.tombstones.length} tombstone${input.tombstones.length > 1 ? 's' : ''}`,
    detail:
      input.tombstones.length > 0
        ? 'Injectés en exclusions dans le threat model et le disconfirmer ; génération d’hypothèses sœurs activée.'
        : 'Aucun tombstone historique enregistré sur cette cible.',
    artifact: {
      id: 'art-l6-tombstones',
      source: 'db://tombstones',
      excerpt:
        input.tombstones.length > 0
          ? input.tombstones.join(' | ')
          : 'tombstones=[]',
    },
  });

  const hasBlock = lines.some((l) => l.status === 'block');
  const hasNeedsInput = lines.some((l) => l.status === 'needs_input');

  let decision: G0Decision;
  if (hasBlock) {
    decision = 'no_go';
  } else if (hasNeedsInput) {
    decision = 'needs_input';
  } else {
    decision = 'go';
  }

  return {
    decision,
    evaluatedAt: new Date().toISOString(),
    missingInputKind: hasNeedsInput ? 'rpc' : undefined,
    missingChain: hasNeedsInput ? input.chain : undefined,
    verdictLines: lines,
  };
}

/**
 * Doctrine Lock L7: G0 override requires an explicit operator rationale >= 20 characters.
 */
export function validateG0Override(reason: string): { ok: boolean; error?: string } {
  const trimmed = reason.trim();
  if (trimmed.length < 20) {
    return {
      ok: false,
      error: `La justification d'override G0 doit contenir au moins 20 caractères (${trimmed.length}/20).`,
    };
  }
  return { ok: true };
}

/**
 * Doctrine Lock L1: Hunting is allowed only when mode is guided_autonomous and G0 in {go, go_override}.
 */
export function canHunt(scan: Pick<ScanRun, 'executionMode' | 'g0'>): boolean {
  if (scan.executionMode !== 'guided_autonomous') {
    return false;
  }
  return scan.g0.decision === 'go' || scan.g0.decision === 'go_override';
}

/**
 * Doctrine Lock L3 / U-1: Human sign-off requires 3 non-empty justifications and a scope-valid deployment_check.
 */
export function validateOperatorSignoff(
  payload: {
    impactJustification: string;
    preconditionJustification: string;
    deploymentCheck: DeploymentCheckKind;
    deploymentJustification: string;
    blockNumber?: number;
  },
  scopeKind: ScopeKind
): { ok: boolean; error?: string } {
  if (payload.impactJustification.trim().length < 10) {
    return {
      ok: false,
      error: 'La justification de l’impact réel doit contenir au moins 10 caractères.',
    };
  }
  if (payload.preconditionJustification.trim().length < 10) {
    return {
      ok: false,
      error: 'La justification des préconditions et de l’absence d’alternative légitime doit contenir au moins 10 caractères.',
    };
  }
  if (payload.deploymentJustification.trim().length < 10) {
    return {
      ok: false,
      error: 'La confirmation de vérification du périmètre doit contenir au moins 10 caractères.',
    };
  }
  if (payload.deploymentCheck === 'commit_anchored_na' && scopeKind !== 'commit_anchored') {
    return {
      ok: false,
      error:
        'commit_anchored_na n’est accepté que pour un scope ancré sur commit (scope_kind=commit_anchored).',
    };
  }
  if (
    payload.deploymentCheck === 'verified_at_block' &&
    scopeKind !== 'commit_anchored' &&
    (!payload.blockNumber || payload.blockNumber <= 0)
  ) {
    return {
      ok: false,
      error: 'Un numéro de bloc valide est requis pour verified_at_block sur un scope déployé.',
    };
  }
  return { ok: true };
}

/**
 * Doctrine Lock L3 + L9:
 * - Export requires operator_confirmed sign-off (U-1 / L3).
 * - Export bounty is forbidden in lab mode (targetKind !== 'program') due to lack of verbatim impact lines (L9 / R12).
 */
export function canExportFinding(
  finding: Pick<Finding, 'status' | 'verbatimImpactLine' | 'signoff'>,
  scan: Pick<ScanRun, 'targetKind'>
): { allowed: boolean; code?: 'LAB_MODE_BLOCKED' | 'SIGNOFF_REQUIRED' | 'NO_VERBATIM_IMPACT'; reason?: string } {
  if (scan.targetKind !== 'program') {
    return {
      allowed: false,
      code: 'LAB_MODE_BLOCKED',
      reason:
        'Export bounty refusé en mode labo (L9 / R12) : aucune ligne d’impact verbatim de programme actif.',
    };
  }
  if (!finding.verbatimImpactLine || finding.verbatimImpactLine.trim().length === 0) {
    return {
      allowed: false,
      code: 'NO_VERBATIM_IMPACT',
      reason: 'Export refusé (R12) : aucune ligne d’impact verbatim attachée au finding.',
    };
  }
  if (finding.status !== 'operator_confirmed' || !finding.signoff) {
    return {
      allowed: false,
      code: 'SIGNOFF_REQUIRED',
      reason: 'Validation humaine requise avant tout export (U-1 / LOCK #3).',
    };
  }
  return { allowed: true };
}

/**
 * Doctrine Lock L8 (R6):
 * A scan cannot transition to `done` with 0 findings unless every seeded hypothesis has an explicit outcome.
 */
export function canCloseScanWithoutFindings(hypotheses: Pick<Hypothesis, 'outcome'>[]): boolean {
  if (hypotheses.length === 0) return false;
  return hypotheses.every((h) => h.outcome !== 'in_progress');
}

/**
 * Rule R9: Closing a hypothesis as killed_by_artifact requires an executed artifactId.
 * Without an executed artifact, outcome is strictly downgraded to abandoned_unproven.
 */
export function classifyHypothesisClosure(
  requestedOutcome: 'candidate' | 'killed_by_artifact' | 'abandoned_unproven',
  artifactId?: string
): HypothesisOutcome {
  if (requestedOutcome === 'killed_by_artifact') {
    if (!artifactId || artifactId.trim().length === 0) {
      return 'abandoned_unproven';
    }
    return 'killed_by_artifact';
  }
  return requestedOutcome;
}

/**
 * Fix G10: Partial update of Threat Model merges fields instead of wiping untouched sections.
 */
export function mergeThreatModel(
  existing: ThreatModel,
  patch: Partial<Omit<ThreatModel, 'updatedAt' | 'provenance'>>
): ThreatModel {
  return {
    provenance: 'operator_approved',
    updatedAt: new Date().toISOString(),
    summary: patch.summary !== undefined ? patch.summary : existing.summary,
    verbatimImpacts:
      patch.verbatimImpacts !== undefined ? patch.verbatimImpacts : existing.verbatimImpacts,
    exclusions: patch.exclusions !== undefined ? patch.exclusions : existing.exclusions,
    tombstones: patch.tombstones !== undefined ? patch.tombstones : existing.tombstones,
    invariants: patch.invariants !== undefined ? patch.invariants : existing.invariants,
    trustBoundaries:
      patch.trustBoundaries !== undefined ? patch.trustBoundaries : existing.trustBoundaries,
  };
}

/**
 * Exported bounty reports stay in English per spec.
 */
export function generateBountyReport(
  finding: Finding,
  scan: ScanRun,
  format: ExportFormat
): { filename: string; content: string } {
  const safeSlug = finding.id.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const formatHeader =
    format === 'immunefi'
      ? 'Immunefi Bug Bounty Report'
      : format === 'cantina'
        ? 'Cantina Security Finding Submission'
        : 'Sherlock Contest Finding Report';

  const blockNote = finding.signoff?.blockNumber
    ? `Verified at block ${finding.signoff.blockNumber} on ${scan.chain}`
    : `Commit-anchored scope (${scan.ingest.provenanceMatch?.pinnedCommit ?? 'HEAD'})`;

  const content = `# ${finding.title}

> **Format**: ${formatHeader}  
> **Program**: ${scan.programName}  
> **Severity**: ${finding.severity.toUpperCase()}  
> **Target**: \`${finding.affectedFileLine}\`  
> **Verification**: ${blockNote}

## 1. Executive Summary

${finding.summary}

## 2. Verbatim Program Impact

> ${finding.verbatimImpactLine ?? 'N/A'}

## 3. Vulnerability Details

**Affected Location**: \`${finding.affectedFileLine}\`

\`\`\`solidity
${finding.affectedCode}
\`\`\`

## 4. Proof of Concept (Clean-Room Foundry Replay)

**Test File**: \`${finding.pocFile}\`  
**Command**: \`${finding.pocReplayCommand}\`

\`\`\`solidity
${finding.pocSource}
\`\`\`

### Clean-Room Execution Trace

\`\`\`text
${finding.pocReplayTrace}
\`\`\`

## 5. Counter-Verification & Operator Sign-Off

- **Legitimate Alternative Check (R13)**: ${finding.disconfirmer.legitimateAlternativeTest}
- **Disconfirmer Notes**: ${finding.disconfirmer.notes}
- **Operator Impact Confirmation**: ${finding.signoff?.impactJustification ?? ''}
- **Preconditions Confirmed**: ${finding.signoff?.preconditionJustification ?? ''}
- **Scope / Block Confirmation**: ${finding.signoff?.deploymentJustification ?? ''}

## 6. Recommended Mitigation

${finding.recommendation}
`;

  return {
    filename: `${safeSlug}-${format}.md`,
    content,
  };
}
