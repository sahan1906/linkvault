import {
  Check,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Play,
  QrCode,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { copyToClipboard, formatMicros, triggerHaptic } from '../lib/telegram.ts';
import type { BootstrapResponse, LinkItem } from '../lib/types.ts';
import { QrModal } from './QrModal.tsx';

interface CreateTabProps {
  data: BootstrapResponse;
  onLinkCreated: (link: LinkItem) => void;
  onPreviewUnlock: (slug: string) => void;
}

export function CreateTab({ data, onLinkCreated, onPreviewUnlock }: CreateTabProps) {
  const { user, stats, settings, demo_slug } = data;
  const currency = settings.currency_label || 'USDT';

  const [destinationUrl, setDestinationUrl] = useState('');
  const [customSlug, setCustomSlug] = useState('');
  const [expiry, setExpiry] = useState<'never' | '24h' | '7d'>('never');
  const [enablePicLink, setEnablePicLink] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdLink, setCreatedLink] = useState<LinkItem | null>(null);
  const [copiedField, setCopiedField] = useState<'tg' | 'pic' | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [previewImgError, setPreviewImgError] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleUploadFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError('Thumbnail image must be smaller than 4 MB.');
      return;
    }
    setError('');
    setUploadNote('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch<{ url: string; storage: string }>('/api/upload', {
        method: 'POST',
        body: form,
        isFormData: true,
      });
      setImageUrl(res.url);
      setPreviewImgError(false);
      setUploadNote(
        res.storage === 'telegram'
          ? 'Stored via Telegram Storage Channel proxy'
          : 'Uploaded and proxied via /api/img'
      );
      triggerHaptic('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
      triggerHaptic('error');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!destinationUrl.trim()) {
      setError('Enter a destination URL starting with https://');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{ link: LinkItem }>('/api/links', {
        method: 'POST',
        body: {
          destination_url: destinationUrl.trim(),
          slug: customSlug.trim() || undefined,
          expiry,
          title: enablePicLink ? title.trim() : '',
          description: enablePicLink ? description.trim() : '',
          image_url: enablePicLink ? imageUrl.trim() : '',
        },
      });
      setCreatedLink(res.link);
      onLinkCreated(res.link);
      setDestinationUrl('');
      setCustomSlug('');
      setTitle('');
      setDescription('');
      setImageUrl('');
      setUploadNote('');
      triggerHaptic('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create link');
      triggerHaptic('error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (text: string, field: 'tg' | 'pic') => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1800);
    }
  };

  const previewDomain = (() => {
    try {
      return destinationUrl.trim() ? new URL(destinationUrl.trim()).hostname.replace(/^www\./, '') : 'destination.com';
    } catch {
      return 'destination.com';
    }
  })();

  return (
    <div className="space-y-6">
      {/* Earnings & Activity Summary Strip */}
      <section aria-label="Earnings summary" className="bg-[#111115] border border-white/10 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
          <div className="p-4 sm:p-5 border-r border-white/10 lg:border-r-0">
            <p className="text-xs text-zinc-400">Available Balance</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
              {formatMicros(user.balance_micros, currency)}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">Today&apos;s Verified Views</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-white tabular-nums">
              {stats.today_verified_views.toLocaleString()}
            </p>
          </div>
          <div className="p-4 sm:p-5 border-r border-white/10 lg:border-r-0">
            <p className="text-xs text-zinc-400">Total Verified Views</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-white tabular-nums">
              {stats.total_verified_views.toLocaleString()}
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs text-zinc-400">Current Rate / 1K Views</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-zinc-100 tabular-nums">
              {formatMicros(stats.current_rate_micros, currency)}
            </p>
          </div>
        </div>

        {/* 1-tap Preview Unlock Flow bar for users & AdsGram reviewers */}
        <div className="px-4 sm:px-5 py-3.5 border-t border-white/10 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">
              Test the AdsGram Unlock Experience
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Preview the compliant unlock flow visitors see before opening your destination link.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onPreviewUnlock(demo_slug)}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Preview Unlock Flow</span>
          </button>
        </div>
      </section>

      {/* Creator Workspace: Form + Live Preview / Output */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-7 bg-[#111115] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5"
        >
          <div>
            <h2 className="text-lg font-semibold text-white tracking-tight">
              Create Monetized Link
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Generates a 1-tap Telegram Mini App link, a Social PicLink card, and a downloadable QR code.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {/* Destination URL */}
          <div>
            <label htmlFor="dest-url" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Destination URL
            </label>
            <input
              id="dest-url"
              type="url"
              required
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://example.com/resource"
              className="w-full min-h-[46px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 text-sm text-white placeholder:text-zinc-500 transition-colors"
            />
          </div>

          {/* Custom Slug + Expiry */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="custom-slug" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Custom Slug <span className="text-zinc-500">(optional)</span>
              </label>
              <div className="flex items-center rounded-xl bg-[#08080A] border border-white/10 focus-within:border-emerald-500/60 transition-colors">
                <span className="pl-3.5 pr-1 font-mono text-xs text-zinc-500 select-none">/r/</span>
                <input
                  id="custom-slug"
                  type="text"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="my-pack"
                  maxLength={40}
                  className="w-full min-h-[44px] bg-transparent pr-3.5 font-mono text-sm text-white placeholder:text-zinc-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-zinc-300 mb-1.5">
                Link Expiry
              </span>
              <div className="grid grid-cols-3 gap-1 p-1 bg-[#08080A] border border-white/10 rounded-xl">
                {(['never', '24h', '7d'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setExpiry(opt)}
                    className={`min-h-[36px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      expiry === opt
                        ? 'bg-white/10 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {opt === 'never' ? 'Never' : opt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* PicLink Toggle */}
          <div className="pt-4 border-t border-white/10">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">PicLink Social Card</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Add a custom title, description, and large thumbnail for X, Facebook &amp; WhatsApp.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enablePicLink}
                onClick={() => setEnablePicLink((v) => !v)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                  enablePicLink
                    ? 'bg-emerald-500 border-emerald-400'
                    : 'bg-[#08080A] border-white/15'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    enablePicLink ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {enablePicLink && (
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="pic-title" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Card Title
                  </label>
                  <input
                    id="pic-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    placeholder="e.g. 2026 Creator Presets & LUT Bundle"
                    className="w-full min-h-[44px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 text-sm text-white placeholder:text-zinc-500"
                  />
                </div>

                <div>
                  <label htmlFor="pic-desc" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Card Description
                  </label>
                  <textarea
                    id="pic-desc"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={280}
                    placeholder="Short summary shown beneath the thumbnail on social platforms."
                    className="w-full rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 resize-none"
                  />
                </div>

                <div>
                  <label htmlFor="pic-img" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Thumbnail Image (URL or Free Upload)
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      id="pic-img"
                      type="text"
                      value={imageUrl}
                      onChange={(e) => {
                        setImageUrl(e.target.value);
                        setPreviewImgError(false);
                      }}
                      placeholder="https://... or upload below"
                      className="flex-1 min-h-[44px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 text-sm text-white placeholder:text-zinc-500"
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => handleUploadFile(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[44px] px-4 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-white inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Upload className="w-4 h-4" />
                      <span>{uploading ? 'Uploading...' : 'Upload Image'}</span>
                    </button>
                  </div>
                  {uploadNote && (
                    <p className="text-[11px] text-emerald-400 mt-1.5">{uploadNote}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <Link2 className="w-4 h-4" />
            <span>{submitting ? 'Generating Links...' : 'Create Short Link & PicLink'}</span>
          </button>
        </form>

        {/* Right Column: Created Result or Live PicLink Preview */}
        <div className="lg:col-span-5 space-y-5">
          {createdLink ? (
            <section className="bg-[#111115] border border-emerald-500/35 rounded-2xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-emerald-400">Link Ready to Share</p>
                  <h3 className="text-base font-semibold text-white mt-0.5 truncate">
                    {createdLink.title || `/${createdLink.slug}`}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setQrOpen(true)}
                  className="min-h-[40px] px-3 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <QrCode className="w-4 h-4" />
                  <span>QR Code</span>
                </button>
              </div>

              {/* Telegram Direct Link */}
              <div className="pt-3 border-t border-white/10 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-200">Telegram Direct Link</span>
                  <span className="text-zinc-500">Opens Mini App in 1 tap</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded-xl bg-[#08080A] border border-white/10 px-3 py-2.5 font-mono text-xs text-emerald-300">
                    {createdLink.telegram_url}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(createdLink.telegram_url, 'tg')}
                    className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 transition-colors shrink-0"
                    aria-label="Copy Telegram Direct Link"
                  >
                    {copiedField === 'tg' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Social PicLink */}
              <div className="pt-3 border-t border-white/10 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-200">Social PicLink</span>
                  <span className="text-zinc-500">X · Facebook · WhatsApp</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded-xl bg-[#08080A] border border-white/10 px-3 py-2.5 font-mono text-xs text-zinc-200">
                    {createdLink.piclink_url}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(createdLink.piclink_url, 'pic')}
                    className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white transition-colors shrink-0"
                    aria-label="Copy Social PicLink"
                  >
                    {copiedField === 'pic' ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => onPreviewUnlock(createdLink.slug)}
                  className="min-h-[42px] rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-xs font-medium text-white inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Test Unlock</span>
                </button>
                <a
                  href={`/r/${encodeURIComponent(createdLink.slug)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[42px] rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-xs font-medium text-white inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Open PicLink Page</span>
                </a>
              </div>
            </section>
          ) : null}

          {/* Live Social Card Preview */}
          <section className="bg-[#111115] border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-zinc-200">
                Social Card Preview
              </h3>
              <span className="text-xs text-zinc-500 font-mono">
                /r/{customSlug.trim() || 'slug'}
              </span>
            </div>

            <div className="p-5">
              <div className="rounded-xl border border-white/10 overflow-hidden bg-[#08080A]">
                {enablePicLink && imageUrl && !previewImgError ? (
                  <img
                    src={imageUrl}
                    alt={title || 'PicLink preview'}
                    referrerPolicy="no-referrer"
                    onError={() => setPreviewImgError(true)}
                    className="w-full aspect-video object-cover bg-zinc-900"
                  />
                ) : (
                  <div className="w-full aspect-video bg-gradient-to-br from-zinc-900 via-[#111115] to-emerald-950/30 flex flex-col items-center justify-center gap-2 px-4 text-center">
                    <ImageIcon className="w-6 h-6 text-zinc-600" />
                    <span className="text-xs text-zinc-500">
                      {enablePicLink
                        ? 'Paste an image URL or upload a 16:9 thumbnail'
                        : 'Enable PicLink Card to attach a custom social thumbnail'}
                    </span>
                  </div>
                )}
                <div className="p-4">
                  <p className="text-[11px] font-mono text-emerald-400 truncate">
                    {settings.site_name} · {previewDomain}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white line-clamp-1">
                    {(enablePicLink && title.trim()) || `Unlock ${previewDomain}`}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                    {(enablePicLink && description.trim()) ||
                      'Watch a short sponsored ad in Telegram to unlock this verified destination.'}
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-zinc-400">
                <span>Transparent CPM tiers</span>
                <span className="font-mono text-zinc-300 tabular-nums">
                  T1 {formatMicros(settings.rate_tier1_micros, currency)} · IN{' '}
                  {formatMicros(settings.rate_in_micros, currency)}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {createdLink && (
        <QrModal
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          slug={createdLink.slug}
          title={createdLink.title}
          telegramUrl={createdLink.telegram_url}
          piclinkUrl={createdLink.piclink_url}
        />
      )}
    </div>
  );
}
