import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { EnrichedFinding } from '../lib/api';
import type { FindingSeverity, FindingStatus } from '../types';
import { FindingStatusLabel, SeverityLabel } from './StatusText';

interface FindingsListViewProps {
  findings: EnrichedFinding[];
  loading: boolean;
  onOpenFinding: (findingId: string) => void;
  onOpenScan: (scanId: string) => void;
}

export function FindingsListView({
  findings,
  loading,
  onOpenFinding,
  onOpenScan,
}: FindingsListViewProps) {
  const [query, setQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | FindingSeverity>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FindingStatus>('all');

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
      if (statusFilter !== 'all' && f.status !== statusFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          f.title.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q) ||
          f.programName.toLowerCase().includes(q) ||
          f.affectedFileLine.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [findings, severityFilter, statusFilter, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
          Findings
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Candidats vérifiés en clean-room (LOCK #5) et validations opérateur (U-1) sur l’ensemble des scans.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800/80 rounded-md">
            {(
              [
                ['all', 'Tous'],
                ['candidate', 'Candidats'],
                ['operator_confirmed', 'Validés'],
                ['hold', 'En attente'],
                ['rejected', 'Rejetés'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setStatusFilter(val)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  statusFilter === val
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filtrer par sévérité"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as 'all' | FindingSeverity)}
            className="h-9 px-3 text-xs bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-md"
          >
            <option value="all">Toutes sévérités</option>
            <option value="critical">Critique</option>
            <option value="high">Haute</option>
            <option value="medium">Moyenne</option>
            <option value="low">Basse</option>
          </select>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un finding, fichier…"
            aria-label="Rechercher dans les findings"
            className="w-full h-9 pl-8 pr-3 text-xs bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:border-blue-600"
          />
        </div>
      </div>

      {/* Findings Table */}
      <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Aucun finding ne correspond aux filtres actifs.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">ID / Titre</th>
                  <th className="py-3 px-4">Cible</th>
                  <th className="py-3 px-4">Sévérité</th>
                  <th className="py-3 px-4">Statut</th>
                  <th className="py-3 px-4">PoC & Disconfirmer</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                {filtered.map((f) => (
                  <tr
                    key={f.id}
                    className="hover:bg-slate-50/90 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-4 max-w-md">
                      <button
                        type="button"
                        onClick={() => onOpenFinding(f.id)}
                        className="text-left group block w-full"
                      >
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {f.id} · {f.affectedFileLine}
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-400 mt-0.5">
                          {f.title}
                        </div>
                      </button>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenScan(f.scanId)}
                        className="text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-400 hover:underline"
                      >
                        {f.programName}
                      </button>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {f.targetKind === 'program' ? 'Programme' : 'Mode labo (L9)'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <SeverityLabel severity={f.severity} />
                    </td>
                    <td className="py-3.5 px-4">
                      <FindingStatusLabel status={f.status} />
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      <span>{f.cleanRoomVerified ? 'PoC rejoué' : 'En attente'}</span>
                      <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>{f.disconfirmer.status === 'clear' ? 'R13 OK' : 'Signalé'}</span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenFinding(f.id)}
                        className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                      >
                        Examiner
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
