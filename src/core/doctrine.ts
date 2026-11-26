import type {
  DeploymentCheckKind,
  ExecRun,
  ExportFormat,
  Finding,
  FundsAttestation,
  G0Decision,
  G0Report,
  G0VerdictLine,
  Hypothesis,
  HypothesisOutcome,
  MissingInputKind,
  OnchainMeasurement,
  ProgramScope,
  ProvenanceResult,
  ScanRun,
  ScopeKind,
  TargetKind,
  ThreatModel,
} from '../types';

/**
 * Every value G0 reads is either attested by the operator (with a source URL) or
 * measured by an executed RPC call / build. `null` means "not available yet" and
 * can only ever produce `needs_input` or `warn` — never `ok`.
 */
export interface G0EvaluationInput {
  targetKind: TargetKind;
  scopeKind: ScopeKind;
  targetUrl: string;
  programScope: ProgramScope | null;
  chain: string;
  rpcConfigured: boolean;
  onchain: OnchainMeasurement | null;
  fundsAttestation: FundsAttestation | null;
  minFundsAtRiskUsd: number;
  /** null = provenance comparison not executed (no build or no RPC yet). */
  provenance: ProvenanceResult[] | null;
  pinnedCommit?: string;
  extraTombstones: string[];
  now: Date;
}

const NEEDS_PRIORITY: MissingInputKind[] = ['program_scope', 'rpc', 'funds_attestation', 'build_fix'];

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function attestationExcerpt(scope: ProgramScope): string {
  return `operator_attested by=${scope.attestedBy} at=${scope.attestedAt} source=${scope.sourceUrl}`;
}

/**
 * Pure deterministic G0 evaluator. No LLM, no network, no defaults that can pass a gate.
 * Implements R1-R4, R11, R12, R15, R16.
 */
