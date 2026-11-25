import {
  getSigningSecret,
  hashPassword,
  randomApiKey,
  randomFileId,
  randomSlug,
  sha256Hex,
  signToken,
  verifyPassword,
  verifyPlaintextConstantTime,
  verifyTelegramInitData,
  verifyToken,
} from './crypto.ts';
import {
  buildPicLinkUrl,
  buildTelegramUrl,
  errorResponse,
  extractDomain,
  getDayBucket,
  getEffectiveBotToken,
  getRateForCountry,
  jsonResponse,
  loadSettings,
  maskUsername,
  publicSettingsView,
  sanitizeSlug,
  validateHttpUrl,
  validateImageUrl,
} from './helpers.ts';
import type { AppSettingsMap, D1Database, Env, LinkRow, UserRow, WithdrawalRow } from './types.ts';

const DEMO_CREATOR_ID = '100000001';
const SYSTEM_DEMO_OWNER_ID = '900000001';

const ALLOWED_SETTING_KEYS = new Set([
  'site_name',
  'bot_username',
  'app_short_name',
  'bot_token',
  'storage_channel_id',
  'adsgram_block_id',
  'rate_in_micros',
  'rate_tier1_micros',
  'rate_global_micros',
  'min_withdraw_micros',
  'currency_label',
  'payout_channel_url',
]);

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function getOrigin(request: Request, env: Env): string {
  if (env.APP_URL && env.APP_URL.trim().startsWith('http')) {
    return env.APP_URL.trim().replace(/\/+$/, '');
  }
  return new URL(request.url).origin;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

function getClientCountry(request: Request): string {
  return (request.headers.get('CF-IPCountry') || 'GLOBAL').toUpperCase().slice(0, 8);
}

async function ensureUser(
  db: D1Database,
  telegramId: string,
  username: string
): Promise<UserRow> {
  const existing = await db
    .prepare('SELECT * FROM users WHERE telegram_id = ? LIMIT 1')
    .bind(telegramId)
    .first<UserRow>();
  if (existing) {
    if (username && username !== existing.username && existing.username.startsWith('user_')) {
      await db
        .prepare('UPDATE users SET username = ? WHERE telegram_id = ?')
        .bind(username, telegramId)
        .run();
      return { ...existing, username };
    }
    return existing;
  }

  const apiKey = randomApiKey();
  const now = Date.now();
  await db
    .prepare(
      'INSERT OR IGNORE INTO users (telegram_id, username, api_key, balance_micros, total_earned_micros, is_banned, created_at) VALUES (?, ?, ?, 0, 0, 0, ?)'
    )
    .bind(telegramId, username || `creator_${telegramId.slice(-4)}`, apiKey, now)
    .run();

  const created = await db
    .prepare('SELECT * FROM users WHERE telegram_id = ? LIMIT 1')
    .bind(telegramId)
    .first<UserRow>();
  if (!created) {
    throw new Error('Failed to create user profile');
  }
  return created;
}

async function resolveCurrentUser(
  request: Request,
  env: Env,
  settings: AppSettingsMap
): Promise<{ user: UserRow; authMode: 'telegram' | 'preview' }> {
  const initData = request.headers.get('X-Telegram-Init-Data') || '';
  const botToken = getEffectiveBotToken(settings, env.TELEGRAM_BOT_TOKEN);

  if (initData && botToken) {
    const verified = await verifyTelegramInitData(initData, botToken);
    if (verified) {
      const user = await ensureUser(env.DB, verified.id, verified.username);
      return { user, authMode: 'telegram' };
    }
  }

  // Fallback for Telegram Mini App preview before bot_token is configured or desktop browser preview
  if (initData && !botToken) {
    try {
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');
      if (userStr) {
        const parsed = JSON.parse(userStr) as { id?: string | number; username?: string; first_name?: string };
        if (parsed.id) {
          const user = await ensureUser(
            env.DB,
            String(parsed.id),
            (parsed.username || parsed.first_name || `user_${parsed.id}`).slice(0, 64)
          );
          return { user, authMode: 'preview' };
        }
      }
    } catch {
      // ignore malformed preview initData
    }
  }

  const demoUser = await ensureUser(env.DB, DEMO_CREATOR_ID, 'creator_demo');
  return { user: demoUser, authMode: 'preview' };
}

function formatLinkForClient(link: LinkRow, origin: string, settings: AppSettingsMap) {
  return {
    ...link,
    is_piclink: Boolean(link.title || link.image_url || link.description),
    domain: extractDomain(link.destination_url),
    telegram_url: buildTelegramUrl(link.slug, settings),
    piclink_url: buildPicLinkUrl(origin, link.slug),
    web_unlock_url: `${origin}/?startapp=r_${encodeURIComponent(link.slug)}`,
  };
}

function computeExpiryTimestamp(expiry: unknown): number | null {
  if (expiry === '24h') return Date.now() + 24 * 60 * 60 * 1000;
  if (expiry === '7d') return Date.now() + 7 * 24 * 60 * 60 * 1000;
  return null;
}

async function requireAdmin(request: Request, env: Env): Promise<{ ok: boolean }> {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return { ok: false };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false };

  const secret = getSigningSecret(env.CLICK_HMAC_SECRET || env.ADMIN_PASSWORD);
  const payload = await verifyToken<{ role?: string; exp?: number }>(token, secret);
  if (!payload || payload.role !== 'admin') return { ok: false };
  return { ok: true };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function handleImageProxy(
  fileId: string,
  env: Env
): Promise<Response> {
  const cleanId = (fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(cleanId)) {
    return errorResponse('Invalid image identifier', 400);
  }

  // Serve locally stored / D1 uploaded image
  const localImg = await env.DB.prepare(
    'SELECT mime_type, data_base64 FROM uploaded_images WHERE file_id = ? LIMIT 1'
  )
    .bind(cleanId)
    .first<{ mime_type: string; data_base64: string }>();

  if (localImg) {
    const bytes = base64ToUint8Array(localImg.data_base64);
    return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': ALLOWED_IMAGE_MIMES.has(localImg.mime_type)
          ? localImg.mime_type
          : 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  }

  // Proxy via Telegram Bot Storage Channel
  const settings = await loadSettings(env.DB);
  const botToken = getEffectiveBotToken(settings, env.TELEGRAM_BOT_TOKEN);
  if (!botToken) {
    return errorResponse('Image not found', 404);
  }

  try {
    const metaRes = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getFile?file_id=${encodeURIComponent(cleanId)}`
    );
    const meta = (await metaRes.json()) as {
      ok?: boolean;
      result?: { file_path?: string };
    };
    const filePath = meta.result?.file_path;
    if (!meta.ok || !filePath || filePath.includes('..')) {
      return errorResponse('Telegram image not found', 404);
    }

    const imgRes = await fetch(
      `https://api.telegram.org/file/bot${encodeURIComponent(botToken)}/${filePath}`
    );
    if (!imgRes.ok) {
      return errorResponse('Failed to fetch image from Telegram', 502);
    }

    const contentType = imgRes.headers.get('Content-Type') || 'image/jpeg';
    return new Response(imgRes.body, {
      status: 200,
      headers: {
        'Content-Type': ALLOWED_IMAGE_MIMES.has(contentType.split(';')[0])
          ? contentType
          : 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return errorResponse('Image proxy error', 502);
  }
}

export async function handlePublicShortenApi(
  request: Request,
  env: Env
): Promise<Response> {
  const settings = await loadSettings(env.DB);
  const origin = getOrigin(request, env);
  const urlObj = new URL(request.url);

  let apiKey = '';
  let destUrl = '';
  let customSlug = '';
  let title = '';
  let description = '';
  let imageUrl = '';
  let expiry: unknown = 'never';

  if (request.method === 'GET') {
    apiKey = (urlObj.searchParams.get('api') || request.headers.get('X-API-Key') || '').trim();
    destUrl = (urlObj.searchParams.get('url') || '').trim();
    customSlug = (urlObj.searchParams.get('slug') || '').trim();
    title = (urlObj.searchParams.get('title') || '').trim().slice(0, 120);
    description = (urlObj.searchParams.get('description') || '').trim().slice(0, 280);
    imageUrl = (urlObj.searchParams.get('image_url') || '').trim();
    expiry = urlObj.searchParams.get('expiry') || 'never';
  } else if (request.method === 'POST') {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return errorResponse('Invalid JSON payload', 400);
    }
    apiKey = String(body.api || body.api_key || request.headers.get('X-API-Key') || '').trim();
    destUrl = String(body.url || body.destination_url || '').trim();
    customSlug = String(body.slug || '').trim();
    title = String(body.title || '').trim().slice(0, 120);
    description = String(body.description || '').trim().slice(0, 280);
    imageUrl = String(body.image_url || '').trim();
    expiry = body.expiry || 'never';
  } else {
    return errorResponse('Method not allowed', 405);
  }

  if (!apiKey) {
    return errorResponse('Missing Admin API key (provide api query param or X-API-Key header)', 401);
  }

  const storedAdminKey = (settings.admin_api_key || '').trim();
  if (!storedAdminKey) {
    return errorResponse('Admin Developer API key is not initialized yet. Open /admin to generate it.', 403);
  }

  const keyValid = await verifyPlaintextConstantTime(apiKey, storedAdminKey);
  if (!keyValid) {
    return errorResponse('Invalid Admin API key', 401);
  }

  const owner = await ensureUser(env.DB, SYSTEM_DEMO_OWNER_ID, 'linkvault_admin');

  const validatedDest = validateHttpUrl(destUrl);
  if (!validatedDest) {
    return errorResponse('Invalid destination URL. Must start with http:// or https://', 400);
  }

  const validatedImg = validateImageUrl(imageUrl);
  if (validatedImg === null) {
    return errorResponse('Invalid image_url format', 400);
  }

  let slug = '';
  if (customSlug) {
    const clean = sanitizeSlug(customSlug);
    if (!clean) {
      return errorResponse('Custom slug must be 3-40 alphanumeric, dash, or underscore characters', 400);
    }
    const taken = await env.DB.prepare('SELECT id FROM links WHERE slug = ? LIMIT 1')
      .bind(clean)
      .first();
    if (taken) {
      return errorResponse('Custom slug is already taken', 409);
    }
    slug = clean;
  } else {
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = randomSlug(6);
      const exists = await env.DB.prepare('SELECT id FROM links WHERE slug = ? LIMIT 1')
        .bind(candidate)
        .first();
      if (!exists) {
        slug = candidate;
        break;
      }
    }
    if (!slug) {
      return errorResponse('Could not allocate unique slug, please retry', 500);
    }
  }

  const now = Date.now();
  const expiresAt = computeExpiryTimestamp(expiry);

  await env.DB.prepare(
    `INSERT INTO links (slug, owner_telegram_id, destination_url, title, description, image_url, verified_clicks, earned_micros, expires_at, is_disabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)`
  )
    .bind(slug, owner.telegram_id, validatedDest, title, description, validatedImg, expiresAt, now)
    .run();

  return jsonResponse({
    status: 'success',
    slug,
    telegram_url: buildTelegramUrl(slug, settings),
    piclink_url: buildPicLinkUrl(origin, slug),
    destination_url: validatedDest,
    expires_at: expiresAt,
  });
}

export async function handleTelegramWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const settings = await loadSettings(env.DB);
  if (settings.webhook_secret) {
    const headerSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    const valid = await verifyPlaintextConstantTime(headerSecret, settings.webhook_secret);
    if (!valid) {
      return errorResponse('Unauthorized webhook request', 401);
    }
  }

  let update: {
    message?: {
      chat?: { id?: number | string };
      from?: { id?: number | string; username?: string; first_name?: string };
      text?: string;
    };
  };
  try {
    update = (await request.json()) as typeof update;
  } catch {
    return jsonResponse({ ok: true });
  }

  const msg = update.message;
  if (!msg?.from?.id || !msg.chat?.id) {
    return jsonResponse({ ok: true });
  }

  const telegramId = String(msg.from.id);
  const username = (msg.from.username || msg.from.first_name || `user_${telegramId}`).slice(0, 64);
  await ensureUser(env.DB, telegramId, username);

  const botToken = getEffectiveBotToken(settings, env.TELEGRAM_BOT_TOKEN);
  const text = (msg.text || '').trim();
  const origin = getOrigin(request, env);

  if (botToken && text.startsWith('/start')) {
    const welcomeText =
      `Welcome to ${settings.site_name}.\n\n` +
      `Create monetized Telegram short links, custom social PicLink cards, and QR codes with transparent payouts.`;

    try {
      await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: msg.chat.id,
          text: welcomeText,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: `Launch ${settings.site_name}`,
                  web_app: { url: origin },
                },
              ],
            ],
          },
        }),
      });
    } catch {
      // Do not fail webhook delivery on outbound notification error
    }
  }

  return jsonResponse({ ok: true });
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const origin = getOrigin(request, env);

  // Dedicated public/webhook/image routes
  if (path === '/api/v1/shorten') {
    return handlePublicShortenApi(request, env);
  }
  if (path === '/api/telegram/webhook') {
    return handleTelegramWebhook(request, env);
  }
  if (path.startsWith('/api/img/')) {
    const fileId = decodeURIComponent(path.slice('/api/img/'.length));
    return handleImageProxy(fileId, env);
  }

  const settings = await loadSettings(env.DB);

  // ─── PUBLIC PAYOUTS PROOF FEED ───────────────────────────────────────────
  if (path === '/api/payouts' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, telegram_id, username, amount_micros, method, tx_proof, processed_at, created_at
       FROM withdrawals
       WHERE status = 'paid'
       ORDER BY COALESCE(processed_at, created_at) DESC
       LIMIT 30`
    ).all<WithdrawalRow>();

    return jsonResponse({
      status: 'success',
      currency_label: settings.currency_label || 'USDT',
      payout_channel_url: settings.payout_channel_url || '',
      payouts: results.map((w) => ({
        id: w.id,
        masked_user: maskUsername(w.username, w.telegram_id),
        amount_micros: w.amount_micros,
        method: w.method,
        tx_proof: w.tx_proof,
        paid_at: w.processed_at || w.created_at,
      })),
    });
  }

  // ─── BOOTSTRAP (USER + STATS + PUBLIC SETTINGS) ──────────────────────────
  if (path === '/api/bootstrap' && method === 'GET') {
    const { user, authMode } = await resolveCurrentUser(request, env, settings);
    const today = getDayBucket();
    const country = getClientCountry(request);

    const todayRow = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt
       FROM click_logs cl
       INNER JOIN links l ON l.id = cl.link_id
       WHERE l.owner_telegram_id = ? AND cl.day_bucket = ? AND cl.credited = 1`
    )
      .bind(user.telegram_id, today)
      .first<{ cnt: number }>();

    const totalViewsRow = await env.DB.prepare(
      'SELECT COALESCE(SUM(verified_clicks), 0) AS total FROM links WHERE owner_telegram_id = ?'
    )
      .bind(user.telegram_id)
      .first<{ total: number }>();

    const pendingRow = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount_micros), 0) AS total FROM withdrawals WHERE telegram_id = ? AND status = 'pending'"
    )
      .bind(user.telegram_id)
      .first<{ total: number }>();

    const paidRow = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount_micros), 0) AS total FROM withdrawals WHERE telegram_id = ? AND status = 'paid'"
    )
      .bind(user.telegram_id)
      .first<{ total: number }>();

    const demoLink = await env.DB.prepare(
      'SELECT slug FROM links WHERE is_disabled = 0 AND owner_telegram_id = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(SYSTEM_DEMO_OWNER_ID)
      .first<{ slug: string }>();

    return jsonResponse({
      status: 'success',
      auth_mode: authMode,
      user: {
        telegram_id: user.telegram_id,
        username: user.username,
        balance_micros: user.balance_micros,
        total_earned_micros: user.total_earned_micros,
        is_banned: user.is_banned === 1,
        created_at: user.created_at,
      },
      stats: {
        today_verified_views: Number(todayRow?.cnt || 0),
        total_verified_views: Number(totalViewsRow?.total || 0),
        pending_payout_micros: Number(pendingRow?.total || 0),
        total_paid_micros: Number(paidRow?.total || 0),
        current_rate_micros: getRateForCountry(country, settings),
        viewer_country: country,
      },
      settings: publicSettingsView(settings),
      demo_slug: demoLink?.slug || 'creator-kit',
      origin,
    });
  }

  // ─── LINKS CRUD ──────────────────────────────────────────────────────────
  if (path === '/api/links' && method === 'GET') {
    const { user } = await resolveCurrentUser(request, env, settings);
    const { results } = await env.DB.prepare(
      'SELECT * FROM links WHERE owner_telegram_id = ? ORDER BY created_at DESC LIMIT 200'
    )
      .bind(user.telegram_id)
      .all<LinkRow>();

    return jsonResponse({
      status: 'success',
      links: results.map((l) => formatLinkForClient(l, origin, settings)),
    });
  }

  if (path === '/api/links' && method === 'POST') {
    const { user } = await resolveCurrentUser(request, env, settings);
    if (user.is_banned === 1) {
      return errorResponse('Your account is restricted from creating links.', 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return errorResponse('Invalid request body', 400);
    }

    const validatedDest = validateHttpUrl(String(body.destination_url || ''));
    if (!validatedDest) {
      return errorResponse('Please enter a valid http:// or https:// destination URL.', 400);
    }

    const title = String(body.title || '').trim().slice(0, 120);
    const description = String(body.description || '').trim().slice(0, 280);
    const validatedImg = validateImageUrl(String(body.image_url || ''));
    if (validatedImg === null) {
      return errorResponse('Thumbnail image URL must be a valid https:// URL or uploaded image.', 400);
    }

    const rawSlug = String(body.slug || '').trim();
    let slug = '';
    if (rawSlug) {
      const clean = sanitizeSlug(rawSlug);
      if (!clean) {
        return errorResponse('Custom slug must be 3–40 characters (letters, numbers, -, _).', 400);
      }
      const existing = await env.DB.prepare('SELECT id FROM links WHERE slug = ? LIMIT 1')
        .bind(clean)
        .first();
      if (existing) {
        return errorResponse('That custom slug is already in use. Choose another.', 409);
      }
      slug = clean;
    } else {
      for (let i = 0; i < 6; i++) {
        const candidate = randomSlug(6);
        const exists = await env.DB.prepare('SELECT id FROM links WHERE slug = ? LIMIT 1')
          .bind(candidate)
          .first();
        if (!exists) {
          slug = candidate;
          break;
        }
      }
      if (!slug) return errorResponse('Unable to generate unique slug', 500);
    }

    const now = Date.now();
    const expiresAt = computeExpiryTimestamp(body.expiry);

    await env.DB.prepare(
      `INSERT INTO links (slug, owner_telegram_id, destination_url, title, description, image_url, verified_clicks, earned_micros, expires_at, is_disabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)`
    )
      .bind(slug, user.telegram_id, validatedDest, title, description, validatedImg, expiresAt, now)
      .run();

    const created = await env.DB.prepare('SELECT * FROM links WHERE slug = ? LIMIT 1')
      .bind(slug)
      .first<LinkRow>();
    if (!created) return errorResponse('Failed to save link', 500);

    return jsonResponse(
      {
        status: 'success',
        link: formatLinkForClient(created, origin, settings),
      },
      201
    );
  }

  const linkIdMatch = path.match(/^\/api\/links\/(\d+)$/);
  if (linkIdMatch && method === 'PATCH') {
    const { user } = await resolveCurrentUser(request, env, settings);
    const linkId = Number(linkIdMatch[1]);
    const existing = await env.DB.prepare(
      'SELECT * FROM links WHERE id = ? AND owner_telegram_id = ? LIMIT 1'
    )
      .bind(linkId, user.telegram_id)
      .first<LinkRow>();
    if (!existing) return errorResponse('Link not found', 404);

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return errorResponse('Invalid JSON payload', 400);
    }

    const nextDest =
      body.destination_url !== undefined
        ? validateHttpUrl(String(body.destination_url))
        : existing.destination_url;
    if (!nextDest) {
      return errorResponse('Destination URL must be a valid http:// or https:// link.', 400);
    }

    const nextImg =
      body.image_url !== undefined
        ? validateImageUrl(String(body.image_url))
        : existing.image_url;
    if (nextImg === null) {
      return errorResponse('Invalid thumbnail image URL', 400);
    }

    const nextTitle =
      body.title !== undefined ? String(body.title).trim().slice(0, 120) : existing.title;
    const nextDesc =
      body.description !== undefined
        ? String(body.description).trim().slice(0, 280)
        : existing.description;
    const nextExpiry =
      body.expiry !== undefined ? computeExpiryTimestamp(body.expiry) : existing.expires_at;

    await env.DB.prepare(
      `UPDATE links
       SET destination_url = ?, title = ?, description = ?, image_url = ?, expires_at = ?
       WHERE id = ? AND owner_telegram_id = ?`
    )
      .bind(nextDest, nextTitle, nextDesc, nextImg, nextExpiry, linkId, user.telegram_id)
      .run();

    const updated = await env.DB.prepare('SELECT * FROM links WHERE id = ? LIMIT 1')
      .bind(linkId)
      .first<LinkRow>();

    return jsonResponse({
      status: 'success',
      link: updated ? formatLinkForClient(updated, origin, settings) : null,
    });
  }

  if (linkIdMatch && method === 'DELETE') {
    const { user } = await resolveCurrentUser(request, env, settings);
    const linkId = Number(linkIdMatch[1]);
    const existing = await env.DB.prepare(
      'SELECT id FROM links WHERE id = ? AND owner_telegram_id = ? LIMIT 1'
    )
      .bind(linkId, user.telegram_id)
      .first();
    if (!existing) return errorResponse('Link not found', 404);

    await env.DB.prepare('DELETE FROM click_logs WHERE link_id = ?').bind(linkId).run();
    await env.DB.prepare('DELETE FROM links WHERE id = ? AND owner_telegram_id = ?')
      .bind(linkId, user.telegram_id)
      .run();

    return jsonResponse({ status: 'success', deleted_id: linkId });
  }

  // ─── IMAGE UPLOAD (TELEGRAM STORAGE CHANNEL OR D1 FALLBACK) ─────────────
  if (path === '/api/upload' && method === 'POST') {
    const { user } = await resolveCurrentUser(request, env, settings);
    if (user.is_banned === 1) {
      return errorResponse('Account is restricted', 403);
    }

    let mimeType = '';
    let imageBytes: Uint8Array | null = null;
    let fileName = 'thumbnail.jpg';

    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        return errorResponse('No image file uploaded', 400);
      }
      mimeType = file.type || 'image/jpeg';
      fileName = file.name || 'thumbnail.jpg';
      const buf = await file.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > 4 * 1024 * 1024) {
        return errorResponse('Image must be smaller than 4 MB', 400);
      }
      imageBytes = new Uint8Array(buf);
    } else {
      let body: { mime_type?: string; data_base64?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return errorResponse('Invalid upload body', 400);
      }
      mimeType = String(body.mime_type || 'image/jpeg');
      const b64 = String(body.data_base64 || '').replace(/^data:image\/[a-z+]+;base64,/, '');
      if (!b64) return errorResponse('Missing image data', 400);
      imageBytes = base64ToUint8Array(b64);
      if (imageBytes.byteLength === 0 || imageBytes.byteLength > 4 * 1024 * 1024) {
        return errorResponse('Image must be smaller than 4 MB', 400);
      }
    }

    if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
      return errorResponse('Supported image formats: JPG, PNG, WebP, GIF', 400);
    }

    const botToken = getEffectiveBotToken(settings, env.TELEGRAM_BOT_TOKEN);
    const storageChannelId = (settings.storage_channel_id || '').trim();

    if (botToken && storageChannelId) {
      try {
        const tgForm = new FormData();
        tgForm.append('chat_id', storageChannelId);
        const blob = new Blob(
          [imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength) as ArrayBuffer],
          { type: mimeType }
        );
        tgForm.append('photo', blob, fileName);

        const tgRes = await fetch(
          `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendPhoto`,
          { method: 'POST', body: tgForm }
        );
        const tgJson = (await tgRes.json()) as {
          ok?: boolean;
          result?: { photo?: Array<{ file_id: string }> };
        };
        const photos = tgJson.result?.photo;
        if (tgJson.ok && photos && photos.length > 0) {
          const bestFileId = photos[photos.length - 1].file_id;
          return jsonResponse({
            status: 'success',
            file_id: bestFileId,
            url: `/api/img/${encodeURIComponent(bestFileId)}`,
            storage: 'telegram',
          });
        }
      } catch {
        // Fall through cleanly to local/D1 image storage
      }
    }

    const fileId = randomFileId();
    const b64 = arrayBufferToBase64(
      imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength) as ArrayBuffer
    );
    await env.DB.prepare(
      'INSERT INTO uploaded_images (file_id, mime_type, data_base64, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(fileId, mimeType, b64, Date.now())
      .run();

    return jsonResponse({
      status: 'success',
      file_id: fileId,
      url: `/api/img/${encodeURIComponent(fileId)}`,
      storage: 'd1',
    });
  }

  // ─── DEEP-LINK UNLOCK & HMAC CLICK VERIFICATION ──────────────────────────
  const unlockMatch = path.match(/^\/api\/unlock\/([^/]+)$/);
  if (unlockMatch && method === 'GET') {
    const slug = decodeURIComponent(unlockMatch[1]).trim();
    const { user } = await resolveCurrentUser(request, env, settings);

    const link = await env.DB.prepare('SELECT * FROM links WHERE slug = ? LIMIT 1')
      .bind(slug)
      .first<LinkRow>();

    if (!link) {
      return errorResponse('This link could not be found.', 404);
    }
    if (link.is_disabled === 1) {
      return errorResponse('This link has been disabled by moderation.', 410);
    }
    if (link.expires_at && Date.now() > link.expires_at) {
      return errorResponse('This link has expired.', 410);
    }

    const secret = getSigningSecret(env.CLICK_HMAC_SECRET || env.ADMIN_PASSWORD);
    const verifyTokenStr = await signToken(
      {
        slug: link.slug,
        link_id: link.id,
        viewer_id: user.telegram_id,
        exp: Date.now() + 5 * 60 * 1000,
      },
      secret
    );

    return jsonResponse({
      status: 'success',
      link: {
        id: link.id,
        slug: link.slug,
        title: link.title || `Unlock ${extractDomain(link.destination_url)}`,
        description:
          link.description ||
          'Watch a short sponsored ad to unlock the destination link safely.',
        image_url: link.image_url,
        domain: extractDomain(link.destination_url),
        verified_clicks: link.verified_clicks,
        is_owner: link.owner_telegram_id === user.telegram_id,
        is_demo: link.owner_telegram_id === SYSTEM_DEMO_OWNER_ID,
      },
      adsgram_block_id: settings.adsgram_block_id || '',
      site_name: settings.site_name || 'LinkVault',
      verify_token: verifyTokenStr,
    });
  }

  if (path === '/api/verify-click' && method === 'POST') {
    let body: { token?: string; ad_completed?: boolean; preview_mode?: boolean } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse('Invalid JSON payload', 400);
    }

    if (!body.token || body.ad_completed !== true) {
      return errorResponse('Ad completion verification is required before unlocking.', 400);
    }

    const secret = getSigningSecret(env.CLICK_HMAC_SECRET || env.ADMIN_PASSWORD);
    const payload = await verifyToken<{
      slug: string;
      link_id: number;
      viewer_id: string;
      exp: number;
    }>(body.token, secret);

    if (!payload || !payload.link_id || !payload.viewer_id) {
      return errorResponse('Unlock session expired or invalid. Please reload the link.', 401);
    }

    const link = await env.DB.prepare('SELECT * FROM links WHERE id = ? LIMIT 1')
      .bind(payload.link_id)
      .first<LinkRow>();
    if (!link || link.is_disabled === 1 || (link.expires_at && Date.now() > link.expires_at)) {
      return errorResponse('Link is no longer available.', 410);
    }

    // Owner cannot farm their own link
    if (link.owner_telegram_id === payload.viewer_id) {
      return jsonResponse({
        status: 'success',
        destination_url: link.destination_url,
        credited: false,
        reason: 'owner_preview',
        message: 'Destination unlocked (link owner views are not monetized).',
      });
    }

    // System demo link preview
    if (link.owner_telegram_id === SYSTEM_DEMO_OWNER_ID || body.preview_mode) {
      return jsonResponse({
        status: 'success',
        destination_url: link.destination_url,
        credited: false,
        reason: 'demo_preview',
        message: 'Demo unlock flow verified successfully.',
      });
    }

    const ipHash = await sha256Hex(getClientIp(request));
    const dedupeKey = await sha256Hex(`${payload.viewer_id}:${ipHash}:${link.id}`);
    const dayBucket = getDayBucket();
    const country = getClientCountry(request);
    const ratePer1000 = getRateForCountry(country, settings);
    const creditMicros = Math.max(1, Math.round(ratePer1000 / 1000));

    const insertRes = await env.DB.prepare(
      `INSERT OR IGNORE INTO click_logs (dedupe_key, day_bucket, link_id, country, credited, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
      .bind(dedupeKey, dayBucket, link.id, country, Date.now())
      .run();

    const isUniqueToday = insertRes.meta.changes > 0;

    if (isUniqueToday) {
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE links SET verified_clicks = verified_clicks + 1, earned_micros = earned_micros + ? WHERE id = ?'
        ).bind(creditMicros, link.id),
        env.DB.prepare(
          'UPDATE users SET balance_micros = balance_micros + ?, total_earned_micros = total_earned_micros + ? WHERE telegram_id = ?'
        ).bind(creditMicros, creditMicros, link.owner_telegram_id),
      ]);
    }

    return jsonResponse({
      status: 'success',
      destination_url: link.destination_url,
      credited: isUniqueToday,
      reason: isUniqueToday ? 'verified' : 'already_counted_24h',
      message: isUniqueToday
        ? 'View verified and destination unlocked.'
        : 'Destination unlocked (already verified within 24 hours).',
    });
  }

  // ─── REPORT ABUSE ────────────────────────────────────────────────────────
  if (path === '/api/report' && method === 'POST') {
    const { user } = await resolveCurrentUser(request, env, settings);
    let body: { slug?: string; reason?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse('Invalid JSON payload', 400);
    }

    const slug = String(body.slug || '').trim();
    const reason = String(body.reason || '').trim().slice(0, 300);
    if (!slug || !reason) {
      return errorResponse('Please specify a reason for reporting this link.', 400);
    }

    const link = await env.DB.prepare('SELECT id, slug FROM links WHERE slug = ? LIMIT 1')
      .bind(slug)
      .first<{ id: number; slug: string }>();
    if (!link) return errorResponse('Link not found', 404);

    await env.DB.prepare(
      'INSERT INTO abuse_reports (link_id, slug, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(link.id, link.slug, user.telegram_id, reason, Date.now())
      .run();

    return jsonResponse({
      status: 'success',
      message: 'Report submitted for moderation review.',
    });
  }

  // ─── WALLET & WITHDRAWALS ────────────────────────────────────────────────
  if (path === '/api/wallet' && method === 'GET') {
    const { user } = await resolveCurrentUser(request, env, settings);

    const { results: myWithdrawals } = await env.DB.prepare(
      'SELECT * FROM withdrawals WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 50'
    )
      .bind(user.telegram_id)
      .all<WithdrawalRow>();

    const { results: publicPayouts } = await env.DB.prepare(
      `SELECT id, telegram_id, username, amount_micros, method, tx_proof, processed_at, created_at
       FROM withdrawals
       WHERE status = 'paid'
       ORDER BY COALESCE(processed_at, created_at) DESC
       LIMIT 25`
    ).all<WithdrawalRow>();

    let pendingMicros = 0;
    let totalPaidMicros = 0;
    for (const w of myWithdrawals) {
      if (w.status === 'pending') pendingMicros += w.amount_micros;
      if (w.status === 'paid') totalPaidMicros += w.amount_micros;
    }

    return jsonResponse({
      status: 'success',
      wallet: {
        balance_micros: user.balance_micros,
        total_earned_micros: user.total_earned_micros,
        pending_micros: pendingMicros,
        total_paid_micros: totalPaidMicros,
        min_withdraw_micros: Number(settings.min_withdraw_micros) || 2000000,
        currency_label: settings.currency_label || 'USDT',
        payout_channel_url: settings.payout_channel_url || '',
      },
      my_withdrawals: myWithdrawals,
      public_payouts: publicPayouts.map((w) => ({
        id: w.id,
        masked_user: maskUsername(w.username, w.telegram_id),
        amount_micros: w.amount_micros,
        method: w.method,
        tx_proof: w.tx_proof,
        paid_at: w.processed_at || w.created_at,
      })),
    });
  }

  if (path === '/api/withdraw' && method === 'POST') {
    const { user } = await resolveCurrentUser(request, env, settings);
    if (user.is_banned === 1) {
      return errorResponse('Account is restricted from withdrawals.', 403);
    }

    let body: { method?: string; payout_address?: string; amount_micros?: number } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse('Invalid request payload', 400);
    }

    const allowedMethods = new Set(['telegram_stars', 'ton_usdt', 'upi']);
    const methodVal = String(body.method || '');
    if (!allowedMethods.has(methodVal)) {
      return errorResponse('Unsupported payout method.', 400);
    }

    const payoutAddress = String(body.payout_address || '').trim().slice(0, 140);
    if (payoutAddress.length < 3) {
      return errorResponse('Please enter a valid payout destination.', 400);
    }

    const minWithdraw = Number(settings.min_withdraw_micros) || 2000000;
    const requestedAmount = Math.floor(Number(body.amount_micros) || 0);
    if (!Number.isFinite(requestedAmount) || requestedAmount < minWithdraw) {
      return errorResponse(
        `Minimum withdrawal is ${(minWithdraw / 1_000_000).toFixed(2)} ${settings.currency_label || 'USDT'}.`,
        400
      );
    }

    // Atomic conditional balance deduction
    const deductRes = await env.DB.prepare(
      'UPDATE users SET balance_micros = balance_micros - ? WHERE telegram_id = ? AND balance_micros >= ?'
    )
      .bind(requestedAmount, user.telegram_id, requestedAmount)
      .run();

    if (deductRes.meta.changes === 0) {
      return errorResponse('Insufficient available balance for this withdrawal.', 400);
    }

    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO withdrawals (telegram_id, username, amount_micros, method, payout_address, status, tx_proof, created_at, processed_at)
       VALUES (?, ?, ?, ?, ?, 'pending', '', ?, NULL)`
    )
      .bind(user.telegram_id, user.username, requestedAmount, methodVal, payoutAddress, now)
      .run();

    return jsonResponse({
      status: 'success',
      message: 'Withdrawal request submitted for admin review.',
    });
  }

  // Public API key regeneration removed — Developer API is strictly Admin-only
  if (path === '/api/api-key/regenerate') {
    return errorResponse('Developer API is restricted to administrators.', 403);
  }

  // ─── ADMIN AUTHENTICATION (FIRST-RUN SETUP + PASSWORD LOGIN) ─────────────
  if (path === '/api/admin/status' && method === 'GET') {
    const envPassword = (env.ADMIN_PASSWORD || '').trim();
    const hasHash = Boolean(settings.admin_password_hash && settings.admin_password_hash.length > 10);
    return jsonResponse({
      status: 'success',
      env_managed: Boolean(envPassword),
      needs_setup: !envPassword && !hasHash,
    });
  }

  if (path === '/api/admin/bootstrap' && method === 'POST') {
    const envPassword = (env.ADMIN_PASSWORD || '').trim();
    const hasHash = Boolean(settings.admin_password_hash && settings.admin_password_hash.length > 10);
    if (envPassword || hasHash) {
      return errorResponse('Admin password is already configured.', 403);
    }

    let body: { password?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse('Invalid JSON payload', 400);
    }

    const password = String(body.password || '');
    if (password.length < 8 || password.length > 128) {
      return errorResponse('Password must be between 8 and 128 characters.', 400);
    }

    const hashed = await hashPassword(password);
    const insertRes = await env.DB.prepare(
      "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('admin_password_hash', ?)"
    )
      .bind(hashed)
      .run();

    if (insertRes.meta.changes === 0) {
      return errorResponse('Admin password was already claimed.', 403);
    }

    const secret = getSigningSecret(env.CLICK_HMAC_SECRET || env.ADMIN_PASSWORD);
    const token = await signToken(
      { role: 'admin', exp: Date.now() + 12 * 60 * 60 * 1000 },
      secret
    );

    return jsonResponse({ status: 'success', token });
  }

  if (path === '/api/admin/login' && method === 'POST') {
    let body: { password?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse('Invalid JSON payload', 400);
    }

    const password = String(body.password || '');
    if (!password) return errorResponse('Password is required.', 400);

    const envPassword = (env.ADMIN_PASSWORD || '').trim();
    let valid = false;

    if (envPassword) {
      valid = await verifyPlaintextConstantTime(password, envPassword);
    } else if (settings.admin_password_hash) {
      valid = await verifyPassword(password, settings.admin_password_hash);
    } else {
      return errorResponse('Admin password not set up yet.', 400);
    }

    if (!valid) {
      return errorResponse('Invalid admin password.', 401);
    }

    const secret = getSigningSecret(env.CLICK_HMAC_SECRET || env.ADMIN_PASSWORD);
    const token = await signToken(
      { role: 'admin', exp: Date.now() + 12 * 60 * 60 * 1000 },
      secret
    );

    return jsonResponse({ status: 'success', token });
  }

  // ─── PROTECTED ADMIN ROUTES ──────────────────────────────────────────────
  if (path.startsWith('/api/admin/')) {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) {
      return errorResponse('Admin authentication required.', 401);
    }

    // Dashboard overview
    if (path === '/api/admin/dashboard' && method === 'GET') {
      const today = getDayBucket();
      const usersCount = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM users').first<{ cnt: number }>();
      const linksCount = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM links').first<{ cnt: number }>();
      const todayViews = await env.DB.prepare(
        'SELECT COUNT(*) AS cnt FROM click_logs WHERE day_bucket = ? AND credited = 1'
      )
        .bind(today)
        .first<{ cnt: number }>();
      const pendingPayouts = await env.DB.prepare(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_micros), 0) AS total FROM withdrawals WHERE status = 'pending'"
      ).first<{ cnt: number; total: number }>();
      const paidPayouts = await env.DB.prepare(
        "SELECT COALESCE(SUM(amount_micros), 0) AS total FROM withdrawals WHERE status = 'paid'"
      ).first<{ total: number }>();
      const reportsCount = await env.DB.prepare(
        'SELECT COUNT(*) AS cnt FROM abuse_reports'
      ).first<{ cnt: number }>();

      return jsonResponse({
        status: 'success',
        metrics: {
          total_users: Number(usersCount?.cnt || 0),
          total_links: Number(linksCount?.cnt || 0),
          today_verified_views: Number(todayViews?.cnt || 0),
          pending_payouts_count: Number(pendingPayouts?.cnt || 0),
          pending_payouts_micros: Number(pendingPayouts?.total || 0),
          total_paid_micros: Number(paidPayouts?.total || 0),
          abuse_reports_count: Number(reportsCount?.cnt || 0),
          currency_label: settings.currency_label || 'USDT',
        },
      });
    }

    // Payout queue with creator view breakdown
    if (path === '/api/admin/withdrawals' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT
           w.*,
           u.balance_micros AS user_balance_micros,
           u.total_earned_micros AS user_total_earned_micros,
           u.is_banned AS user_is_banned,
           (SELECT COALESCE(SUM(verified_clicks), 0) FROM links WHERE owner_telegram_id = w.telegram_id) AS user_verified_views,
           (SELECT COUNT(*) FROM links WHERE owner_telegram_id = w.telegram_id) AS user_links_count
         FROM withdrawals w
         LEFT JOIN users u ON u.telegram_id = w.telegram_id
         ORDER BY CASE WHEN w.status = 'pending' THEN 0 ELSE 1 END, w.created_at DESC
         LIMIT 100`
      ).all();

      return jsonResponse({
        status: 'success',
        currency_label: settings.currency_label || 'USDT',
        withdrawals: results,
      });
    }

    const approveMatch = path.match(/^\/api\/admin\/withdrawals\/(\d+)\/approve$/);
    if (approveMatch && method === 'POST') {
      const wId = Number(approveMatch[1]);
      let body: { tx_proof?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }
      const txProof = String(body.tx_proof || '').trim().slice(0, 200);
      const res = await env.DB.prepare(
        "UPDATE withdrawals SET status = 'paid', tx_proof = ?, processed_at = ? WHERE id = ? AND status = 'pending'"
      )
        .bind(txProof || 'Verified payout', Date.now(), wId)
        .run();

      if (res.meta.changes === 0) {
        return errorResponse('Withdrawal is not pending or does not exist.', 404);
      }
      return jsonResponse({ status: 'success' });
    }

    const rejectMatch = path.match(/^\/api\/admin\/withdrawals\/(\d+)\/reject$/);
    if (rejectMatch && method === 'POST') {
      const wId = Number(rejectMatch[1]);
      let body: { tx_proof?: string } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }
      const note = String(body.tx_proof || 'Rejected by admin').trim().slice(0, 200);

      const withdrawal = await env.DB.prepare(
        "SELECT id, telegram_id, amount_micros FROM withdrawals WHERE id = ? AND status = 'pending' LIMIT 1"
      )
        .bind(wId)
        .first<{ id: number; telegram_id: string; amount_micros: number }>();

      if (!withdrawal) {
        return errorResponse('Withdrawal is not pending or does not exist.', 404);
      }

      await env.DB.batch([
        env.DB.prepare(
          "UPDATE withdrawals SET status = 'rejected', tx_proof = ?, processed_at = ? WHERE id = ? AND status = 'pending'"
        ).bind(note, Date.now(), wId),
        env.DB.prepare(
          'UPDATE users SET balance_micros = balance_micros + ? WHERE telegram_id = ?'
        ).bind(withdrawal.amount_micros, withdrawal.telegram_id),
      ]);

      return jsonResponse({ status: 'success' });
    }

    // Links moderation
    if (path === '/api/admin/links' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      const like = `%${q}%`;
      const query = q
        ? `SELECT l.*, u.username AS owner_username,
             (SELECT COUNT(*) FROM abuse_reports ar WHERE ar.link_id = l.id) AS reports_count
           FROM links l
           LEFT JOIN users u ON u.telegram_id = l.owner_telegram_id
           WHERE l.slug LIKE ? OR l.destination_url LIKE ? OR l.title LIKE ? OR u.username LIKE ?
           ORDER BY l.created_at DESC LIMIT 150`
        : `SELECT l.*, u.username AS owner_username,
             (SELECT COUNT(*) FROM abuse_reports ar WHERE ar.link_id = l.id) AS reports_count
           FROM links l
           LEFT JOIN users u ON u.telegram_id = l.owner_telegram_id
           ORDER BY l.created_at DESC LIMIT 150`;

      const stmt = q
        ? env.DB.prepare(query).bind(like, like, like, like)
        : env.DB.prepare(query);
      const { results } = await stmt.all();

      return jsonResponse({ status: 'success', links: results });
    }

    const adminLinkMatch = path.match(/^\/api\/admin\/links\/(\d+)$/);
    if (adminLinkMatch && method === 'PATCH') {
      const linkId = Number(adminLinkMatch[1]);
      let body: { is_disabled?: boolean } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return errorResponse('Invalid JSON payload', 400);
      }
      const disabledVal = body.is_disabled ? 1 : 0;
      await env.DB.prepare('UPDATE links SET is_disabled = ? WHERE id = ?')
        .bind(disabledVal, linkId)
        .run();
      return jsonResponse({ status: 'success', id: linkId, is_disabled: disabledVal });
    }

    // Users moderation
    if (path === '/api/admin/users' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      const like = `%${q}%`;
      const query = q
        ? `SELECT u.telegram_id, u.username, u.balance_micros, u.total_earned_micros, u.is_banned, u.created_at,
             (SELECT COUNT(*) FROM links l WHERE l.owner_telegram_id = u.telegram_id) AS links_count,
             (SELECT COALESCE(SUM(l.verified_clicks), 0) FROM links l WHERE l.owner_telegram_id = u.telegram_id) AS total_views
           FROM users u
           WHERE u.telegram_id LIKE ? OR u.username LIKE ?
           ORDER BY u.created_at DESC LIMIT 150`
        : `SELECT u.telegram_id, u.username, u.balance_micros, u.total_earned_micros, u.is_banned, u.created_at,
             (SELECT COUNT(*) FROM links l WHERE l.owner_telegram_id = u.telegram_id) AS links_count,
             (SELECT COALESCE(SUM(l.verified_clicks), 0) FROM links l WHERE l.owner_telegram_id = u.telegram_id) AS total_views
           FROM users u
           ORDER BY u.created_at DESC LIMIT 150`;

      const stmt = q ? env.DB.prepare(query).bind(like, like) : env.DB.prepare(query);
      const { results } = await stmt.all();

      return jsonResponse({ status: 'success', users: results });
    }

    const adminUserMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && method === 'PATCH') {
      const targetId = decodeURIComponent(adminUserMatch[1]);
      let body: { is_banned?: boolean } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return errorResponse('Invalid JSON payload', 400);
      }
      const bannedVal = body.is_banned ? 1 : 0;
      await env.DB.prepare('UPDATE users SET is_banned = ? WHERE telegram_id = ?')
        .bind(bannedVal, targetId)
        .run();
      return jsonResponse({ status: 'success', telegram_id: targetId, is_banned: bannedVal });
    }

    // Admin Developer API key management (Admin-only)
    if (path === '/api/admin/api-key' && method === 'GET') {
      let adminKey = (settings.admin_api_key || '').trim();
      if (!adminKey) {
        adminKey = randomApiKey();
        await env.DB.prepare(
          "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('admin_api_key', ?)"
        )
          .bind(adminKey)
          .run();
      }
      return jsonResponse({
        status: 'success',
        api_key: adminKey,
        origin,
      });
    }

    if (path === '/api/admin/api-key/regenerate' && method === 'POST') {
      const nextKey = randomApiKey();
      await env.DB.prepare(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('admin_api_key', ?)"
      )
        .bind(nextKey)
        .run();
      return jsonResponse({
        status: 'success',
        api_key: nextKey,
      });
    }

    // Settings
    if (path === '/api/admin/settings' && method === 'GET') {
      const {
        admin_password_hash: _h,
        webhook_secret: _w,
        admin_api_key: _k,
        ...safeSettings
      } = settings;
      return jsonResponse({
        status: 'success',
        settings: safeSettings,
        webhook_url: `${origin}/api/telegram/webhook`,
      });
    }

    if (path === '/api/admin/settings' && method === 'PUT') {
      let body: Record<string, unknown> = {};
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return errorResponse('Invalid JSON payload', 400);
      }

      const statements = [];
      for (const [key, val] of Object.entries(body)) {
        if (!ALLOWED_SETTING_KEYS.has(key)) continue;
        const strVal = String(val ?? '').trim();
        if (key === 'payout_channel_url' && strVal && !validateHttpUrl(strVal)) {
          return errorResponse('Payout Channel URL must be a valid http:// or https:// URL.', 400);
        }
        statements.push(
          env.DB.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').bind(
            key,
            strVal
          )
        );
      }

      if (statements.length > 0) {
        await env.DB.batch(statements);
      }

      const updated = await loadSettings(env.DB);
      const {
        admin_password_hash: _h,
        webhook_secret: _w,
        admin_api_key: _k,
        ...safeSettings
      } = updated;
      return jsonResponse({ status: 'success', settings: safeSettings });
    }

    // 1-click Telegram Webhook setup
    if (path === '/api/admin/setup-webhook' && method === 'POST') {
      const botToken = getEffectiveBotToken(settings, env.TELEGRAM_BOT_TOKEN);
      if (!botToken) {
        return errorResponse('Please save your Telegram Bot Token in Settings first.', 400);
      }

      const webhookSecret = settings.webhook_secret || randomApiKey().replace('lv_', 'wh_');
      await env.DB.prepare(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('webhook_secret', ?)"
      )
        .bind(webhookSecret)
        .run();

      const webhookUrl = `${origin}/api/telegram/webhook`;
      try {
        const tgRes = await fetch(
          `https://api.telegram.org/bot${encodeURIComponent(botToken)}/setWebhook`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: webhookUrl,
              secret_token: webhookSecret,
              allowed_updates: ['message'],
            }),
          }
        );
        const tgJson = (await tgRes.json()) as { ok?: boolean; description?: string };
        if (!tgJson.ok) {
          return errorResponse(tgJson.description || 'Telegram setWebhook failed.', 400);
        }
        return jsonResponse({
          status: 'success',
          webhook_url: webhookUrl,
          description: tgJson.description || 'Webhook registered with Telegram.',
        });
      } catch {
        return errorResponse('Failed to reach Telegram Bot API.', 502);
      }
    }

    // Batched Broadcast (max 25 users per call — safe under Cloudflare 50 subrequest limit)
    if (path === '/api/admin/broadcast' && method === 'POST') {
      let body: {
        message?: string;
        button_text?: string;
        button_url?: string;
        offset?: number;
        batch_size?: number;
      } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return errorResponse('Invalid JSON payload', 400);
      }

      const message = String(body.message || '').trim();
      if (!message || message.length > 3500) {
        return errorResponse('Broadcast message must be 1–3500 characters.', 400);
      }

      const buttonText = String(body.button_text || '').trim().slice(0, 64);
      const rawBtnUrl = String(body.button_url || '').trim();
      const validBtnUrl = rawBtnUrl ? validateHttpUrl(rawBtnUrl) : null;
      if (rawBtnUrl && !validBtnUrl) {
        return errorResponse('Button URL must be a valid http:// or https:// link.', 400);
      }

      const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
      const batchSize = Math.min(25, Math.max(1, Math.floor(Number(body.batch_size) || 25)));

      const totalRow = await env.DB.prepare(
        'SELECT COUNT(*) AS cnt FROM users WHERE is_banned = 0'
      ).first<{ cnt: number }>();
      const totalUsers = Number(totalRow?.cnt || 0);

      const { results: recipients } = await env.DB.prepare(
        'SELECT telegram_id FROM users WHERE is_banned = 0 ORDER BY created_at ASC LIMIT ? OFFSET ?'
      )
        .bind(batchSize, offset)
        .all<{ telegram_id: string }>();

      const botToken = getEffectiveBotToken(settings, env.TELEGRAM_BOT_TOKEN);
      let sent = 0;
      let failed = 0;
      const dryRun = !botToken;

      if (dryRun) {
        sent = recipients.length;
      } else {
        const replyMarkup =
          buttonText && validBtnUrl
            ? { inline_keyboard: [[{ text: buttonText, url: validBtnUrl }]] }
            : undefined;

        for (const r of recipients) {
          try {
            const tgRes = await fetch(
              `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: r.telegram_id,
                  text: message,
                  reply_markup: replyMarkup,
                }),
              }
            );
            const tgJson = (await tgRes.json()) as { ok?: boolean };
            if (tgJson.ok) sent++;
            else failed++;
          } catch {
            failed++;
          }
        }
      }

      const nextOffset = offset + recipients.length;
      return jsonResponse({
        status: 'success',
        dry_run: dryRun,
        total_users: totalUsers,
        processed_in_batch: recipients.length,
        sent,
        failed,
        next_offset: nextOffset,
        done: nextOffset >= totalUsers || recipients.length === 0,
      });
    }
  }

  return errorResponse('API endpoint not found', 404);
}
