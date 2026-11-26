import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AdvancedSnapshot } from '../types';

type AdvTab = 'llm_pool' | 'agents' | 'skills' | 'mcp' | 'logs' | 'traffic';

export function AdvancedView() {
  const [data, setData] = useState<AdvancedSnapshot | null>(null);
  const [tab, setTab] = useState<AdvTab>('agents');

  useEffect(() => {
    api.getAdvanced().then(setData);
  }, []);

  if (!data) {
    return (
      <div className="h-64 bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
    );
  }

  const tabs: Array<{ key: AdvTab; label: string }> = [
    { key: 'agents', label: 'Agents & Prompts' },
    { key: 'mcp', label: 'Serveurs MCP' },
    { key: 'skills', label: 'Skills SC' },
    { key: 'llm_pool', label: 'Pool LLM' },
    { key: 'logs', label: 'Logs serveur' },
    { key: 'traffic', label: 'Trafic dApp capturé' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
          Avancé (Smart Contract)
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Sous-ensemble dédié à l’audit SC : agents, verrouillages de doctrine, outils MCP, pool LLM, logs et trafic capturé.
        </p>
      </div>

      <div className="border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        <nav role="tablist" aria-label="Sections avancées" className="flex items-center gap-6 min-w-max">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === item.key
                  ? 'border-blue-700 dark:border-blue-400 text-slate-950 dark:text-white font-semibold'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'agents' && (
        <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800/80">
          {data.agents.map((ag) => (
            <div key={ag.name} className="p-5 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                  {ag.name}
                </div>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {ag.lock}
                </span>
              </div>
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">{ag.role}</div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {ag.guidanceExcerpt}
              </p>
            </div>
          ))}
        </div>
      )}

      {tab === 'mcp' && (
        <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                <th className="py-3 px-4">Outil MCP</th>
                <th className="py-3 px-4">Gate appliquée</th>
                <th className="py-3 px-4">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {data.mcpTools.map((tool) => (
                <tr key={tool.name}>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                    {tool.name}
                  </td>
                  <td className="py-3 px-4 font-mono text-blue-700 dark:text-blue-400">
                    {tool.gate}
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                    {tool.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'skills' && (
        <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800/80">
          {data.skills.map((sk) => (
            <div key={sk.name} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                  {sk.name}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{sk.description}</p>
              </div>
              <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">
                {sk.scope} · Actif
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === 'llm_pool' && (
        <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                <th className="py-3 px-4">Slot</th>
                <th className="py-3 px-4">Fournisseur</th>
                <th className="py-3 px-4">Modèle</th>
                <th className="py-3 px-4">Affectation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {data.llmPool.map((slot) => (
                <tr key={slot.id}>
                  <td className="py-3 px-4 font-mono">{slot.id}</td>
                  <td className="py-3 px-4">{slot.provider}</td>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                    {slot.model}
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{slot.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'logs' && (
        <div className="bg-[#0D1117] border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-200 space-y-2 max-h-96 overflow-y-auto">
          {data.serverLogs.map((l, idx) => (
            <div key={idx} className="flex items-start gap-3">
              <span className="text-slate-500 tabular-nums shrink-0">{l.ts}</span>
              <span className={`w-28 shrink-0 ${l.level === 'warn' ? 'text-amber-400' : 'text-blue-400'}`}>
                [{l.component}]
              </span>
              <span>{l.msg}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'traffic' && (
        <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800/80">
          {data.capturedTraffic.map((ev) => (
            <div key={ev.id} className="p-4 space-y-1 text-xs">
              <div className="font-mono text-slate-900 dark:text-white font-semibold">
                {ev.method} · {ev.functionSig}
              </div>
              <div className="font-mono text-slate-500">
                {ev.origin} → {ev.contractAddress} ({ev.anvilTempdir})
              </div>
              <div className="text-slate-600 dark:text-slate-400">{ev.notes}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
