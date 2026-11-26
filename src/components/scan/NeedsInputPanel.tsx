import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import type { ChainSetting, Finding, ScanRun } from '../../types';

const inputCls =
  'w-full h-9 px-3 text-xs font-mono bg-white dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md';
const areaCls =
  'w-full p-2.5 text-xs font-mono bg-white dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md';
const btnCls =
  'h-9 px-4 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950 whitespace-nowrap disabled:opacity-60';

interface Props {
  scan: ScanRun;
  onUpdated: (data: { scan: ScanRun; findings: Finding[] }) => void;
}

/** Operator attestation of the program page. Every field is copied from the page, never inferred. */
export function ProgramScopeForm({ scan, onUpdated }: Props) {
  const prev = scan.programScope;
  const [chains, setChains] = useState<ChainSetting[]>([]);
  const [sourceUrl, setSourceUrl] = useState(prev?.sourceUrl ?? scan.targetUrl);
  const [status, setStatus] = useState<'active' | 'paused' | 'closed'>(prev?.status ?? 'active');
  const [impacts, setImpacts] = useState((prev?.verbatimImpacts ?? []).join('\n'));
  const [maxBounty, setMaxBounty] = useState(prev?.maxBountyUsd != null ? String(prev.maxBountyUsd) : '');
  const [listedAt, setListedAt] = useState(prev?.listedAt ?? '');
  const [knownIssues, setKnownIssues] = useState((prev?.knownIssues ?? []).join('\n'));
  const [scopeKind, setScopeKind] = useState<'deployed' | 'commit_anchored'>(prev?.scopeKind ?? 'deployed');
  const [chain, setChain] = useState(prev?.chain ?? 'ethereum');
  const [addresses, setAddresses] = useState((prev?.scopeAddresses ?? []).join('\n'));
  const [repoUrl, setRepoUrl] = useState(prev?.repoUrl ?? '');
  const [pinnedCommit, setPinnedCommit] = useState(prev?.pinnedCommit ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => setChains(s.chains)).catch(() => undefined);
  }, []);

  const split = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.submitProgramScope(scan.id, {
        sourceUrl: sourceUrl.trim(),
        status,
        verbatimImpacts: split(impacts),
        maxBountyUsd: maxBounty.trim() ? Number(maxBounty) : null,
        listedAt: listedAt || undefined,
        knownIssues: split(knownIssues),
        scopeKind,
        chain,
        scopeAddresses: split(addresses),
        repoUrl: repoUrl.trim() || undefined,
        pinnedCommit: pinnedCommit.trim() || undefined,
      });
      onUpdated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attestation refusée.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      <label className="space-y-1 md:col-span-2">
        <span className="font-medium">Page source (URL exacte du scope)</span>
        <input className={inputCls} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} required />
      </label>
      <label className="space-y-1">
        <span className="font-medium">Statut du programme (L1)</span>
        <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="active">Actif</option>
          <option value="paused">En pause</option>
          <option value="closed">Fermé</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="font-medium">Prime max (USD)</span>
        <input className={inputCls} type="number" min={0} value={maxBounty} onChange={(e) => setMaxBounty(e.target.value)} />
      </label>
      <label className="space-y-1 md:col-span-2">
        <span className="font-medium">Impacts in scope — une ligne par impact, mot pour mot (L2 / R12)</span>
        <textarea className={areaCls} rows={4} value={impacts} onChange={(e) => setImpacts(e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="font-medium">Date d’ajout du programme / de l’asset (L5)</span>
        <input className={inputCls} type="date" value={listedAt} onChange={(e) => setListedAt(e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="font-medium">Type de scope</span>
        <select className={inputCls} value={scopeKind} onChange={(e) => setScopeKind(e.target.value as typeof scopeKind)}>
          <option value="deployed">Déployé (bug bounty)</option>
          <option value="commit_anchored">Ancré sur commit (contest)</option>
        </select>
      </label>
      <label className="space-y-1 md:col-span-2">
        <span className="font-medium">Known issues / exclusions — une par ligne (L6 / R16)</span>
        <textarea className={areaCls} rows={3} value={knownIssues} onChange={(e) => setKnownIssues(e.target.value)} />
      </label>
      {scopeKind === 'deployed' && (
        <>
          <label className="space-y-1">
            <span className="font-medium">Chaîne</span>
            <select className={inputCls} value={chain} onChange={(e) => setChain(e.target.value)}>
              {(chains.length ? chains.map((c) => c.chain) : [chain]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-medium">Adresses in scope — une par ligne (L3 / L4)</span>
            <textarea className={areaCls} rows={3} value={addresses} onChange={(e) => setAddresses(e.target.value)} />
          </label>
        </>
      )}
      <label className="space-y-1">
        <span className="font-medium">Dépôt in scope (https)</span>
        <input className={inputCls} value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/org/repo" />
      </label>
      <label className="space-y-1">
        <span className="font-medium">Commit épinglé (SHA)</span>
        <input className={inputCls} value={pinnedCommit} onChange={(e) => setPinnedCommit(e.target.value)} />
      </label>
      <div className="md:col-span-2 flex items-center gap-3">
        <button type="submit" disabled={busy} className={btnCls}>
          {busy ? 'Enregistrement…' : 'Attester et réévaluer G0'}
        </button>
        {error && (
          <span role="alert" className="text-red-700 dark:text-red-400 font-medium">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

function RpcForm({ scan, onUpdated }: Props) {
  const [rpc, setRpc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chain = scan.g0.missingChain || scan.programScope?.chain || scan.chain;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onUpdated(await api.provideScanInput(scan.id, { rpcUrl: rpc.trim(), chain }));
      setRpc('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'URL RPC invalide.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2.5">
      <label htmlFor="inline-rpc-input" className="sr-only">
        Endpoint RPC {chain}
      </label>
      <input
        id="inline-rpc-input"
        type="url"
        required
        value={rpc}
        onChange={(e) => setRpc(e.target.value)}
        placeholder={`RPC ${chain} (https://…)`}
        className={`flex-1 ${inputCls}`}
      />
      <button type="submit" disabled={busy} className={btnCls}>
        {busy ? 'Mesure…' : 'Enregistrer et mesurer'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400 font-medium self-center">
          {error}
        </span>
      )}
    </form>
  );
}

function FundsForm({ scan, onUpdated }: Props) {
  const [usd, setUsd] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onUpdated(await api.submitFundsAttestation(scan.id, { usd: Number(usd), sourceUrl: source.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attestation refusée.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2.5">
      <input
        type="number"
        min={0}
        required
        value={usd}
        onChange={(e) => setUsd(e.target.value)}
        placeholder="TVL en USD"
        className={`sm:w-48 ${inputCls}`}
      />
      <input
        type="url"
        required
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="Source (DefiLlama, dashboard, lien explorer…)"
        className={`flex-1 ${inputCls}`}
      />
      <button type="submit" disabled={busy} className={btnCls}>
        {busy ? 'Enregistrement…' : 'Attester le TVL'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400 font-medium self-center">
          {error}
        </span>
      )}
    </form>
  );
}

export function NeedsInputPanel({ scan, onUpdated }: Props) {
  const kind = scan.g0.missingInputKind;
  const titles: Record<string, { title: string; body: string }> = {
    program_scope: {
      title: 'Scope du programme à attester',
      body: 'Recopiez depuis la page du programme : statut, impacts in scope mot pour mot, adresses, dépôt. Polymorphe n’infère rien depuis l’URL.',
    },
    rpc: {
      title: `RPC ${scan.g0.missingChain || scan.chain} manquant`,
      body: 'Scope déployé : un RPC est nécessaire pour lire bytecode et soldes au bloc courant (L3 / L4). Il est mémorisé dans les réglages chaîne.',
    },
    funds_attestation: {
      title: 'Fonds à risque non établis',
      body: 'La mesure on-chain ne couvre que les soldes natifs (borne basse). Attestez le TVL avec une source vérifiable : sous le seuil, G0 bloquera (R1).',
    },
    build_fix: {
      title: 'Build à corriger',
      body: 'Le build a échoué : corrigez le commit épinglé ou le dépôt, puis relancez.',
    },
  };
  const t = titles[kind ?? 'program_scope'];
  return (
    <section className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800/70 rounded-lg p-5 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Entrée requise — {t.title}</h2>
          <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">{t.body}</p>
        </div>
      </div>
      <div className="pl-7">
        {kind === 'program_scope' && <ProgramScopeForm scan={scan} onUpdated={onUpdated} />}
        {kind === 'rpc' && <RpcForm scan={scan} onUpdated={onUpdated} />}
        {kind === 'funds_attestation' && <FundsForm scan={scan} onUpdated={onUpdated} />}
      </div>
    </section>
  );
}
