import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { api } from '../lib/api';
import type { DoctorCheck } from '../types';

interface SetupViewProps {
  onComplete: () => void;
}

export function SetupView({ onComplete }: SetupViewProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [setupToken, setSetupToken] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [llmModel, setLlmModel] = useState('gemini-4-neon');
  const [ethRpc, setEthRpc] = useState('');
  const [arbRpc, setArbRpc] = useState('');
  const [doctor, setDoctor] = useState<DoctorCheck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  // The doctor endpoint needs a session: it is fetched once the instance has been claimed.
  useEffect(() => {
    if (step === 4) api.getDoctor().then((d) => setDoctor(d.checks)).catch(() => undefined);
  }, [step]);

  const handleNext = () => {
    setError(null);
    if (step === 1) {
      if (!setupToken.trim()) {
        setError('Le jeton d’initialisation est requis (console du serveur ou fichier setup-token).');
        return;
      }
      if (password.length < 12) {
        setError('Le mot de passe opérateur doit contenir au moins 12 caractères.');
        return;
      }
      if (password !== passwordConfirm) {
        setError('Les deux mots de passe ne correspondent pas.');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleClaim = async () => {
    setError(null);
    setFinishing(true);
    try {
      await api.completeSetup({
        setupToken: setupToken.trim(),
        password,
        llmModel,
        chainRpcs: [
          { chain: 'ethereum', rpcUrl: ethRpc.trim() },
          { chain: 'arbitrum', rpcUrl: arbRpc.trim() },
        ].filter((c) => c.rpcUrl),
      });
      setPassword('');
      setPasswordConfirm('');
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Initialisation refusée.');
    } finally {
      setFinishing(false);
    }
  };

  const handleFinish = () => onComplete();

  const stepLabels = [
    '1. Mot de passe',
    '2. Modèle LLM',
    '3. RPC par réseau',
    '4. Doctor toolchain',
  ];

  return (
    <div className="max-w-2xl mx-auto py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
          Initialisation de Polymorphe
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Quatre étapes rapides avant votre premier scan.
        </p>
      </div>

      {/* Stepper Header */}
      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {stepLabels.map((label, idx) => {
          const num = idx + 1;
          const active = step === num;
          const done = step > num;
          return (
            <li
              key={label}
              className={`pb-2 border-b-2 font-medium ${
                active
                  ? 'border-blue-700 dark:border-blue-400 text-slate-950 dark:text-white font-semibold'
                  : done
                    ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                    : 'border-slate-200 dark:border-slate-800 text-slate-500'
              }`}
            >
              {label}
            </li>
          );
        })}
      </ol>

      <div className="bg-white dark:bg-[#121722] border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-5">
        {error && (
          <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Compte opérateur local (admin)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Définissez un mot de passe pour protéger l’interface et signer les validations U-1. Le jeton d’initialisation est affiché au démarrage du serveur (et écrit dans <code className="font-mono">&lt;data&gt;/setup-token</code>) : il empêche un tiers de revendiquer l’instance avant vous.
            </p>
            <div>
              <label htmlFor="setup-token" className="block text-xs font-medium mb-1">
                Jeton d’initialisation
              </label>
              <input
                id="setup-token"
                type="text"
                autoComplete="off"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="setup-pass" className="block text-xs font-medium mb-1">
                Mot de passe opérateur
              </label>
              <input
                id="setup-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="12 caractères minimum"
                className="w-full h-10 px-3 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="setup-pass-confirm" className="block text-xs font-medium mb-1">
                Confirmation
              </label>
              <input
                id="setup-pass-confirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Modèle LLM de chasse (Google Gemini)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              La clé API est lue côté serveur dans <code className="font-mono">GEMINI_API_KEY</code> (Secrets AI Studio ou <code className="font-mono">.env</code>). Sans clé, la chasse reste manuelle : aucun brouillon LLM n’est simulé.
            </p>
            <div>
              <label htmlFor="setup-model" className="block text-xs font-medium mb-1">
                Modèle par défaut
              </label>
              <input
                id="setup-model"
                type="text"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Endpoints RPC par réseau (optionnel)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Vous pouvez sauter cette étape : si un programme déployé a besoin d’un RPC, Polymorphe le demandera une fois au gate G0 puis le mémorisera.
            </p>
            <div>
              <label htmlFor="setup-eth-rpc" className="block text-xs font-medium mb-1">
                Ethereum Mainnet RPC
              </label>
              <input
                id="setup-eth-rpc"
                type="text"
                value={ethRpc}
                onChange={(e) => setEthRpc(e.target.value)}
                placeholder="https://…"
                className="w-full h-10 px-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="setup-arb-rpc" className="block text-xs font-medium mb-1">
                Arbitrum One RPC (optionnel)
              </label>
              <input
                id="setup-arb-rpc"
                type="text"
                value={arbRpc}
                onChange={(e) => setArbRpc(e.target.value)}
                placeholder="https://…"
                className="w-full h-10 px-3 text-xs font-mono bg-[#F8F9FB] dark:bg-[#0B0E14] border border-slate-300 dark:border-slate-700 rounded-md"
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Vérification de la toolchain (Doctor)
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {doctor.map((item) => (
                <div key={item.tool} className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">
                      {item.tool}
                    </span>
                    <span className="ml-2 text-slate-500">{item.version}</span>
                  </div>
                  <span
                    className={`font-mono font-semibold ${
                      item.installed
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {item.installed ? 'OK' : item.required ? 'Requis manquant' : 'Optionnel manquant'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          {step > 1 && step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Précédent</span>
            </button>
          ) : (
            <span />
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950"
            >
              <span>Continuer</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : step === 3 ? (
            <button
              type="button"
              disabled={finishing}
              onClick={handleClaim}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 text-white"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{finishing ? 'Initialisation…' : 'Initialiser l’instance'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-md bg-blue-700 hover:bg-blue-800 text-white"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>Nouveau scan</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
