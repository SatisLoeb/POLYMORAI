import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../../lib/api';
import { getT } from '../../i18n/translations';
import type { Locale, ScanRun } from '../../types';

interface ThreatModelTabProps {
  scan: ScanRun;
  locale: Locale;
  onScanUpdated: (scan: ScanRun) => void;
}

function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function ThreatModelTab({ scan, locale, onScanUpdated }: ThreatModelTabProps) {
  const t = getT(locale);
  const [summary, setSummary] = useState(scan.threatModel.summary);
  const [verbatimImpacts, setVerbatimImpacts] = useState(scan.threatModel.verbatimImpacts.join('\n'));
  const [exclusions, setExclusions] = useState(scan.threatModel.exclusions.join('\n'));
  const [tombstones, setTombstones] = useState(scan.threatModel.tombstones.join('\n'));
  const [invariants, setInvariants] = useState(scan.threatModel.invariants.join('\n'));
  const [trustBoundaries, setTrustBoundaries] = useState(scan.threatModel.trustBoundaries.join('\n'));
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSummary(scan.threatModel.summary);
    setVerbatimImpacts(scan.threatModel.verbatimImpacts.join('\n'));
    setExclusions(scan.threatModel.exclusions.join('\n'));
    setTombstones(scan.threatModel.tombstones.join('\n'));
    setInvariants(scan.threatModel.invariants.join('\n'));
    setTrustBoundaries(scan.threatModel.trustBoundaries.join('\n'));
  }, [scan.id, scan.threatModel.updatedAt]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedFeedback(false);
    try {
      const { scan: updated } = await api.updateThreatModel(scan.id, {
        summary: summary.trim(),
        verbatimImpacts: linesToArray(verbatimImpacts),
        exclusions: linesToArray(exclusions),
        tombstones: linesToArray(tombstones),
        invariants: linesToArray(invariants),
        trustBoundaries: linesToArray(trustBoundaries),
      });
      onScanUpdated(updated);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateAI = async () => {
    setGenerating(true);
    setError(null);
    try {
      const { scan: updated } = await api.generateThreatModelAI(scan.id);
      onScanUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’appel gemini-4-neon.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Threat model structuré
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Provenance :{' '}
            <span
              className={
                scan.threatModel.provenance === 'operator_approved'
                  ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                  : 'font-semibold text-amber-700 dark:text-amber-400'
              }
            >
              {scan.threatModel.provenance === 'operator_approved'
                ? t.scan.threatModelProvenanceOp
                : t.scan.threatModelProvenanceAuto}
            </span>
            <span className="mx-1.5" aria-hidden="true">
              ·
            </span>
            Éditable à tout moment (fusion partielle G10 ; relu par le planner).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {savedFeedback && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              {t.scan.saved}
            </span>
          )}
          <button
            type="button"
            disabled={generating || saving}
            onClick={handleGenerateAI}
            className="px-3.5 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 disabled:opacity-60 whitespace-nowrap"
          >
            {generating ? 'Analyse gemini-4-neon…' : 'Affiner (gemini-4-neon)'}
          </button>
          <button
            type="submit"
            disabled={saving || generating}
            className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap"
          >
            {saving ? 'Enregistrement…' : t.scan.saveThreatModel}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <div>
        <label htmlFor="tm-summary" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          Synthèse de la surface d’attaque
        </label>
        <textarea
          id="tm-summary"
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="w-full p-3 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:border-blue-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <label htmlFor="tm-invariants" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Invariants critiques (1 par ligne)
          </label>
          <textarea
            id="tm-invariants"
            rows={5}
            value={invariants}
            onChange={(e) => setInvariants(e.target.value)}
            className="w-full p-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:border-blue-600"
          />
        </div>

        <div>
          <label htmlFor="tm-boundaries" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Frontières de confiance (1 par ligne)
          </label>
          <textarea
            id="tm-boundaries"
            rows={5}
            value={trustBoundaries}
            onChange={(e) => setTrustBoundaries(e.target.value)}
            className="w-full p-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:border-blue-600"
          />
        </div>

        <div>
          <label htmlFor="tm-impacts" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Impacts verbatim du programme (R12 — 1 par ligne)
          </label>
          <textarea
            id="tm-impacts"
            rows={4}
            value={verbatimImpacts}
            onChange={(e) => setVerbatimImpacts(e.target.value)}
            placeholder={scan.targetKind !== 'program' ? 'Mode labo : aucun impact inventé par défaut.' : ''}
            className="w-full p-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:border-blue-600"
          />
        </div>

        <div>
          <label htmlFor="tm-exclusions" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Exclusions & OOS (1 par ligne)
          </label>
          <textarea
            id="tm-exclusions"
            rows={4}
            value={exclusions}
            onChange={(e) => setExclusions(e.target.value)}
            className="w-full p-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:border-blue-600"
          />
        </div>
      </div>

      <div>
        <label htmlFor="tm-tombstones" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          Tombstones historiques injectés (R16 — 1 par ligne)
        </label>
        <textarea
          id="tm-tombstones"
          rows={3}
          value={tombstones}
          onChange={(e) => setTombstones(e.target.value)}
          className="w-full p-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:border-blue-600"
        />
      </div>
    </form>
  );
}
