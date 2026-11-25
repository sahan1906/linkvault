import type { AppSettingsMap, D1Database } from './types.ts';

export const DEFAULT_SETTINGS: AppSettingsMap = {
  site_name: 'LinkVault',
  bot_username: 'LinkVaultAppBot',
  app_short_name: 'app',
  bot_token: '',
  storage_channel_id: '',
  adsgram_block_id: '',
  rate_in_micros: '450000',
  rate_tier1_micros: '1200000',
  rate_global_micros: '650000',
  min_withdraw_micros: '2000000',
  currency_label: 'USDT',
  payout_channel_url: 'https://t.me/LinkVaultPayouts',
};

const TIER1_COUNTRIES = new Set([
  'US',
  'GB',
  'CA',
  'AU',
  'DE',
  'CH',
  'NO',
  'SE',
  'DK',
  'NL',
  'SG',
  'AE',
  'FR',
  'NZ',
  'IE',
  'JP',
]);

export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function validateHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function validateImageUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > 2048) return null;
  if (trimmed.startsWith('/api/img/') || trimmed.startsWith('/src/assets/images/')) {
    if (/^\/[a-zA-Z0-9/_\-.]+$/.test(trimmed) && !trimmed.includes('..')) {
      return trimmed;
    }
    return null;
  }
  return validateHttpUrl(trimmed);
}

export function sanitizeSlug(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9_-]{3,40}$/.test(trimmed)) return null;
  const reserved = new Set(['admin', 'api', 'r', 'health', 'assets', 'static']);
  if (reserved.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

export function maskUsername(username: string, telegramId: string): string {
  const clean = (username || '').replace(/^@+/, '').trim();
  if (clean.length >= 4) {
    return `@${clean.slice(0, 2)}***${clean.slice(-2)}`;
  }
  if (clean.length > 0) {
    return `@${clean[0]}***`;
  }
  const tail = String(telegramId || '00').slice(-3);
  return `creator_***${tail}`;
}

export function getDayBucket(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function getRateForCountry(countryCode: string, settings: AppSettingsMap): number {
  const cc = (countryCode || 'GLOBAL').toUpperCase();
  if (cc === 'IN') {
    return Math.max(0, Number(settings.rate_in_micros) || 450000);
  }
  if (TIER1_COUNTRIES.has(cc)) {
    return Math.max(0, Number(settings.rate_tier1_micros) || 1200000);
  }
  return Math.max(0, Number(settings.rate_global_micros) || 650000);
}

export function getEffectiveBotToken(settings: AppSettingsMap, envBotToken?: string): string {
  return (settings.bot_token || envBotToken || '').trim();
}

export function buildTelegramUrl(slug: string, settings: AppSettingsMap): string {
  const bot = (settings.bot_username || 'LinkVaultAppBot').replace(/^@+/, '').trim();
  const app = (settings.app_short_name || 'app').trim();
  return `https://t.me/${encodeURIComponent(bot)}/${encodeURIComponent(app)}?startapp=r_${encodeURIComponent(slug)}`;
}

export function buildPicLinkUrl(origin: string, slug: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  return `${cleanOrigin}/r/${encodeURIComponent(slug)}`;
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'external link';
  }
}

export async function loadSettings(db: D1Database): Promise<AppSettingsMap> {
  const { results } = await db
    .prepare('SELECT key, value FROM app_settings')
    .all<{ key: string; value: string }>();
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of results) {
    map[row.key] = row.value;
  }
  return map as unknown as AppSettingsMap;
}

export function publicSettingsView(settings: AppSettingsMap) {
  return {
    site_name: settings.site_name,
    bot_username: settings.bot_username,
    app_short_name: settings.app_short_name,
    adsgram_block_id: settings.adsgram_block_id,
    rate_in_micros: Number(settings.rate_in_micros) || 450000,
    rate_tier1_micros: Number(settings.rate_tier1_micros) || 1200000,
    rate_global_micros: Number(settings.rate_global_micros) || 650000,
    min_withdraw_micros: Number(settings.min_withdraw_micros) || 2000000,
    currency_label: settings.currency_label || 'USDT',
    payout_channel_url: settings.payout_channel_url || '',
  };
}

export function jsonResponse(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

export function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ status: 'error', error }, status);
}
