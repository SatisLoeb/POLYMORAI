import type { ScanRun } from '../../types';

interface DappSeamTabProps {
  scan: ScanRun;
}

export function DappSeamTab({ scan }: DappSeamTabProps) {
  return (
    <section className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Capture dApp & coutures web2 ↔ web3
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Non implémenté dans cette version : aucune capture dApp n’est effectuée ni simulée.
        </p>
      </div>

      {scan.seamEvents.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400 space-y-2">
          <p>Aucune capture dApp enregistrée pour ce scan.</p>
          <p className="text-xs">
            Pour une couture web2 ↔ web3, créez une hypothèse « seam » dans l’onglet Chasse et prouvez-la par un PoC Foundry.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {scan.seamEvents.map((ev) => (
            <div key={ev.id} className="p-5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {ev.origin} · <span className="text-slate-900 dark:text-white font-semibold">{ev.method}</span> · {ev.contractAddress}
                </div>
                <span
                  className={`font-mono text-xs font-semibold ${
                    ev.replayStatus === 'replayed_ok'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {ev.replayStatus === 'replayed_ok' ? 'Rejoué Anvil OK' : ev.replayStatus}
                </span>
              </div>
              <div className="text-xs font-mono text-slate-800 dark:text-slate-200">
                {ev.functionSig}
              </div>
              <pre className="p-3 rounded-md bg-[#0D1117] text-slate-300 text-xs font-mono overflow-x-auto">
                {ev.calldataPreview}
              </pre>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                <span>{ev.notes}</span>
                <span className="font-mono text-slate-500">tempdir: {ev.anvilTempdir}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
