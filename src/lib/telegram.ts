interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: {
      id: number;
      username?: string;
      first_name?: string;
    };
  };
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink?: (url: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: 'light' | 'medium' | 'heavy') => void;
    notificationOccurred?: (type: 'success' | 'warning' | 'error') => void;
  };
}

interface AdsGramController {
  show: () => Promise<{ done: boolean; description?: string; state?: string; error?: boolean }>;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
    Adsgram?: {
      init: (config: { blockId: string; debug?: boolean }) => AdsGramController;
    };
  }
}

export function initTelegramWebApp(): void {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  try {
    tg.ready?.();
    tg.expand?.();
    tg.setHeaderColor?.('#08080A');
    tg.setBackgroundColor?.('#08080A');
  } catch {
    // Ignore outside Telegram client
  }
}

export function getTelegramInitData(): string {
  return window.Telegram?.WebApp?.initData || '';
}

export function getStartAppSlug(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  const rawParam =
    urlParams.get('startapp') ||
    urlParams.get('tgWebAppStartParam') ||
    window.Telegram?.WebApp?.initDataUnsafe?.start_param ||
    '';

  const trimmed = rawParam.trim();
  if (trimmed.startsWith('r_') && trimmed.length > 2) {
    return trimmed.slice(2);
  }
  return null;
}

export function triggerHaptic(kind: 'light' | 'success' | 'error' = 'light'): void {
  try {
    const hf = window.Telegram?.WebApp?.HapticFeedback;
    if (!hf) return;
    if (kind === 'light') hf.impactOccurred?.('light');
    else hf.notificationOccurred?.(kind);
  } catch {
    // Ignore
  }
}

export function openExternalDestination(url: string): boolean {
  const tg = window.Telegram?.WebApp;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (tg) {
      if (parsed.hostname === 't.me' || parsed.hostname === 'telegram.me') {
        if (tg.openTelegramLink) {
          tg.openTelegramLink(url);
          return true;
        }
      }
      if (tg.openLink) {
        tg.openLink(url);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function runAdsGramRewardedAd(
  blockId: string
): Promise<{ completed: boolean; usedSdk: boolean; reason?: string }> {
  const cleanId = (blockId || '').trim();
  if (!cleanId || !window.Adsgram || !window.Telegram?.WebApp?.initData) {
    return { completed: false, usedSdk: false, reason: 'fallback_preview' };
  }
  try {
    const controller = window.Adsgram.init({ blockId: cleanId });
    const result = await controller.show();
    return {
      completed: Boolean(result?.done),
      usedSdk: true,
      reason: result?.description,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ad skipped or unavailable';
    return { completed: false, usedSdk: true, reason: msg };
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      triggerHaptic('light');
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    if (ok) triggerHaptic('light');
    return ok;
  } catch {
    return false;
  }
}

export function formatMicros(micros: number, currency = 'USDT', decimals = 2): string {
  const val = (Number(micros) || 0) / 1_000_000;
  const formatted = val.toFixed(decimals);
  if (currency === 'USD' || currency === 'USDT') {
    return `$${formatted}`;
  }
  if (currency === 'INR' || currency === 'UPI') {
    return `₹${formatted}`;
  }
  if (currency === 'Stars') {
    return `${Math.round(val)} Stars`;
  }
  return `${formatted} ${currency}`;
}

export function formatMethodLabel(method: string): string {
  if (method === 'telegram_stars') return 'Telegram Stars';
  if (method === 'ton_usdt') return 'TON / USDT';
  if (method === 'upi') return 'UPI';
  return method;
}

export function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
