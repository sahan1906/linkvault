import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Lock,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildUnlockSteps,
  ensureAdsGramScript,
  ensureCleanAdsScript,
  preloadRichAdsScript,
  runUnlockAdStep,
  syncMonetagScript,
} from '../lib/ads.ts';
import { apiFetch } from '../lib/api.ts';
import {
  closeTelegramWebApp,
  isInsideTelegramWebApp,
  triggerHaptic,
} from '../lib/telegram.ts';
import type { GateSessionPayload } from '../lib/types.ts';

interface GateUnlockScreenProps {
  sessionId: string;
  onExit: () => void;
}

export function GateUnlockScreen({ sessionId, onExit }: GateUnlockScreenProps) {
  const [payload, setPayload] = useState<GateSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Multi-step client-side progression (zero extra backend requests between steps)
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [stepPhase, setStepPhase] = useState<
    'idle' | 'loading_ad' | 'fallback' | 'completing' | 'unlocked' | 'consumed'
  >('idle');
  const [fallbackSeconds, setFallbackSeconds] = useState<number>(2);
  const [stepError, setStepError] = useState('');

  const autoCloseTimerRef = useRef<number | null>(null);
  const inTelegram = isInsideTelegramWebApp();

  const steps = useMemo(() => buildUnlockSteps(payload?.ad_config), [payload?.ad_config]);
  const totalSteps = Math.max(1, steps.length);
  const displayStep = Math.min(currentStepIdx + 1, totalSteps);
  const isLastStep = steps.length === 0 || currentStepIdx >= steps.length - 1;

  const scheduleAutoClose = () => {
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    if (isInsideTelegramWebApp()) {
      autoCloseTimerRef.current = window.setTimeout(() => {
        closeTelegramWebApp();
      }, 600);
    }
  };

  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) {
        window.clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    setCurrentStepIdx(0);
    setCompletedCount(0);
    setStepPhase('idle');
    setStepError('');

    apiFetch<GateSessionPayload>(`/api/gate/session/${encodeURIComponent(sessionId)}`)
      .then((res) => {
        if (!active) return;
        setPayload(res);

        // Prepare/clean up scripts according to live Admin configuration
        const cfg = res.ad_config;
        syncMonetagScript(Boolean(cfg?.monetag_enabled), cfg?.monetag_zone_id || '');
        const activeSteps = buildUnlockSteps(cfg);
        if (activeSteps.some((s) => s.network === 'adsgram')) {
          ensureAdsGramScript();
        }
        if (activeSteps.some((s) => s.network === 'cleanads')) {
          ensureCleanAdsScript();
        }
        if (activeSteps.some((s) => s.network === 'richads')) {
          // Preload RichAds <script> ONLY; initialization stays deferred until RichAds' step page
          preloadRichAdsScript();
        }

        if (res.session.status === 'completed') {
          setCompletedCount(Math.max(1, activeSteps.length));
          setStepPhase('unlocked');
          scheduleAutoClose();
        } else if (res.session.status === 'consumed') {
          setCompletedCount(Math.max(1, activeSteps.length));
          setStepPhase('consumed');
        }
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Unable to load unlock session');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sessionId]);

  const handleReturnAndClose = () => {
    triggerHaptic('light');
    const closed = closeTelegramWebApp();
    if (!closed) {
      try {
        window.Telegram?.WebApp?.close?.();
      } catch {
        // Ignore outside Telegram
      }
      try {
        window.close();
      } catch {
        // Browser may prevent closing non-script-opened tabs
      }
    }
  };

  const completeGateWithServer = async (gateId: string, completeToken: string) => {
    setStepPhase('completing');
    try {
      await apiFetch<{
        status: string;
        session_id: string;
        completed: boolean;
      }>('/api/gate/complete', {
        method: 'POST',
        body: {
          session_id: gateId,
          token: completeToken,
        },
      });
      setCompletedCount(totalSteps);
      setStepPhase('unlocked');
      triggerHaptic('success');
      scheduleAutoClose();
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
      setStepPhase('idle');
      triggerHaptic('error');
    }
  };

  const handleStepAction = async () => {
    if (!payload || stepPhase !== 'idle') return;
    setStepError('');

    // Zero enabled ad units: complete gate immediately
    if (steps.length === 0) {
      await completeGateWithServer(payload.session.id, payload.complete_token);
      return;
    }

    const activeStep = steps[currentStepIdx];
    if (!activeStep) {
      await completeGateWithServer(payload.session.id, payload.complete_token);
      return;
    }

    setStepPhase('loading_ad');
    triggerHaptic('light');

    const outcome = await runUnlockAdStep(activeStep, {
      telegramUserId: payload.viewer_telegram_id,
      cleanadsTestMode: Boolean(payload.ad_config?.cleanads_test_mode),
      onFallbackTick: (sec) => {
        setStepPhase('fallback');
        setFallbackSeconds(sec);
      },
    });

    if (!outcome.completed) {
      setStepError(
        outcome.message || 'Please finish watching the short sponsored ad to continue.'
      );
      setStepPhase('idle');
      triggerHaptic('error');
      return;
    }

    const nextCompleted = currentStepIdx + 1;
    setCompletedCount(nextCompleted);

    if (currentStepIdx < steps.length - 1) {
      // Advance client-side to the next step page (zero extra backend requests)
      setCurrentStepIdx((prev) => prev + 1);
      setStepPhase('idle');
      triggerHaptic('success');
      return;
    }

    // Final step completed: mark gate session completed and close back to partner Mini App
    await completeGateWithServer(payload.session.id, payload.complete_token);
  };

  const progressPercent =
    stepPhase === 'unlocked' || stepPhase === 'consumed'
      ? 100
      : Math.round((completedCount / totalSteps) * 100);

  return (
    <div className="min-h-screen bg-[#08080A] text-[#F4F4F6] flex flex-col">
      {/* Compact Header */}
      <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 border-b border-white/10 bg-[#08080A]/90 backdrop-blur-md flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={inTelegram ? handleReturnAndClose : onExit}
          className="min-h-[40px] px-2.5 -ml-2 rounded-xl hover:bg-white/5 text-xs font-medium text-zinc-300 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{inTelegram ? 'Return to App' : `Back to ${payload?.site_name || 'LinkVault'}`}</span>
        </button>

        <div className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="font-medium">Verified Unlock</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md space-y-4">
          {loading ? (
            <div className="bg-[#111115] border border-white/10 rounded-2xl p-6 space-y-4 animate-pulse">
              <div className="h-4 w-32 bg-white/10 rounded" />
              <div className="h-6 w-56 bg-white/10 rounded" />
              <div className="h-12 w-full bg-white/10 rounded-xl mt-2" />
            </div>
          ) : loadError || !payload ? (
            <div className="bg-[#111115] border border-white/10 rounded-2xl p-6 text-center space-y-4">
              <p className="text-base font-semibold text-white">Unlock Session Unavailable</p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {loadError || 'This unlock session has expired or could not be found.'}
              </p>
              <button
                type="button"
                onClick={inTelegram ? handleReturnAndClose : onExit}
                className="min-h-[44px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs transition-colors"
              >
                {inTelegram ? 'Return to App' : 'Return Home'}
              </button>
            </div>
          ) : (
            <>
              {/* Multi-Step Progress Header */}
              <div className="bg-[#111115] border border-white/10 rounded-2xl px-4 py-3.5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-white tracking-tight">
                    {stepPhase === 'unlocked' || stepPhase === 'consumed'
                      ? 'Access Unlocked'
                      : `Step ${displayStep} of ${totalSteps}`}
                  </span>
                  <span className="font-mono text-xs font-semibold text-emerald-400 tabular-nums">
                    {stepPhase === 'unlocked' || stepPhase === 'consumed'
                      ? `${totalSteps} / ${totalSteps}`
                      : `${displayStep} / ${totalSteps}`}
                  </span>
                </div>

                {/* Segmented Step Bar */}
                <div className="flex items-center gap-1.5" aria-label={`Unlock progress ${progressPercent}%`}>
                  {Array.from({ length: totalSteps }).map((_, idx) => {
                    const isDone =
                      stepPhase === 'unlocked' || stepPhase === 'consumed' || idx < completedCount;
                    const isActive =
                      stepPhase !== 'unlocked' &&
                      stepPhase !== 'consumed' &&
                      idx === currentStepIdx;
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-1.5">
                        <div
                          className={`h-1.5 w-full rounded-full transition-colors duration-300 ${
                            isDone
                              ? 'bg-emerald-500'
                              : isActive
                              ? 'bg-emerald-400/50'
                              : 'bg-white/10'
                          }`}
                        />
                        {totalSteps <= 8 && (
                          <div
                            className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono transition-colors ${
                              isDone
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : isActive
                                ? 'bg-white/10 text-white border border-white/25'
                                : 'text-zinc-600'
                            }`}
                          >
                            {isDone ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : idx + 1}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Gate Card */}
              <article className="bg-[#111115] border border-white/10 rounded-2xl p-6 space-y-5">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>Partner Access Gate</span>
                  </div>
                  <h1 className="text-xl font-semibold text-white tracking-tight leading-snug text-balance">
                    {payload.session.title}
                  </h1>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    {stepPhase === 'unlocked'
                      ? inTelegram
                        ? 'Verification complete. Sending you right back to unlock your content.'
                        : 'Verification complete. Return to the app to enjoy your unlocked content.'
                      : stepPhase === 'consumed'
                      ? 'This unlock session has already been redeemed.'
                      : 'Complete the short sponsored steps below to return automatically and unlock.'}
                  </p>
                </div>

                {stepError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                    {stepError}
                  </div>
                )}

                {stepPhase === 'unlocked' ? (
                  <div className="space-y-3 pt-1">
                    <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-4 py-3.5 flex items-start gap-2.5">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-emerald-300">
                          {inTelegram
                            ? 'Unlocked! Returning to app...'
                            : 'Unlocked! You can close this tab and return.'}
                        </p>
                        <p className="text-xs text-emerald-200/80 mt-0.5">
                          {inTelegram
                            ? 'Closing automatically in a moment, or tap below.'
                            : 'Your access has been verified and saved.'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleReturnAndClose}
                      className="w-full min-h-[50px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Return &amp; Unlock</span>
                    </button>
                  </div>
                ) : stepPhase === 'consumed' ? (
                  <div className="space-y-3 pt-1">
                    <div className="rounded-xl border border-white/10 bg-[#08080A] px-4 py-3 text-xs text-zinc-300">
                      This session was already claimed. Return to the app if you need a new unlock.
                    </div>
                    <button
                      type="button"
                      onClick={handleReturnAndClose}
                      className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm transition-colors"
                    >
                      Return to App
                    </button>
                  </div>
                ) : stepPhase === 'loading_ad' || stepPhase === 'fallback' ? (
                  <div className="rounded-xl border border-white/10 bg-[#08080A] p-5 text-center space-y-2.5">
                    <div className="flex items-center justify-center gap-2 text-emerald-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-xs font-medium text-zinc-200">
                        {stepPhase === 'fallback'
                          ? `Preparing next step (${displayStep}/${totalSteps})...`
                          : `Opening sponsored step ${displayStep} of ${totalSteps}...`}
                      </span>
                    </div>
                    {stepPhase === 'fallback' && (
                      <p className="font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
                        {fallbackSeconds}s
                      </p>
                    )}
                    <p className="text-[11px] text-zinc-500">
                      Please wait a moment while this step completes
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 pt-1">
                    <button
                      type="button"
                      disabled={stepPhase === 'completing'}
                      onClick={handleStepAction}
                      className="w-full min-h-[50px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-zinc-950 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      {stepPhase === 'completing' ? (
                        <>
                          <Unlock className="w-4 h-4" />
                          <span>Completing Unlock...</span>
                        </>
                      ) : isLastStep ? (
                        <>
                          <Lock className="w-4 h-4" />
                          <span>
                            Complete &amp; Unlock ({displayStep}/{totalSteps})
                          </span>
                        </>
                      ) : (
                        <>
                          <span>
                            Continue ({displayStep}/{totalSteps})
                          </span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>

                    <p className="text-center text-xs text-zinc-400">
                      {steps.length === 0
                        ? 'Tap above to unlock and return to the app.'
                        : isLastStep
                        ? 'Complete this final sponsored step to return and unlock.'
                        : 'Watch a short sponsored ad to continue to the next step.'}
                    </p>
                  </div>
                )}

                <div className="pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-500">
                  <div className="flex items-center gap-2 min-w-0">
                    {payload.site_logo_url && (
                      <img
                        src={payload.site_logo_url}
                        alt={payload.site_name}
                        referrerPolicy="no-referrer"
                        className="w-4 h-4 rounded object-cover shrink-0"
                      />
                    )}
                    <span className="truncate">{payload.site_name} Safe Gate</span>
                  </div>
                  <span className="font-mono shrink-0">{payload.session.id.slice(0, 13)}…</span>
                </div>
              </article>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
