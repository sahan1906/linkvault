import type { AdNetworkConfig } from './types.ts';

export type AdNetworkKind = 'adsgram' | 'cleanads' | 'monetag' | 'richads';

export interface UnlockAdStep {
  id: string;
  network: AdNetworkKind;
  label: string;
  blockId?: string;
  placementId?: string;
  zoneId?: string;
  pubId?: string;
  appId?: string;
}

interface CleanAdsShowResult {
  completed?: boolean;
  done?: boolean;
  rewarded?: boolean;
  reason?: string;
  error?: string | boolean;
}

interface CleanAdsController {
  show: () => Promise<CleanAdsShowResult | void>;
}

interface RichAdsController {
  initialize: (config: { pubId: string; appId: string }) => Promise<void> | void;
  triggerInterstitialVideo?: () => Promise<unknown>;
  triggerInterstitialBanner?: () => Promise<unknown>;
}

declare global {
  interface Window {
    CleanAds?: {
      init: (config: {
        placementId: string;
        userId?: string;
        test?: boolean;
      }) => CleanAdsController;
    };
    TelegramAdsController?: new () => RichAdsController;
    [key: `show_${string}`]: (() => Promise<unknown>) | undefined;
  }
}

// Strict hardcoded official Telegram Mini App ad SDK URLs (never accept user-provided URLs)
const ADSGRAM_SDK_URL = 'https://sad.adsgram.ai/js/sad.min.js';
const CLEANADS_SDK_URL = 'https://api.cleanads.ai/sdk/v1.js';
const MONETAG_SDK_URL = 'https://libtl.com/sdk.js';
const RICHADS_SDK_URL = 'https://richinfo.co/richpartners/telegram/js/tg-ob.js';

const MONETAG_SCRIPT_ATTR = 'data-lv-monetag-zone';

const loadedScripts = new Map<string, Promise<boolean>>();
const initializedRichAdsKeys = new Map<string, RichAdsController>();

// ─── SMART EXTRACTORS FOR ADMIN INPUTS ───────────────────────────────────────

