import {
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  Code2,
  ExternalLink,
  LayoutDashboard,
  Link2,
  Lock,
  LogOut,
  Megaphone,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Trash2,
  Upload,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { formatMethodLabel, formatMicros, formatRelativeTime } from '../lib/telegram.ts';
import type {
  AdminDashboardMetrics,
  AdminLinkRow,
  AdminSettings,
  AdminUserRow,
  AdminWithdrawalRow,
} from '../lib/types.ts';
import { ApiTab } from './ApiTab.tsx';

interface AdminPanelProps {
  onBackToApp: () => void;
}

type AdminSection = 'overview' | 'payouts' | 'moderation' | 'api' | 'settings' | 'broadcast';

export function AdminPanel({ onBackToApp }: AdminPanelProps) {
  // Keep admin token strictly in React memory (never localStorage/sessionStorage)
  const [adminToken, setAdminToken] = useState<string>('');
  const [needsSetup, setNeedsSetup] = useState<boolean>(false);
  const [envManaged, setEnvManaged] = useState<boolean>(false);
  const [statusLoading, setStatusLoading] = useState<boolean>(true);
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [section, setSection] = useState<AdminSection>('overview');
  const [metrics, setMetrics] = useState<AdminDashboardMetrics | null>(null);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawalRow[]>([]);
  const [txNotes, setTxNotes] = useState<Record<number, string>>({});
  const [processingWId, setProcessingWId] = useState<number | null>(null);

  const [modTab, setModTab] = useState<'links' | 'users'>('links');
  const [modSearch, setModSearch] = useState('');
  const [adminLinks, setAdminLinks] = useState<AdminLinkRow[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);

  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoImgError, setLogoImgError] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // Admin-only Developer API state
  const [adminApiKey, setAdminApiKey] = useState('');
  const [adminApiOrigin, setAdminApiOrigin] = useState('');

  // Broadcast state (25-user safe batches for Cloudflare Free Tier)
  const [bcMessage, setBcMessage] = useState('');
  const [bcBtnText, setBcBtnText] = useState('');
  const [bcBtnUrl, setBcBtnUrl] = useState('');
  const [bcRunning, setBcRunning] = useState(false);
  const [bcProgress, setBcProgress] = useState<{
    total: number;
    processed: number;
    sent: number;
    failed: number;
    dryRun: boolean;
    done: boolean;
  } | null>(null);
  const [bcError, setBcError] = useState('');

  useEffect(() => {
    apiFetch<{ needs_setup: boolean; env_managed: boolean }>('/api/admin/status')
      .then((res) => {
        setNeedsSetup(res.needs_setup);
        setEnvManaged(res.env_managed);
      })
      .catch(() => setAuthError('Could not connect to admin server.'))
      .finally(() => setStatusLoading(false));
  }, []);

  const loadSectionData = useCallback(
    async (activeSec: AdminSection, token: string, query = '') => {
      if (!token) return;
      try {
        if (activeSec === 'overview') {
          const res = await apiFetch<{ metrics: AdminDashboardMetrics }>('/api/admin/dashboard', {
            adminToken: token,
          });
          setMetrics(res.metrics);
        } else if (activeSec === 'payouts') {
          const res = await apiFetch<{ withdrawals: AdminWithdrawalRow[] }>('/api/admin/withdrawals', {
            adminToken: token,
          });
          setWithdrawals(res.withdrawals);
        } else if (activeSec === 'moderation') {
          const qs = query ? `?q=${encodeURIComponent(query)}` : '';
          const [lRes, uRes] = await Promise.all([
            apiFetch<{ links: AdminLinkRow[] }>(`/api/admin/links${qs}`, { adminToken: token }),
            apiFetch<{ users: AdminUserRow[] }>(`/api/admin/users${qs}`, { adminToken: token }),
          ]);
          setAdminLinks(lRes.links);
          setAdminUsers(uRes.users);
        } else if (activeSec === 'api') {
          const res = await apiFetch<{ api_key: string; origin: string }>('/api/admin/api-key', {
            adminToken: token,
          });
          setAdminApiKey(res.api_key);
          setAdminApiOrigin(res.origin);
        } else if (activeSec === 'settings') {
          const res = await apiFetch<{ settings: AdminSettings; webhook_url: string }>(
            '/api/admin/settings',
            { adminToken: token }
          );
          setSettings(res.settings);
          setWebhookUrl(res.webhook_url);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('authentication')) {
          setAdminToken('');
        }
      }
    },
    []
  );

  useEffect(() => {
    if (adminToken) {
      loadSectionData(section, adminToken, modSearch);
    }
  }, [adminToken, section, loadSectionData]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (needsSetup && passwordInput !== confirmPasswordInput) {
      setAuthError('Passwords do not match.');
      return;
    }
    setAuthSubmitting(true);
    try {
      const endpoint = needsSetup ? '/api/admin/bootstrap' : '/api/admin/login';
      const res = await apiFetch<{ token: string }>(endpoint, {
        method: 'POST',
        body: { password: passwordInput },
      });
      setAdminToken(res.token);
      setNeedsSetup(false);
      setPasswordInput('');
      setConfirmPasswordInput('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleApproveWithdrawal = async (id: number) => {
    setProcessingWId(id);
    try {
      await apiFetch(`/api/admin/withdrawals/${id}/approve`, {
        method: 'POST',
        adminToken,
        body: { tx_proof: txNotes[id] || '' },
      });
      await loadSectionData('payouts', adminToken);
      await loadSectionData('overview', adminToken);
    } finally {
      setProcessingWId(null);
    }
  };

  const handleRejectWithdrawal = async (id: number) => {
    setProcessingWId(id);
    try {
      await apiFetch(`/api/admin/withdrawals/${id}/reject`, {
        method: 'POST',
        adminToken,
        body: { tx_proof: txNotes[id] || 'Rejected by admin' },
      });
      await loadSectionData('payouts', adminToken);
      await loadSectionData('overview', adminToken);
    } finally {
      setProcessingWId(null);
    }
  };

  const handleToggleLink = async (link: AdminLinkRow) => {
    await apiFetch(`/api/admin/links/${link.id}`, {
      method: 'PATCH',
      adminToken,
      body: { is_disabled: link.is_disabled === 0 },
    });
    await loadSectionData('moderation', adminToken, modSearch);
  };

  const handleToggleUser = async (user: AdminUserRow) => {
    await apiFetch(`/api/admin/users/${encodeURIComponent(user.telegram_id)}`, {
      method: 'PATCH',
      adminToken,
      body: { is_banned: user.is_banned === 0 },
    });
    await loadSectionData('moderation', adminToken, modSearch);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    setSettingsNotice('');
    try {
      const res = await apiFetch<{ settings: AdminSettings }>('/api/admin/settings', {
        method: 'PUT',
        adminToken,
        body: settings,
      });
      setSettings(res.settings);
      setSettingsNotice('Settings saved and applied across all endpoints.');
    } catch (err) {
      setSettingsNotice(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSetupWebhook = async () => {
    setWebhookLoading(true);
    setSettingsNotice('');
    try {
      const res = await apiFetch<{ description: string; webhook_url: string }>(
        '/api/admin/setup-webhook',
        { method: 'POST', adminToken }
      );
      setSettingsNotice(`Webhook active: ${res.webhook_url} (${res.description})`);
    } catch (err) {
      setSettingsNotice(err instanceof Error ? err.message : 'Webhook setup failed.');
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleUploadLogo = async (file: File | undefined) => {
    if (!file || !settings) return;
    if (file.size > 2 * 1024 * 1024) {
      setSettingsNotice('Logo image must be smaller than 2 MB.');
      return;
    }
    setLogoUploading(true);
    setSettingsNotice('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch<{ url: string; storage: string }>('/api/admin/upload-logo', {
        method: 'POST',
        adminToken,
        body: form,
        isFormData: true,
      });
      setSettings({ ...settings, site_logo_url: res.url });
      setLogoImgError(false);
      setSettingsNotice(
        res.storage === 'telegram'
          ? 'Brand logo uploaded via Telegram Storage Channel and applied live.'
          : 'Brand logo uploaded to D1 and applied live across the Mini App.'
      );
    } catch (err) {
      setSettingsNotice(err instanceof Error ? err.message : 'Logo upload failed.');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!settings) return;
    setSavingSettings(true);
    setSettingsNotice('');
    try {
      const next = { ...settings, site_logo_url: '' };
      const res = await apiFetch<{ settings: AdminSettings }>('/api/admin/settings', {
        method: 'PUT',
        adminToken,
        body: next,
      });
      setSettings(res.settings);
      setSettingsNotice('Custom logo removed. Reverted to default monogram.');
    } catch (err) {
      setSettingsNotice(err instanceof Error ? err.message : 'Could not remove logo.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleChangeAdminPassword = async () => {
    if (newAdminPassword.length < 8) {
      setSettingsNotice('New admin password must be at least 8 characters.');
      return;
    }
    setUpdatingPassword(true);
    setSettingsNotice('');
    try {
      const res = await apiFetch<{ message: string }>('/api/admin/change-password', {
        method: 'POST',
        adminToken,
        body: { new_password: newAdminPassword },
      });
      setNewAdminPassword('');
      setSettingsNotice(res.message || 'Admin password updated.');
    } catch (err) {
      setSettingsNotice(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleRunBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    setBcError('');
    if (!bcMessage.trim()) {
      setBcError('Enter a broadcast message.');
      return;
    }
    setBcRunning(true);
    setBcProgress({ total: 0, processed: 0, sent: 0, failed: 0, dryRun: false, done: false });

    let offset = 0;
    let accSent = 0;
    let accFailed = 0;

    try {
      while (true) {
        const res = await apiFetch<{
          dry_run: boolean;
          total_users: number;
          processed_in_batch: number;
          sent: number;
          failed: number;
          next_offset: number;
          done: boolean;
        }>('/api/admin/broadcast', {
          method: 'POST',
          adminToken,
          body: {
            message: bcMessage.trim(),
            button_text: bcBtnText.trim() || undefined,
            button_url: bcBtnUrl.trim() || undefined,
            offset,
            batch_size: 25,
          },
        });

        accSent += res.sent;
        accFailed += res.failed;
        offset = res.next_offset;

        setBcProgress({
          total: res.total_users,
          processed: Math.min(res.total_users, offset),
          sent: accSent,
          failed: accFailed,
          dryRun: res.dry_run,
          done: res.done,
        });

        if (res.done) break;
      }
    } catch (err) {
      setBcError(err instanceof Error ? err.message : 'Broadcast interrupted.');
    } finally {
      setBcRunning(false);
    }
  };

  // Auth Gate
  if (!adminToken) {
    return (
      <div className="min-h-screen bg-[#08080A] text-[#F4F4F6] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#111115] border border-white/10 rounded-2xl p-6 sm:p-7 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-white">
                  {needsSetup ? 'Claim Admin Access' : 'LinkVault Admin'}
                </h1>
                <p className="text-xs text-zinc-400">
                  {needsSetup
                    ? 'Set your first-run admin password'
                    : envManaged
                    ? 'Verified via server ADMIN_PASSWORD'
                    : 'Server-verified administrator console'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onBackToApp}
              className="min-h-[38px] px-3 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-white"
            >
              Exit
            </button>
          </div>

          {statusLoading ? (
            <div className="h-28 rounded-xl bg-white/5 animate-pulse" />
          ) : (
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {authError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                  {authError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  {needsSetup ? 'Create Admin Password (min 8 chars)' : 'Admin Password'}
                </label>
                <input
                  type="password"
                  required
                  minLength={needsSetup ? 8 : 1}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full min-h-[46px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 text-sm text-white"
                />
              </div>

              {needsSetup && (
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Confirm Admin Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPasswordInput}
                    onChange={(e) => setConfirmPasswordInput(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full min-h-[46px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 text-sm text-white"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold text-sm transition-colors"
              >
                {authSubmitting
                  ? 'Verifying...'
                  : needsSetup
                  ? 'Save Password & Enter Admin'
                  : 'Sign In to Admin'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: AdminSection; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'payouts', label: 'Payouts Queue', icon: Wallet },
    { id: 'moderation', label: 'Links & Users', icon: ShieldAlert },
    { id: 'api', label: 'Developer API', icon: Code2 },
    { id: 'settings', label: 'AdsGram & Rates', icon: Settings },
    { id: 'broadcast', label: 'Broadcast', icon: Megaphone },
  ];

  const currency = metrics?.currency_label || settings?.currency_label || 'USDT';

  return (
    <div className="min-h-screen bg-[#08080A] text-[#F4F4F6] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 border-r border-white/10 bg-[#0B0B0E] p-5 shrink-0">
        <div className="mb-8 flex items-center justify-between">
          <span className="text-base font-bold tracking-tight text-white">LinkVault Admin</span>
        </div>

        <nav className="space-y-1 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-500/12 text-emerald-300 border border-emerald-500/25'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="pt-4 border-t border-white/10 space-y-1.5">
          <button
            type="button"
            onClick={onBackToApp}
            className="w-full min-h-[40px] px-3.5 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-white/[0.04] flex items-center gap-2.5"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Mini App</span>
          </button>
          <button
            type="button"
            onClick={() => setAdminToken('')}
            className="w-full min-h-[40px] px-3.5 rounded-xl text-xs text-red-300 hover:bg-red-500/10 flex items-center gap-2.5"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile Top Bar */}
        <header className="lg:hidden sticky top-0 z-30 bg-[#08080A]/95 backdrop-blur-md border-b border-white/10 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">LinkVault Admin</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onBackToApp}
                className="min-h-[36px] px-3 rounded-lg border border-white/10 text-xs text-zinc-300"
              >
                App
              </button>
              <button
                type="button"
                onClick={() => setAdminToken('')}
                className="min-h-[36px] px-3 rounded-lg border border-red-500/30 text-xs text-red-300"
              >
                Sign Out
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                  section === item.id
                    ? 'bg-emerald-500 text-zinc-950 font-semibold'
                    : 'bg-[#111115] border border-white/10 text-zinc-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
          {/* OVERVIEW */}
          {section === 'overview' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-white">Platform Overview</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Live totals from your D1 / SQLite database.
                </p>
              </div>

              <div className="bg-[#111115] border border-white/10 rounded-2xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
                <div className="p-5 border-r border-white/10 lg:border-r-0">
                  <p className="text-xs text-zinc-400">Total Users</p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold text-white tabular-nums">
                    {(metrics?.total_users ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-zinc-400">Total Links</p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold text-white tabular-nums">
                    {(metrics?.total_links ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="p-5 border-r border-white/10 lg:border-r-0">
                  <p className="text-xs text-zinc-400">Today&apos;s Verified Views</p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
                    {(metrics?.today_verified_views ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="p-5">
                  <p className="text-xs text-zinc-400">Pending Payouts</p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold text-amber-300 tabular-nums">
                    {metrics?.pending_payouts_count ?? 0}{' '}
                    <span className="text-sm text-zinc-400">
                      ({formatMicros(metrics?.pending_payouts_micros ?? 0, currency)})
                    </span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-[#111115] border border-white/10 rounded-2xl p-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-zinc-400">Cumulative Paid Out</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-emerald-400 tabular-nums">
                      {formatMicros(metrics?.total_paid_micros ?? 0, currency)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSection('payouts')}
                    className="min-h-[40px] px-4 rounded-xl bg-emerald-500/12 border border-emerald-500/30 text-emerald-300 text-xs font-semibold"
                  >
                    Review Queue
                  </button>
                </div>

                <div className="bg-[#111115] border border-white/10 rounded-2xl p-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-zinc-400">Abuse Reports Logged</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-white tabular-nums">
                      {metrics?.abuse_reports_count ?? 0}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSection('moderation')}
                    className="min-h-[40px] px-4 rounded-xl border border-white/10 hover:bg-white/5 text-zinc-200 text-xs font-medium"
                  >
                    Open Moderation
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PAYOUTS QUEUE */}
          {section === 'payouts' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-white">Payout Approval Queue</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Approving a withdrawal marks it paid and automatically publishes it to the public Payouts Proof feed. Rejecting refunds the creator&apos;s balance.
                </p>
              </div>

              {withdrawals.length === 0 ? (
                <div className="bg-[#111115] border border-white/10 rounded-2xl p-8 text-center text-xs text-zinc-400">
                  No withdrawal requests recorded yet.
                </div>
              ) : (
                <div className="bg-[#111115] border border-white/10 rounded-2xl divide-y divide-white/10">
                  {withdrawals.map((w) => (
                    <div key={w.id} className="p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-white">
                              @{w.username || w.telegram_id}
                            </span>
                            <span className="text-zinc-600">·</span>
                            <span className="text-xs text-zinc-400">
                              {formatMethodLabel(w.method)}
                            </span>
                            <span className="text-zinc-600">·</span>
                            <span className="font-mono text-xs text-zinc-300 truncate">
                              {w.payout_address}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-400 font-mono">
                            {Number(w.user_verified_views || 0).toLocaleString()} verified views ·{' '}
                            {Number(w.user_links_count || 0)} links · Requested{' '}
                            {formatRelativeTime(w.created_at)}
                          </div>
                        </div>

                        <div className="sm:text-right shrink-0">
                          <p className="font-mono text-lg font-semibold text-emerald-400 tabular-nums">
                            {formatMicros(w.amount_micros, currency)}
                          </p>
                          <p
                            className={`text-xs font-medium mt-0.5 ${
                              w.status === 'paid'
                                ? 'text-emerald-400'
                                : w.status === 'pending'
                                ? 'text-amber-300'
                                : 'text-red-400'
                            }`}
                          >
                            {w.status === 'paid'
                              ? 'Paid & Published'
                              : w.status === 'pending'
                              ? 'Pending Review'
                              : 'Rejected & Refunded'}
                          </p>
                        </div>
                      </div>

                      {w.status === 'pending' ? (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                          <input
                            type="text"
                            value={txNotes[w.id] || ''}
                            onChange={(e) =>
                              setTxNotes((prev) => ({ ...prev, [w.id]: e.target.value }))
                            }
                            placeholder="Optional TX hash / UTR / proof note..."
                            className="flex-1 min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3.5 font-mono text-xs text-white placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={processingWId === w.id}
                            onClick={() => handleApproveWithdrawal(w.id)}
                            className="min-h-[42px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Approve &amp; Mark Paid</span>
                          </button>
                          <button
                            type="button"
                            disabled={processingWId === w.id}
                            onClick={() => handleRejectWithdrawal(w.id)}
                            className="min-h-[42px] px-4 rounded-xl border border-red-500/35 bg-red-500/10 hover:bg-red-500/20 text-red-200 font-medium text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                          >
                            <XCircle className="w-4 h-4" />
                            <span>Reject &amp; Refund</span>
                          </button>
                        </div>
                      ) : w.tx_proof ? (
                        <p className="text-xs font-mono text-zinc-500">Proof: {w.tx_proof}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* MODERATION (LINKS & USERS) */}
          {section === 'moderation' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">Links &amp; Users Moderation</h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    Inspect destination URLs, disable abusive links, or suspend accounts.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-[#111115] border border-white/10 rounded-xl shrink-0">
                  <button
                    type="button"
                    onClick={() => setModTab('links')}
                    className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 ${
                      modTab === 'links' ? 'bg-white/10 text-white' : 'text-zinc-400'
                    }`}
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Links ({adminLinks.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModTab('users')}
                    className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 ${
                      modTab === 'users' ? 'bg-white/10 text-white' : 'text-zinc-400'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Users ({adminUsers.length})</span>
                  </button>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  loadSectionData('moderation', adminToken, modSearch);
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={modSearch}
                    onChange={(e) => setModSearch(e.target.value)}
                    placeholder="Search slugs, destination URLs, or usernames..."
                    className="w-full min-h-[44px] rounded-xl bg-[#111115] border border-white/10 pl-10 pr-4 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-white"
                >
                  Search
                </button>
              </form>

              {modTab === 'links' ? (
                <div className="bg-[#111115] border border-white/10 rounded-2xl divide-y divide-white/10">
                  {adminLinks.map((l) => (
                    <div
                      key={l.id}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold text-white">
                            /r/{l.slug}
                          </span>
                          <span className="text-xs text-zinc-400">
                            by @{l.owner_username || l.owner_telegram_id}
                          </span>
                          {l.reports_count > 0 && (
                            <span className="text-xs font-medium text-amber-300">
                              · {l.reports_count} report{l.reports_count > 1 ? 's' : ''}
                            </span>
                          )}
                          {l.is_disabled === 1 && (
                            <span className="text-xs font-medium text-red-400">· Disabled</span>
                          )}
                        </div>
                        <a
                          href={l.destination_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zinc-400 hover:text-emerald-300 inline-flex items-center gap-1 truncate max-w-full"
                        >
                          <span className="truncate">{l.destination_url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                        <p className="text-[11px] font-mono text-zinc-500">
                          {l.verified_clicks.toLocaleString()} views ·{' '}
                          {formatMicros(l.earned_micros, currency)} earned
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleLink(l)}
                        className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                          l.is_disabled === 1
                            ? 'bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25'
                            : 'bg-red-500/12 border border-red-500/35 text-red-200 hover:bg-red-500/20'
                        }`}
                      >
                        {l.is_disabled === 1 ? 'Re-enable Link' : 'Disable Link'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-[#111115] border border-white/10 rounded-2xl divide-y divide-white/10">
                  {adminUsers.map((u) => (
                    <div
                      key={u.telegram_id}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold text-white">
                            @{u.username || 'unknown'}
                          </span>
                          <span className="font-mono text-xs text-zinc-500">
                            ID {u.telegram_id}
                          </span>
                          {u.is_banned === 1 && (
                            <span className="text-xs font-medium text-red-400">· Banned</span>
                          )}
                        </div>
                        <p className="text-xs font-mono text-zinc-400">
                          Balance {formatMicros(u.balance_micros, currency)} · Earned{' '}
                          {formatMicros(u.total_earned_micros, currency)} · {u.links_count} links ·{' '}
                          {Number(u.total_views || 0).toLocaleString()} views
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleUser(u)}
                        className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                          u.is_banned === 1
                            ? 'bg-emerald-500/15 border border-emerald-500/35 text-emerald-300'
                            : 'bg-red-500/12 border border-red-500/35 text-red-200'
                        }`}
                      >
                        {u.is_banned === 1 ? <Check className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                        <span>{u.is_banned === 1 ? 'Unban User' : 'Ban User'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ADMIN DEVELOPER API */}
          {section === 'api' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-white">Developer API</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Admin-exclusive REST endpoint and API key management. Hidden from public Mini App users.
                </p>
              </div>

              {adminApiKey ? (
                <ApiTab
                  apiKey={adminApiKey}
                  origin={adminApiOrigin}
                  adminToken={adminToken}
                  onApiKeyUpdated={(nextKey) => setAdminApiKey(nextKey)}
                  onLinkCreatedViaApi={() => {
                    loadSectionData('overview', adminToken);
                  }}
                />
              ) : (
                <div className="h-44 rounded-2xl bg-[#111115] border border-white/10 animate-pulse" />
              )}
            </div>
          )}

          {/* ADSGRAM & SETTINGS */}
          {section === 'settings' && settings && (
            <form onSubmit={handleSaveSettings} className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">AdsGram, Bot &amp; Rate Settings</h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    Configure realistic payout tiers per 1,000 verified views, AdsGram Block ID, and Telegram Bot webhook.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="min-h-[44px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs whitespace-nowrap shrink-0"
                >
                  {savingSettings ? 'Saving...' : 'Save All Settings'}
                </button>
              </div>

              {settingsNotice && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
                  {settingsNotice}
                </div>
              )}

              {/* Brand Logo Upload Card */}
              <div className="bg-[#111115] border border-white/10 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {settings.site_logo_url && !logoImgError ? (
                      <img
                        src={settings.site_logo_url}
                        alt={settings.site_name || 'Brand Logo'}
                        referrerPolicy="no-referrer"
                        onError={() => setLogoImgError(true)}
                        className="w-14 h-14 rounded-xl object-cover border border-white/15 bg-[#08080A] shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-emerald-500 text-zinc-950 flex items-center justify-center font-bold text-lg shrink-0">
                        {(settings.site_name || 'LV').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-white">Brand Logo</h3>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Displayed in the Mini App header, sidebar, Unlock Screen, and PicLink preview pages. PNG, JPG, or WebP up to 2 MB.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => {
                        handleUploadLogo(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      disabled={logoUploading}
                      onClick={() => logoInputRef.current?.click()}
                      className="min-h-[42px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold text-xs inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      <span>{logoUploading ? 'Uploading...' : 'Upload Logo'}</span>
                    </button>
                    {settings.site_logo_url && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="min-h-[42px] px-3 rounded-xl border border-white/10 hover:bg-red-500/15 hover:border-red-500/30 text-zinc-400 hover:text-red-300 text-xs inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    Or paste direct Logo URL
                  </label>
                  <input
                    type="text"
                    value={settings.site_logo_url || ''}
                    onChange={(e) => {
                      setSettings({ ...settings, site_logo_url: e.target.value });
                      setLogoImgError(false);
                    }}
                    placeholder="/api/img/... or https://..."
                    className="w-full min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3.5 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Telegram & AdsGram */}
                <div className="bg-[#111115] border border-white/10 rounded-2xl p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-white">Telegram Mini App &amp; AdsGram</h3>

                  {(
                    [
                      ['site_name', 'Platform Name', 'LinkVault'],
                      ['adsgram_block_id', 'AdsGram Block ID', 'e.g. int-12345'],
                      ['bot_username', 'Bot Username (without @)', 'LinkVaultAppBot'],
                      ['app_short_name', 'Mini App Short Name', 'app'],
                      ['bot_token', 'Telegram Bot Token', '123456:ABC-DEF...'],
                      ['storage_channel_id', 'Storage Channel ID (for free image proxy)', '-1001234567890'],
                    ] as Array<[keyof AdminSettings, string, string]>
                  ).map(([key, label, placeholder]) => (
                    <div key={key}>
                      <label className="block text-xs text-zinc-300 mb-1">{label}</label>
                      <input
                        type={key === 'bot_token' ? 'password' : 'text'}
                        value={settings[key] || ''}
                        onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                        placeholder={placeholder}
                        className="w-full min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3.5 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
                      />
                    </div>
                  ))}

                  <div className="pt-3 border-t border-white/10 space-y-2">
                    <p className="text-xs text-zinc-400">
                      Webhook endpoint: <code className="font-mono text-zinc-300">{webhookUrl}</code>
                    </p>
                    <button
                      type="button"
                      disabled={webhookLoading}
                      onClick={handleSetupWebhook}
                      className="min-h-[42px] px-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-semibold"
                    >
                      {webhookLoading ? 'Registering Webhook...' : '1-Click Set Telegram Webhook'}
                    </button>
                  </div>
                </div>

                {/* Realistic CPM Rates & Payout Thresholds */}
                <div className="bg-[#111115] border border-white/10 rounded-2xl p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-white">Creator Rates &amp; Payout Policy</h3>
                  <p className="text-xs text-zinc-400">
                    Values stored in micros (1,000,000 = 1.00 unit) per 1,000 verified views.
                  </p>

                  {(
                    [
                      ['currency_label', 'Currency Label (USDT / Stars / INR)', 'USDT'],
                      ['rate_tier1_micros', 'Tier-1 Rate / 1K views (micros)', '1200000'],
                      ['rate_in_micros', 'India (IN) Rate / 1K views (micros)', '450000'],
                      ['rate_global_micros', 'Global Rate / 1K views (micros)', '650000'],
                      ['min_withdraw_micros', 'Minimum Withdrawal (micros)', '2000000'],
                      ['payout_channel_url', 'Public Payout Proof Channel URL', 'https://t.me/LinkVaultPayouts'],
                    ] as Array<[keyof AdminSettings, string, string]>
                  ).map(([key, label, placeholder]) => (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-zinc-300">{label}</label>
                        {key.endsWith('_micros') && (
                          <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
                            = {formatMicros(Number(settings[key] || 0), settings.currency_label)}
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        value={settings[key] || ''}
                        onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                        placeholder={placeholder}
                        className="w-full min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3.5 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Admin Password Security Card */}
              <div className="bg-[#111115] border border-white/10 rounded-2xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-white">Admin Password Security</h3>
                {envManaged ? (
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Your admin password is managed securely via the <code className="font-mono text-emerald-400">ADMIN_PASSWORD</code> secret in Cloudflare Pages → Settings → Variables and Secrets. Update it there to rotate your password.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-zinc-400">
                      Update the PBKDF2-hashed admin password stored in D1 (or set <code className="font-mono text-zinc-300">ADMIN_PASSWORD</code> in Cloudflare Secrets to override).
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        type="password"
                        value={newAdminPassword}
                        onChange={(e) => setNewAdminPassword(e.target.value)}
                        placeholder="Enter new admin password (min 8 chars)"
                        className="flex-1 min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3.5 text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={updatingPassword || newAdminPassword.length < 8}
                        onClick={handleChangeAdminPassword}
                        className="min-h-[42px] px-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-45 text-emerald-300 text-xs font-semibold whitespace-nowrap"
                      >
                        {updatingPassword ? 'Updating...' : 'Update Password'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </form>
          )}

          {/* BATCHED BROADCAST */}
          {section === 'broadcast' && (
            <div className="max-w-2xl space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-white">Batched Telegram Broadcast</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Dispatches announcements in 25-user sequential batches to stay safely within Cloudflare Free Tier&apos;s 50 subrequest limit.
                </p>
              </div>

              <form
                onSubmit={handleRunBroadcast}
                className="bg-[#111115] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-4"
              >
                {bcError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                    {bcError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Message Text
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={bcMessage}
                    onChange={(e) => setBcMessage(e.target.value)}
                    placeholder="Write your announcement to active creators..."
                    className="w-full rounded-xl bg-[#08080A] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-300 mb-1">
                      Inline Button Label (optional)
                    </label>
                    <input
                      type="text"
                      value={bcBtnText}
                      onChange={(e) => setBcBtnText(e.target.value)}
                      placeholder="Open LinkVault"
                      className="w-full min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3.5 text-xs text-white focus:border-emerald-500/60 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-300 mb-1">
                      Inline Button URL (optional)
                    </label>
                    <input
                      type="url"
                      value={bcBtnUrl}
                      onChange={(e) => setBcBtnUrl(e.target.value)}
                      placeholder="https://t.me/..."
                      className="w-full min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3.5 text-xs text-white focus:border-emerald-500/60 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={bcRunning}
                  className="w-full min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold text-sm inline-flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>{bcRunning ? 'Sending 25-User Batches...' : 'Start Batched Broadcast'}</span>
                </button>

                {bcProgress && (
                  <div className="pt-4 border-t border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-zinc-300">
                        {bcProgress.done ? 'Broadcast Complete' : 'Processing batches...'}
                        {bcProgress.dryRun ? ' (Dry Run — configure Bot Token for live Telegram delivery)' : ''}
                      </span>
                      <span className="text-emerald-400 tabular-nums">
                        {bcProgress.processed} / {bcProgress.total}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{
                          width: `${
                            bcProgress.total > 0
                              ? Math.round((bcProgress.processed / bcProgress.total) * 100)
                              : 100
                          }%`,
                        }}
                      />
                    </div>
                    <p className="text-xs font-mono text-zinc-400 tabular-nums">
                      Delivered: {bcProgress.sent} · Failed: {bcProgress.failed}
                    </p>
                  </div>
                )}
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