export function evaluateG0(input: G0EvaluationInput): G0Report {
  const isLab = input.targetKind !== 'program';
  const scope = input.programScope;
  const deployed = input.scopeKind !== 'commit_anchored';
  const lines: G0VerdictLine[] = [];

  // L1 — Payer / active program (R4)
  if (isLab) {
    lines.push({
      id: 'L1',
      ruleRef: 'R4',
      label: 'Payeur / Programme actif',
      status: 'n/a',
      value: 'Mode labo (sans programme)',
      detail: 'Cible locale ou dépôt sans programme de bounty associé.',
      artifact: {
        id: 'art-l1-lab',
        source: input.targetUrl,
        excerpt: `target_kind=${input.targetKind} · scope_kind=${input.scopeKind}`,
      },
    });
  } else if (!scope) {
    lines.push({
      id: 'L1',
      ruleRef: 'R4',
      label: 'Payeur / Programme actif',
      status: 'needs_input',
      needs: 'program_scope',
      value: 'Statut non attesté',
      detail: 'Recopiez le statut du programme depuis sa page (actif / en pause / fermé).',
      artifact: {
        id: 'art-l1-missing',
        source: input.targetUrl,
        excerpt: 'program_scope=unset (nothing is inferred from the URL)',
      },
    });
  } else {
    const active = scope.status === 'active';
    lines.push({
      id: 'L1',
      ruleRef: 'R4',
      label: 'Payeur / Programme actif',
      status: active ? 'ok' : 'block',
      value: active ? 'Actif (attesté)' : scope.status === 'paused' ? 'En pause' : 'Fermé',
      detail: active
        ? 'Statut actif recopié par l’opérateur depuis la page du programme.'
        : 'Programme en pause ou fermé : aucun investissement de chasse justifié (R4).',
      artifact: {
        id: 'art-l1-program',
        source: scope.sourceUrl,
        excerpt: `status=${scope.status} · ${attestationExcerpt(scope)}`,
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
      detail: 'Aucun impact inventé en mode labo ; export bounty bloqué (L9).',
      artifact: {
        id: 'art-l2-lab',
        source: input.targetUrl,
        excerpt: 'verbatim_impacts=[]',
      },
    });
  } else if (!scope) {
    lines.push({
      id: 'L2',
      ruleRef: 'R12',
      label: 'Impacts verbatim',
      status: 'needs_input',
      needs: 'program_scope',
      value: 'Non fournis',
      detail: 'Collez les lignes « Impacts in scope » mot pour mot depuis la page du programme.',
      artifact: {
        id: 'art-l2-missing',
        source: input.targetUrl,
        excerpt: 'verbatim_impacts=unset',
      },
    });
  } else {
    const count = scope.verbatimImpacts.length;
    lines.push({
      id: 'L2',
      ruleRef: 'R12',
      label: 'Impacts verbatim',
      status: count > 0 ? 'ok' : 'block',
      value: `${count} ligne${count > 1 ? 's' : ''}`,
      detail:
        count > 0
          ? 'Lignes d’impact recopiées mot pour mot par l’opérateur.'
          : 'Aucune ligne d’impact verbatim : impossible de qualifier une prime (R12).',
      artifact: {
        id: 'art-l2-impacts',
        source: scope.sourceUrl,
        excerpt: count > 0 ? scope.verbatimImpacts.slice(0, 3).join(' | ') : 'verbatim_impacts=[]',
      },
    });
  }

  // L3 — Funds-at-risk at current block (R1, R15)
  if (!deployed) {
    lines.push({
      id: 'L3',
      ruleRef: 'R1, R15',
      label: 'Fonds à risque (bloc courant)',
      status: 'n/a',
      value: 'Scope ancré sur commit',
      detail: 'Périmètre audité sur un commit précis, sans déploiement mainnet requis.',
      artifact: {
        id: 'art-l3-commit',
        source: input.targetUrl,
        commitSha: input.pinnedCommit,
        excerpt: `scope_kind=commit_anchored · commit=${input.pinnedCommit ?? 'unknown'}`,
      },
    });
  } else if (!input.rpcConfigured) {
    lines.push({
      id: 'L3',
      ruleRef: 'R1, R15',
      label: 'Fonds à risque (bloc courant)',
      status: 'needs_input',
      needs: 'rpc',
      value: `RPC ${input.chain} manquant`,
      detail: `Fournissez un endpoint RPC pour ${input.chain} afin de lire bytecode et soldes au bloc courant.`,
      artifact: {
        id: 'art-l3-rpc-missing',
        source: `chain_settings://${input.chain}`,
        chain: input.chain,
        excerpt: `rpc_url=unset for chain=${input.chain}`,
      },
    });
  } else if (input.fundsAttestation) {
    const att = input.fundsAttestation;
    const above = att.usd >= input.minFundsAtRiskUsd;
    lines.push({
      id: 'L3',
      ruleRef: 'R1, R15',
      label: 'Fonds à risque (bloc courant)',
      status: above ? 'ok' : 'block',
      value: `${usd(att.usd)} (attesté)`,
      detail: above
        ? `Attestation opérateur ≥ seuil (${usd(input.minFundsAtRiskUsd)}).`
        : `Attestation opérateur sous le seuil (${usd(input.minFundsAtRiskUsd)}) : exposition insuffisante (R1).`,
      artifact: {
        id: 'art-l3-attested',
        source: att.sourceUrl,
        chain: input.chain,
        blockNumber: input.onchain?.blockNumber,
        excerpt: `funds_usd=${att.usd} · operator_attested by=${att.attestedBy} at=${att.attestedAt}` +
          (input.onchain?.fundsLowerBoundUsd != null
            ? ` · measured_native_lower_bound_usd=${Math.round(input.onchain.fundsLowerBoundUsd)}`
            : ''),
      },
    });
  } else if (input.onchain && input.onchain.fundsLowerBoundUsd !== null &&
             input.onchain.fundsLowerBoundUsd >= input.minFundsAtRiskUsd) {
    const m = input.onchain;
    lines.push({
      id: 'L3',
      ruleRef: 'R1, R15',
      label: 'Fonds à risque (bloc courant)',
      status: 'ok',
      value: `≥ ${usd(m.fundsLowerBoundUsd!)}`,
      detail: `Borne basse mesurée (soldes natifs × ${m.nativeUsd?.description ?? 'feed'}) au bloc ${m.blockNumber}, au-dessus du seuil ${usd(input.minFundsAtRiskUsd)}.`,
      artifact: {
        id: 'art-l3-measured',
        source: `rpc://${m.chain}/eth_getBalance+latestRoundData`,
        chain: m.chain,
        blockNumber: m.blockNumber,
        excerpt: m.addresses.map((a) => `${a.address}=${a.nativeBalanceWei}wei`).join(' · ') +
          (m.nativeUsd ? ` · feed=${m.nativeUsd.feed} answer=${m.nativeUsd.answer}e-${m.nativeUsd.decimals}` : ''),
      },
    });
  } else {
    const m = input.onchain;
    const measured = m?.fundsLowerBoundUsd;
    lines.push({
      id: 'L3',
      ruleRef: 'R1, R15',
      label: 'Fonds à risque (bloc courant)',
      status: 'needs_input',
      needs: 'funds_attestation',
      value: measured != null ? `Borne basse ${usd(measured)}` : 'Non mesuré',
      detail:
        (measured != null
          ? 'La borne basse mesurée (soldes natifs uniquement, ERC-20 non comptés) est sous le seuil : elle ne suffit pas à bloquer ni à passer. '
          : 'Aucune mesure exploitable (adresses de scope absentes, feed de prix indisponible ou erreur RPC). ') +
        'Attestez le TVL avec sa source (DefiLlama, dashboard du protocole, lecture cast).',
      artifact: {
        id: 'art-l3-unmeasured',
        source: m ? `rpc://${m.chain}` : `chain_settings://${input.chain}`,
        chain: input.chain,
        blockNumber: m?.blockNumber,
        excerpt: m
          ? `addresses=${m.addresses.length} · lower_bound_usd=${measured ?? 'null'} · errors=${m.errors.join(' | ') || 'none'}`
          : 'onchain_measurement=unset',
      },
    });
  }

  // L4 — Bytecode <-> repo provenance (R11). Never blocks; never "ok" unless executed.
  if (!deployed) {
    lines.push({
      id: 'L4',
      ruleRef: 'R11',
      label: 'Provenance bytecode ↔ dépôt',
      status: 'n/a',
      value: 'Non applicable',
      detail: 'Scope ancré sur commit : pas de bytecode déployé à comparer.',
      artifact: {
        id: 'art-l4-na',
        source: 'git://HEAD',
        commitSha: input.pinnedCommit,
        excerpt: `pinned_commit=${input.pinnedCommit ?? 'unknown'}`,
      },
    });
  } else if (!input.provenance || input.provenance.length === 0) {
    lines.push({
      id: 'L4',
      ruleRef: 'R11',
      label: 'Provenance bytecode ↔ dépôt',
      status: 'warn',
      value: 'Non exécutée',
      detail: !input.rpcConfigured
        ? 'Requiert un RPC configuré.'
        : 'Requiert un build réussi et au moins une adresse de scope : tant qu’elle n’a pas tourné, rien ne prouve que HEAD est le code déployé.',
      artifact: {
        id: 'art-l4-not-run',
        source: `rpc://${input.chain}/eth_getCode`,
        chain: input.chain,
        excerpt: 'provenance=not_executed',
      },
    });
  } else {
    const prov = input.provenance;
    const allMatched = prov.every((p) => p.status === 'matched');
    const bad = prov.filter((p) => p.status !== 'matched');
    const block = prov[0]?.blockNumber;
    lines.push({
      id: 'L4',
      ruleRef: 'R11',
      label: 'Provenance bytecode ↔ dépôt',
      status: allMatched ? 'ok' : 'warn',
      value: allMatched
        ? `${prov.length}/${prov.length} adresse(s) alignée(s)`
        : `${bad.length}/${prov.length} adresse(s) divergente(s)`,
      detail: allMatched
        ? 'Chaque sélecteur ABI du contrat apparié est présent dans le bytecode déployé (implémentation si proxy).'
        : 'Des sélecteurs du dépôt sont absents du bytecode déployé, ou aucun contrat ne correspond : auditez le code déployé, pas HEAD.',
      artifact: {
        id: 'art-l4-prov',
        source: `rpc://${input.chain}/eth_getCode`,
        chain: input.chain,
        blockNumber: block,
        commitSha: input.pinnedCommit,
        excerpt: prov
          .map((p) =>
            `${p.address}${p.comparedAddress !== p.address ? `→${p.comparedAddress}` : ''}=${p.status}` +
            (p.bestMatch
              ? `(${p.bestMatch.contract} ${p.bestMatch.matchedSelectors}/${p.bestMatch.abiSelectors}` +
                (p.bestMatch.missingSelectors.length ? ` missing=${p.bestMatch.missingSelectors.slice(0, 6).join(',')}` : '') +
                ')'
              : ''))
          .join(' · '),
      },
    });
  }

  // L5 — Saturation / dwell (R3) — orients toward seams (R2), never kills alone
  if (isLab) {
    lines.push({
      id: 'L5',
      ruleRef: 'R3, R2',
      label: 'Saturation / Ancienneté (dwell)',
      status: 'n/a',
      value: 'Mode labo',
      detail: 'Pas de programme : pas de saturation à mesurer.',
      artifact: { id: 'art-l5-lab', source: input.targetUrl, excerpt: 'dwell=n/a' },
    });
  } else if (!scope?.listedAt || Number.isNaN(Date.parse(scope.listedAt))) {
    lines.push({
      id: 'L5',
      ruleRef: 'R3, R2',
      label: 'Saturation / Ancienneté (dwell)',
      status: 'warn',
      value: 'Date de listing inconnue',
      detail: 'Renseignez la date d’ajout du programme / de l’asset : un programme > 3 mois sur un chemin monétaire évident est présumé déjà soumis (R3).',
      artifact: { id: 'art-l5-unknown', source: scope?.sourceUrl ?? input.targetUrl, excerpt: 'listed_at=unset' },
    });
  } else {
    const days = Math.max(0, Math.floor((input.now.getTime() - Date.parse(scope.listedAt)) / 86_400_000));
    const known = scope.knownIssues.length;
    const highDwell = days >= 90;
    lines.push({
      id: 'L5',
      ruleRef: 'R3, R2',
      label: 'Saturation / Ancienneté (dwell)',
      status: highDwell ? 'warn' : 'ok',
      value: `${days} jours · ${known} known issue${known > 1 ? 's' : ''}`,
      detail: highDwell
        ? 'Programme > 3 mois : chemins monétaires évidents présumés déjà soumis — orienter vers les coutures et fonctions non testées (R2). Ne bloque jamais seul.'
        : 'Ancienneté modérée : surface principale et coutures toutes deux pertinentes.',
      artifact: {
        id: 'art-l5-dwell',
        source: scope.sourceUrl,
        excerpt: `listed_at=${scope.listedAt} · dwell_days=${days} · known_issues=${known}`,
      },
    });
  }

  // L6 — Tombstones (R16)
  const tombstones = [...new Set([...(scope?.knownIssues ?? []), ...input.extraTombstones])];
  if (!isLab && !scope) {
    lines.push({
      id: 'L6',
      ruleRef: 'R16',
      label: 'Tombstones & exclusions',
      status: 'needs_input',
      needs: 'program_scope',
      value: 'Known issues non attestés',
      detail: 'Recopiez les known issues / exclusions du programme : un finding qui y figure est mort d’avance (R16).',
      artifact: { id: 'art-l6-missing', source: input.targetUrl, excerpt: 'known_issues=unset' },
    });
  } else lines.push({
    id: 'L6',
    ruleRef: 'R16',
    label: 'Tombstones & exclusions',
    status: tombstones.length > 0 ? 'warn' : isLab ? 'n/a' : 'ok',
    value: `${tombstones.length} tombstone${tombstones.length > 1 ? 's' : ''}`,
    detail:
      tombstones.length > 0
        ? 'Injectés en exclusions dans le threat model et le disconfirmer.'
        : isLab
          ? 'Mode labo.'
          : 'Aucun known issue attesté sur cette cible.',
    artifact: {
      id: 'art-l6-tombstones',
      source: scope?.sourceUrl ?? 'scan://threat_model',
      excerpt: tombstones.length > 0 ? tombstones.join(' | ') : 'tombstones=[]',
    },
  });

  const hasBlock = lines.some((l) => l.status === 'block');
  const needs = lines.filter((l) => l.status === 'needs_input').map((l) => l.needs!);

  let decision: G0Decision;
  if (hasBlock) decision = 'no_go';
  else if (needs.length > 0) decision = 'needs_input';
  else decision = 'go';

  const missingInputKind = needs.length > 0
    ? NEEDS_PRIORITY.find((k) => needs.includes(k))
    : undefined;

  return {
    decision,
    evaluatedAt: input.now.toISOString(),
    missingInputKind,
    missingChain: missingInputKind === 'rpc' ? input.chain : undefined,
    verdictLines: lines,
  };
}

/** Doctrine Lock L7: G0 override requires an explicit operator rationale >= 20 characters. */
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

/** Doctrine Lock L1: hunting is allowed only in guided_autonomous mode with G0 in {go, go_override}. */
export function canHunt(scan: Pick<ScanRun, 'executionMode' | 'g0'>): boolean {
  if (scan.executionMode !== 'guided_autonomous') return false;
  return scan.g0.decision === 'go' || scan.g0.decision === 'go_override';
}

/**
 * LOCK #5: a PoC replay counts only if every repetition exited 0, at least one test
 * passed, none failed, and compilation succeeded.
 */
export function isPassingRun(run: Pick<ExecRun, 'status' | 'exitCodes' | 'compileFailed' | 'testsPassed' | 'testsFailed'>): boolean {
  return (
    run.status === 'finished' &&
    run.exitCodes.length > 0 &&
    run.exitCodes.every((c) => c === 0) &&
    !run.compileFailed &&
    run.testsPassed > 0 &&
    run.testsFailed === 0
  );
}

/**
 * Doctrine Lock L3 / U-1: human sign-off requires a passing clean-room replay,
 * 3 non-empty justifications and a scope-valid deployment_check.
 */
export function validateOperatorSignoff(
  payload: {
    impactJustification: string;
    preconditionJustification: string;
    deploymentCheck: DeploymentCheckKind;
    deploymentJustification: string;
    blockNumber?: number;
  },
  scopeKind: ScopeKind,
  finding: Pick<Finding, 'cleanRoomVerified'>
): { ok: boolean; error?: string } {
  if (!finding.cleanRoomVerified) {
    return {
      ok: false,
      error: 'LOCK #5 : aucun rejeu clean-room réussi pour ce finding — validation impossible.',
    };
  }
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (text(payload.impactJustification).length < 10) {
    return { ok: false, error: 'La justification de l’impact réel doit contenir au moins 10 caractères.' };
  }
  if (text(payload.preconditionJustification).length < 10) {
    return {
      ok: false,
      error: 'La justification des préconditions et de l’absence d’alternative légitime doit contenir au moins 10 caractères.',
    };
  }
  if (text(payload.deploymentJustification).length < 10) {
    return { ok: false, error: 'La confirmation de vérification du périmètre doit contenir au moins 10 caractères.' };
  }
  if (payload.deploymentCheck !== 'verified_at_block' && payload.deploymentCheck !== 'commit_anchored_na') {
    return { ok: false, error: 'deployment_check invalide.' };
  }
  if (payload.deploymentCheck === 'commit_anchored_na' && scopeKind !== 'commit_anchored') {
    return {
      ok: false,
      error: 'commit_anchored_na n’est accepté que pour un scope ancré sur commit (scope_kind=commit_anchored).',
    };
  }
  if (
    payload.deploymentCheck === 'verified_at_block' &&
    scopeKind !== 'commit_anchored' &&
    (!Number.isInteger(payload.blockNumber) || (payload.blockNumber ?? 0) <= 0)
  ) {
    return { ok: false, error: 'Un numéro de bloc valide est requis pour verified_at_block sur un scope déployé.' };
  }
  return { ok: true };
}

/**
 * Doctrine Lock L3 + L9 + LOCK #5:
 * - export requires a passing clean-room replay;
 * - export requires operator_confirmed sign-off (U-1);
 * - export is forbidden in lab mode (no verbatim impact lines).
 */
export function canExportFinding(
  finding: Pick<Finding, 'status' | 'verbatimImpactLine' | 'signoff' | 'cleanRoomVerified'>,
  scan: Pick<ScanRun, 'targetKind'>
): {
  allowed: boolean;
  code?: 'LAB_MODE_BLOCKED' | 'SIGNOFF_REQUIRED' | 'NO_VERBATIM_IMPACT' | 'REPLAY_REQUIRED';
  reason?: string;
} {
  if (scan.targetKind !== 'program') {
    return {
      allowed: false,
      code: 'LAB_MODE_BLOCKED',
      reason: 'Export bounty refusé en mode labo (L9 / R12) : aucune ligne d’impact verbatim de programme actif.',
    };
  }
  if (!finding.cleanRoomVerified) {
    return {
      allowed: false,
      code: 'REPLAY_REQUIRED',
      reason: 'Export refusé (LOCK #5) : aucun rejeu clean-room réussi.',
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
 * Doctrine Lock L8 (R6): a scan cannot close with 0 findings unless every seeded
 * hypothesis has an explicit outcome.
 */
export function canCloseScanWithoutFindings(hypotheses: Pick<Hypothesis, 'outcome'>[]): boolean {
  if (hypotheses.length === 0) return false;
  return hypotheses.every((h) => h.outcome !== 'in_progress');
}

/**
 * Rule R9: `killed_by_artifact` and `candidate` require the id of an executed,
 * passing run attached to this hypothesis. A typed string is not an artifact.
 * Anything else is strictly downgraded to `abandoned_unproven`.
 */
export function classifyHypothesisClosure(
  requestedOutcome: 'candidate' | 'killed_by_artifact' | 'abandoned_unproven',
  artifactRun: Pick<ExecRun, 'status' | 'exitCodes' | 'compileFailed' | 'testsPassed' | 'testsFailed'> | null
): HypothesisOutcome {
  if (requestedOutcome === 'abandoned_unproven') return 'abandoned_unproven';
  if (requestedOutcome !== 'killed_by_artifact' && requestedOutcome !== 'candidate') {
    return 'abandoned_unproven';
  }
  if (!artifactRun || !isPassingRun(artifactRun)) return 'abandoned_unproven';
  return requestedOutcome;
}

/** Fix G10: partial update of the threat model merges fields instead of wiping untouched sections. */
export function mergeThreatModel(
  existing: ThreatModel,
  patch: Partial<Omit<ThreatModel, 'updatedAt' | 'provenance'>>
): ThreatModel {
  const list = (v: unknown, fallback: string[]) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fallback;
  return {
    provenance: 'operator_approved',
    updatedAt: new Date().toISOString(),
    summary: typeof patch.summary === 'string' ? patch.summary : existing.summary,
    verbatimImpacts: list(patch.verbatimImpacts, existing.verbatimImpacts),
    exclusions: list(patch.exclusions, existing.exclusions),
    tombstones: list(patch.tombstones, existing.tombstones),
    invariants: list(patch.invariants, existing.invariants),
    trustBoundaries: list(patch.trustBoundaries, existing.trustBoundaries),
  };
}

/** Exported bounty reports stay in English per spec. */
export function generateBountyReport(
  finding: Finding,
  scan: ScanRun,
  format: ExportFormat,
  replayRun?: ExecRun
): { filename: string; content: string } {
  const safeSlug = finding.id.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const formatHeader =
    format === 'immunefi'
      ? 'Immunefi Bug Bounty Report'
      : format === 'cantina'
        ? 'Cantina Security Finding Submission'
        : 'Sherlock Contest Finding Report';

  const commit = replayRun?.commit ?? scan.workspace?.commit ?? 'unknown';
  const blockNote = finding.signoff?.blockNumber
    ? `Verified at block ${finding.signoff.blockNumber} on ${scan.chain}`
    : `Commit-anchored scope (${commit})`;

  const replayMeta = replayRun
    ? `- **Replay command**: \`${replayRun.command}\`
- **Commit**: \`${replayRun.commit}\`
- **Repetitions**: ${replayRun.exitCodes.length} (exit codes: ${replayRun.exitCodes.join(', ')})
- **Tests**: ${replayRun.testsPassed} passed, ${replayRun.testsFailed} failed`
    : `- **Command**: \`${finding.pocReplayCommand}\``;

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

## 4. Proof of Concept

**Test File**: \`${finding.pocFile}\`

${replayMeta}

\`\`\`solidity
${finding.pocSource}
\`\`\`

### Execution Output

\`\`\`text
${finding.pocReplayTrace}
\`\`\`

## 5. Recommended Mitigation

${finding.recommendation}
`;

  return {
    filename: `${safeSlug}-${format}.md`,
    content,
  };
}