export function extractAdsGramBlockId(raw: string): string {
  const input = (raw || '').trim();
  if (!input) return '';
  const match = input.match(/blockId\s*[:=]\s*["'`]([a-zA-Z0-9_-]{1,64})["'`]/i);
  if (match?.[1]) return match[1];
  return input.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export function extractCleanAdsPlacementId(raw: string): string {
  const input = (raw || '').trim();
  if (!input) return '';
  const snippetMatch = input.match(/placementId\s*[:=]\s*["'`]([a-zA-Z0-9_-]{1,80})["'`]/i);
  if (snippetMatch?.[1]) return snippetMatch[1];
  const prefixMatch = input.match(/\b(pl_[a-zA-Z0-9_-]{2,80})\b/);
  if (prefixMatch?.[1]) return prefixMatch[1];
  return input.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

export function extractMonetagZoneId(raw: string): string {
  const input = (raw || '').trim();
  if (!input) return '';
  const dataZoneMatch = input.match(/data-zone\s*=\s*["']?(\d{3,24})["']?/i);
  if (dataZoneMatch?.[1]) return dataZoneMatch[1];
  const dataSdkMatch = input.match(/show_(\d{3,24})/i);
  if (dataSdkMatch?.[1]) return dataSdkMatch[1];
  return input.replace(/\D/g, '').slice(0, 24);
}

export function extractRichAdsIds(raw: string): { pubId?: string; appId?: string } {
  const input = (raw || '').trim();
  if (!input) return {};
  const pubMatch = input.match(/pubId\s*[:=]\s*["'`]?([a-zA-Z0-9_-]{1,64})["'`]?/i);
  const appMatch = input.match(/appId\s*[:=]\s*["'`]?([a-zA-Z0-9_-]{1,64})["'`]?/i);
  return {
    pubId: pubMatch?.[1] || undefined,
    appId: appMatch?.[1] || undefined,
  };
}

// ─── DYNAMIC SEQUENTIAL STEP BUILDER ─────────────────────────────────────────

export function buildUnlockSteps(config?: AdNetworkConfig | null): UnlockAdStep[] {
  if (!config) return [];
  const steps: UnlockAdStep[] = [];

  // 1. Enabled AdsGram Units (each enabled unit with valid Block ID = 1 step)
  for (const unit of config.adsgram_units || []) {
    const cleanBlockId = extractAdsGramBlockId(unit.block_id);
    if (unit.enabled && cleanBlockId) {
      steps.push({
        id: `adsgram:${unit.id}`,
        network: 'adsgram',
        label: unit.label.trim() || 'AdsGram Unit',
        blockId: cleanBlockId,
      });
    }
  }

  // 2. Enabled CleanAds Units (each enabled unit with valid Placement ID = 1 step)
  for (const unit of config.cleanads_units || []) {
    const cleanPlacementId = extractCleanAdsPlacementId(unit.placement_id);
    if (unit.enabled && cleanPlacementId) {
      steps.push({
        id: `cleanads:${unit.id}`,
        network: 'cleanads',
        label: unit.label.trim() || 'CleanAds Unit',
        placementId: cleanPlacementId,
      });
    }
  }

  // 3. Monetag (1 step if enabled with numeric Zone ID)
  const cleanZoneId = extractMonetagZoneId(config.monetag_zone_id);
  if (config.monetag_enabled && cleanZoneId) {
    steps.push({
      id: `monetag:${cleanZoneId}`,
      network: 'monetag',
      label: `Monetag (Zone ${cleanZoneId})`,
      zoneId: cleanZoneId,
    });
  }

  // 4. RichAds (1 step if enabled with both Pub ID and App ID)
  const cleanPubId = (config.richads_pub_id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const cleanAppId = (config.richads_app_id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (config.richads_enabled && cleanPubId && cleanAppId) {
    steps.push({
      id: `richads:${cleanPubId}:${cleanAppId}`,
      network: 'richads',
      label: 'RichAds Interstitial',
      pubId: cleanPubId,
      appId: cleanAppId,
    });
  }

  return steps;
}

// ─── SAFE SCRIPT LOADERS & CLEANUP ───────────────────────────────────────────

function loadExternalScript(src: string, timeoutMs = 6000): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);

  const existingPromise = loadedScripts.get(src);
  if (existingPromise) return existingPromise;

  const existingTag = Array.from(document.scripts).find((s) => s.src === src);
  if (existingTag) {
    const resolved = Promise.resolve(true);
    loadedScripts.set(src, resolved);
    return resolved;
  }

  const promise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) {
        loadedScripts.delete(src);
      }
      resolve(ok);
    };

    const timer = window.setTimeout(() => finish(false), timeoutMs);
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });

  loadedScripts.set(src, promise);
  return promise;
}

export function ensureAdsGramScript(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.Adsgram) {
    return Promise.resolve(true);
  }
  return loadExternalScript(ADSGRAM_SDK_URL);
}

export function ensureCleanAdsScript(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.CleanAds) {
    return Promise.resolve(true);
  }
  return loadExternalScript(CLEANADS_SDK_URL);
}

export function removeMonetagScripts(): void {
  if (typeof document === 'undefined') return;
  const scripts = document.querySelectorAll(
    `script[${MONETAG_SCRIPT_ATTR}], script[src="${MONETAG_SDK_URL}"]`
  );
  scripts.forEach((node) => {
    const zone = node.getAttribute('data-zone');
    if (zone && typeof window !== 'undefined') {
      try {
        delete window[`show_${zone}`];
      } catch {
        // Ignore read-only property
      }
    }
    node.parentNode?.removeChild(node);
  });
}

export function syncMonetagScript(enabled: boolean, rawZoneId: string): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const zoneId = extractMonetagZoneId(rawZoneId);

  if (!enabled || !zoneId) {
    removeMonetagScripts();
    return Promise.resolve(false);
  }

  const currentTag = document.querySelector(
    `script[${MONETAG_SCRIPT_ATTR}="${zoneId}"]`
  ) as HTMLScriptElement | null;

  if (currentTag) {
    if (typeof window[`show_${zoneId}`] === 'function') {
      return Promise.resolve(true);
    }
  }

  // Remove any stale Monetag script from a previous zone before injecting
  removeMonetagScripts();

  return new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = MONETAG_SDK_URL;
    script.async = true;
    script.setAttribute('data-zone', zoneId);
    script.setAttribute('data-sdk', `show_${zoneId}`);
    script.setAttribute(MONETAG_SCRIPT_ATTR, zoneId);

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };

    const timer = window.setTimeout(() => finish(false), 6000);
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });
}

/**
 * Preload RichAds <script> ONLY.
 * Never calls TelegramAdsController.initialize() here so auto-timers never fire outside RichAds' step.
 */
export function preloadRichAdsScript(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.TelegramAdsController) {
    return Promise.resolve(true);
  }
  return loadExternalScript(RICHADS_SDK_URL);
}

// ─── STEP EXECUTION ENGINE WITH SAFE FALLBACK TIMER ──────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function runFallbackCountdown(
  seconds: number,
  onFallbackTick?: (secondsLeft: number) => void
): Promise<void> {
  for (let s = seconds; s > 0; s--) {
    onFallbackTick?.(s);
    await new Promise((r) => window.setTimeout(r, 1000));
  }
}

