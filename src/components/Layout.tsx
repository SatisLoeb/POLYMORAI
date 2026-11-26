import React, { useState } from 'react';
import {
  FileCheck2,
  Menu,
  Moon,
  Plus,
  Radar,
  Settings,
  SlidersHorizontal,
  Sun,
  X,
} from 'lucide-react';
import { getT } from '../i18n/translations';
import type { Locale } from '../types';

export interface RouteState {
  path: '/' | '/scan' | '/finding' | '/findings' | '/settings' | '/advanced' | '/setup' | '/login';
  id?: string;
}

interface LayoutProps {
  route: RouteState;
  navigate: (next: RouteState) => void;
  breadcrumb: string[];
  locale: Locale;
  onToggleLocale: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
  children: React.ReactNode;
}

export function Layout({
  route,
  navigate,
  breadcrumb,
  locale,
  onToggleLocale,
  darkMode,
  onToggleDark,
  children,
}: LayoutProps) {
  const t = getT(locale);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: Array<{
    key: RouteState['path'];
    label: string;
    icon: React.ReactNode;
    active: boolean;
  }> = [
    {
      key: '/',
      label: t.nav.scans,
      icon: <Radar className="w-4 h-4 shrink-0" />,
      active: route.path === '/' || route.path === '/scan',
    },
    {
      key: '/findings',
      label: t.nav.findings,
      icon: <FileCheck2 className="w-4 h-4 shrink-0" />,
      active: route.path === '/findings' || route.path === '/finding',
    },
    {
      key: '/settings',
      label: t.nav.settings,
      icon: <Settings className="w-4 h-4 shrink-0" />,
      active: route.path === '/settings',
    },
    {
      key: '/advanced',
      label: t.nav.advanced,
      icon: <SlidersHorizontal className="w-4 h-4 shrink-0" />,
      active: route.path === '/advanced',
    },
  ];

  const handleNav = (path: RouteState['path']) => {
    setMobileMenuOpen(false);
    navigate({ path });
  };

  return (
    <div className="min-h-screen flex bg-[#F8F9FB] dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:sticky lg:top-0 lg:h-screen shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#10141D]">
        <div className="h-14 px-5 flex items-center border-b border-slate-200 dark:border-slate-800">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              handleNav('/');
            }}
            className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            {t.brand}
          </a>
        </div>

        <nav aria-label="Navigation principale" className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => handleNav(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors whitespace-nowrap ${
                item.active
                  ? 'bg-slate-100 dark:bg-slate-800/90 text-slate-950 dark:text-white font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/40 font-medium'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={onToggleDark}
              aria-label={darkMode ? 'Passer en mode clair' : 'Passer en mode sombre'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{darkMode ? t.common.light : t.common.dark}</span>
            </button>
            <button
              type="button"
              onClick={onToggleLocale}
              aria-label="Changer de langue"
              className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-mono text-xs transition-colors whitespace-nowrap"
            >
              {locale === 'fr' ? 'FR / EN' : 'EN / FR'}
            </button>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-1">
            <button
              type="button"
              onClick={() => handleNav('/setup')}
              className="hover:text-slate-900 dark:hover:text-slate-200 underline-offset-4 hover:underline whitespace-nowrap"
            >
              {t.nav.setup}
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => handleNav('/login')}
              className="hover:text-slate-900 dark:hover:text-slate-200 underline-offset-4 hover:underline whitespace-nowrap"
            >
              {t.nav.login}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-64 max-w-[82vw] bg-white dark:bg-[#10141D] border-r border-slate-200 dark:border-slate-800 flex flex-col h-full z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                {t.brand}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fermer le menu"
                className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleNav(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-md ${
                    item.active
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-950 dark:text-white font-semibold'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onToggleDark}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-700"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span>{darkMode ? t.common.light : t.common.dark}</span>
              </button>
              <button
                type="button"
                onClick={onToggleLocale}
                className="px-3 py-2 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700"
              >
                {locale.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action on right */}
        <header className="sticky top-0 z-30 h-14 px-4 lg:px-8 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#10141D]/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Ouvrir le menu de navigation"
              className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>
            <ol className="flex items-center gap-2 text-sm min-w-0 truncate">
              {breadcrumb.map((crumb, idx) => (
                <li key={`${crumb}-${idx}`} className="flex items-center gap-2 min-w-0">
                  {idx > 0 && (
                    <span className="text-slate-300 dark:text-slate-600 select-none" aria-hidden="true">
                      /
                    </span>
                  )}
                  <span
                    className={
                      idx === breadcrumb.length - 1
                        ? 'font-semibold text-slate-900 dark:text-white truncate'
                        : 'text-slate-500 dark:text-slate-400 truncate'
                    }
                  >
                    {crumb}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <button
            type="button"
            onClick={() => handleNav('/')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.nav.newScan}</span>
          </button>
        </header>

        <main className="flex-1 w-full max-w-[1220px] mx-auto px-4 lg:px-8 py-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
