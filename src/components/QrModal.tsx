import { Check, Copy, Download, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { copyToClipboard } from '../lib/telegram.ts';

interface QrModalProps {
  open: boolean;
  onClose: () => void;
  slug: string;
  title?: string;
  telegramUrl: string;
  piclinkUrl: string;
}

export function QrModal({
  open,
  onClose,
  slug,
  title,
  telegramUrl,
  piclinkUrl,
}: QrModalProps) {
  const [mode, setMode] = useState<'telegram' | 'piclink'>('telegram');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const activeUrl = mode === 'telegram' ? telegramUrl : piclinkUrl;

  useEffect(() => {
    if (!open || !activeUrl) return;
    let cancelled = false;
    QRCode.toDataURL(activeUrl, {
      width: 512,
      margin: 2,
      color: {
        dark: '#08080A',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeUrl]);

  if (!open) return null;

  const handleCopy = async () => {
    const ok = await copyToClipboard(activeUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const anchor = document.createElement('a');
    anchor.href = qrDataUrl;
    anchor.download = `linkvault-${slug}-${mode}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Download QR Code"
    >
      <div
        className="w-full sm:max-w-md bg-[#111115] border border-white/10 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-white/15 rounded-full mx-auto mb-4 sm:hidden" />

        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white truncate">
              {title || `/${slug}`}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              High-resolution QR code ready to share or print
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Close QR dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-[#08080A] border border-white/10 rounded-xl mb-5">
          <button
            type="button"
            onClick={() => setMode('telegram')}
            className={`min-h-[40px] px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              mode === 'telegram'
                ? 'bg-emerald-500 text-zinc-950 font-semibold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Telegram Direct
          </button>
          <button
            type="button"
            onClick={() => setMode('piclink')}
            className={`min-h-[40px] px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              mode === 'piclink'
                ? 'bg-emerald-500 text-zinc-950 font-semibold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Social PicLink
          </button>
        </div>

        {/* QR Preview */}
        <div className="flex flex-col items-center justify-center bg-[#08080A] border border-white/10 rounded-2xl p-6 mb-4">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR code for ${slug}`}
              className="w-52 h-52 rounded-xl bg-white p-2"
            />
          ) : (
            <div className="w-52 h-52 rounded-xl bg-white/5 animate-pulse" />
          )}
          <p className="mt-4 w-full text-center font-mono text-[11px] text-zinc-400 truncate px-2">
            {activeUrl}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-sm font-medium text-white transition-colors whitespace-nowrap"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied' : 'Copy Link'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!qrDataUrl}
            className="min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-sm font-semibold text-zinc-950 transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Download PNG</span>
          </button>
        </div>
      </div>
    </div>
  );
}
