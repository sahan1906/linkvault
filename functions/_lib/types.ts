export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
}

export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  CLICK_HMAC_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  APP_URL?: string;
}

export interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
}

export interface UserRow {
  telegram_id: string;
  username: string;
  api_key: string;
  balance_micros: number;
  total_earned_micros: number;
  is_banned: number;
  created_at: number;
}

export interface LinkRow {
  id: number;
  slug: string;
  owner_telegram_id: string;
  destination_url: string;
  title: string;
  description: string;
  image_url: string;
  verified_clicks: number;
  earned_micros: number;
  expires_at: number | null;
  is_disabled: number;
  created_at: number;
}

export interface WithdrawalRow {
  id: number;
  telegram_id: string;
  username: string;
  amount_micros: number;
  method: string;
  payout_address: string;
  status: string;
  tx_proof: string;
  created_at: number;
  processed_at: number | null;
}

export interface AppSettingsMap {
  site_name: string;
  bot_username: string;
  app_short_name: string;
  bot_token: string;
  storage_channel_id: string;
  adsgram_block_id: string;
  rate_in_micros: string;
  rate_tier1_micros: string;
  rate_global_micros: string;
  min_withdraw_micros: string;
  currency_label: string;
  payout_channel_url: string;
  admin_password_hash?: string;
  webhook_secret?: string;
  admin_api_key?: string;
}
