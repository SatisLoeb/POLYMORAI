import React, { useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';
import { api } from '../../lib/api';
import { getT } from '../../i18n/translations';
import type { Finding, Locale } from '../../types';

interface FixReviewTabProps {
  findings: Finding[];
  locale: Locale;
  onFindingUpdated: (finding: Finding) => void;
}

export function FixReviewTab({ findings, locale, onFindingUpdated }: FixReviewTabProps) {
  const t = getT(locale);
  const [selectedFindingId, setSelectedFindingId] = useState(findings[0]?.id ?? '');
  const [prUrl, setPrUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedFinding = findings.find((f) => f.id === selectedFindingId) ?? findings[0];

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFinding) return;
    setError(null);
    if (!prUrl.trim()) {
      setError('Collez une URL de PR GitHub ou un SHA de commit.');
      return;
    }
    setRunning(true);
    try {
      const { finding } = await api.runFixReview(selectedFinding.id, prUrl.trim());
      onFindingUpdated(finding);
      setPrUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du fix-review.');
    } finally {
      setRunning(false);
    }
  };

  const handleCopy = async (id: string, markdown: string) => {
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      // Clipboard fallback in headless browsers
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  if (findings.length === 0) {
    return (
      <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Aucun finding sur ce scan à rejouer en fix-review.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleRun}
        className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4"
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            {t.finding.fixReviewTitle}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t.finding.fixReviewNoPostNote}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="fr-finding-select" className="block text-xs font-medium mb-1">
              Finding à vérifier
            </label>
            <select
              id="fr-finding-select"
              value={selectedFinding?.id ?? ''}
              onChange={(e) => setSelectedFindingId(e.target.value)}
              className="w-full h-10 px-3 text-xs bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
            >
              {findings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id} — {f.title}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="fr-pr-url" className="block text-xs font-medium mb-1">
              URL de PR ou commit
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="fr-pr-url"
                type="text"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                placeholder={t.finding.fixReviewPlaceholder}
                className="flex-1 h-10 px-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
              <button
                type="submit"
                disabled={running}
                className="h-10 px-4 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-100 whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{running ? 'Rejeu…' : t.finding.fixReviewRun}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>Exemples rapides :</span>
          <button
            type="button"
            onClick={() => setPrUrl('https://github.com/aegis-protocol/vault-v2/pull/184')}
            className="text-blue-700 dark:text-blue-400 hover:underline"
          >
            PR correctif complet (#184)
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setPrUrl('https://github.com/aegis-protocol/vault-v2/pull/185-wip-unfixed')}
            className="text-blue-700 dark:text-blue-400 hover:underline"
          >
            PR non correctif (still_reproducible)
          </button>
        </div>

        {error && (
          <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </form>

      {/* Results list */}
      {selectedFinding && selectedFinding.fixReviews.length > 0 && (
        <div className="space-y-4">
          {selectedFinding.fixReviews.map((review) => (
            <article
              key={review.id}
              className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    {review.baseCommit.slice(0, 12)}..{review.headCommit.slice(0, 12)} · {review.prOrCommitUrl}
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    Verdict :{' '}
                    <span
                      className={
                        review.verdict === 'fixed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : review.verdict === 'still_reproducible'
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-400'
                      }
                    >
                      {review.verdict === 'fixed'
                        ? 'PoC échoue sur la tête (fixed)'
                        : review.verdict === 'still_reproducible'
                          ? 'PoC passe encore (still_reproducible)'
                          : review.verdict === 'pending'
                            ? 'Rejeu en cours…'
                            : 'Non concluant (PoC non compilé / non exécuté)'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(review.id, review.summaryMarkdown)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  {copiedId === review.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{t.finding.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t.finding.copySummary}</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="p-3 rounded-md bg-[#0D1117] text-slate-200 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto">
                {review.pocReplayOutput || review.error || '(en attente)'}
              </pre>

              <div>
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Analyse des sinks frères (patchlag)
                </h4>
                {review.siblingSinks.length === 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Non exécutée par cette version : seul le PoC du finding est rejoué. Les frères non patchés restent à chasser à la main.
                  </p>
                )}
                <ul className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {review.siblingSinks.map((sink) => (
                    <li key={sink.fileLine} className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div>
                        <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                          {sink.functionName}
                        </span>
                        <span className="ml-2 font-mono text-slate-500">{sink.fileLine}</span>
                        <p className="text-slate-600 dark:text-slate-400 mt-0.5">{sink.note}</p>
                      </div>
                      <span
                        className={`font-mono text-xs font-semibold whitespace-nowrap ${
                          sink.status === 'clean'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {sink.status === 'clean' ? 'Protégé' : 'Sink frère vulnérable'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
