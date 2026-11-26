import { useCallback, useEffect, useState } from 'react';
import { api, AUTH_REQUIRED_EVENT, type EnrichedFinding, type ScanSummary } from './lib/api';
import type { Locale } from './types';
import { Layout, type RouteState } from './components/Layout';
import { HomeView } from './components/HomeView';
import { ScanView } from './components/ScanView';
import { FindingDetailView } from './components/FindingDetailView';
import { FindingsListView } from './components/FindingsListView';
import { SettingsView } from './components/SettingsView';
import { AdvancedView } from './components/AdvancedView';
import { SetupView } from './components/SetupView';
import { LoginView } from './components/LoginView';

function parseLocation(): RouteState {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  const id = params.get('id') || undefined;
  const clean = pathname.replace(/\/+$/, '') || '/';

  if (clean === '/scan' && id) return { path: '/scan', id };
  if (clean === '/finding' && id) return { path: '/finding', id };
  if (clean === '/findings') return { path: '/findings' };
  if (clean === '/settings') return { path: '/settings' };
  if (clean === '/advanced') return { path: '/advanced' };
  if (clean === '/setup' && params.get('autostart') !== '1') return { path: '/setup' };
  if (clean === '/login') return { path: '/login' };
  return { path: '/' };
}

function routeToUrl(next: RouteState): string {
  if (next.path === '/scan' && next.id) {
    return `/scan?id=${encodeURIComponent(next.id)}`;
  }
  if (next.path === '/finding' && next.id) {
    return `/finding?id=${encodeURIComponent(next.id)}`;
  }
  return next.path;
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseLocation());
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      return window.localStorage.getItem('polymorphe_locale') === 'en' ? 'en' : 'fr';
    } catch {
      return 'fr';
    }
  });
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('polymorphe_theme') === 'dark';
    } catch {
      return false;
    }
  });

  const [authChecked, setAuthChecked] = useState(false);
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [findings, setFindings] = useState<EnrichedFinding[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      window.localStorage.setItem('polymorphe_theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem('polymorphe_locale', locale);
    } catch {
      // ignore
    }
  }, [locale]);

  const refreshLists = useCallback(async () => {
    try {
      const [sRes, fRes] = await Promise.all([api.listScans(), api.listFindings()]);
      setScans(sRes.scans);
      setFindings(fRes.findings);
    } catch {
      // 401 is handled by the auth-required listener
    } finally {
      setLoadingLists(false);
    }
  }, []);

  // Auth gate: a fresh instance goes to /setup, an anonymous browser to /login.
  useEffect(() => {
    const gate = async () => {
      try {
        const status = await api.authStatus();
        if (status.setupRequired) {
          window.history.replaceState({}, '', '/setup');
          setRoute({ path: '/setup' });
        } else if (!status.authenticated) {
          window.history.replaceState({}, '', '/login');
          setRoute({ path: '/login' });
        } else {
          await refreshLists();
        }
      } finally {
        setAuthChecked(true);
      }
    };
    gate();
    const onAuthRequired = () => {
      window.history.replaceState({}, '', '/login');
      setRoute({ path: '/login' });
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [refreshLists]);

  useEffect(() => {
    const onPop = () => setRoute(parseLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: RouteState) => {
    const url = routeToUrl(next);
    window.history.pushState({}, '', url);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const currentScanName =
    route.path === '/scan'
      ? scans.find((s) => s.id === route.id)?.programName || route.id || 'Scan'
      : '';

  const breadcrumb: string[] = (() => {
    switch (route.path) {
      case '/':
        return ['Polymorphe', 'Scans'];
      case '/scan':
        return ['Polymorphe', 'Scans', currentScanName];
      case '/findings':
        return ['Polymorphe', 'Findings'];
      case '/finding':
        return ['Polymorphe', 'Findings', route.id || 'Détail'];
      case '/settings':
        return ['Polymorphe', 'Réglages'];
      case '/advanced':
        return ['Polymorphe', 'Avancé'];
      case '/setup':
        return ['Polymorphe', 'Initialisation'];
      case '/login':
        return ['Polymorphe', 'Connexion'];
    }
  })();

  if (!authChecked) {
    return <div className="min-h-screen bg-[#F8F9FB] dark:bg-[#0B0E14]" />;
  }

  return (
    <Layout
      route={route}
      navigate={navigate}
      breadcrumb={breadcrumb}
      locale={locale}
      onToggleLocale={() => setLocale((l) => (l === 'fr' ? 'en' : 'fr'))}
      darkMode={darkMode}
      onToggleDark={() => setDarkMode((d) => !d)}
    >
      {route.path === '/' && (
        <HomeView
          scans={scans}
          loading={loadingLists}
          locale={locale}
          onScanCreated={(scanId) => {
            refreshLists();
            navigate({ path: '/scan', id: scanId });
          }}
          onOpenScan={(scanId) => navigate({ path: '/scan', id: scanId })}
        />
      )}

      {route.path === '/scan' && route.id && (
        <ScanView
          scanId={route.id}
          locale={locale}
          onOpenFinding={(findingId) => navigate({ path: '/finding', id: findingId })}
          onBackHome={() => navigate({ path: '/' })}
          onScanMutated={refreshLists}
        />
      )}

      {route.path === '/findings' && (
        <FindingsListView
          findings={findings}
          loading={loadingLists}
          onOpenFinding={(findingId) => navigate({ path: '/finding', id: findingId })}
          onOpenScan={(scanId) => navigate({ path: '/scan', id: scanId })}
        />
      )}

      {route.path === '/finding' && route.id && (
        <FindingDetailView
          findingId={route.id}
          locale={locale}
          onOpenScan={(scanId) => navigate({ path: '/scan', id: scanId })}
          onBackFindings={() => navigate({ path: '/findings' })}
          onFindingMutated={refreshLists}
        />
      )}

      {route.path === '/settings' && (
        <SettingsView
          locale={locale}
          onChangeLocale={setLocale}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode((d) => !d)}
        />
      )}

      {route.path === '/advanced' && <AdvancedView />}

      {route.path === '/setup' && (
        <SetupView
          onComplete={() => {
            refreshLists();
            navigate({ path: '/' });
          }}
        />
      )}

      {route.path === '/login' && (
        <LoginView
          onSuccess={() => {
            refreshLists();
            navigate({ path: '/' });
          }}
        />
      )}
    </Layout>
  );
}
