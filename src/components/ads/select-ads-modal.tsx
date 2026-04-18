'use client';

import { useMemo, useRef, useState } from 'react';
import { Ad } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAds } from '@/hooks/use-ads';
import { X, Search, Upload, Eye, Check, Trash2, Play, Pause, Loader2, Info } from 'lucide-react';
import { UploadAdModal } from '@/components/ads/upload-ad-modal';

interface Props {
  mode: 'static' | 'ab';
  // Deprecated — kept for backwards compatibility with callers that still
  // pass a pre-loaded list. The modal now reads `useAds()` directly so the
  // list stays fresh after in-modal uploads.
  ads?: Ad[];
  onConfirm: (selected: Ad[]) => void;
  onCancel: () => void;
}

const ALL = 'All';

function formatDuration(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—';
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function SelectAdsModal({ mode, onConfirm, onCancel }: Props) {
  const { ads, loading, error, refresh } = useAds();
  const [search, setSearch] = useState('');
  const [campaign, setCampaign] = useState(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [previewAdId, setPreviewAdId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Derive campaign filter chips. Skip blanks and keep order stable.
  const campaigns = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [ALL];
    for (const a of ads) {
      const c = (a.campaign ?? '').trim();
      if (c && !seen.has(c)) { seen.add(c); out.push(c); }
    }
    return out;
  }, [ads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ads.filter((ad) => {
      const matchSearch =
        !q ||
        ad.title.toLowerCase().includes(q) ||
        ad.advertiser.toLowerCase().includes(q) ||
        ad.tags.some((t) => t.toLowerCase().includes(q));
      const matchCampaign =
        campaign === ALL || ad.campaign === campaign || ad.tags.includes(campaign);
      return matchSearch && matchCampaign;
    });
  }, [ads, search, campaign]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (mode === 'static') {
        next.clear();
        next.add(id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleConfirm() {
    onConfirm(ads.filter((a) => selected.has(a.id)));
  }

  async function handleUploaded(ad: Ad) {
    setShowUpload(false);
    // Refresh in the background; pre-select the new ad so the user can
    // confirm it immediately without rescrolling.
    setSelected((prev) => {
      if (mode === 'static') return new Set([ad.id]);
      const n = new Set(prev); n.add(ad.id); return n;
    });
    try { await refresh(); } catch { /* surface is the list staying stale */ }
  }

  async function handleDelete(ad: Ad) {
    if (deletingId) return;
    if (!confirm(`Delete "${ad.title}"?`)) return;
    setDeletingId(ad.id);
    try {
      const res = await fetch(`/api/ads/${ad.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`DELETE failed ${res.status}`);
      setSelected((prev) => { const n = new Set(prev); n.delete(ad.id); return n; });
      await refresh();
    } catch {
      // Non-blocking: the list stays unchanged, user can retry.
    } finally {
      setDeletingId(null);
    }
  }

  const previewAd = useMemo(
    () => (previewAdId ? ads.find((a) => a.id === previewAdId) ?? null : null),
    [previewAdId, ads],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(15,15,20,0.55) 0%, rgba(8,8,12,0.72) 100%)',
        backdropFilter: 'blur(1.5px) saturate(115%)',
        WebkitBackdropFilter: 'blur(1.5px) saturate(115%)',
      }}
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg animate-slide-in flex flex-col max-h-[82vh]"
        style={{
          boxShadow:
            '0 24px 64px -12px rgba(0,0,0,0.35), 0 8px 24px -6px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-gray-900 font-semibold text-sm">
              {mode === 'ab' ? 'A/B test' : 'Select ad'}
            </h2>
            <p className="text-gray-400 text-xs mt-0.5">
              {mode === 'ab'
                ? "Pick two or more ads to rotate for this marker"
                : 'Pick the ad to play at this marker'}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-700 transition p-1 rounded-lg hover:bg-gray-100"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search + actions */}
        <div className="px-5 pt-3 pb-2 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title, advertiser, tag…"
                className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-900 transition"
              />
            </div>
            <button
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg px-3 py-2 transition"
            >
              <Upload size={12} />
              Upload
            </button>
          </div>

          {/* Campaign filters */}
          {campaigns.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {campaigns.map((c) => (
                <button
                  key={c}
                  onClick={() => setCampaign(c)}
                  className={cn(
                    'shrink-0 text-xs px-3 py-1 rounded-full font-medium transition',
                    campaign === c
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">
            Ad library {ads.length > 0 && <span className="text-gray-300 font-normal normal-case">· {ads.length}</span>}
          </p>
        </div>

        {/* Ad list */}
        <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-1.5">
          {loading && ads.length === 0 ? (
            <AdSkeleton />
          ) : error ? (
            <div className="flex flex-col items-center justify-center text-center py-12 px-6">
              <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center mb-2.5">
                <Info size={16} className="text-red-500" />
              </div>
              <p className="text-red-600 text-sm font-medium">Couldn&apos;t load ads</p>
              <button
                onClick={() => void refresh()}
                className="mt-2 text-xs text-gray-700 hover:text-gray-900 font-medium underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-12 px-6">
              <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center mb-2.5">
                <Info size={16} className="text-gray-400" />
              </div>
              <p className="text-gray-700 text-sm font-medium">No ads found</p>
              <p className="text-gray-400 text-xs mt-1">
                {ads.length === 0
                  ? 'Upload your first ad to get started.'
                  : 'Try a different search or clear the campaign filter.'}
              </p>
            </div>
          ) : (
            filtered.map((ad) => {
              const isSel = selected.has(ad.id);
              const isOwner = !ad.isPublicAd;
              return (
                <div
                  key={ad.id}
                  onClick={() => toggle(ad.id)}
                  className={cn(
                    'group relative w-full flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                    isSel
                      ? 'border-gray-900 bg-gray-50'
                      : 'border-transparent bg-gray-50/70 hover:bg-gray-50 hover:border-gray-200',
                  )}
                >
                  {/* Thumbnail / play-preview */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewAdId((cur) => cur === ad.id ? null : ad.id);
                    }}
                    className="relative w-20 h-12 rounded-lg bg-gray-200 overflow-hidden shrink-0 group/thumb"
                  >
                    {ad.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ad.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-linear-to-br from-gray-800 to-gray-950" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover/thumb:opacity-100 transition">
                      <Play size={14} className="text-white fill-white" />
                    </div>
                  </button>

                  {/* Meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-gray-900 text-[13px] font-semibold truncate">{ad.title}</p>
                      {ad.isPublicAd && (
                        <span className="shrink-0 text-[10px] font-bold tracking-wider uppercase text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded">
                          Public
                        </span>
                      )}
                    </div>
                    <p className="text-gray-500 text-xs mt-0.5 truncate">
                      {ad.advertiser || '—'}
                      {ad.duration > 0 && <span className="text-gray-300 mx-1.5">·</span>}
                      {ad.duration > 0 && <span className="tabular-nums">{formatDuration(ad.duration)}</span>}
                      {ad.tags[0] && <span className="text-gray-300 mx-1.5">·</span>}
                      {ad.tags[0] && <span>{ad.tags[0]}</span>}
                    </p>
                  </div>

                  {/* Right actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isOwner && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleDelete(ad); }}
                        disabled={deletingId === ad.id}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition disabled:opacity-30"
                        title="Delete ad"
                      >
                        {deletingId === ad.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <Trash2 size={12} />}
                      </button>
                    )}
                    {isSel && (
                      <div className="w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center">
                        <Check size={11} className="text-white" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Inline preview (collapses when closed; single-instance keeps DOM light) */}
        {previewAd && (
          <AdPreview ad={previewAd} onClose={() => setPreviewAdId(null)} />
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-gray-100">
          <span className="text-xs text-gray-400 tabular-nums">
            {selected.size > 0 && (mode === 'ab' ? `${selected.size} selected` : 'Selected')}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0 || (mode === 'ab' && selected.size < 2)}
              className="bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              title={mode === 'ab' && selected.size < 2 ? 'Pick at least two ads for an A/B test' : undefined}
            >
              {mode === 'ab' ? 'Create A/B test' : 'Select ad'}
            </button>
          </div>
        </div>
      </div>

      {showUpload && (
        <UploadAdModal
          onUploaded={handleUploaded}
          onCancel={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────
function AdSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-transparent"
        >
          <div className="w-20 h-12 rounded-lg bg-gray-200 shrink-0 waveform-shimmer" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-2.5 w-3/5 rounded bg-gray-200 waveform-shimmer" />
            <div className="h-2 w-2/5 rounded bg-gray-100 waveform-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Inline preview ───────────────────────────────────────────────────
function AdPreview({ ad, onClose }: { ad: Ad; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }

  if (!ad.videoUrl) {
    return (
      <div className="mx-5 mb-3 p-3 rounded-xl bg-gray-50 border border-gray-100 text-[11px] text-gray-500 flex items-center gap-2">
        <Eye size={12} />
        Preview unavailable — no source URL for this ad.
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700">
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-5 mb-3 rounded-xl bg-black overflow-hidden relative">
      <video
        ref={videoRef}
        src={ad.videoUrl}
        autoPlay
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="w-full max-h-[180px] object-contain bg-black"
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2 bg-linear-to-t from-black/80 to-transparent">
        <button
          onClick={toggle}
          className="w-7 h-7 rounded-full bg-white/90 hover:bg-white text-gray-900 flex items-center justify-center transition"
        >
          {playing ? <Pause size={12} /> : <Play size={12} className="translate-x-px" />}
        </button>
        <p className="text-[11px] text-white font-medium truncate">{ad.title}</p>
        <button
          onClick={onClose}
          className="ml-auto text-white/70 hover:text-white transition p-1"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
