import {
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Play,
  QrCode,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import {
  copyToClipboard,
  formatMicros,
  formatRelativeTime,
  triggerHaptic,
} from '../lib/telegram.ts';
import type { LinkItem } from '../lib/types.ts';
import { QrModal } from './QrModal.tsx';

interface LinksTabProps {
  links: LinkItem[];
  loading: boolean;
  currency: string;
  onRefresh: () => void;
  onCreateNew: () => void;
  onPreviewUnlock: (slug: string) => void;
}

export function LinksTab({
  links,
  loading,
  currency,
  onRefresh,
  onCreateNew,
  onPreviewUnlock,
}: LinksTabProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'piclink' | 'standard'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState<LinkItem | null>(null);
  const [editing, setEditing] = useState<LinkItem | null>(null);
  const [editDest, setEditDest] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editImage, setEditImage] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return links.filter((l) => {
      if (filter === 'piclink' && !l.is_piclink) return false;
      if (filter === 'standard' && l.is_piclink) return false;
      if (!q) return true;
      return (
        l.slug.toLowerCase().includes(q) ||
        l.title.toLowerCase().includes(q) ||
        l.destination_url.toLowerCase().includes(q)
      );
    });
  }, [links, search, filter]);

  const handleCopy = async (text: string, key: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    }
  };

  const openEdit = (item: LinkItem) => {
    setEditing(item);
    setEditDest(item.destination_url);
    setEditTitle(item.title);
    setEditDesc(item.description);
    setEditImage(item.image_url);
    setEditError('');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSavingEdit(true);
    setEditError('');
    try {
      await apiFetch(`/api/links/${editing.id}`, {
        method: 'PATCH',
        body: {
          destination_url: editDest.trim(),
          title: editTitle.trim(),
          description: editDesc.trim(),
          image_url: editImage.trim(),
        },
      });
      setEditing(null);
      triggerHaptic('success');
      onRefresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update link');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await apiFetch(`/api/links/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      triggerHaptic('success');
      onRefresh();
    } catch {
      triggerHaptic('error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by slug, title, or destination..."
            className="w-full min-h-[44px] rounded-xl bg-[#111115] border border-white/10 focus:border-emerald-500/60 focus:outline-none pl-10 pr-4 text-sm text-white placeholder:text-zinc-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#111115] border border-white/10 rounded-xl shrink-0">
          {(
            [
              ['all', 'All'],
              ['piclink', 'PicLinks'],
              ['standard', 'Standard'],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFilter(val)}
              className={`min-h-[36px] px-3.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                filter === val ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Links List */}
      {loading ? (
        <div className="bg-[#111115] border border-white/10 rounded-2xl divide-y divide-white/10">
          {[1, 2, 3].map((n) => (
            <div key={n} className="p-5 animate-pulse space-y-3">
              <div className="h-4 w-48 bg-white/10 rounded" />
              <div className="h-3 w-72 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#111115] border border-white/10 rounded-2xl p-10 text-center">
          <p className="text-base font-semibold text-white">
            {links.length === 0 ? 'No links created yet' : 'No matching links'}
          </p>
          <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
            {links.length === 0
              ? 'Create your first Telegram short link or PicLink card to start earning on verified views.'
              : 'Try adjusting your search query or filter.'}
          </p>
          {links.length === 0 && (
            <button
              type="button"
              onClick={onCreateNew}
              className="mt-5 min-h-[44px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs transition-colors"
            >
              Create First Link
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[#111115] border border-white/10 rounded-2xl divide-y divide-white/10">
          {filtered.map((item) => {
            const isExpired = Boolean(item.expires_at && Date.now() > item.expires_at);
            return (
              <article key={item.id} className="p-4 sm:p-5 space-y-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.title || item.slug}
                        referrerPolicy="no-referrer"
                        className="w-16 h-12 rounded-lg object-cover border border-white/10 shrink-0 bg-zinc-900"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg border border-white/10 bg-[#08080A] flex items-center justify-center shrink-0">
                        <ImageIcon className="w-4 h-4 text-zinc-600" />
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-white truncate">
                          {item.title || `/${item.slug}`}
                        </h3>
                        {item.is_piclink && (
                          <span className="text-[11px] font-medium text-emerald-400">
                            PicLink
                          </span>
                        )}
                        {item.is_disabled === 1 && (
                          <span className="text-[11px] font-medium text-red-400">
                            Disabled
                          </span>
                        )}
                        {isExpired && (
                          <span className="text-[11px] font-medium text-amber-400">
                            Expired
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400 truncate mt-0.5">
                        {item.destination_url}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500 mt-1 font-mono">
                        <span>/r/{item.slug}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelativeTime(item.created_at)}</span>
                        {item.expires_at && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              Expires {new Date(item.expires_at).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Verified Views & Earnings */}
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                      {formatMicros(item.earned_micros, currency)}
                    </p>
                    <p className="font-mono text-xs text-zinc-400 tabular-nums mt-0.5">
                      {item.verified_clicks.toLocaleString()} views
                    </p>
                  </div>
                </div>

                {/* Action Controls */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleCopy(item.telegram_url, `tg-${item.id}`)}
                    className="min-h-[40px] px-3 rounded-xl bg-emerald-500/12 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    {copiedKey === `tg-${item.id}` ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === `tg-${item.id}` ? 'Copied TG' : 'Copy TG Link'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopy(item.piclink_url, `pic-${item.id}`)}
                    className="min-h-[40px] px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    {copiedKey === `pic-${item.id}` ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === `pic-${item.id}` ? 'Copied PicLink' : 'Copy PicLink'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setQrLink(item)}
                    className="min-h-[40px] px-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 text-zinc-300 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>QR</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onPreviewUnlock(item.slug)}
                    className="min-h-[40px] px-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 text-zinc-300 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Preview</span>
                  </button>

                  <a
                    href={`/r/${encodeURIComponent(item.slug)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 text-zinc-400 hover:text-white transition-colors"
                    aria-label="Open social PicLink card"
                    title="Open social PicLink page"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 text-zinc-400 hover:text-white transition-colors"
                    aria-label="Edit link"
                    title="Edit link"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>

                  {confirmDeleteId === item.id ? (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={deletingId === item.id}
                        onClick={() => handleDelete(item.id)}
                        className="min-h-[40px] px-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs font-semibold whitespace-nowrap"
                      >
                        {deletingId === item.id ? 'Deleting...' : 'Confirm Delete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[40px] px-2.5 rounded-xl border border-white/10 text-zinc-400 text-xs whitespace-nowrap"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(item.id)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-white/[0.03] hover:bg-red-500/15 border border-white/10 hover:border-red-500/30 text-zinc-400 hover:text-red-300 transition-colors"
                      aria-label="Delete link"
                      title="Delete link"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* QR Popup */}
      {qrLink && (
        <QrModal
          open={Boolean(qrLink)}
          onClose={() => setQrLink(null)}
          slug={qrLink.slug}
          title={qrLink.title}
          telegramUrl={qrLink.telegram_url}
          piclinkUrl={qrLink.piclink_url}
        />
      )}

      {/* Edit Link Modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setEditing(null)}
        >
          <form
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg bg-[#111115] border border-white/10 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">Edit Link</h3>
                <p className="text-xs font-mono text-zinc-400">/r/{editing.slug}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/5"
                aria-label="Close edit modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                {editError}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Destination URL
              </label>
              <input
                type="url"
                required
                value={editDest}
                onChange={(e) => setEditDest(e.target.value)}
                className="w-full min-h-[44px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                PicLink Title
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={120}
                className="w-full min-h-[44px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                PicLink Description
              </label>
              <textarea
                rows={2}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={280}
                className="w-full rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 py-2.5 text-sm text-white resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Thumbnail Image URL
              </label>
              <input
                type="text"
                value={editImage}
                onChange={(e) => setEditImage(e.target.value)}
                className="w-full min-h-[44px] rounded-xl bg-[#08080A] border border-white/10 focus:border-emerald-500/60 focus:outline-none px-3.5 text-sm text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="min-h-[44px] px-4 rounded-xl border border-white/10 text-xs font-medium text-zinc-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="min-h-[44px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold"
              >
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
