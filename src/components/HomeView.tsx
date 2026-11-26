import React, { useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { api, type ScanSummary } from '../lib/api';
import { getT } from '../i18n/translations';
import type { Locale } from '../types';
import { G0DecisionLabel, ScanStatusLabel } from './StatusText';

interface HomeViewProps {
  scans: ScanSummary[];
  loading: boolean;
  locale: Locale;
  onScanCreated: (scanId: string) => void;
  onOpenScan: (scanId: string) => void;
}

export function HomeView({ scans, loading, locale, onScanCreated, onOpenScan }: HomeViewProps) {
  const t = getT(locale);
  const [targetUrl, setTargetUrl] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [rpcUrl, setRpcUrl] = useState('');
  const [surface, setSurface] = useState<'all' | 'onchain' | 'seam'>('all');
  const [repoCount, setRepoCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!targetUrl.trim()) {
      setError('Veuillez coller une URL de programme, un dépôt GitHub ou un chemin local.');
      return;
    }
    setSubmitting(true);
    try {
      const { scan } = await api.createScan({
        targetUrl: targetUrl.trim(),
        rpcUrl: rpcUrl.trim() || undefined,
        surface,
        repoCount,
      });
      onScanCreated(scan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du lancement du scan.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredScans = scans.filter((s) => {
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    return (
      s.programName.toLowerCase().includes(q) ||
      s.targetUrl.toLowerCase().includes(q) ||
      s.chain.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-10">
      {/* Focused Hunter Entry */}
      <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 lg:p-8">
        <div className="max-w-3xl">
          <h1 className="text-2xl lg:text-[28px] font-bold tracking-tight text-slate-950 dark:text-white">
            {t.home.title}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {t.home.subtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="scan-target-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2"
            >
              {t.home.inputLabel}
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                id="scan-target-input"
                type="text"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder={t.home.inputPlaceholder}
                className="flex-1 min-w-0 h-11 px-3.5 text-sm font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
              />
              <button
                type="submit"
                disabled={submitting}
                className="h-11 px-6 inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-md bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <span>{submitting ? t.home.launching : t.home.launch}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
              {error}
            </p>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Programme : rien n’est déduit de l’URL — statut, impacts verbatim, adresses et dépôt sont attestés ensuite depuis la page du programme.
            Dépôt : <span className="font-mono">https://github.com/org/repo</span> (ou <span className="font-mono">/tree/&lt;sha&gt;</span> pour épingler un commit).
            Local : chemin absolu.
          </p>

          {/* Collapsible Options */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <button
              type="button"
              aria-expanded={showOptions}
              onClick={() => setShowOptions((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            >
              {showOptions ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              <span>{t.home.optionsToggle}</span>
            </button>

            {showOptions && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="scan-rpc-input"
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                  >
                    {t.home.rpcLabel}
                  </label>
                  <input
                    id="scan-rpc-input"
                    type="text"
                    value={rpcUrl}
                    onChange={(e) => setRpcUrl(e.target.value)}
                    placeholder={t.home.rpcPlaceholder}
                    className="w-full h-9 px-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label
                    htmlFor="scan-surface-select"
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                  >
                    {t.home.surfaceLabel}
                  </label>
                  <select
                    id="scan-surface-select"
                    value={surface}
                    onChange={(e) => setSurface(e.target.value as 'all' | 'onchain' | 'seam')}
                    className="w-full h-9 px-3 text-xs bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="all">{t.home.surfaceAll}</option>
                    <option value="onchain">{t.home.surfaceOnchain}</option>
                    <option value="seam">{t.home.surfaceSeam}</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="scan-repos-input"
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                  >
                    {t.home.reposLabel}
                  </label>
                  <input
                    id="scan-repos-input"
                    type="number"
                    min={1}
                    max={8}
                    value={repoCount}
                    onChange={(e) => setRepoCount(Number(e.target.value) || 1)}
                    className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>
            )}
          </div>
        </form>
      </section>

      {/* Recent Scans Table */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t.home.recentScans}
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filtrer par cible ou réseau…"
              aria-label="Filtrer les scans récents"
              className="w-full h-9 pl-8 pr-3 text-xs bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse"
                />
              ))}
            </div>
          ) : filteredScans.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {t.home.emptyScans}
            </div>
          ) : (
            <>
              {/* Mobile stacked rows (zero horizontal scroll at 390px) */}
              <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredScans.map((scan) => (
                  <div key={scan.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenScan(scan.id)}
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                          {scan.programName}
                        </div>
                        <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {scan.targetUrl}
                        </div>
                      </button>
                      <G0DecisionLabel decision={scan.g0.decision} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <ScanStatusLabel status={scan.status} />
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {Math.round(scan.budget.tokensUsed / 1000)}k/{Math.round(scan.budget.tokensLimit / 1000)}k
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{scan.findingsCount} cand.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenScan(scan.id)}
                        className="font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        Ouvrir
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop high-density table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-4">{t.home.colTarget}</th>
                      <th className="py-3 px-4">{t.home.colKind}</th>
                      <th className="py-3 px-4">{t.home.colG0}</th>
                      <th className="py-3 px-4">{t.home.colStatus}</th>
                      <th className="py-3 px-4 text-right">{t.home.colBudget}</th>
                      <th className="py-3 px-4 text-right">{t.home.colFindings}</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                    {filteredScans.map((scan) => (
                      <tr
                        key={scan.id}
                        className="hover:bg-slate-50/90 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3.5 px-4 max-w-xs">
                          <button
                            type="button"
                            onClick={() => onOpenScan(scan.id)}
                            className="text-left group block w-full"
                          >
                            <div className="font-semibold text-slate-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate">
                              {scan.programName}
                            </div>
                            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {scan.targetUrl}
                            </div>
                          </button>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          <span>{scan.targetKind === 'program' ? t.common.programMode : t.common.labMode}</span>
                          <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono">{scan.chain}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <G0DecisionLabel decision={scan.g0.decision} />
                        </td>
                        <td className="py-3.5 px-4">
                          <ScanStatusLabel status={scan.status} />
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {Math.round(scan.budget.tokensUsed / 1000)}k /{' '}
                          {Math.round(scan.budget.tokensLimit / 1000)}k
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums font-semibold text-slate-900 dark:text-white">
                          {scan.findingsCount}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => onOpenScan(scan.id)}
                            className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                          >
                            Ouvrir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
