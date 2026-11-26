import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { getT } from '../../i18n/translations';
import type { ExecRun, Finding, FindingSeverity, HypothesisOutcome, Locale, ScanRun } from '../../types';
import { HypothesisOutcomeLabel } from '../StatusText';

const POC_TEMPLATE = `// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
// import {Target} from "../../src/Target.sol";

contract PolymorphePoC is Test {
    function setUp() public {
        // vm.createSelectFork(vm.envString("FORK_RPC_URL")); // fork: FORK_RPC_URL est injecté
    }

    function test_Exploit() public {
        // Atteindre l'état (ne pas le construire), puis prouver l'impact par assertion.
    }
}
`;

const KILL_TEMPLATE = `// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

contract PolymorpheKillTest is Test {
    function test_GuardHolds() public {
        // Tenter l'attaque et prouver qu'elle échoue (vm.expectRevert / assert sur l'état).
    }
}
`;

interface HuntTabProps {
  scan: ScanRun;
  locale: Locale;
  onScanUpdated: (scan: ScanRun) => void;
  onFindingCreated: (finding: Finding) => void;
}

export function HuntTab({ scan, locale, onScanUpdated, onFindingCreated }: HuntTabProps) {
  const t = getT(locale);
  const [filter, setFilter] = useState<'all' | HypothesisOutcome>('all');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeOutcome, setCloseOutcome] = useState<'killed_by_artifact' | 'candidate' | 'abandoned_unproven'>('killed_by_artifact');
  const [closeArtifact, setCloseArtifact] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Omit<ExecRun, 'output'>[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testSource, setTestSource] = useState(KILL_TEMPLATE);
  const [testError, setTestError] = useState<string | null>(null);
  const [submittingTest, setSubmittingTest] = useState(false);
  const [openRun, setOpenRun] = useState<ExecRun | null>(null);
  const [showAddHyp, setShowAddHyp] = useState(false);
  const [newHypTitle, setNewHypTitle] = useState('');
  const [newHypDoor, setNewHypDoor] = useState<'door_a_untested' | 'invariant' | 'seam' | 'tombstone_sibling'>('door_a_untested');
  const [newHypTarget, setNewHypTarget] = useState('');
  const [addHypError, setAddHypError] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [submittingClose, setSubmittingClose] = useState(false);
  const [generatingHyp, setGeneratingHyp] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Human from-poc modal (G6)
  const [showPocModal, setShowPocModal] = useState(false);
  const [pocTitle, setPocTitle] = useState('');
  const [pocSeverity, setPocSeverity] = useState<FindingSeverity>('high');
  const [pocFileLine, setPocFileLine] = useState(scan.ingest.untestedMonetaryFunctions[0]?.fileLine ?? '');
  const [pocSummary, setPocSummary] = useState('');
  const [pocImpact, setPocImpact] = useState('');
  const [pocRecommendation, setPocRecommendation] = useState('');
  const [pocSource, setPocSource] = useState(POC_TEMPLATE);
  const [pocError, setPocError] = useState<string | null>(null);
  const [submittingPoc, setSubmittingPoc] = useState(false);

  // Runs are the only artifacts a closure can cite (R9).
  useEffect(() => {
    api.listRuns(scan.id).then((r) => setRuns(r.runs)).catch(() => undefined);
  }, [scan]);

  const runsOf = (hypId: string) => runs.filter((r) => r.subjectId === hypId && r.kind === 'kill_test');

  const handleRunTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testingId) return;
    setTestError(null);
    setSubmittingTest(true);
    try {
      const { scan: updated } = await api.runHypothesisTest(scan.id, testingId, testSource);
      onScanUpdated(updated);
      setTestingId(null);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Test refusé.');
    } finally {
      setSubmittingTest(false);
    }
  };

  const handleAddHypothesis = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddHypError(null);
    try {
      const { scan: updated } = await api.addHypothesis(scan.id, {
        title: newHypTitle.trim(),
        door: newHypDoor,
        targetFileLine: newHypTarget.trim(),
      });
      onScanUpdated(updated);
      setShowAddHyp(false);
      setNewHypTitle('');
      setNewHypTarget('');
    } catch (err) {
      setAddHypError(err instanceof Error ? err.message : 'Hypothèse refusée.');
    }
  };

  const showRun = async (runId: string) => {
    try {
      setOpenRun((await api.getRun(runId)).run);
    } catch {
      setOpenRun(null);
    }
  };

  const counts = {
    all: scan.hypotheses.length,
    in_progress: scan.hypotheses.filter((h) => h.outcome === 'in_progress').length,
    candidate: scan.hypotheses.filter((h) => h.outcome === 'candidate').length,
    killed_by_artifact: scan.hypotheses.filter((h) => h.outcome === 'killed_by_artifact').length,
    abandoned_unproven: scan.hypotheses.filter((h) => h.outcome === 'abandoned_unproven').length,
  };

  const visibleHypotheses = scan.hypotheses.filter((h) =>
    filter === 'all' ? true : h.outcome === filter
  );

  const handleCloseHypothesis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingId) return;
    setCloseError(null);
    setSubmittingClose(true);
    try {
      const { scan: updated } = await api.closeHypothesis(scan.id, closingId, {
        outcome: closeOutcome,
        artifactId: closeOutcome === 'abandoned_unproven' ? undefined : closeArtifact || undefined,
        reason: closeReason.trim() || 'Clôture manuelle.',
      });
      onScanUpdated(updated);
      setClosingId(null);
      setCloseArtifact('');
      setCloseReason('');
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Clôture refusée.');
    } finally {
      setSubmittingClose(false);
    }
  };

  const handleCreateFromPoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setPocError(null);
    setSubmittingPoc(true);
    try {
      const { finding } = await api.createFindingFromPoc(scan.taskId, {
        title: pocTitle,
        severity: pocSeverity,
        affectedFileLine: pocFileLine.trim(),
        summary: pocSummary,
        pocSource,
        verbatimImpactLine: pocImpact || undefined,
        recommendation: pocRecommendation,
      });
      onFindingCreated(finding);
      setShowPocModal(false);
      setPocTitle('');
      setPocSummary('');
    } catch (err) {
      setPocError(err instanceof Error ? err.message : 'Erreur lors de la validation LOCK #5.');
    } finally {
      setSubmittingPoc(false);
    }
  };

  const handleGenerateHypotheses = async () => {
    setAiError(null);
    setGeneratingHyp(true);
    try {
      const { scan: updated } = await api.generateHypothesesAI(scan.id);
      onScanUpdated(updated);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur lors de la génération LLM.');
    } finally {
      setGeneratingHyp(false);
    }
  };

  const doorLabel: Record<string, string> = {
    door_a_untested: 'Door A (non testé)',
    invariant: 'Invariant',
    seam: 'Couture web2↔web3',
    tombstone_sibling: 'Frère tombstone',
  };

  return (
    <div className="space-y-8">
      {/* Hypotheses Section */}
      <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Hypothèses & liste de kills (R6, R9)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Un kill sans artefact exécuté est strictement classé « Abandonnée sans preuve ».
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={generatingHyp}
              onClick={handleGenerateHypotheses}
              className="px-3.5 py-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white whitespace-nowrap"
            >
              {generatingHyp ? 'Génération…' : 'Générer 3 hypothèses (LLM, code réel)'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddHyp((v) => !v)}
              className="px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 whitespace-nowrap"
            >
              Ajouter une hypothèse
            </button>
            <button
              type="button"
              onClick={() => setShowPocModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.scan.addFindingFromPoc}</span>
            </button>
          </div>
        </div>

        {showAddHyp && (
          <form
            onSubmit={handleAddHypothesis}
            className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 grid grid-cols-1 md:grid-cols-[1fr_180px_220px_auto] gap-2.5 items-end text-xs"
          >
            <label className="space-y-1">
              <span className="font-medium">Hypothèse (où l’argent sort-il ?)</span>
              <input
                required
                value={newHypTitle}
                onChange={(e) => setNewHypTitle(e.target.value)}
                className="w-full h-9 px-2.5 bg-white dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Door</span>
              <select
                value={newHypDoor}
                onChange={(e) => setNewHypDoor(e.target.value as typeof newHypDoor)}
                className="w-full h-9 px-2.5 bg-white dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="door_a_untested">Door A (non testé)</option>
                <option value="invariant">Invariant</option>
                <option value="seam">Couture</option>
                <option value="tombstone_sibling">Frère tombstone</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium">fichier:ligne</span>
              <input
                list="hyp-targets"
                value={newHypTarget}
                onChange={(e) => setNewHypTarget(e.target.value)}
                className="w-full h-9 px-2.5 font-mono bg-white dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
              <datalist id="hyp-targets">
                {scan.ingest.untestedMonetaryFunctions.map((f) => (
                  <option key={f.fileLine} value={f.fileLine}>
                    {f.contract}.{f.functionName}
                  </option>
                ))}
              </datalist>
            </label>
            <button type="submit" className="h-9 px-3.5 font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950">
              Ajouter
            </button>
            {addHypError && (
              <p role="alert" className="md:col-span-4 font-medium text-red-700 dark:text-red-400">
                {addHypError}
              </p>
            )}
          </form>
        )}

        {aiError && (
          <div role="alert" className="px-5 py-2.5 text-xs font-medium text-red-700 dark:text-red-400 border-b border-slate-100 dark:border-slate-800/80">
            {aiError}
          </div>
        )}

        {/* Segmented Filter */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800/80 overflow-x-auto">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-md">
            {(
              [
                ['all', `${t.scan.hypothesesAll} (${counts.all})`],
                ['in_progress', `${t.scan.hypothesesInProgress} (${counts.in_progress})`],
                ['candidate', `${t.scan.hypothesesCandidate} (${counts.candidate})`],
                ['killed_by_artifact', `${t.scan.hypothesesKilled} (${counts.killed_by_artifact})`],
                ['abandoned_unproven', `${t.scan.hypothesesAbandoned} (${counts.abandoned_unproven})`],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setFilter(val)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  filter === val
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {visibleHypotheses.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Aucune hypothèse dans cette catégorie.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {visibleHypotheses.map((hyp) => (
              <div key={hyp.id} className="px-5 py-4 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                      <span className="font-mono">{hyp.id}</span>
                      <span aria-hidden="true">·</span>
                      <span>{doorLabel[hyp.door] || hyp.door}</span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-mono ${hyp.targetVerified ? '' : 'line-through decoration-red-500'}`}>
                        {hyp.targetFileLine || '—'}
                      </span>
                      {!hyp.targetVerified && (
                        <span className="text-red-700 dark:text-red-400 font-medium">introuvable dans le dépôt</span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                      {hyp.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <HypothesisOutcomeLabel outcome={hyp.outcome} />
                    {hyp.outcome === 'in_progress' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setTestingId(hyp.id);
                            setTestError(null);
                          }}
                          className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                        >
                          Exécuter un test
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setClosingId(hyp.id);
                            setCloseError(null);
                            setCloseArtifact(runsOf(hyp.id).find((r) => r.passed)?.id ?? '');
                          }}
                          className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                        >
                          Clôturer
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {(hyp.reason || hyp.artifactId) && (
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    {hyp.artifactId && (
                      <span className="font-mono text-slate-800 dark:text-slate-200 mr-2">
                        [{hyp.artifactId}]
                      </span>
                    )}
                    {hyp.reason}
                  </div>
                )}

                {runsOf(hyp.id).length > 0 && (
                  <ul className="text-xs font-mono space-y-0.5">
                    {runsOf(hyp.id).map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => showRun(r.id)} className="hover:underline text-left">
                          <span className={r.passed ? 'text-emerald-700 dark:text-emerald-400' : r.status === 'running' || r.status === 'queued' ? 'text-blue-700 dark:text-blue-400' : 'text-red-700 dark:text-red-400'}>
                            {r.status === 'running' || r.status === 'queued' ? 'EN COURS' : r.passed ? 'PASS' : 'ÉCHEC'}
                          </span>{' '}
                          {r.id} · exit {r.exitCodes.join('/') || '—'} · {r.testsPassed} pass / {r.testsFailed} fail
                          {r.compileFailed ? ' · compilation échouée' : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {testingId === hyp.id && (
                  <form
                    onSubmit={handleRunTest}
                    className="mt-3 p-4 rounded-md bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-slate-800 space-y-3"
                  >
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Fichier Foundry complet, écrit dans <span className="font-mono">{scan.workspace?.layout.test ?? 'test'}/polymorphe/</span> d’une copie fraîche du dépôt et exécuté deux fois (FOUNDRY_FFI=false, sandbox). Un test qui passe devient l’artefact citable pour un kill (garde qui tient) ou un candidat (exploit qui marche).
                    </p>
                    <textarea
                      rows={10}
                      value={testSource}
                      onChange={(e) => setTestSource(e.target.value)}
                      className="w-full p-3 text-xs font-mono bg-[#0D1117] text-slate-100 border border-slate-700 rounded-md"
                    />
                    {testError && (
                      <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
                        {testError}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={submittingTest}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950"
                      >
                        {submittingTest ? 'Mise en file…' : 'Lancer forge test'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTestingId(null)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900"
                      >
                        Annuler
                      </button>
                    </div>
                  </form>
                )}

                {closingId === hyp.id && (
                  <form
                    onSubmit={handleCloseHypothesis}
                    className="mt-3 p-4 rounded-md bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-slate-800 space-y-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Issue souhaitée
                        </label>
                        <select
                          value={closeOutcome}
                          onChange={(e) =>
                            setCloseOutcome(e.target.value as 'killed_by_artifact' | 'candidate' | 'abandoned_unproven')
                          }
                          className="w-full h-9 px-2.5 text-xs bg-white dark:bg-[#121722] border border-slate-300 dark:border-slate-700 rounded-md"
                        >
                          <option value="killed_by_artifact">Tuée par artefact (run passant requis)</option>
                          <option value="candidate">Candidat (run passant requis)</option>
                          <option value="abandoned_unproven">Abandonnée sans preuve</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Run exécuté (R9) — sans run passant, la clôture est rétrogradée
                        </label>
                        <select
                          value={closeArtifact}
                          disabled={closeOutcome === 'abandoned_unproven'}
                          onChange={(e) => setCloseArtifact(e.target.value)}
                          className="w-full h-9 px-2.5 text-xs font-mono bg-white dark:bg-[#121722] border border-slate-300 dark:border-slate-700 rounded-md"
                        >
                          <option value="">— aucun —</option>
                          {runsOf(hyp.id)
                            .filter((r) => r.passed)
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.id} (PASS)
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Raison
                      </label>
                      <input
                        type="text"
                        value={closeReason}
                        onChange={(e) => setCloseReason(e.target.value)}
                        placeholder="Résumé de la preuve ou du motif d’abandon"
                        className="w-full h-9 px-2.5 text-xs bg-white dark:bg-[#121722] border border-slate-300 dark:border-slate-700 rounded-md"
                      />
                    </div>
                    {closeError && (
                      <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
                        {closeError}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={submittingClose}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950"
                      >
                        Enregistrer la clôture
                      </button>
                      <button
                        type="button"
                        onClick={() => setClosingId(null)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900"
                      >
                        Annuler
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Live Hunter Log */}
      <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t.scan.hunterLogTitle}
          </h3>
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
            mode: {scan.executionMode} · workers: {scan.workerCount}
          </span>
        </div>
        <div className="p-4 bg-[#0D1117] text-slate-200 font-mono text-xs space-y-2 max-h-72 overflow-y-auto">
          {scan.hunterLogs.map((entry) => (
            <div key={entry.id} className="flex items-start gap-3">
              <span className="text-slate-500 shrink-0 tabular-nums">{entry.timestamp}</span>
              <span
                className={`shrink-0 w-24 ${
                  entry.role === 'disconfirmer'
                    ? 'text-amber-400'
                    : entry.role === 'worker'
                      ? 'text-emerald-400'
                      : entry.role === 'planner'
                        ? 'text-blue-400'
                        : 'text-slate-400'
                }`}
              >
                [{entry.role}]
              </span>
              <span className="text-slate-200 leading-relaxed">{entry.message}</span>
            </div>
          ))}
        </div>
      </section>

      {openRun && (
        <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate">
              {openRun.id} · {openRun.command}
            </div>
            <button type="button" onClick={() => setOpenRun(null)} aria-label="Fermer" className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre className="p-4 bg-[#0D1117] text-slate-200 text-xs font-mono max-h-96 overflow-auto whitespace-pre-wrap">
            {openRun.output || openRun.error || '(vide)'}
          </pre>
        </section>
      )}

      {/* Human From-PoC Modal (G6) */}
      {showPocModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="from-poc-modal-title"
        >
          <div className="w-full max-w-2xl bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 id="from-poc-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">
                Soumettre un finding depuis un PoC Foundry (LOCK #5)
              </h3>
              <button
                type="button"
                onClick={() => setShowPocModal(false)}
                aria-label="Fermer"
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateFromPoc} className="p-5 space-y-4">
              {pocError && (
                <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
                  {pocError}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="poc-title" className="block text-xs font-medium mb-1">
                    Titre du finding
                  </label>
                  <input
                    id="poc-title"
                    type="text"
                    required
                    value={pocTitle}
                    onChange={(e) => setPocTitle(e.target.value)}
                    placeholder="Ex. Contournement de deadline sur claimPermit"
                    className="w-full h-9 px-3 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="poc-severity" className="block text-xs font-medium mb-1">
                    Sévérité
                  </label>
                  <select
                    id="poc-severity"
                    value={pocSeverity}
                    onChange={(e) => setPocSeverity(e.target.value as FindingSeverity)}
                    className="w-full h-9 px-3 text-xs bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="critical">Critique</option>
                    <option value="high">Haute</option>
                    <option value="medium">Moyenne</option>
                    <option value="low">Basse</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="poc-fileline" className="block text-xs font-medium mb-1">
                  Code affecté (fichier:ligne, vérifié contre le workspace)
                </label>
                <input
                  id="poc-fileline"
                  type="text"
                  value={pocFileLine}
                  onChange={(e) => setPocFileLine(e.target.value)}
                  className="w-full h-9 px-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="poc-summary" className="block text-xs font-medium mb-1">
                  Résumé technique
                </label>
                <textarea
                  id="poc-summary"
                  rows={2}
                  value={pocSummary}
                  onChange={(e) => setPocSummary(e.target.value)}
                  className="w-full p-2.5 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              {scan.targetKind === 'program' && (
                <div>
                  <label htmlFor="poc-impact" className="block text-xs font-medium mb-1">
                    Ligne d’impact verbatim (R12) — choisie par vous, jamais par défaut
                  </label>
                  <select
                    id="poc-impact"
                    value={pocImpact}
                    onChange={(e) => setPocImpact(e.target.value)}
                    className="w-full h-9 px-3 text-xs bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="">— à choisir plus tard (export bloqué) —</option>
                    {(scan.programScope?.verbatimImpacts ?? []).map((imp) => (
                      <option key={imp} value={imp}>
                        {imp}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="poc-reco" className="block text-xs font-medium mb-1">
                  Recommandation
                </label>
                <textarea
                  id="poc-reco"
                  rows={2}
                  value={pocRecommendation}
                  onChange={(e) => setPocRecommendation(e.target.value)}
                  className="w-full p-2.5 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="poc-source" className="block text-xs font-medium mb-1">
                  Fichier PoC Foundry complet — rejoué deux fois dans une copie fraîche (FOUNDRY_FFI=false, sandbox) ; candidat seulement si les deux passent
                </label>
                <textarea
                  id="poc-source"
                  rows={12}
                  required
                  value={pocSource}
                  onChange={(e) => setPocSource(e.target.value)}
                  className="w-full p-3 text-xs font-mono bg-[#0D1117] text-slate-100 border border-slate-700 rounded-md"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPocModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submittingPoc}
                  className="px-4 py-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 text-white"
                >
                  {submittingPoc ? 'Mise en file…' : 'Soumettre au rejeu clean-room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
