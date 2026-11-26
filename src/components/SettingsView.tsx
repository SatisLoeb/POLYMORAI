import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../lib/api';
import { getT } from '../i18n/translations';
import type { ChainSetting, DoctorCheck, LlmSettings, Locale } from '../types';

interface SettingsViewProps {
  locale: Locale;
  onChangeLocale: (locale: Locale) => void;
  darkMode: boolean;
  onToggleDark: () => void;
}

type SettingsTab = 'llm' | 'chains' | 'doctor' | 'account' | 'license';

export function SettingsView({
  locale,
  onChangeLocale,
  darkMode,
  onToggleDark,
}: SettingsViewProps) {
  const t = getT(locale);
  const [tab, setTab] = useState<SettingsTab>('llm');
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [chains, setChains] = useState<ChainSetting[]>([]);
  const [doctor, setDoctor] = useState<DoctorCheck[]>([]);
  const [user, setUser] = useState('admin');
  const [execution, setExecution] = useState<{ allowUnsandboxedExecution: boolean; sandboxAvailable: boolean } | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getSettings(), api.getDoctor()]).then(([settings, doc]) => {
      setLlm(settings.llm);
      setChains(settings.chains);
      setUser(settings.user);
      setExecution(settings.execution);
      setDoctor(doc.checks);
    });
  }, []);

  const handleToggleUnsandboxed = async (allow: boolean) => {
    if (!execution) return;
    setSaveError(null);
    try {
      const res = await api.saveExecution(allow);
      setExecution({ ...execution, allowUnsandboxedExecution: res.execution.allowUnsandboxedExecution });
      flashSaved(allow ? 'Exécution hors sandbox autorisée.' : 'Exécution hors sandbox interdite.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erreur.');
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    window.location.assign('/login');
  };

  const flashSaved = (msg: string) => {
    setSavedNotice(msg);
    setTimeout(() => setSavedNotice(null), 2500);
  };

  const handleSaveLlm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!llm) return;
    setSaveError(null);
    try {
      const { llm: updated } = await api.saveLlm({
        provider: llm.provider,
        model: llm.model,
        defaultTokenBudget: llm.defaultTokenBudget,
      });
      setLlm(updated);
      flashSaved('Configuration LLM enregistrée.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erreur.');
    }
  };

  const handleSaveChains = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    try {
      const { chains: updated } = await api.saveChains(chains);
      setChains(updated);
      flashSaved('Paramètres RPC & seuils enregistrés.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erreur.');
    }
  };

  const tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: 'llm', label: t.settings.llmTab },
    { key: 'chains', label: t.settings.chainsTab },
    { key: 'doctor', label: t.settings.doctorTab },
    { key: 'account', label: t.settings.accountTab },
    { key: 'license', label: t.settings.licenseTab },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
            {t.settings.title}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Configuration du modèle, des endpoints RPC par réseau, diagnostic toolchain et mentions légales.
          </p>
        </div>
        {savedNotice && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <Check className="w-4 h-4" />
            {savedNotice}
          </span>
        )}
        {saveError && (
          <span role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400">
            {saveError}
          </span>
        )}
      </div>

      <div className="border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        <nav role="tablist" aria-label="Sections des réglages" className="flex items-center gap-6 min-w-max">
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

      {tab === 'llm' && llm && (
        <form
          onSubmit={handleSaveLlm}
          className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 max-w-2xl space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Modèle de chasse (Google Gemini)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            La clé API est lue côté serveur dans la variable d’environnement <code className="font-mono">GEMINI_API_KEY</code> (Secrets AI Studio ou <code className="font-mono">.env</code>). Elle n’est jamais stockée ni renvoyée par l’API.
          </p>
          <div>
            <label htmlFor="llm-provider" className="block text-xs font-medium mb-1">
              Fournisseur
            </label>
            <input
              id="llm-provider"
              type="text"
              value={llm.provider}
              onChange={(e) => setLlm({ ...llm, provider: e.target.value })}
              className="w-full h-9 px-3 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label htmlFor="llm-model" className="block text-xs font-medium mb-1">
              Modèle principal
            </label>
            <input
              id="llm-model"
              type="text"
              value={llm.model}
              onChange={(e) => setLlm({ ...llm, model: e.target.value })}
              className="w-full h-9 px-3 text-sm font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div>
            <label htmlFor="llm-budget" className="block text-xs font-medium mb-1">
              Budget tokens par défaut (par scan)
            </label>
            <input
              id="llm-budget"
              type="number"
              step={10000}
              min={20000}
              value={llm.defaultTokenBudget}
              onChange={(e) => setLlm({ ...llm, defaultTokenBudget: Number(e.target.value) || 100000 })}
              className="w-full h-9 px-3 text-sm font-mono tabular-nums bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
            />
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            Statut secret serveur : {llm.configured ? `Configuré (${llm.keyMasked})` : 'Non configuré'}
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950"
          >
            Enregistrer
          </button>
        </form>
      )}

      {tab === 'chains' && (
        <form
          onSubmit={handleSaveChains}
          className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                RPC par réseau & seuil G0 (chain_settings)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Utilisés pour L3 (soldes natifs × feed Chainlink vérifié par <code className="font-mono">description()</code>), L4 (provenance bytecode) et <code className="font-mono">FORK_RPC_URL</code> des PoC qui forkent. Le serveur vérifie <code className="font-mono">eth_chainId</code> avant toute mesure.
              </p>
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950"
            >
              Enregistrer les réseaux
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {chains.map((ch, idx) => (
              <div key={ch.chain} className="py-4 grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {ch.label}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    {ch.chain} · {ch.rpcConfigured ? 'Configuré' : 'Non configuré'}
                  </div>
                </div>
                <div>
                  <label htmlFor={`rpc-${ch.chain}`} className="block text-xs font-medium mb-1">
                    Endpoint RPC
                  </label>
                  <input
                    id={`rpc-${ch.chain}`}
                    type="text"
                    value={ch.rpcUrl}
                    placeholder={`https://${ch.chain}-mainnet.example/v2/...`}
                    onChange={(e) => {
                      const next = [...chains];
                      next[idx] = {
                        ...ch,
                        rpcUrl: e.target.value,
                        rpcConfigured: Boolean(e.target.value.trim()),
                      };
                      setChains(next);
                    }}
                    className="w-full h-9 px-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor={`min-tvl-${ch.chain}`} className="block text-xs font-medium mb-1">
                    Seuil TVL G0 (USD)
                  </label>
                  <input
                    id={`min-tvl-${ch.chain}`}
                    type="number"
                    value={ch.minFundsAtRiskUsd}
                    onChange={(e) => {
                      const next = [...chains];
                      next[idx] = { ...ch, minFundsAtRiskUsd: Number(e.target.value) || 0 };
                      setChains(next);
                    }}
                    className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor={`chainid-${ch.chain}`} className="block text-xs font-medium mb-1">
                    chainId attendu
                  </label>
                  <input
                    id={`chainid-${ch.chain}`}
                    type="number"
                    value={ch.chainId ?? ''}
                    onChange={(e) => {
                      const next = [...chains];
                      next[idx] = { ...ch, chainId: e.target.value ? Number(e.target.value) : null };
                      setChains(next);
                    }}
                    className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor={`feed-${ch.chain}`} className="block text-xs font-medium mb-1">
                    Feed {ch.nativeUsdFeedDescription}
                  </label>
                  <input
                    id={`feed-${ch.chain}`}
                    type="text"
                    value={ch.nativeUsdFeed}
                    onChange={(e) => {
                      const next = [...chains];
                      next[idx] = { ...ch, nativeUsdFeed: e.target.value.trim() };
                      setChains(next);
                    }}
                    className="w-full h-9 px-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>
            ))}
          </div>
        </form>
      )}

      {tab === 'doctor' && (
        <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Diagnostic Toolchain (polymorphe doctor)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Chaque ligne est le résultat d’un <code className="font-mono">--version</code> exécuté sur ce serveur ; bwrap est validé par une vraie création de namespaces.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold">
                  <th className="py-3 px-4">Outil</th>
                  <th className="py-3 px-4">Statut</th>
                  <th className="py-3 px-4">Version</th>
                  <th className="py-3 px-4">Rôle / Commande d’install</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {doctor.map((item) => (
                  <tr key={item.tool}>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                      {item.tool}
                      {item.required && <span className="ml-1.5 text-slate-400 font-normal">(requis)</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-mono font-semibold ${
                          item.installed
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : item.required
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {item.installed ? 'OK' : 'Manquant'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">
                      {item.version}
                    </td>
                    <td className="py-3 px-4 space-y-1">
                      <div className="text-slate-700 dark:text-slate-300">{item.impact}</div>
                      {!item.installed && (
                        <code className="block font-mono text-[11px] text-slate-500">
                          {item.installCmd}
                        </code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {execution && (
            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-900 dark:text-white">
                Sandbox d’exécution : {execution.sandboxAvailable ? 'bwrap opérationnel' : 'indisponible'}
              </div>
              <p className="text-slate-600 dark:text-slate-400">
                Les builds et PoC exécutent le code du dépôt cible. Sans sandbox, ce code tourne avec les droits du serveur (accès à vos fichiers, clés, wallets).
              </p>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={execution.allowUnsandboxedExecution}
                  onChange={(e) => handleToggleUnsandboxed(e.target.checked)}
                />
                <span>Autoriser l’exécution hors sandbox quand bwrap est indisponible</span>
              </label>
            </div>
          )}
        </section>
      )}

      {tab === 'account' && (
        <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 max-w-2xl space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Compte opérateur & préférences d’interface
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Session active : <span className="font-mono font-semibold text-slate-900 dark:text-white">{user}</span>
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-3 h-8 px-3 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Se déconnecter
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label htmlFor="ui-locale" className="block text-xs font-medium mb-1.5">
                Langue de l’interface (rapports exportés en anglais)
              </label>
              <select
                id="ui-locale"
                value={locale}
                onChange={(e) => onChangeLocale(e.target.value as Locale)}
                className="w-full h-9 px-3 text-xs bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              >
                <option value="fr">Français (défaut)</option>
                <option value="en">English</option>
              </select>
            </div>
            <div>
              <div className="text-xs font-medium mb-1.5">Thème visuel</div>
              <button
                type="button"
                onClick={onToggleDark}
                className="h-9 px-4 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {darkMode ? 'Basculer vers le thème clair' : 'Basculer vers le thème sombre'}
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === 'license' && (
        <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 max-w-2xl space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Licence & mentions légales (AGPL-3.0)
          </h2>
          <p>
            <strong>Polymorphe</strong> est distribué sous licence{' '}
            <strong>GNU Affero General Public License v3.0 (AGPL-3.0)</strong>, conformément à l’article §5(d).
          </p>
          <p>
            <strong>Crédit copyright upstream :</strong> basé sur des travaux initiaux de{' '}
            <span className="font-mono font-semibold text-slate-900 dark:text-white">Autumn-27</span>. Les fichiers <code className="font-mono">LICENSE</code> et <code className="font-mono">NOTICE</code> complets accompagnent le dépôt source.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <strong>Absence de garantie :</strong> ce logiciel est fourni « tel quel », sans aucune garantie d’aucune sorte, explicite ou implicite. Le code source correspondant est accessible depuis le dépôt local Polymorphe.
          </p>
        </section>
      )}
    </div>
  );
}
