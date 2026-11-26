import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getT } from '../../i18n/translations';
import type { G0VerdictLine, Locale, ScanRun } from '../../types';
import { G0LineStatusLabel } from '../StatusText';

interface ScanOverviewTabProps {
  scan: ScanRun;
  locale: Locale;
}

export function ScanOverviewTab({ scan, locale }: ScanOverviewTabProps) {
  const t = getT(locale);
  const [expandedArtifactId, setExpandedArtifactId] = useState<string | null>(null);
  const [showBuildLog, setShowBuildLog] = useState(false);

  const toggleArtifact = (line: G0VerdictLine) => {
    setExpandedArtifactId((prev) => (prev === line.artifact.id ? null : line.artifact.id));
  };

  // Simple SVG chart coordinates for Budget (tokensK) vs Findings & Hypotheses Closed
  const history = scan.budget.history.length > 0 ? scan.budget.history : [{ tokensK: 0, hypothesesClosed: 0, findingsCount: 0 }];
  const maxTokensK = Math.max(Math.round(scan.budget.tokensLimit / 1000), ...history.map((h) => h.tokensK), 50);
  const maxY = Math.max(3, ...history.map((h) => Math.max(h.hypothesesClosed, h.findingsCount)));
  const chartW = 460;
  const chartH = 160;
  const padL = 34;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const toX = (tokensK: number) => padL + (tokensK / maxTokensK) * innerW;
  const toY = (val: number) => padT + innerH - (val / maxY) * innerH;

  const findingsPath = history
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toX(pt.tokensK).toFixed(1)} ${toY(pt.findingsCount).toFixed(1)}`)
    .join(' ');

  const hypPath = history
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toX(pt.tokensK).toFixed(1)} ${toY(pt.hypothesesClosed).toFixed(1)}`)
    .join(' ');

  return (
    <div className="space-y-8">
      {/* G0 Verdict Line-by-Line Card */}
      <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {t.scan.verdictTableTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Évaluation déterministe en code pur (L7) — chaque ligne cite son artefact vérifiable.
            </p>
          </div>
          {scan.g0.overrideReason && (
            <div className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              Override journalisé ({scan.g0.overrideBy}) : « {scan.g0.overrideReason} »
            </div>
          )}
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {scan.g0.verdictLines.map((line) => {
            const expanded = expandedArtifactId === line.artifact.id;
            return (
              <div key={line.id} className="px-5 py-3.5">
                <div className="grid grid-cols-1 md:grid-cols-[96px_190px_88px_1fr_auto] items-start md:items-center gap-2 md:gap-4">
                  <div className="font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {line.id} · {line.ruleRef}
                  </div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {line.label}
                  </div>
                  <div>
                    <G0LineStatusLabel status={line.status} />
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-300">
                    <span className="font-mono font-medium text-slate-900 dark:text-white">
                      {line.value}
                    </span>
                    <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">{line.detail}</span>
                  </div>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleArtifact(line)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                  >
                    <span>{t.scan.inspectArtifact}</span>
                    {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {expanded && (
                  <div className="mt-3 p-3.5 rounded-md bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-slate-800 text-xs font-mono space-y-1 text-slate-700 dark:text-slate-300">
                    <div>
                      <span className="text-slate-500">artifact_id:</span> {line.artifact.id}
                    </div>
                    <div>
                      <span className="text-slate-500">source:</span> {line.artifact.source}
                    </div>
                    {line.artifact.blockNumber !== undefined && (
                      <div>
                        <span className="text-slate-500">block:</span> {line.artifact.blockNumber}
                      </div>
                    )}
                    {line.artifact.commitSha && (
                      <div>
                        <span className="text-slate-500">commit:</span> {line.artifact.commitSha}
                      </div>
                    )}
                    <div className="pt-1 text-slate-900 dark:text-slate-100 break-all">
                      {line.artifact.excerpt}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 2-Column Lower Split: Budget vs Findings Chart & Ingest Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Budget vs Findings SVG */}
        <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t.scan.budgetChartTitle}
              </h3>
              <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {Math.round(scan.budget.tokensUsed / 1000)}k / {Math.round(scan.budget.tokensLimit / 1000)}k tokens
              </span>
            </div>

            <div className="mt-4">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-44 overflow-visible"
                role="img"
                aria-label="Courbe budget tokens versus candidats et hypothèses clôturées"
              >
                {[0, 0.5, 1].map((ratio) => {
                  const y = padT + innerH * (1 - ratio);
                  const val = Math.round(maxY * ratio);
                  return (
                    <g key={ratio}>
                      <line
                        x1={padL}
                        x2={chartW - padR}
                        y1={y}
                        y2={y}
                        className="stroke-slate-200 dark:stroke-slate-800"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={padL - 8}
                        y={y + 4}
                        textAnchor="end"
                        className="fill-slate-400 text-[10px] font-mono"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

                <path
                  d={hypPath}
                  fill="none"
                  className="stroke-slate-400 dark:stroke-slate-500"
                  strokeWidth="2"
                />
                <path
                  d={findingsPath}
                  fill="none"
                  className="stroke-blue-600 dark:stroke-blue-400"
                  strokeWidth="2.5"
                />
                {history.map((pt, idx) => (
                  <g key={idx}>
                    <circle
                      cx={toX(pt.tokensK)}
                      cy={toY(pt.findingsCount)}
                      r="3.5"
                      className="fill-blue-600 dark:fill-blue-400"
                    />
                    <text
                      x={toX(pt.tokensK)}
                      y={chartH - 6}
                      textAnchor="middle"
                      className="fill-slate-500 text-[10px] font-mono"
                    >
                      {pt.tokensK}k
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          <div className="pt-3 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-5 text-xs text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-blue-600 dark:bg-blue-400 inline-block" />
              Candidats PoC
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-slate-400 inline-block" />
              Hypothèses clôturées
            </span>
          </div>
        </section>

        {/* Persisted Ingest Summary */}
        <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t.scan.ingestSummaryTitle}
            </h3>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              {scan.ingest.contractsCount} contrats · FFI off
            </span>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400">
            {scan.ingest.negativeSpaceSummary}
          </p>

          {scan.ingest.untestedMonetaryFunctions.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Fonctions monétaires non testées (Door A)
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                {scan.ingest.untestedMonetaryFunctions.map((fn) => (
                  <li key={`${fn.contract}-${fn.functionName}`} className="py-2">
                    <div className="font-mono font-medium text-slate-900 dark:text-slate-100">
                      {fn.contract}.{fn.functionName}
                      <span className="ml-2 text-slate-500 dark:text-slate-400">{fn.fileLine}</span>
                    </div>
                    <div className="text-slate-600 dark:text-slate-400 mt-0.5">{fn.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowBuildLog((v) => !v)}
              className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
            >
              {showBuildLog ? 'Masquer le log forge build' : 'Afficher le log forge build'}
            </button>
            {showBuildLog && (
              <pre className="mt-2 p-3 rounded-md bg-[#0D1117] text-slate-200 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                {scan.ingest.buildLog}
              </pre>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
