import type {
  FindingSeverity,
  FindingStatus,
  G0Decision,
  G0LineStatus,
  HypothesisOutcome,
  ScanStatus,
} from '../types';

export function G0DecisionLabel({ decision }: { decision: G0Decision }) {
  const styles: Record<G0Decision, { text: string; cls: string }> = {
    go: { text: 'GO', cls: 'text-emerald-700 dark:text-emerald-400 font-semibold' },
    go_override: { text: 'GO (override)', cls: 'text-amber-700 dark:text-amber-400 font-semibold' },
    needs_input: { text: 'Entrée requise', cls: 'text-amber-700 dark:text-amber-400 font-semibold' },
    no_go: { text: 'NO-GO', cls: 'text-red-700 dark:text-red-400 font-semibold' },
  };
  const s = styles[decision];
  return <span className={`font-mono text-xs tracking-tight whitespace-nowrap ${s.cls}`}>{s.text}</span>;
}

export function G0LineStatusLabel({ status }: { status: G0LineStatus }) {
  const map: Record<G0LineStatus, { text: string; cls: string }> = {
    ok: { text: 'OK', cls: 'text-emerald-700 dark:text-emerald-400 font-semibold' },
    warn: { text: 'Avert.', cls: 'text-amber-700 dark:text-amber-400 font-semibold' },
    block: { text: 'Bloquant', cls: 'text-red-700 dark:text-red-400 font-semibold' },
    needs_input: { text: 'Requis', cls: 'text-amber-700 dark:text-amber-400 font-semibold' },
    'n/a': { text: 'N/A', cls: 'text-slate-500 dark:text-slate-400 font-medium' },
  };
  const item = map[status];
  return <span className={`font-mono text-xs whitespace-nowrap ${item.cls}`}>{item.text}</span>;
}

export function ScanStatusLabel({ status }: { status: ScanStatus }) {
  const map: Record<ScanStatus, { text: string; cls: string }> = {
    running: { text: 'En cours', cls: 'text-blue-700 dark:text-blue-400 font-medium' },
    hunting: { text: 'Chasse active', cls: 'text-blue-700 dark:text-blue-400 font-medium' },
    needs_input: { text: 'En attente (RPC)', cls: 'text-amber-700 dark:text-amber-400 font-medium' },
    no_go: { text: 'Arrêté (NO-GO)', cls: 'text-red-700 dark:text-red-400 font-medium' },
    done: { text: 'Terminé', cls: 'text-emerald-700 dark:text-emerald-400 font-medium' },
    stopped: { text: 'Budget atteint', cls: 'text-slate-700 dark:text-slate-300 font-medium' },
    failed: { text: 'Échec', cls: 'text-red-700 dark:text-red-400 font-medium' },
  };
  const item = map[status];
  return <span className={`text-xs whitespace-nowrap ${item.cls}`}>{item.text}</span>;
}

export function SeverityLabel({ severity }: { severity: FindingSeverity }) {
  const map: Record<FindingSeverity, { text: string; cls: string }> = {
    critical: { text: 'Critique', cls: 'text-red-700 dark:text-red-400 font-semibold' },
    high: { text: 'Haute', cls: 'text-orange-700 dark:text-orange-400 font-semibold' },
    medium: { text: 'Moyenne', cls: 'text-amber-700 dark:text-amber-400 font-medium' },
    low: { text: 'Basse', cls: 'text-slate-600 dark:text-slate-400 font-medium' },
  };
  const item = map[severity];
  return <span className={`text-xs whitespace-nowrap ${item.cls}`}>{item.text}</span>;
}

export function FindingStatusLabel({ status }: { status: FindingStatus }) {
  const map: Record<FindingStatus, { text: string; cls: string }> = {
    candidate: { text: 'Candidat', cls: 'text-blue-700 dark:text-blue-400 font-medium' },
    operator_confirmed: { text: 'Validé (U-1)', cls: 'text-emerald-700 dark:text-emerald-400 font-semibold' },
    rejected: { text: 'Rejeté', cls: 'text-slate-500 dark:text-slate-400 line-through' },
    hold: { text: 'En attente', cls: 'text-amber-700 dark:text-amber-400 font-medium' },
  };
  const item = map[status];
  return <span className={`text-xs whitespace-nowrap ${item.cls}`}>{item.text}</span>;
}

export function HypothesisOutcomeLabel({ outcome }: { outcome: HypothesisOutcome }) {
  const map: Record<HypothesisOutcome, { text: string; cls: string }> = {
    in_progress: { text: 'En cours', cls: 'text-blue-700 dark:text-blue-400 font-medium' },
    candidate: { text: 'Candidat (PoC)', cls: 'text-emerald-700 dark:text-emerald-400 font-semibold' },
    killed_by_artifact: { text: 'Tuée par artefact', cls: 'text-slate-700 dark:text-slate-300 font-medium' },
    abandoned_unproven: { text: 'Abandonnée sans preuve', cls: 'text-amber-700 dark:text-amber-400 font-medium' },
  };
  const item = map[outcome];
  return <span className={`text-xs whitespace-nowrap ${item.cls}`}>{item.text}</span>;
}
