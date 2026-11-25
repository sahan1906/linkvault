import 'dotenv/config';
import Database from 'better-sqlite3';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { randomApiKey } from './functions/_lib/crypto.ts';
import { DEFAULT_SETTINGS, getDayBucket } from './functions/_lib/helpers.ts';
import { renderPicLinkPage } from './functions/_lib/piclink.ts';
import { handleApiRequest } from './functions/_lib/router.ts';
import type { D1Database, D1PreparedStatement, Env } from './functions/_lib/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createLocalD1Adapter(sqlite: Database.Database): D1Database {
  const wrapStmt = (query: string, boundValues: unknown[] = []): D1PreparedStatement => ({
    bind(...values: unknown[]) {
      return wrapStmt(query, values);
    },
    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const row = sqlite.prepare(query).get(...boundValues) as Record<string, unknown> | undefined;
      if (!row) return null;
      if (colName) return (row[colName] as T) ?? null;
      return row as T;
    },
    async all<T = Record<string, unknown>>() {
      const results = sqlite.prepare(query).all(...boundValues) as T[];
      return { results, success: true };
    },
    async run() {
      const info = sqlite.prepare(query).run(...boundValues);
      return {
        success: true,
        meta: {
          changes: Number(info.changes || 0),
          last_row_id: Number(info.lastInsertRowid || 0),
        },
      };
    },
  });

  return {
    prepare(query: string) {
      return wrapStmt(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]> {
      const results: T[] = [];
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const stmt of statements) {
          results.push((await stmt.run()) as T);
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

function initDatabase(): Database.Database {
  const dataDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'linkvault.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const schemaSql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8');
  sqlite.exec(schemaSql);

  // Seed default settings if absent
  const insertSetting = sqlite.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
  );
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(k, v);
  }

  // Seed realistic initial demo workspace if database is fresh
  const userCount = sqlite.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
  if (userCount.cnt === 0) {
    const now = Date.now();
    const hour = 3600 * 1000;
    const day = 24 * hour;

    const insertUser = sqlite.prepare(
      'INSERT INTO users (telegram_id, username, api_key, balance_micros, total_earned_micros, is_banned, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    );
    insertUser.run('900000001', 'linkvault_editorial', randomApiKey(), 0, 0, now - 30 * day);
    insertUser.run('100000001', 'creator_demo', randomApiKey(), 3450000, 12850000, now - 14 * day);
    insertUser.run('204819201', 'arjun_dev', randomApiKey(), 1820000, 19400000, now - 25 * day);
    insertUser.run('309184712', 'mira_design', randomApiKey(), 910000, 14200000, now - 21 * day);
    insertUser.run('418273645', 'dan_crypto', randomApiKey(), 2650000, 26800000, now - 18 * day);
    insertUser.run('519283746', 'nina_media', randomApiKey(), 640000, 8900000, now - 10 * day);

    const insertLink = sqlite.prepare(
      `INSERT INTO links (slug, owner_telegram_id, destination_url, title, description, image_url, verified_clicks, earned_micros, expires_at, is_disabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    );

    // Featured demo PicLink for 1-tap Preview Unlock Flow
    insertLink.run(
      'creator-kit',
      '900000001',
      'https://core.telegram.org/bots/webapps',
      'Telegram Mini App Creator Starter Kit',
      'Curated reference guide for building fast, compliant Telegram Mini Apps on Cloudflare Pages & D1.',
      '/src/assets/images/piclink_demo_fintech_1795612304991.jpg',
      1482,
      1185600,
      null,
      now - 12 * day
    );

    // Demo user's sample PicLink & standard short link
    insertLink.run(
      'edge-arch',
      '100000001',
      'https://developers.cloudflare.com/pages/functions/',
      'Cloudflare Pages Edge Architecture Notes',
      'Zero-cost D1 schema patterns, anti-fraud deduplication, and OpenGraph social card templates.',
      '/src/assets/images/piclink_demo_devguide_1795612304148.jpg',
      4820,
      4338000,
      null,
      now - 6 * day
    );

    insertLink.run(
      'tg-docs',
      '100000001',
      'https://telegram.org/blog',
      '',
      '',
      '',
      2190,
      1642500,
      null,
      now - 3 * day
    );

    // Today's verified click records for demo user so "Today's Verified Views" displays real DB count
    const today = getDayBucket(now);
    const insertClick = sqlite.prepare(
      'INSERT INTO click_logs (dedupe_key, day_bucket, link_id, country, credited, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    );
    const demoLinkRow = sqlite.prepare("SELECT id FROM links WHERE slug = 'edge-arch'").get() as { id: number };
    const sampleCountries = ['US', 'IN', 'GB', 'DE', 'CA', 'IN', 'SG', 'US', 'BR', 'NL', 'AU', 'IN'];
    sampleCountries.forEach((cc, idx) => {
      insertClick.run(`seed_click_${idx}_${today}`, today, demoLinkRow.id, cc, now - (idx + 1) * 900_000);
    });

    // Verified admin-approved payouts for the Public Payouts Proof feed
    const insertWithdrawal = sqlite.prepare(
      `INSERT INTO withdrawals (telegram_id, username, amount_micros, method, payout_address, status, tx_proof, created_at, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertWithdrawal.run(
      '418273645',
      'dan_crypto',
      12500000,
      'ton_usdt',
      'UQBx7...91fK',
      'paid',
      'TON TX #8f31c9a2',
      now - 5 * hour,
      now - 3 * hour
    );
    insertWithdrawal.run(
      '204819201',
      'arjun_dev',
      6400000,
      'upi',
      'arjun@okaxis',
      'paid',
      'UPI Ref 6119482013',
      now - 19 * hour,
      now - 14 * hour
    );
    insertWithdrawal.run(
      '309184712',
      'mira_design',
      8000000,
      'telegram_stars',
      '@mira_design',
      'paid',
      'Stars Transfer #ST-4910',
      now - 2 * day,
      now - 42 * hour
    );
    insertWithdrawal.run(
      '100000001',
      'creator_demo',
      5000000,
      'ton_usdt',
      'UQDemo...82pQ',
      'paid',
      'TON TX #4a02e7b1',
      now - 4 * day,
      now - 3 * day
    );
    // One pending payout from another user so Admin Payouts Queue is immediately testable
    insertWithdrawal.run(
      '519283746',
      'nina_media',
      3200000,
      'telegram_stars',
      '@nina_media',
      'pending',
      '',
      now - 2 * hour,
      null
    );
  }

  return sqlite;
}

function toWebRequest(req: express.Request): Request {
  const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
  const fullUrl = `${protocol}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (Array.isArray(val)) {
      headers.set(key, val.join(', '));
    } else if (typeof val === 'string') {
      headers.set(key, val);
    }
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const rawBody = hasBody && Buffer.isBuffer(req.body) ? req.body : undefined;

  return new Request(fullUrl, {
    method: req.method,
    headers,
    body: rawBody && rawBody.length > 0 ? new Uint8Array(rawBody) : undefined,
  });
}

async function sendWebResponse(res: express.Response, webRes: Response): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.send(buf);
}

async function startServer() {
  const sqlite = initDatabase();
  const db = createLocalD1Adapter(sqlite);

  const env: Env = {
    DB: db,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
    CLICK_HMAC_SECRET: process.env.CLICK_HMAC_SECRET || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    APP_URL: process.env.APP_URL || '',
  };

  const app = express();
  app.set('trust proxy', true);

  // Raw body capture strictly for API endpoints (supports JSON + multipart/form-data seamlessly)
  app.use('/api', express.raw({ type: '*/*', limit: '6mb' }));

  app.all('/api/*', async (req, res) => {
    try {
      const webReq = toWebRequest(req);
      const webRes = await handleApiRequest(webReq, env);
      await sendWebResponse(res, webRes);
    } catch (err) {
      console.error('API route error:', err);
      res.status(500).json({ status: 'error', error: 'Internal server error' });
    }
  });

  // Dynamic OpenGraph PicLink preview & redirect route
  app.get('/r/:slug', async (req, res) => {
    try {
      const webReq = toWebRequest(req);
      const webRes = await renderPicLinkPage(req.params.slug, webReq, env);
      await sendWebResponse(res, webRes);
    } catch (err) {
      console.error('PicLink route error:', err);
      res.status(500).send('Unable to render preview');
    }
  });

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(__dirname, 'dist'));

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`LinkVault server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start LinkVault server:', err);
  process.exit(1);
});
