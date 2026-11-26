import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, RefreshCw, Square, X } from 'lucide-react';
import { api, subscribeScanEvents } from '../lib/api';
import { getT } from '../i18n/translations';
import type { Finding, Locale, ScanRun } from '../types';
import { FindingStatusLabel, G0DecisionLabel, ScanStatusLabel, SeverityLabel } from './StatusText';
import { ScanOverviewTab } from './scan/ScanOverviewTab';
import { ThreatModelTab } from './scan/ThreatModelTab';
import { HuntTab } from './scan/HuntTab';
import { FixReviewTab } from './scan/FixReviewTab';
import { DappSeamTab } from './scan/DappSeamTab';
import { NeedsInputPanel, ProgramScopeForm } from './scan/NeedsInputPanel';

interface ScanViewProps {
  scanId: string;
  locale: Locale;
  onOpenFinding: (findingId: string) => void;
  onBackHome: () => void;
  onScanMutated: () => void;
}

type ScanTab = 'overview' | 'threat_model' | 'hunt' | 'findings' | 'fix_review' | 'seam';

export function ScanView({
  scanId,
  locale,
  onOpenFinding,
  onBackHome,
  onScanMutated,
}: ScanViewProps) {
  const t = getT(locale);
  const [scan, setScan] = useState<ScanRun | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ScanTab>('overview');

  const [showScopeEditor, setShowScopeEditor] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // NO-GO Override modal
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [submittingOverride, setSubmittingOverride] = useState(false);

  const [actionBusy, setActionBusy] = useState(false);

  const loadScan = async () => {
    try {
      const data = await api.getScan(scanId);
      setScan(data.scan);
      setFindings(data.findings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger le scan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadScan();
    const unsub = subscribeScanEvents(scanId, () => {
      loadScan();
    });
    return unsub;
  }, [scanId]);

  const applyUpdate = (data: { scan: ScanRun; findings: Finding[] }) => {
    setScan(data.scan);
    setFindings(data.findings);
    setShowScopeEditor(false);
    onScanMutated();
  };

  const handleRebuild = async () => {
    if (!scan) return;
    setActionError(null);
    setActionBusy(true);
    try {
      applyUpdate(await api.rebuildScan(scan.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Relance refusée.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scan) return;
    setOverrideError(null);
    if (overrideReason.trim().length < 20) {
      setOverrideError(
        `La justification doit contenir au moins 20 caractères (${overrideReason.trim().length}/20).`
      );
      return;
    }
    setSubmittingOverride(true);
    try {
      const data = await api.overrideG0(scan.id, overrideReason.trim());
      setScan(data.scan);
      setFindings(data.findings);
      setShowOverrideModal(false);
      setOverrideReason('');
      onScanMutated();
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : 'Override refusé.');
    } finally {
      setSubmittingOverride(false);
    }
  };

  const handleExtendBudget = async () => {
    if (!scan) return;
    setActionError(null);
    setActionBusy(true);
    try {
      const { scan: updated } = await api.extendBudget(scan.id, 50_000);
      setScan(updated);
      onScanMutated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Extension refusée.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleStopScan = async () => {
    if (!scan) return;
    setActionBusy(true);
    try {
      const { scan: updated } = await api.stopScan(scan.id);
      setScan(updated);
      onScanMutated();
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
        <div className="h-64 bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !scan) {
    return (
      <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center space-y-3">
        <p className="text-sm text-red-700 dark:text-red-400">{error || 'Scan introuvable.'}</p>
        <button
          type="button"
          onClick={onBackHome}
          className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
        >
          Retour à la liste des scans
        </button>
      </div>
    );
  }

  const blockingLines = scan.g0.verdictLines.filter((l) => l.status === 'block');
  const tabs: Array<{ key: ScanTab; label: string }> = [
    { key: 'overview', label: t.scan.tabs.overview },
    { key: 'threat_model', label: t.scan.tabs.threatModel },
    { key: 'hunt', label: `${t.scan.tabs.hunt} (${scan.hypotheses.length})` },
    { key: 'findings', label: `${t.scan.tabs.findings} (${findings.length})` },
    { key: 'fix_review', label: t.scan.tabs.fixReview },
    { key: 'seam', label: `${t.scan.tabs.seam} (${scan.seamEvents.length})` },
  ];

  return (
    <div className="space-y-6">
      {/* Scan Header */}
      <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-5 lg:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>{scan.targetKind === 'program' ? t.common.programMode : t.common.labMode}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{scan.scopeKind}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{scan.chain}</span>
              <span aria-hidden="true">·</span>
              <G0DecisionLabel decision={scan.g0.decision} />
              <span aria-hidden="true">·</span>
              <ScanStatusLabel status={scan.status} />
            </div>

            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-950 dark:text-white truncate">
              {scan.programName}
            </h1>
            <div className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
              {scan.targetUrl}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 shrink-0">
            <div className="text-right">
              <div className="text-xs text-slate-500 dark:text-slate-400">Prime max</div>
              <div className="text-base font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                {scan.maxBountyUsd !== null
                  ? `$${scan.maxBountyUsd.toLocaleString('en-US')}`
                  : scan.targetKind === 'program'
                    ? 'Non attestée'
                    : 'Mode labo'}
              </div>
            </div>
            <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />
            <div className="text-right">
              <div className="text-xs text-slate-500 dark:text-slate-400">Budget tokens</div>
              <div className="text-base font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                {Math.round(scan.budget.tokensUsed / 1000)}k /{' '}
                {Math.round(scan.budget.tokensLimit / 1000)}k
              </div>
            </div>

            {scan.status !== 'running' && (scan.targetKind !== 'program' || scan.programScope?.repoUrl) && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleRebuild}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-cloner &amp; rebuild</span>
              </button>
            )}
            {scan.targetKind === 'program' && scan.programScope && (
              <button
                type="button"
                onClick={() => setShowScopeEditor((v) => !v)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <span>{showScopeEditor ? 'Fermer le scope' : 'Modifier le scope attesté'}</span>
              </button>
            )}
            {(scan.status === 'hunting' || scan.status === 'running') && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={handleStopScan}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Square className="w-3.5 h-3.5" />
                <span>{t.scan.stopScan}</span>
              </button>
            )}
          </div>
        </div>

        {/* 7-Step Horizontal Pipeline Stepper */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 overflow-x-auto">
          <ol className="grid grid-cols-7 min-w-[700px] gap-2">
            {scan.steps.map((step, idx) => {
              const isDone = step.status === 'done';
              const isBlocked = step.status === 'blocked' || step.status === 'failed';
              const isNeeds = step.status === 'needs_input';
              const isRunning = step.status === 'running';
              return (
                <li key={step.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-5 h-5 rounded-full text-[11px] font-mono font-semibold flex items-center justify-center shrink-0 ${
                        isDone
                          ? 'bg-emerald-600 text-white'
                          : isBlocked
                            ? 'bg-red-600 text-white'
                            : isNeeds
                              ? 'bg-amber-600 text-white'
                              : isRunning
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {isDone ? <Check className="w-3 h-3" /> : idx + 1}
                    </span>
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {t.scan.steps[step.key]}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug line-clamp-2 pl-7">
                    {step.detail}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {actionError && (
        <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
          {actionError}
        </p>
      )}

      {/* Gate Banner: NEEDS_INPUT (program scope / RPC / funds attestation) */}
      {scan.status === 'needs_input' && <NeedsInputPanel scan={scan} onUpdated={applyUpdate} />}

      {showScopeEditor && scan.programScope && (
        <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Scope attesté par {scan.programScope.attestedBy} le {scan.programScope.attestedAt.slice(0, 16).replace('T', ' ')}
          </h2>
          <ProgramScopeForm scan={scan} onUpdated={applyUpdate} />
        </section>
      )}

      {/* Gate Banner: NO-GO */}
      {scan.status === 'no_go' && (
        <section className="bg-red-50/70 dark:bg-red-950/20 border border-red-300 dark:border-red-900/70 rounded-lg p-5 flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{t.scan.noGoTitle} — chasse bloquée (LOCK #1)</span>
            </div>
            <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300 pl-6 list-disc">
              {blockingLines.map((b) => (
                <li key={b.id}>
                  <span className="font-mono font-semibold">{b.id}</span> ({b.label}) : {b.value} — {b.detail}
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => setShowOverrideModal(true)}
            className="px-4 py-2 text-xs font-semibold rounded-md border border-red-400 dark:border-red-700 text-red-800 dark:text-red-300 hover:bg-red-100/60 dark:hover:bg-red-900/30 whitespace-nowrap shrink-0"
          >
            {t.scan.overrideBtn}
          </button>
        </section>
      )}

      {/* Gate Banner: Budget Stopped */}
      {scan.status === 'stopped' && (
        <section className="bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-700 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-white">
              Scan arrêté.
            </span>{' '}
            {scan.budget.tokensUsed >= scan.budget.tokensLimit
              ? 'Budget tokens épuisé : l’extension relève seulement la limite, elle ne clôt aucune hypothèse.'
              : 'Arrêté par l’opérateur : relancez via « Re-cloner & rebuild » ou étendez le budget pour reprendre.'}
          </div>
          <button
            type="button"
            disabled={actionBusy}
            onClick={handleExtendBudget}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950 whitespace-nowrap shrink-0"
          >
            {t.scan.continueBudget}
          </button>
        </section>
      )}

      {/* Tabs Navigation */}
      <div className="border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        <nav role="tablist" aria-label="Vues du scan" className="flex items-center gap-6 min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-blue-700 dark:border-blue-400 text-slate-950 dark:text-white font-semibold'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Active Tab Content */}
      <div>
        {activeTab === 'overview' && <ScanOverviewTab scan={scan} locale={locale} />}
        {activeTab === 'threat_model' && (
          <ThreatModelTab
            scan={scan}
            locale={locale}
            onScanUpdated={(updated) => {
              setScan(updated);
              onScanMutated();
            }}
          />
        )}
        {activeTab === 'hunt' && (
          <HuntTab
            scan={scan}
            locale={locale}
            onScanUpdated={(updated) => {
              setScan(updated);
              onScanMutated();
            }}
            onFindingCreated={(f) => {
              setFindings((prev) => [f, ...prev]);
              onScanMutated();
            }}
          />
        )}
        {activeTab === 'findings' && (
          <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            {findings.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucun candidat enregistré sur ce scan pour le moment.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {findings.map((f) => (
                  <div
                    key={f.id}
                    className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{f.id}</span>
                        <span aria-hidden="true">·</span>
                        <SeverityLabel severity={f.severity} />
                        <span aria-hidden="true">·</span>
                        <FindingStatusLabel status={f.status} />
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{f.affectedFileLine}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenFinding(f.id)}
                        className="text-left text-base font-semibold text-slate-900 dark:text-white hover:text-blue-700 dark:hover:text-blue-400"
                      >
                        {f.title}
                      </button>
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                        {f.summary}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenFinding(f.id)}
                      className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      Ouvrir le récit
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {activeTab === 'fix_review' && (
          <FixReviewTab
            findings={findings}
            locale={locale}
            onFindingUpdated={(updated) =>
              setFindings((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
            }
          />
        )}
        {activeTab === 'seam' && <DappSeamTab scan={scan} />}
      </div>

      {/* NO-GO Override Modal */}
      {showOverrideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="override-modal-title"
        >
          <div className="w-full max-w-lg bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 id="override-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">
                {t.scan.overrideModalTitle}
              </h3>
              <button
                type="button"
                onClick={() => setShowOverrideModal(false)}
                aria-label="Fermer"
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmOverride} className="p-5 space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                L’override G0 est journalisé avec votre identifiant et la raison fournie (L7). Il débloque la chasse sur ce scan malgré les lignes bloquantes.
              </p>
              <div>
                <label htmlFor="override-reason-input" className="block text-xs font-semibold mb-1.5">
                  {t.scan.overrideReasonLabel}
                </label>
                <textarea
                  id="override-reason-input"
                  rows={3}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Ex. Analyse préventive du code avant la réouverture annoncée du programme v3."
                  className="w-full p-3 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:border-blue-600"
                />
                <div className="mt-1 text-xs font-mono text-slate-500">
                  {overrideReason.trim().length} / 20 caractères minimum
                </div>
              </div>
              {overrideError && (
                <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
                  {overrideError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  {t.scan.cancel}
                </button>
                <button
                  type="submit"
                  disabled={submittingOverride}
                  className="px-4 py-2 text-xs font-semibold rounded-md bg-red-700 hover:bg-red-800 text-white"
                >
                  {submittingOverride ? 'Validation…' : t.scan.confirmOverride}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