export interface RunStepOptions {
  telegramUserId?: string;
  cleanadsTestMode?: boolean;
  onFallbackTick?: (secondsLeft: number) => void;
}

export interface RunStepOutcome {
  completed: boolean;
  usedFallback: boolean;
  closedEarly?: boolean;
  message?: string;
}

function isClosedEarlyReason(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const obj = err as { reason?: string; description?: string; state?: string; message?: string };
  const combined = `${obj.reason || ''} ${obj.description || ''} ${obj.state || ''} ${obj.message || ''}`.toLowerCase();
  return combined.includes('closed_early') || combined.includes('skipped');
}

export async function runUnlockAdStep(
  step: UnlockAdStep,
  options: RunStepOptions
): Promise<RunStepOutcome> {
  const inTelegramClient = Boolean(window.Telegram?.WebApp?.initData);

  // Desktop / browser preview outside Telegram Mini App: smoothly run a brief 2s compliant fallback
  if (!inTelegramClient && !(step.network === 'cleanads' && options.cleanadsTestMode)) {
    await runFallbackCountdown(2, options.onFallbackTick);
    return { completed: true, usedFallback: true };
  }

  try {
    if (step.network === 'adsgram' && step.blockId) {
      const ok = await ensureAdsGramScript();
      if (ok && window.Adsgram) {
        const controller = window.Adsgram.init({ blockId: step.blockId });
        const result = await withTimeout(controller.show(), 45000, 'adsgram');
        if (result?.done) {
          return { completed: true, usedFallback: false };
        }
        if (isClosedEarlyReason(result)) {
          return {
            completed: false,
            usedFallback: false,
            closedEarly: true,
            message: 'Please finish watching the short sponsored ad to continue.',
          };
        }
      }
    } else if (step.network === 'cleanads' && step.placementId) {
      const ok = await ensureCleanAdsScript();
      if (ok && window.CleanAds) {
        const controller = window.CleanAds.init({
          placementId: step.placementId,
          userId: options.telegramUserId || undefined,
          test: Boolean(options.cleanadsTestMode),
        });
        const result = await withTimeout(
          Promise.resolve(controller.show()),
          45000,
          'cleanads'
        );

        if (result && typeof result === 'object' && result.reason === 'closed_early') {
          return {
            completed: false,
            usedFallback: false,
            closedEarly: true,
            message: 'Please finish watching the short sponsored ad to continue.',
          };
        }

        if (!result || result.completed !== false) {
          return { completed: true, usedFallback: false };
        }
      }
    } else if (step.network === 'monetag' && step.zoneId) {
      const ok = await syncMonetagScript(true, step.zoneId);
      const showFn = window[`show_${step.zoneId}`];
      if (ok && typeof showFn === 'function') {
        await withTimeout(Promise.resolve(showFn()), 45000, 'monetag');
        return { completed: true, usedFallback: false };
      }
    } else if (step.network === 'richads' && step.pubId && step.appId) {
      const ok = await preloadRichAdsScript();
      if (ok && window.TelegramAdsController) {
        const cacheKey = `${step.pubId}:${step.appId}`;
        let controller = initializedRichAdsKeys.get(cacheKey);
        if (!controller) {
          controller = new window.TelegramAdsController();
          await withTimeout(
            Promise.resolve(
              controller.initialize({
                pubId: step.pubId,
                appId: step.appId,
              })
            ),
            8000,
            'richads_init'
          );
          initializedRichAdsKeys.set(cacheKey, controller);
        }

        // Try Interstitial Video first, then fall back to Interstitial Banner
        let triggered = false;
        if (typeof controller.triggerInterstitialVideo === 'function') {
          try {
            await withTimeout(
              Promise.resolve(controller.triggerInterstitialVideo()),
              45000,
              'richads_video'
            );
            triggered = true;
          } catch {
            // Fall back to Interstitial Banner below
          }
        }
        if (!triggered && typeof controller.triggerInterstitialBanner === 'function') {
          await withTimeout(
            Promise.resolve(controller.triggerInterstitialBanner()),
            35000,
            'richads_banner'
          );
          triggered = true;
        }
        if (triggered) {
          return { completed: true, usedFallback: false };
        }
      }
    }
  } catch (err) {
    // Handle CleanAds / AdsGram explicit closed_early rejection without unhandled errors
    if (isClosedEarlyReason(err)) {
      return {
        completed: false,
        usedFallback: false,
        closedEarly: true,
        message: 'Please finish watching the short sponsored ad to continue.',
      };
    }
    // Any no-fill, timeout, or SDK error falls through to the short graceful fallback timer below
  }

  // Never get users stuck: cleanly unlock this step after a 2-second fallback timer
  await runFallbackCountdown(2, options.onFallbackTick);
  return { completed: true, usedFallback: true };
}
