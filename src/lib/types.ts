export interface AdsGramUnit {
  id: string;
  label: string;
  block_id: string;
  enabled: boolean;
}

export interface CleanAdsUnit {
  id: string;
  label: string;
  placement_id: string;
  enabled: boolean;
}

export interface AdNetworkConfig {
  adsgram_units: AdsGramUnit[];
  cleanads_units: CleanAdsUnit[];
  cleanads_test_mode: boolean;
  monetag_enabled: boolean;
  monetag_zone_id: string;
  richads_enabled: boolean;
  richads_pub_id: string;
  richads_app_id: string;
}

export interface PublicSettings {
  site_name: string;
  site_logo_url: string;
  bot_username: string;
  app_short_name: string;
  adsgram_block_id: string;
  ad_config?: AdNetworkConfig;
  rate_in_micros: number;
  rate_tier1_micros: number;
  rate_global_micros: number;
  min_withdraw_micros: number;
  currency_label: string;
  payout_channel_url: string;
}

export interface UserProfile {
  telegram_id: string;
  username: string;
  balance_micros: number;
  total_earned_micros: number;
  is_banned: boolean;
  created_at: number;
}

export interface UserStats {
  today_verified_views: number;
  total_verified_views: number;
  pending_payout_micros: number;
  total_paid_micros: number;
  current_rate_micros: number;
  viewer_country: string;
}

export interface BootstrapResponse {
  status: string;
  auth_mode: 'telegram' | 'preview';
  user: UserProfile;
  stats: UserStats;
  settings: PublicSettings;
  demo_slug: string;
  origin: string;
}

export interface LinkItem {
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
  is_piclink: boolean;
  domain: string;
  telegram_url: string;
  piclink_url: string;
  web_unlock_url: string;
}

export interface WithdrawalItem {
  id: number;
  telegram_id: string;
  username: string;
  amount_micros: number;
  method: 'telegram_stars' | 'ton_usdt' | 'upi' | string;
  payout_address: string;
  status: 'pending' | 'paid' | 'rejected' | string;
  tx_proof: string;
  created_at: number;
  processed_at: number | null;
}

export interface PublicPayoutProof {
  id: number;
  masked_user: string;
  amount_micros: number;
  method: string;
  tx_proof: string;
  paid_at: number;
}

export interface WalletResponse {
  status: string;
  wallet: {
    balance_micros: number;
    total_earned_micros: number;
    pending_micros: number;
    total_paid_micros: number;
    min_withdraw_micros: number;
    currency_label: string;
    payout_channel_url: string;
  };
  my_withdrawals: WithdrawalItem[];
  public_payouts: PublicPayoutProof[];
}

export interface UnlockPayload {
  status: string;
  link: {
    id: number;
    slug: string;
    title: string;
    description: string;
    image_url: string;
    domain: string;
    verified_clicks: number;
    is_owner: boolean;
    is_demo: boolean;
  };
  viewer_telegram_id?: string;
  adsgram_block_id: string;
  ad_config?: AdNetworkConfig;
  site_name: string;
  site_logo_url: string;
  verify_token: string;
}

export interface AdminDashboardMetrics {
  total_users: number;
  total_links: number;
  today_verified_views: number;
  pending_payouts_count: number;
  pending_payouts_micros: number;
  total_paid_micros: number;
  abuse_reports_count: number;
  currency_label: string;
}

export interface AdminWithdrawalRow extends WithdrawalItem {
  user_balance_micros: number;
  user_total_earned_micros: number;
  user_is_banned: number;
  user_verified_views: number;
  user_links_count: number;
}

export interface AdminLinkRow {
  id: number;
  slug: string;
  owner_telegram_id: string;
  owner_username: string;
  destination_url: string;
  title: string;
  image_url: string;
  verified_clicks: number;
  earned_micros: number;
  is_disabled: number;
  reports_count: number;
  created_at: number;
}

export interface AdminUserRow {
  telegram_id: string;
  username: string;
  balance_micros: number;
  total_earned_micros: number;
  is_banned: number;
  links_count: number;
  total_views: number;
  created_at: number;
}

export interface AdminSettings {
  site_name: string;
  site_logo_url: string;
  bot_username: string;
  app_short_name: string;
  bot_token: string;
  storage_channel_id: string;
  adsgram_block_id: string;
  adsgram_units: string;
  cleanads_units: string;
  cleanads_test_mode: string;
  monetag_enabled: string;
  monetag_zone_id: string;
  richads_enabled: string;
  richads_pub_id: string;
  richads_app_id: string;
  rate_in_micros: string;
  rate_tier1_micros: string;
  rate_global_micros: string;
  min_withdraw_micros: string;
  currency_label: string;
  payout_channel_url: string;
  show_payout_channel: string;
}
