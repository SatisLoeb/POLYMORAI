import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { getT } from '../../i18n/translations';
import type { Finding, FindingSeverity, HypothesisOutcome, Locale, ScanRun } from '../../types';
import { HypothesisOutcomeLabel } from '../StatusText';

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
  const [closeOutcome, setCloseOutcome] = useState<'killed_by_artifact' | 'abandoned_unproven'>('killed_by_artifact');
  const [closeArtifact, setCloseArtifact] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [submittingClose, setSubmittingClose] = useState(false);
  const [generatingHyp, setGeneratingHyp] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Human from-poc modal (G6)
  const [showPocModal, setShowPocModal] = useState(false);
  const [pocTitle, setPocTitle] = useState('');
  const [pocSeverity, setPocSeverity] = useState<FindingSeverity>('high');
  const [pocFileLine, setPocFileLine] = useState('src/Vault.sol:120');
  const [pocSummary, setPocSummary] = useState('');
  const [pocSource, setPocSource] = useState(
    'contract ManualPoC is Test {\n  function test_Exploit() public {\n    assertTrue(true);\n  }\n}'
  );
  const [pocError, setPocError] = useState<string | null>(null);
  const [submittingPoc, setSubmittingPoc] = useState(false);

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
    setSubmittingClose(true);
    try {
      const { scan: updated } = await api.closeHypothesis(scan.id, closingId, {
        outcome: closeOutcome,
        artifactId: closeArtifact.trim() || undefined,
        reason: closeReason.trim() || 'Clôture manuelle.',
      });
      onScanUpdated(updated);
      setClosingId(null);
      setCloseArtifact('');
      setCloseReason('');
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
        affectedFileLine: pocFileLine,
        summary: pocSummary,
        pocSource,
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
      setAiError(err instanceof Error ? err.message : 'Erreur lors de la génération gemini-4-neon.');
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
              {generatingHyp ? 'Génération gemini-4-neon…' : 'Générer hypothèses (gemini-4-neon)'}
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
                      <span className="font-mono">{hyp.targetFileLine}</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                      {hyp.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <HypothesisOutcomeLabel outcome={hyp.outcome} />
                    {hyp.outcome === 'in_progress' && (
                      <button
                        type="button"
                        onClick={() => setClosingId(hyp.id)}
                        className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                      >
                        Clôturer
                      </button>
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
                            setCloseOutcome(e.target.value as 'killed_by_artifact' | 'abandoned_unproven')
                          }
                          className="w-full h-9 px-2.5 text-xs bg-white dark:bg-[#121722] border border-slate-300 dark:border-slate-700 rounded-md"
                        >
                          <option value="killed_by_artifact">Tuée par artefact (exige artifact_id)</option>
                          <option value="abandoned_unproven">Abandonnée sans preuve</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                          ID artefact exécuté (si vide → abandonnée sans preuve)
                        </label>
                        <input
                          type="text"
                          value={closeArtifact}
                          onChange={(e) => setCloseArtifact(e.target.value)}
                          placeholder="ex. art-forge-test-260"
                          className="w-full h-9 px-2.5 text-xs font-mono bg-white dark:bg-[#121722] border border-slate-300 dark:border-slate-700 rounded-md"
                        />
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
                  Code affecté (fichier:ligne)
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
              <div>
                <label htmlFor="poc-source" className="block text-xs font-medium mb-1">
                  Source PoC Foundry (écrit dans le worktree et rejoué avec FOUNDRY_FFI=false)
                </label>
                <textarea
                  id="poc-source"
                  rows={6}
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
                  {submittingPoc ? 'Validation clean-room…' : 'Valider PoC et créer le candidat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
