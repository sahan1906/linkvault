import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Flag,
  Loader2,
  Lock,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  buildUnlockSteps,
  ensureAdsGramScript,
  ensureCleanAdsScript,
  preloadRichAdsScript,
  runUnlockAdStep,
  syncMonetagScript,
} from '../lib/ads.ts';
import { apiFetch } from '../lib/api.ts';
import { openExternalDestination, triggerHaptic } from '../lib/telegram.ts';
import type { UnlockPayload } from '../lib/types.ts';

interface UnlockScreenProps {
  slug: string;
  onExit: () => void;
  onUnlocked?: () => void;
}

export function UnlockScreen({ slug, onExit, onUnlocked }: UnlockScreenProps) {
  const [payload, setPayload] = useState<UnlockPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [imgError, setImgError] = useState(false);

  // Multi-step client-side progression (zero extra backend calls between steps)
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [stepPhase, setStepPhase] = useState<'idle' | 'loading_ad' | 'fallback' | 'verifying' | 'unlocked'>('idle');
  const [fallbackSeconds, setFallbackSeconds] = useState<number>(2);
  const [stepError, setStepError] = useState('');

  const [destinationUrl, setDestinationUrl] = useState('');
  const [unlockNotice, setUnlockNotice] = useState('');
  const [wasCredited, setWasCredited] = useState(false);

  // Report abuse modal
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Spam or misleading link');
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  const steps = useMemo(() => buildUnlockSteps(payload?.ad_config), [payload?.ad_config]);
  const totalSteps = Math.max(1, steps.length);
  const displayStep = Math.min(currentStepIdx + 1, totalSteps);
  const isLastStep = steps.length === 0 || currentStepIdx >= steps.length - 1;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    setCurrentStepIdx(0);
    setCompletedCount(0);
    setStepPhase('idle');
    setStepError('');
    setDestinationUrl('');
    setUnlockNotice('');
    setWasCredited(false);
    setImgError(false);

    apiFetch<UnlockPayload>(`/api/unlock/${encodeURIComponent(slug)}`)
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
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Unable to load link');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  const verifyWithServer = async (token: string, previewMode: boolean) => {
    setStepPhase('verifying');
    try {
      const res = await apiFetch<{
        destination_url: string;
        credited: boolean;
        message: string;
      }>('/api/verify-click', {
        method: 'POST',
        body: {
          token,
          ad_completed: true,
          preview_mode: previewMode,
        },
      });
      setCompletedCount(totalSteps);
      setDestinationUrl(res.destination_url);
      setWasCredited(Boolean(res.credited));
      setUnlockNotice(res.message);
      setStepPhase('unlocked');
      triggerHaptic('success');
      onUnlocked?.();
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
      setStepPhase('idle');
      triggerHaptic('error');
    }
  };

  const handleStepAction = async () => {
    if (!payload || stepPhase !== 'idle') return;
    setStepError('');

    // Zero enabled ad units: unlock immediately with a single verification call
    if (steps.length === 0) {
      await verifyWithServer(payload.verify_token, payload.link.is_demo);
      return;
    }

    const activeStep = steps[currentStepIdx];
    if (!activeStep) {
      await verifyWithServer(payload.verify_token, payload.link.is_demo);
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

    // Final step completed: verify once with backend & reveal final destination
    await verifyWithServer(payload.verify_token, payload.link.is_demo);
  };

  const handleOpenDestination = () => {
    if (!destinationUrl) return;
    const openedViaTg = openExternalDestination(destinationUrl);
    if (!openedViaTg) {
      const anchor = document.createElement('a');
      anchor.href = destinationUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload) return;
    setReportSending(true);
    try {
      await apiFetch('/api/report', {
        method: 'POST',
        body: { slug: payload.link.slug, reason: reportReason },
      });
      setReportDone(true);
      triggerHaptic('success');
      setTimeout(() => {
        setReportOpen(false);
        setReportDone(false);
      }, 1200);
    } catch {
      triggerHaptic('error');
    } finally {
      setReportSending(false);
    }
  };

  const progressPercent =
    stepPhase === 'unlocked'
      ? 100
      : Math.round((completedCount / totalSteps) * 100);

  return (
    <div className="min-h-screen bg-[#08080A] text-[#F4F4F6] flex flex-col">
      {/* Compact Header */}
      <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 border-b border-white/10 bg-[#08080A]/90 backdrop-blur-md flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onExit}
          className="min-h-[40px] px-2.5 -ml-2 rounded-xl hover:bg-white/5 text-xs font-medium text-zinc-300 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to {payload?.site_name || 'LinkVault'}</span>
        </button>

        {payload && (
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="min-h-[40px] px-3 rounded-xl hover:bg-white/5 text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Flag className="w-3.5 h-3.5" />
            <span>Report Abuse</span>
          </button>
        )}
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md space-y-4">
          {loading ? (
            <div className="bg-[#111115] border border-white/10 rounded-2xl overflow-hidden animate-pulse">
              <div className="aspect-video bg-white/5" />
              <div className="p-6 space-y-3">
                <div className="h-5 w-48 bg-white/10 rounded" />
                <div className="h-4 w-full bg-white/5 rounded" />
                <div className="h-12 w-full bg-white/10 rounded-xl mt-4" />
              </div>
            </div>
          ) : loadError || !payload ? (
            <div className="bg-[#111115] border border-white/10 rounded-2xl p-6 text-center space-y-4">
              <p className="text-base font-semibold text-white">Link Unavailable</p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {loadError || 'This link does not exist or has expired.'}
              </p>
              <button
                type="button"
                onClick={onExit}
                className="min-h-[44px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs transition-colors"
              >
                Return Home
              </button>
            </div>
          ) : (
            <>
              {/* Multi-Step Progress Header */}
              <div className="bg-[#111115] border border-white/10 rounded-2xl px-4 py-3.5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white tracking-tight">
                      {stepPhase === 'unlocked'
                        ? 'Destination Unlocked'
                        : `Step ${displayStep} of ${totalSteps}`}
                    </span>
                  </div>
                  <span className="font-mono text-xs font-semibold text-emerald-400 tabular-nums">
                    {stepPhase === 'unlocked'
                      ? `${totalSteps} / ${totalSteps}`
                      : `${displayStep} / ${totalSteps}`}
                  </span>
                </div>

                {/* Segmented Step Bar */}
                <div className="flex items-center gap-1.5" aria-label={`Unlock progress ${progressPercent}%`}>
                  {Array.from({ length: totalSteps }).map((_, idx) => {
                    const isDone = stepPhase === 'unlocked' || idx < completedCount;
                    const isActive = stepPhase !== 'unlocked' && idx === currentStepIdx;
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

              {/* Link Preview & Action Card */}
              <article className="bg-[#111115] border border-white/10 rounded-2xl overflow-hidden">
                {/* Custom PicLink Thumbnail */}
                {payload.link.image_url && !imgError ? (
                  <div className="relative aspect-video bg-zinc-950 overflow-hidden">
                    <img
                      src={payload.link.image_url}
                      alt={payload.link.title}
                      referrerPolicy="no-referrer"
                      onError={() => setImgError(true)}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#111115] to-transparent" />
                  </div>
                ) : null}

                <div className="p-6 space-y-5">
                  {/* Verified Destination Preview */}
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="inline-flex items-center gap-1.5 text-emerald-400 font-mono truncate">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span className="truncate">{payload.link.domain}</span>
                    </div>
                    <span className="font-mono text-zinc-500 tabular-nums shrink-0">
                      {payload.link.verified_clicks.toLocaleString()} unlocks
                    </span>
                  </div>

                  <div>
                    <h1 className="text-xl font-semibold text-white tracking-tight leading-snug text-balance">
                      {payload.link.title}
                    </h1>
                    <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                      {payload.link.description}
                    </p>
                  </div>

                  {stepError && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                      {stepError}
                    </div>
                  )}

                  {/* Step States */}
                  {stepPhase === 'unlocked' ? (
                    <div className="space-y-3 pt-1">
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-emerald-300">
                            {wasCredited ? 'Verified & Unlocked' : 'Destination Ready'}
                          </p>
                          <p className="text-[11px] text-emerald-200/80 mt-0.5">
                            {unlockNotice}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleOpenDestination}
                        className="w-full min-h-[50px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>
                          {payload.link.is_api ? 'Continue Watching' : 'Open Destination Link'}
                        </span>
                      </button>

                      <p className="text-center font-mono text-[11px] text-zinc-500 truncate px-2">
                        {destinationUrl}
                      </p>
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
                        disabled={stepPhase === 'verifying'}
                        onClick={handleStepAction}
                        className="w-full min-h-[50px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-zinc-950 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                      >
                        {stepPhase === 'verifying' ? (
                          <>
                            <Unlock className="w-4 h-4" />
                            <span>Verifying Destination...</span>
                          </>
                        ) : isLastStep ? (
                          <>
                            <Lock className="w-4 h-4" />
                            <span>
                              Unlock Final Link ({displayStep}/{totalSteps})
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
                          ? 'Tap above to verify and open the destination link.'
                          : isLastStep
                          ? 'Complete this final sponsored step to unlock your destination.'
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
                      <span className="truncate">{payload.site_name} Safe Preview</span>
                    </div>
                    <span className="font-mono shrink-0">/r/{payload.link.slug}</span>
                  </div>
                </div>
              </article>
            </>
          )}
        </div>
      </main>

      {/* Report Abuse Modal */}
      {reportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setReportOpen(false)}
        >
          <form
            onSubmit={handleSubmitReport}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-[#111115] border border-white/10 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Report Link Abuse</h3>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reportDone ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
                Thank you. This link has been flagged for moderator review.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {[
                    'Spam or misleading link',
                    'Malware or phishing destination',
                    'NSFW or prohibited content',
                    'Copyright or impersonation',
                  ].map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setReportReason(opt)}
                      className={`w-full min-h-[44px] px-3.5 rounded-xl border text-left text-xs font-medium transition-colors ${
                        reportReason === opt
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                          : 'border-white/10 bg-[#08080A] text-zinc-300 hover:bg-white/[0.03]'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={reportSending}
                  className="w-full min-h-[44px] rounded-xl bg-red-500/90 hover:bg-red-500 text-white font-semibold text-xs transition-colors"
                >
                  {reportSending ? 'Submitting Report...' : 'Submit Abuse Report'}
                </button>
              </>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
