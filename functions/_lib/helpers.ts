import type {
  AdNetworkConfig,
  AdsGramUnit,
  AppSettingsMap,
  CleanAdsUnit,
  D1Database,
} from './types.ts';

export const DEFAULT_ADSGRAM_UNITS: AdsGramUnit[] = [
  { id: 'ag_1', label: 'AdsGram Unit 1 (Rewarded)', block_id: '', enabled: false },
  { id: 'ag_2', label: 'AdsGram Unit 2 (Interstitial)', block_id: '', enabled: false },
];

export const DEFAULT_CLEANADS_UNITS: CleanAdsUnit[] = [
  { id: 'ca_1', label: 'CleanAds Rewarded', placement_id: '', enabled: false },
  { id: 'ca_2', label: 'CleanAds Interstitial', placement_id: '', enabled: false },
];

export const DEFAULT_SETTINGS: AppSettingsMap = {
  site_name: 'LinkVault',
  site_logo_url: '',
  bot_username: 'LinkVaultAppBot',
  app_short_name: 'app',
  bot_token: '',
  storage_channel_id: '',
  adsgram_block_id: '',
  adsgram_units: '',
  cleanads_units: '',
  cleanads_test_mode: '0',
  monetag_enabled: '0',
  monetag_zone_id: '',
  richads_enabled: '0',
  richads_pub_id: '',
  richads_app_id: '',
  rate_in_micros: '450000',
  rate_tier1_micros: '1200000',
  rate_global_micros: '650000',
  min_withdraw_micros: '2000000',
  currency_label: 'USDT',
  payout_channel_url: '',
  show_payout_channel: '0',
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

export function cleanBotUsername(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
    .replace(/^@+/, '')
    .split('/')[0]
    .trim();
}

export function cleanAppShortName(raw: string): string {
  return (raw || '').trim().replace(/^\/+|\/+$/g, '');
}

export function isBotConfigured(settings: AppSettingsMap): boolean {
  const bot = cleanBotUsername(settings.bot_username);
  return Boolean(bot && bot.toLowerCase() !== 'linkvaultappbot');
}

export function buildTelegramUrl(slug: string, settings: AppSettingsMap): string {
  const bot = cleanBotUsername(settings.bot_username) || 'LinkVaultAppBot';
  const app = cleanAppShortName(settings.app_short_name);
  if (app) {
    return `https://t.me/${encodeURIComponent(bot)}/${encodeURIComponent(app)}?startapp=r_${encodeURIComponent(slug)}`;
  }
  return `https://t.me/${encodeURIComponent(bot)}?startapp=r_${encodeURIComponent(slug)}`;
}

export function buildTelegramGateUrl(sessionId: string, settings: AppSettingsMap): string {
  const bot = cleanBotUsername(settings.bot_username) || 'LinkVaultAppBot';
  const app = cleanAppShortName(settings.app_short_name);
  if (app) {
    return `https://t.me/${encodeURIComponent(bot)}/${encodeURIComponent(app)}?startapp=${encodeURIComponent(sessionId)}`;
  }
  return `https://t.me/${encodeURIComponent(bot)}?startapp=${encodeURIComponent(sessionId)}`;
}

let gateTableEnsured = false;

export async function ensureGateSessionsTable(db: D1Database): Promise<void> {
  if (gateTableEnsured) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS gate_sessions (
        id TEXT PRIMARY KEY,
        api_key_owner_id TEXT NOT NULL,
        external_user_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT 'Complete steps to unlock',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      )`
    )
    .run();
  gateTableEnsured = true;
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

export function sanitizeAdsGramUnits(raw: unknown, legacyBlockId = ''): AdsGramUnit[] {
  let list: unknown[] = [];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  }

  if (list.length === 0) {
    const legacy = (legacyBlockId || '').trim().slice(0, 80);
    return DEFAULT_ADSGRAM_UNITS.map((u, idx) =>
      idx === 0 && legacy ? { ...u, block_id: legacy, enabled: true } : { ...u }
    );
  }

  return list.slice(0, 20).map((item, idx) => {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const id = String(obj.id || `ag_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || `ag_${idx + 1}`;
    const label = String(obj.label || `AdsGram Unit ${idx + 1}`).trim().slice(0, 64);
    const blockId = String(obj.block_id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const enabled = Boolean(obj.enabled);
    return { id, label, block_id: blockId, enabled };
  });
}

export function sanitizeCleanAdsUnits(raw: unknown): CleanAdsUnit[] {
  let list: unknown[] = [];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  }

  if (list.length === 0) {
    return DEFAULT_CLEANADS_UNITS.map((u) => ({ ...u }));
  }

  return list.slice(0, 20).map((item, idx) => {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const id = String(obj.id || `ca_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || `ca_${idx + 1}`;
    const label = String(obj.label || `CleanAds Unit ${idx + 1}`).trim().slice(0, 64);
    const placementId = String(obj.placement_id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const enabled = Boolean(obj.enabled);
    return { id, label, placement_id: placementId, enabled };
  });
}

export function parseAdConfig(settings: AppSettingsMap): AdNetworkConfig {
  const adsgramUnits = sanitizeAdsGramUnits(settings.adsgram_units, settings.adsgram_block_id);
  const cleanadsUnits = sanitizeCleanAdsUnits(settings.cleanads_units);
  const monetagZoneId = (settings.monetag_zone_id || '').replace(/\D/g, '').slice(0, 24);
  const richadsPubId = (settings.richads_pub_id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const richadsAppId = (settings.richads_app_id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

  return {
    adsgram_units: adsgramUnits,
    cleanads_units: cleanadsUnits,
    cleanads_test_mode: settings.cleanads_test_mode === '1' || settings.cleanads_test_mode === 'true',
    monetag_enabled: settings.monetag_enabled === '1' || settings.monetag_enabled === 'true',
    monetag_zone_id: monetagZoneId,
    richads_enabled: settings.richads_enabled === '1' || settings.richads_enabled === 'true',
    richads_pub_id: richadsPubId,
    richads_app_id: richadsAppId,
  };
}

export function publicSettingsView(settings: AppSettingsMap) {
  const adConfig = parseAdConfig(settings);
  const firstActiveAdsGram = adConfig.adsgram_units.find((u) => u.enabled && u.block_id);
  return {
    site_name: settings.site_name,
    site_logo_url: settings.site_logo_url || '',
    bot_username: settings.bot_username,
    app_short_name: settings.app_short_name,
    adsgram_block_id: firstActiveAdsGram?.block_id || settings.adsgram_block_id || '',
    ad_config: adConfig,
    rate_in_micros: Number(settings.rate_in_micros) || 450000,
    rate_tier1_micros: Number(settings.rate_tier1_micros) || 1200000,
    rate_global_micros: Number(settings.rate_global_micros) || 650000,
    min_withdraw_micros: Number(settings.min_withdraw_micros) || 2000000,
    currency_label: settings.currency_label || 'USDT',
    payout_channel_url:
      settings.show_payout_channel === '1' ? settings.payout_channel_url || '' : '',
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
