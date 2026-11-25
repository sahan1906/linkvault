import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Flag,
  Lock,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import {
  openExternalDestination,
  runAdsGramRewardedAd,
  triggerHaptic,
} from '../lib/telegram.ts';
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

  const [adState, setAdState] = useState<'idle' | 'watching' | 'verifying' | 'unlocked'>('idle');
  const [countdown, setCountdown] = useState(3);
  const [adError, setAdError] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [unlockNotice, setUnlockNotice] = useState('');
  const [wasCredited, setWasCredited] = useState(false);

  // Report abuse modal
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Spam or misleading link');
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    setAdState('idle');
    setDestinationUrl('');
    setUnlockNotice('');
    setAdError('');
    setImgError(false);

    apiFetch<UnlockPayload>(`/api/unlock/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (active) setPayload(res);
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
    setAdState('verifying');
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
      setDestinationUrl(res.destination_url);
      setWasCredited(Boolean(res.credited));
      setUnlockNotice(res.message);
      setAdState('unlocked');
      triggerHaptic('success');
      onUnlocked?.();
    } catch (err) {
      setAdError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
      setAdState('idle');
      triggerHaptic('error');
    }
  };

  const handleWatchAd = async () => {
    if (!payload) return;
    setAdError('');
    setAdState('watching');

    const blockId = payload.adsgram_block_id;
    const sdkResult = await runAdsGramRewardedAd(blockId);

    if (sdkResult.usedSdk) {
      if (sdkResult.completed) {
        await verifyWithServer(payload.verify_token, payload.link.is_demo);
      } else {
        setAdError(
          sdkResult.reason ||
            'Please finish watching the short sponsored ad to unlock the destination.'
        );
        setAdState('idle');
        triggerHaptic('error');
      }
      return;
    }

    // Graceful 3-second compliant preview timer when AdsGram Block ID is not configured or in browser preview
    setCountdown(3);
    for (let sec = 3; sec > 0; sec--) {
      setCountdown(sec);
      await new Promise((r) => setTimeout(r, 1000));
    }
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
        <div className="w-full max-w-md">
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

                {adError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                    {adError}
                  </div>
                )}

                {/* Unlock States */}
                {adState === 'unlocked' ? (
                  <div className="space-y-3 pt-1">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-emerald-300">
                          {wasCredited ? 'Verified & Unlocked' : 'Destination Unlocked'}
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
                      <span>Open Destination Link</span>
                    </button>

                    <p className="text-center font-mono text-[11px] text-zinc-500 truncate px-2">
                      {destinationUrl}
                    </p>
                  </div>
                ) : adState === 'watching' ? (
                  <div className="rounded-xl border border-white/10 bg-[#08080A] p-5 text-center space-y-2.5">
                    <p className="text-xs font-medium text-zinc-300">
                      {payload.adsgram_block_id
                        ? 'Displaying sponsored ad...'
                        : 'Sponsored preview unlocking shortly...'}
                    </p>
                    <p className="font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
                      {payload.adsgram_block_id ? '...' : `${countdown}s`}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Watch a short sponsored ad to unlock destination
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 pt-1">
                    <button
                      type="button"
                      disabled={adState === 'verifying'}
                      onClick={handleWatchAd}
                      className="w-full min-h-[50px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-zinc-950 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      {adState === 'verifying' ? (
                        <>
                          <Unlock className="w-4 h-4" />
                          <span>Verifying Unlock...</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-4 h-4" />
                          <span>Watch Ad &amp; Unlock Link</span>
                        </>
                      )}
                    </button>

                    <p className="text-center text-xs text-zinc-400">
                      Watch a short sponsored ad to unlock destination.
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
