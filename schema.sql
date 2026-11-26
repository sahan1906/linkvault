-- LinkVault Cloudflare D1 (SQLite) Schema
-- Apply with: wrangler d1 execute linkvault-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL UNIQUE,
  balance_micros INTEGER NOT NULL DEFAULT 0,
  total_earned_micros INTEGER NOT NULL DEFAULT 0,
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  owner_telegram_id TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  verified_clicks INTEGER NOT NULL DEFAULT 0,
  earned_micros INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (owner_telegram_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_slug ON links(slug);

CREATE TABLE IF NOT EXISTS click_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL,
  day_bucket TEXT NOT NULL,
  link_id INTEGER NOT NULL,
  country TEXT NOT NULL DEFAULT 'GLOBAL',
  credited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(dedupe_key, day_bucket),
  FOREIGN KEY (link_id) REFERENCES links(id)
);

CREATE INDEX IF NOT EXISTS idx_click_logs_link_day ON click_logs(link_id, day_bucket);
CREATE INDEX IF NOT EXISTS idx_click_logs_day ON click_logs(day_bucket);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  amount_micros INTEGER NOT NULL,
  method TEXT NOT NULL,
  payout_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_proof TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, processed_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  reporter_id TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_link ON abuse_reports(link_id, created_at DESC);

CREATE TABLE IF NOT EXISTS uploaded_images (
  file_id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_sessions (
  id TEXT PRIMARY KEY,
  api_key_owner_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT 'Complete steps to unlock',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gate_sessions_owner ON gate_sessions(api_key_owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_sessions_expires ON gate_sessions(expires_at);


CREATE TABLE IF NOT EXISTS gate_sessions (
  id TEXT PRIMARY KEY,
  api_key_owner_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT 'Complete steps to unlock',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gate_sessions_owner ON gate_sessions(api_key_owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_sessions_expires ON gate_sessions(expires_at);

