import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, Lock, Play, ShieldCheck, X } from 'lucide-react';
import { canExportFinding } from '../core/doctrine';
import { api } from '../lib/api';
import { getT } from '../i18n/translations';
import type { DeploymentCheckKind, ExportFormat, Finding, Locale, ScanRun } from '../types';
import { FindingStatusLabel, SeverityLabel } from './StatusText';

interface FindingDetailViewProps {
  findingId: string;
  locale: Locale;
  onOpenScan: (scanId: string) => void;
  onBackFindings: () => void;
  onFindingMutated: () => void;
}

export function FindingDetailView({
  findingId,
  locale,
  onOpenScan,
  onBackFindings,
  onFindingMutated,
}: FindingDetailViewProps) {
  const t = getT(locale);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [scan, setScan] = useState<ScanRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sign-off modal state (3 plain-language questions, U-1)
  const [showSignoff, setShowSignoff] = useState(false);
  const [q1Impact, setQ1Impact] = useState('');
  const [q2Precond, setQ2Precond] = useState('');
  const [deploymentCheck, setDeploymentCheck] = useState<DeploymentCheckKind>('verified_at_block');
  const [blockNumber, setBlockNumber] = useState<string>('');
  const [q3Deployment, setQ3Deployment] = useState('');
  const [signoffError, setSignoffError] = useState<string | null>(null);
  const [submittingSignoff, setSubmittingSignoff] = useState(false);

  // Export state
  const [exportFormat, setExportFormat] = useState<ExportFormat>('immunefi');
  const [exportPreview, setExportPreview] = useState<{ filename: string; content: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Inline Fix-Review state
  const [prUrl, setPrUrl] = useState('');
  const [runningFix, setRunningFix] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Disconfirmer AI re-run state
  const [runningDisconfirmer, setRunningDisconfirmer] = useState(false);
  const [disconfirmerError, setDisconfirmerError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const data = await api.getFinding(findingId);
      setFinding(data.finding);
      setScan(data.scan);
      setError(null);

      // Prefill deployment_check from G0 artifacts
      const g0Block =
        data.scan.g0.verdictLines.find((l) => l.artifact.blockNumber)?.artifact.blockNumber ||
        data.scan.ingest.provenanceMatch?.blockNumber;
      if (data.scan.scopeKind === 'commit_anchored') {
        setDeploymentCheck('commit_anchored_na');
        setBlockNumber('');
        setQ3Deployment(
          `Code vérifié sur le commit épinglé ${data.scan.ingest.provenanceMatch?.pinnedCommit?.slice(0, 7) ?? 'HEAD'}.`
        );
      } else {
        setDeploymentCheck('verified_at_block');
        setBlockNumber(g0Block ? String(g0Block) : '');
        setQ3Deployment(
          g0Block
            ? `Bytecode et solde vérifiés sur ${data.scan.chain} au bloc ${g0Block}.`
            : `Vérifié sur le déploiement ${data.scan.chain}.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finding introuvable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [findingId]);

  const handleStatusChange = async (status: 'rejected' | 'hold') => {
    if (!finding) return;
    const { finding: updated } = await api.patchFindingStatus(finding.id, status);
    setFinding(updated);
    onFindingMutated();
  };

  const handleSignoffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finding) return;
    setSignoffError(null);
    setSubmittingSignoff(true);
    try {
      const { finding: updated } = await api.signoffFinding(finding.id, {
        impactJustification: q1Impact,
        preconditionJustification: q2Precond,
        deploymentCheck,
        deploymentJustification: q3Deployment,
        blockNumber: deploymentCheck === 'verified_at_block' ? Number(blockNumber) : undefined,
      });
      setFinding(updated);
      setShowSignoff(false);
      onFindingMutated();
    } catch (err) {
      setSignoffError(err instanceof Error ? err.message : 'Validation refusée.');
    } finally {
      setSubmittingSignoff(false);
    }
  };

  const handleExport = async (downloadBundle: 'md' | 'zip') => {
    if (!finding) return;
    setExportError(null);
    try {
      const result = await api.exportFinding(finding.id, exportFormat);
      setExportPreview({ filename: result.filename, content: result.content });

      const filename =
        downloadBundle === 'zip' ? result.filename.replace(/\.md$/, '-bundle.md') : result.filename;
      const blob = new Blob([result.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export bloqué.');
    }
  };

  const handleFixReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finding) return;
    setFixError(null);
    if (!prUrl.trim()) {
      setFixError('Veuillez coller une URL de PR ou un SHA de commit.');
      return;
    }
    setRunningFix(true);
    try {
      const { finding: updated } = await api.runFixReview(finding.id, prUrl.trim());
      setFinding(updated);
      setPrUrl('');
    } catch (err) {
      setFixError(err instanceof Error ? err.message : 'Erreur fix-review.');
    } finally {
      setRunningFix(false);
    }
  };

  const copySummary = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleRerunDisconfirmer = async () => {
    if (!finding) return;
    setDisconfirmerError(null);
    setRunningDisconfirmer(true);
    try {
      const { finding: updated } = await api.runDisconfirmerAI(finding.id);
      setFinding(updated);
      onFindingMutated();
    } catch (err) {
      setDisconfirmerError(
        err instanceof Error ? err.message : 'Erreur lors de la contre-vérification gemini-4-neon.'
      );
    } finally {
      setRunningDisconfirmer(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
        <div className="h-96 bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !finding || !scan) {
    return (
      <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center space-y-3">
        <p className="text-sm text-red-700 dark:text-red-400">{error || 'Finding introuvable.'}</p>
        <button
          type="button"
          onClick={onBackFindings}
          className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
        >
          Retour aux findings
        </button>
      </div>
    );
  }

  const exportGate = canExportFinding(finding, scan);

  return (
    <div className="space-y-6">
      {/* Back links */}
      <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <button
          type="button"
          onClick={() => onOpenScan(scan.id)}
          className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>
            {t.finding.backToScan} ({scan.programName})
          </span>
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={onBackFindings}
          className="hover:text-slate-900 dark:hover:text-white"
        >
          {t.finding.backToFindings}
        </button>
      </div>

      {/* Finding Header + Primary Human Actions */}
      <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                {finding.id}
              </span>
              <span aria-hidden="true">·</span>
              <SeverityLabel severity={finding.severity} />
              <span aria-hidden="true">·</span>
              <FindingStatusLabel status={finding.status} />
              <span aria-hidden="true">·</span>
              <span className="font-mono">{finding.affectedFileLine}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
              {finding.title}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {finding.status !== 'operator_confirmed' && (
              <button
                type="button"
                onClick={() => setShowSignoff(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-emerald-700 hover:bg-emerald-800 text-white whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{t.finding.validate}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleStatusChange('hold')}
              className="px-3.5 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              {t.finding.hold}
            </button>
            <button
              type="button"
              onClick={() => handleStatusChange('rejected')}
              className="px-3.5 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 whitespace-nowrap"
            >
              {t.finding.reject}
            </button>
          </div>
        </div>

        {/* Verbatim Impact Line or Lab Notice */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
            Ligne d’impact verbatim du programme (R12)
          </div>
          {finding.verbatimImpactLine ? (
            <blockquote className="text-sm text-slate-900 dark:text-slate-100 font-medium">
              « {finding.verbatimImpactLine} »
            </blockquote>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              Mode labo : aucune ligne d’impact verbatim de programme actif. L’export bounty est automatiquement bloqué (L9).
            </p>
          )}
        </div>
      </section>

      {/* Main 2-Column Content: Narrative Left, Sign-off/Export & Disconfirmer Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          {/* Summary & Affected Code */}
          <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Résumé</h2>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {finding.summary}
              </p>
            </div>
            <div className="pt-2">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Code affecté</span>
                <span className="font-mono text-slate-500">{finding.affectedFileLine}</span>
              </div>
              <pre className="p-4 rounded-md bg-[#0D1117] text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
                {finding.affectedCode}
              </pre>
            </div>
          </section>

          {/* PoC Source + Clean-Room Foundry Replay Trace */}
          <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {t.finding.pocTitle}
              </h2>
              <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                {finding.cleanRoomVerified ? 'Clean-room PASS (LOCK #5)' : 'Non vérifié'}
              </span>
            </div>

            <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
              {finding.pocFile} · {finding.pocReplayCommand}
            </div>

            <pre className="p-4 rounded-md bg-[#0D1117] text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
              {finding.pocSource}
            </pre>

            <div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Trace d’exécution Foundry (rejeu déterministe)
              </div>
              <pre className="p-4 rounded-md bg-[#0D1117] text-emerald-300/95 text-xs font-mono overflow-x-auto leading-relaxed">
                {finding.pocReplayTrace}
              </pre>
            </div>
          </section>

          {/* Recommendation */}
          <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Recommandation de correctif
            </h2>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              {finding.recommendation}
            </p>
          </section>

          {/* Fix Review Inline */}
          <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {t.finding.fixReviewTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t.finding.fixReviewNoPostNote}
              </p>
            </div>

            <form onSubmit={handleFixReview} className="flex flex-col sm:flex-row gap-2.5">
              <label htmlFor="finding-fix-pr" className="sr-only">
                URL de PR ou commit
              </label>
              <input
                id="finding-fix-pr"
                type="text"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                placeholder={t.finding.fixReviewPlaceholder}
                className="flex-1 h-10 px-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
              <button
                type="submit"
                disabled={runningFix}
                className="h-10 px-4 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950 whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{runningFix ? 'Rejeu…' : t.finding.fixReviewRun}</span>
              </button>
            </form>

            {fixError && (
              <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
                {fixError}
              </p>
            )}

            {finding.fixReviews.map((fr) => (
              <div
                key={fr.id}
                className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs">
                    <span className="font-mono text-slate-500">{fr.prOrCommitUrl}</span>
                    <span className="mx-2">·</span>
                    <span
                      className={`font-semibold ${
                        fr.verdict === 'fixed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {fr.verdict === 'fixed' ? 'Corrigé (fixed)' : 'Toujours reproductible'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copySummary(fr.id, fr.summaryMarkdown)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {copiedId === fr.id ? (
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
                <pre className="p-3 rounded-md bg-[#0D1117] text-slate-200 text-xs font-mono overflow-x-auto">
                  {fr.pocReplayOutput}
                </pre>
              </div>
            ))}
          </section>
        </div>

        {/* Right Rail: Disconfirmer, Sign-Off Record, Export */}
        <div className="space-y-6">
          {/* Disconfirmer Panel (LOCK #4 / R13 / R10) */}
          <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t.finding.disconfirmerTitle}
              </h2>
              <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                {finding.disconfirmer.status === 'clear' ? 'RAS' : 'Signalé'}
              </span>
            </div>
            <div className="text-xs space-y-2 text-slate-600 dark:text-slate-400">
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  {t.finding.legitimateAltLabel}
                </div>
                <p className="mt-0.5 leading-relaxed">
                  {finding.disconfirmer.legitimateAlternativeTest}
                </p>
              </div>
              <p className="leading-relaxed">{finding.disconfirmer.notes}</p>
              <p className="text-[11px] text-slate-500">
                Règle R10 : le disconfirmer signale uniquement, il ne supprime jamais un candidat.
              </p>
              {disconfirmerError && (
                <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
                  {disconfirmerError}
                </p>
              )}
              <button
                type="button"
                disabled={runningDisconfirmer}
                onClick={handleRerunDisconfirmer}
                className="w-full mt-1 px-3 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 disabled:opacity-60"
              >
                {runningDisconfirmer ? 'Vérification gemini-4-neon…' : 'Relancer R13 (gemini-4-neon)'}
              </button>
            </div>
          </section>

          {/* Operator Sign-Off Record */}
          {finding.signoff && (
            <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Sign-off opérateur (U-1)
                </h2>
                <span className="font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                  Confirmé
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-400">
                <strong className="text-slate-800 dark:text-slate-200">Impact :</strong>{' '}
                {finding.signoff.impactJustification}
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                <strong className="text-slate-800 dark:text-slate-200">Préconditions :</strong>{' '}
                {finding.signoff.preconditionJustification}
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                <strong className="text-slate-800 dark:text-slate-200">Périmètre :</strong>{' '}
                {finding.signoff.deploymentJustification}
                {finding.signoff.blockNumber ? ` (bloc ${finding.signoff.blockNumber})` : ''}
              </p>
            </section>
          )}

          {/* Export Bounty Box (Gated by U-1 & L9) */}
          <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t.finding.exportTitle}
              </h2>
              {!exportGate.allowed && <Lock className="w-4 h-4 text-slate-400" />}
            </div>

            {!exportGate.allowed ? (
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {exportGate.code === 'LAB_MODE_BLOCKED'
                  ? t.finding.exportLockedLab
                  : t.finding.exportLockedSignoff}
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="export-format-select" className="block text-xs font-medium mb-1">
                    Plateforme cible
                  </label>
                  <select
                    id="export-format-select"
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                    className="w-full h-9 px-3 text-xs bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="immunefi">Immunefi</option>
                    <option value="cantina">Cantina</option>
                    <option value="sherlock">Sherlock</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleExport('md')}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 text-white whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Exporter .md</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport('zip')}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Bundle .zip</span>
                  </button>
                </div>

                {exportError && (
                  <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
                    {exportError}
                  </p>
                )}

                {exportPreview && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 mb-1">
                      Généré : {exportPreview.filename}
                    </div>
                    <pre className="p-2.5 max-h-40 overflow-y-auto rounded bg-[#0D1117] text-slate-200 text-[11px] font-mono">
                      {exportPreview.content.slice(0, 600)}…
                    </pre>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Sign-off Modal: 3 Plain-Language Questions (NO internal jargon or case numbers) */}
      {showSignoff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signoff-modal-title"
        >
          <div className="w-full max-w-xl bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 id="signoff-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">
                {t.finding.signoffTitle}
              </h3>
              <button
                type="button"
                onClick={() => setShowSignoff(false)}
                aria-label="Fermer"
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSignoffSubmit} className="p-5 space-y-4">
              {signoffError && (
                <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
                  {signoffError}
                </p>
              )}

              <div>
                <label htmlFor="signoff-q1" className="block text-xs font-semibold mb-1.5">
                  {t.finding.signoffQ1}
                </label>
                <textarea
                  id="signoff-q1"
                  rows={2}
                  required
                  value={q1Impact}
                  onChange={(e) => setQ1Impact(e.target.value)}
                  placeholder="Ex. Extraction directe de 195 WETH depuis la file de retrait sans autorisation."
                  className="w-full p-2.5 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>

              <div>
                <label htmlFor="signoff-q2" className="block text-xs font-semibold mb-1.5">
                  {t.finding.signoffQ2}
                </label>
                <textarea
                  id="signoff-q2"
                  rows={2}
                  required
                  value={q2Precond}
                  onChange={(e) => setQ2Precond(e.target.value)}
                  placeholder="Ex. Appel permissionless par tout contrat destinataire ; aucune fonction légitime ne permet ce gain."
                  className="w-full p-2.5 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>

              <div className="space-y-2.5">
                <label htmlFor="signoff-q3" className="block text-xs font-semibold">
                  {t.finding.signoffQ3}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    aria-label="Type de vérification du déploiement"
                    value={deploymentCheck}
                    onChange={(e) => setDeploymentCheck(e.target.value as DeploymentCheckKind)}
                    className="h-9 px-3 text-xs bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="verified_at_block">Vérifié on-chain à un bloc donné</option>
                    <option
                      value="commit_anchored_na"
                      disabled={scan.scopeKind !== 'commit_anchored'}
                    >
                      Scope ancré sur un commit (non déployé)
                    </option>
                  </select>

                  {deploymentCheck === 'verified_at_block' && (
                    <input
                      type="number"
                      aria-label="Numéro de bloc vérifié"
                      value={blockNumber}
                      onChange={(e) => setBlockNumber(e.target.value)}
                      placeholder="Numéro de bloc"
                      className="h-9 px-3 text-xs font-mono tabular-nums bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                    />
                  )}
                </div>
                <textarea
                  id="signoff-q3"
                  rows={2}
                  required
                  value={q3Deployment}
                  onChange={(e) => setQ3Deployment(e.target.value)}
                  className="w-full p-2.5 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSignoff(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submittingSignoff}
                  className="px-4 py-2 text-xs font-semibold rounded-md bg-emerald-700 hover:bg-emerald-800 text-white"
                >
                  {submittingSignoff ? 'Enregistrement…' : t.finding.signoffSubmit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
