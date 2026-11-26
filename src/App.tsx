import { Link2, PlusCircle, ShieldCheck, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AdminPanel } from './components/AdminPanel.tsx';
import { CreateTab } from './components/CreateTab.tsx';
import { GateUnlockScreen } from './components/GateUnlockScreen.tsx';
import { LinksTab } from './components/LinksTab.tsx';
import { UnlockScreen } from './components/UnlockScreen.tsx';
import { WalletTab } from './components/WalletTab.tsx';
import { removeMonetagScripts } from './lib/ads.ts';
import { apiFetch } from './lib/api.ts';
import {
  formatMicros,
  getStartAppGateSessionId,
  getStartAppSlug,
  initTelegramWebApp,
} from './lib/telegram.ts';
import type { BootstrapResponse, LinkItem, WalletResponse } from './lib/types.ts';

type TabKey = 'create' | 'links' | 'wallet';

export default function App() {
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() =>
    window.location.pathname.startsWith('/admin')
  );
  const [unlockSlug, setUnlockSlug] = useState<string | null>(() => getStartAppSlug());
  const [gateSessionId, setGateSessionId] = useState<string | null>(() =>
    getStartAppGateSessionId()
  );
  const [activeTab, setActiveTab] = useState<TabKey>('create');

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [logoError, setLogoError] = useState(false);
  const [bootError, setBootError] = useState('');
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [walletData, setWalletData] = useState<WalletResponse | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);

  useEffect(() => {
    initTelegramWebApp();
    const onPopState = () => {
      setIsAdminRoute(window.location.pathname.startsWith('/admin'));
      setUnlockSlug(getStartAppSlug());
      setGateSessionId(getStartAppGateSessionId());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const res = await apiFetch<BootstrapResponse>('/api/bootstrap');
      setBootstrap(res);
      setLogoError(false);
      setBootError('');
      if (!res.settings.ad_config?.monetag_enabled) {
        removeMonetagScripts();
      }
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Unable to initialize LinkVault');
    }
  }, []);

  const loadLinks = useCallback(async () => {
    setLinksLoading(true);
    try {
      const res = await apiFetch<{ links: LinkItem[] }>('/api/links');
      setLinks(res.links);
    } finally {
      setLinksLoading(false);
    }
  }, []);

  const loadWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const res = await apiFetch<WalletResponse>('/api/wallet');
      setWalletData(res);
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdminRoute && !gateSessionId) {
      loadBootstrap();
    }
  }, [isAdminRoute, gateSessionId, loadBootstrap]);

  useEffect(() => {
    if (isAdminRoute || unlockSlug || gateSessionId) return;
    if (activeTab === 'links') loadLinks();
    if (activeTab === 'wallet') loadWallet();
  }, [activeTab, isAdminRoute, unlockSlug, gateSessionId, loadLinks, loadWallet]);

  // Hidden /admin route (never linked in user UI)
  if (isAdminRoute) {
    return (
      <AdminPanel
        onBackToApp={() => {
          window.history.pushState({}, '', '/');
          setIsAdminRoute(false);
          loadBootstrap();
        }}
      />
    );
  }

  // Rewarded Ad Gate Screen (startapp=gate_...)
  if (gateSessionId) {
    return (
      <GateUnlockScreen
        sessionId={gateSessionId}
        onExit={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('startapp');
          url.searchParams.delete('tgWebAppStartParam');
          window.history.replaceState({}, '', url.pathname + url.search);
          setGateSessionId(null);
          loadBootstrap();
        }}
      />
    );
  }

  // Deep-Link Unlock Screen (startapp=r_<slug> or 1-tap Preview Unlock Flow)
  if (unlockSlug) {
    return (
      <UnlockScreen
        slug={unlockSlug}
        onExit={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('startapp');
          url.searchParams.delete('tgWebAppStartParam');
          window.history.replaceState({}, '', url.pathname + url.search);
          setUnlockSlug(null);
          loadBootstrap();
        }}
        onUnlocked={() => {
          loadBootstrap();
        }}
      />
    );
  }

  const tabs: Array<{ id: TabKey; label: string; icon: typeof PlusCircle }> = [
    { id: 'create', label: 'Create', icon: PlusCircle },
    { id: 'links', label: 'My Links', icon: Link2 },
    { id: 'wallet', label: 'Wallet', icon: Wallet },
  ];

  const siteName = bootstrap?.settings.site_name || 'LinkVault';
  const siteLogoUrl = bootstrap?.settings.site_logo_url || '';
  const currency = bootstrap?.settings.currency_label || 'USDT';
  const brandInitials = siteName.slice(0, 2).toUpperCase();

  const handleOpenPreview = (slug: string) => {
    setUnlockSlug(slug);
  };

  return (
    <div className="min-h-screen bg-[#08080A] text-[#F4F4F6] flex flex-col lg:flex-row">
      {/* Desktop Sidebar Navigation (keeps 1440px viewports clean & spacious) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 border-r border-white/10 bg-[#0B0B0E] p-5 shrink-0 sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 mb-8 px-1">
          {siteLogoUrl && !logoError ? (
            <img
              src={siteLogoUrl}
              alt={siteName}
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
              className="w-8 h-8 rounded-lg object-cover border border-white/10 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-emerald-500 text-zinc-950 flex items-center justify-center font-bold text-sm shrink-0">
              {brandInitials}
            </div>
          )}
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap truncate">
            {siteName}
          </span>
        </div>

        <nav className="space-y-1 flex-1" aria-label="Main navigation">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-500/12 text-emerald-300 border border-emerald-500/25'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {bootstrap && (
          <div className="pt-4 border-t border-white/10 px-1 space-y-1">
            <p className="text-xs font-medium text-white truncate">
              @{bootstrap.user.username}
            </p>
            <p className="font-mono text-xs text-emerald-400 tabular-nums">
              {formatMicros(bootstrap.user.balance_micros, currency)} available
            </p>
          </div>
        )}
      </aside>

      {/* Mobile Compact Header (< lg) */}
      <header className="lg:hidden sticky top-0 z-30 h-13 px-4 border-b border-white/10 bg-[#08080A]/92 backdrop-blur-md flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {siteLogoUrl && !logoError ? (
            <img
              src={siteLogoUrl}
              alt={siteName}
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
              className="w-7 h-7 rounded-lg object-cover border border-white/10 shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-emerald-500 text-zinc-950 flex items-center justify-center font-bold text-xs shrink-0">
              {brandInitials}
            </div>
          )}
          <span className="text-sm font-bold tracking-tight text-white truncate">
            {siteName}
          </span>
        </div>

        {bootstrap && (
          <button
            type="button"
            onClick={() => setActiveTab('wallet')}
            className="min-h-[36px] px-3 rounded-lg bg-[#111115] border border-white/10 font-mono text-xs font-semibold text-emerald-400 tabular-nums whitespace-nowrap shrink-0"
          >
            {formatMicros(bootstrap.user.balance_micros, currency)}
          </button>
        )}
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 min-w-0 pb-24 lg:pb-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7">
          {/* Desktop Section Header */}
          <div className="hidden lg:flex items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-semibold text-white tracking-tight">
                {activeTab === 'create' && 'Create Short Link & PicLink'}
                {activeTab === 'links' && 'My Links'}
                {activeTab === 'wallet' && 'Wallet & Public Payouts'}
              </h1>
            </div>
            {bootstrap && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Verified Creator Revenue Sharing</span>
              </div>
            )}
          </div>

          {bootError ? (
            <div className="bg-[#111115] border border-red-500/30 rounded-2xl p-6 text-center space-y-3">
              <p className="text-sm font-semibold text-white">Connection Error</p>
              <p className="text-xs text-zinc-400">{bootError}</p>
              <button
                type="button"
                onClick={loadBootstrap}
                className="min-h-[42px] px-4 rounded-xl bg-emerald-500 text-zinc-950 font-semibold text-xs"
              >
                Retry
              </button>
            </div>
          ) : !bootstrap ? (
            <div className="space-y-4">
              <div className="h-32 rounded-2xl bg-[#111115] border border-white/10 animate-pulse" />
              <div className="h-80 rounded-2xl bg-[#111115] border border-white/10 animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab === 'create' && (
                <CreateTab
                  data={bootstrap}
                  onLinkCreated={(newLink) => {
                    setLinks((prev) => [newLink, ...prev]);
                  }}
                  onPreviewUnlock={handleOpenPreview}
                />
              )}

              {activeTab === 'links' && (
                <LinksTab
                  links={links}
                  loading={linksLoading}
                  currency={currency}
                  onRefresh={() => {
                    loadLinks();
                    loadBootstrap();
                  }}
                  onCreateNew={() => setActiveTab('create')}
                  onPreviewUnlock={handleOpenPreview}
                />
              )}

              {activeTab === 'wallet' && (
                <WalletTab
                  data={walletData}
                  loading={walletLoading}
                  onRefresh={() => {
                    loadWallet();
                    loadBootstrap();
                  }}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* Fixed Mobile 3-Tab Bottom Navigation (< lg) */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#08080A]/95 backdrop-blur-md border-t border-white/10 pb-safe"
      >
        <div className="grid grid-cols-3 h-15">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center justify-center gap-1 min-h-[48px] transition-colors ${
                  active ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={active ? 2.25 : 1.75} />
                <span className="text-[11px] font-medium tracking-tight whitespace-nowrap">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
