'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AdMarker, AdType, Ad, VideoListDto, VideoDetailDto } from '@/lib/types';
import { formatTime, generateId } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useHistory } from '@/hooks/use-history';
import { useAds } from '@/hooks/use-ads';
import { useApp } from '@/context/app-context';
import { VideoPlayer, VideoPlayerHandle } from '@/components/video/video-player';
import { Timeline } from '@/components/video/timeline';
import { CreateMarkerModal } from '@/components/ads/create-marker-modal';
import { SelectAdsModal } from '@/components/ads/select-ads-modal';
import {
  Plus, Trash2, Info, ArrowLeft, Play, Radio, Loader2, AlertCircle,
  CheckCircle2, Clock, Settings, Bell, Sparkles,
} from 'lucide-react';
import { TranscriptPanel } from '@/components/video/transcript-panel';
import { UserMenu } from '@/components/user-menu';

const TYPE_LABELS = { auto: 'Auto', static: 'Static', ab: 'A/B' };
const TYPE_BADGE: Record<string, string> = {
  auto:   'bg-emerald-100 text-emerald-700 border border-emerald-200',
  static: 'bg-blue-100 text-blue-700 border border-blue-200',
  ab:     'bg-orange-100 text-orange-700 border border-orange-200',
};

type StatusKey = 'pending' | 'uploaded' | 'chunking' | 'completed';
const STATUS_CONFIG: Record<StatusKey, { label: string; icon: typeof CheckCircle2; color: string }> = {
  completed: { label: 'Ready',      icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' },
  uploaded:  { label: 'Uploaded',   icon: CheckCircle2, color: 'text-blue-600 bg-blue-50' },
  chunking:  { label: 'Processing', icon: Loader2,      color: 'text-amber-600 bg-amber-50' },
  pending:   { label: 'Pending',    icon: Clock,        color: 'text-zinc-500 bg-zinc-100' },
};
const PLAYABLE: Set<string> = new Set(['uploaded', 'completed']);

// ── Topbar user chip ──────────────────────────────────────────────────
// Settings and Bell remain decorative for now; the user chip is wired up
// to real auth via <UserMenu /> (shows the signed-in user and provides a
// functional Log out action).
function TopbarUser() {
  return (
    <div className="flex items-center gap-3">
      <button className="text-gray-400 hover:text-gray-700 transition p-1.5 rounded-lg hover:bg-gray-100">
        <Settings size={16} />
      </button>
      <button className="text-gray-400 hover:text-gray-700 transition p-1.5 rounded-lg hover:bg-gray-100 relative">
        <Bell size={16} />
        <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
      </button>
      <UserMenu />
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ── Episodes list (was PodcastList) ───────────────────────────────────
// Fetches real videos for the currently-selected podcast and routes the
// user into the editor on click.
function EpisodesList({ onSelect }: { onSelect: (id: string) => void }) {
  const { currentPodcast, currentPodcastId, apiFetch } = useApp();
  const [videos, setVideos] = useState<VideoListDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentPodcastId) {
      setVideos([]);
      return;
    }
    setError(null);
    try {
      const res = await apiFetch('/api/videos', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/videos failed: ${res.status}`);
      setVideos((await res.json()) as VideoListDto[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load videos');
    }
  }, [apiFetch, currentPodcastId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 bg-[#f5f5f7]/90 backdrop-blur border-b border-black/6 px-6 py-4 flex items-center justify-between z-10">
        <div>
          <p className="text-gray-400 text-xs">Ads</p>
          <h1 className="text-gray-900 text-lg font-semibold">
            {currentPodcast ? currentPodcast.title : 'Choose an episode'}
          </h1>
          {currentPodcast?.description && (
            <p className="text-gray-400 text-xs mt-0.5 max-w-xl truncate">
              {currentPodcast.description}
            </p>
          )}
        </div>
        <TopbarUser />
      </div>

      <div className="p-6">
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {videos === null && !error && (
            // Skeleton rows — shimmer reused from globals.css.
            <div>
              {[0, 1, 2].map((i) => (
                <div key={i} className={cn(
                  'flex items-center gap-4 px-4 py-4',
                  i !== 2 && 'border-b border-gray-100',
                )}>
                  <div className="w-20 h-12 rounded-lg bg-gray-100 shrink-0 waveform-shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-gray-100 waveform-shimmer" />
                    <div className="h-2.5 w-1/3 rounded bg-gray-100 waveform-shimmer" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="py-12 text-center">
              <AlertCircle size={28} className="text-red-300 mx-auto mb-2" />
              <p className="text-red-500 text-sm font-medium">{error}</p>
              <button
                onClick={() => void load()}
                className="mt-3 text-xs text-indigo-600 hover:text-indigo-700 font-medium bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
              >
                Retry
              </button>
            </div>
          )}

          {videos !== null && !error && videos.length === 0 && (
            <div className="py-14 text-center">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                <Radio size={18} className="text-indigo-400" />
              </div>
              <p className="text-gray-700 text-sm font-medium">No episodes here yet</p>
              <p className="text-gray-400 text-xs mt-1">
                Upload an episode from the Dashboard to start managing ads.
              </p>
            </div>
          )}

          {videos?.map((video, idx) => {
            const key = (video.status in STATUS_CONFIG ? video.status : 'pending') as StatusKey;
            const status = STATUS_CONFIG[key];
            const StatusIcon = status.icon;
            const playable = PLAYABLE.has(video.status);
            return (
              <button
                key={video.id}
                onClick={() => playable && onSelect(video.id)}
                disabled={!playable}
                className={cn(
                  'w-full flex items-center gap-4 px-4 py-4 text-left transition group',
                  playable ? 'hover:bg-indigo-50/60 cursor-pointer' : 'opacity-60 cursor-not-allowed',
                  idx !== (videos.length - 1) && 'border-b border-gray-100',
                )}
              >
                <div className="w-20 h-12 rounded-lg bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center relative">
                  {video.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={video.thumbnail} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-linear-to-br from-fuchsia-100 via-pink-100 to-amber-100 flex items-center justify-center">
                      <Play size={16} className="text-pink-500" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-sm font-medium leading-snug line-clamp-2 transition',
                    playable ? 'text-gray-900 group-hover:text-indigo-700' : 'text-gray-600',
                  )}>
                    {video.title}
                  </p>
                  <p className="text-gray-400 text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {video.episode && <span>{video.episode}</span>}
                    {video.episode && (video.publishedAt || video.createdAt) && <span>·</span>}
                    <span>{formatDate(video.publishedAt ?? video.createdAt)}</span>
                    {video.duration > 0 && <><span>·</span><span>{formatDuration(video.duration)}</span></>}
                    {video.adMarkerCount > 0 && (
                      <span className="text-indigo-500 ml-1">
                        {video.adMarkerCount} ad marker{video.adMarkerCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </p>
                </div>
                <div className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0',
                  status.color,
                )}>
                  <StatusIcon size={11} className={video.status === 'chunking' ? 'animate-spin' : ''} />
                  {status.label}
                </div>
                {playable && (
                  <div className="hidden group-hover:flex items-center gap-1.5 text-xs text-indigo-600 font-medium bg-indigo-50 group-hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition shrink-0">
                    <Radio size={12} />Manage ads
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Ad editor ─────────────────────────────────────────────────────────
// Fetches a single video by id, passes its signed playback URL to the
// player and its parsed waveform to the timeline. Marker mutations are
// persisted via a debounced PATCH.
function AdEditor({ videoId, onBack }: { videoId: string; onBack: () => void }) {
  const { apiFetch } = useApp();
  const { ads } = useAds();
  const [video, setVideo] = useState<VideoDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [adProgress, setAdProgress] = useState<{ markerId: string; elapsed: number } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingType, setPendingType] = useState<AdType | null>(null);
  const [editingMarker, setEditingMarker] = useState<AdMarker | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const playerRef = useRef<VideoPlayerHandle>(null);

  // useHistory needs an initial markers value; wait to seed it until we
  // have the DTO. Render a skeleton instead of mounting it empty.
  const initialMarkers = video?.adMarkers ?? [];
  const { markers, push, undo, redo, canUndo, canRedo, reset } = useHistory(initialMarkers);

  // Fetch the video.
  useEffect(() => {
    let alive = true;
    setVideo(null);
    setLoadError(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/videos/${videoId}`, { cache: 'no-store' });
        if (res.status === 404) {
          if (alive) setLoadError('Episode not found.');
          return;
        }
        if (!res.ok) throw new Error(`GET /api/videos/${videoId} failed: ${res.status}`);
        const dto = (await res.json()) as VideoDetailDto;
        if (!alive) return;
        setVideo(dto);
        setDuration(dto.duration ?? 0);
        // Seed history with the server's markers. `reset` wipes past/future
        // so undo can't jump to a pre-load state.
        reset(dto.adMarkers ?? []);
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Failed to load episode');
      }
    })();
    return () => { alive = false; };
    // `reset` identity is stable across renders of useHistory; `apiFetch`
    // changes with the X-Podcast-Id, which is fine here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Debounced PATCH — persists marker edits (move, add, delete, A/B swap)
  // to the server 500ms after the last change. Skips the initial seeded
  // state so loading doesn't trigger a round-trip.
  const skipFirstSyncRef = useRef(true);
  useEffect(() => {
    if (!video) return;
    if (skipFirstSyncRef.current) {
      skipFirstSyncRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void apiFetch(`/api/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adMarkers: markers.map((m) => ({
            type: m.type,
            startTime: m.startTime,
            label: m.label ?? null,
            adIds: m.adIds ?? [],
          })),
        }),
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [markers, video, apiFetch]);

  // Spacebar + Ctrl+Z/Y (same as before).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        const v = document.querySelector('video') as HTMLVideoElement | null;
        if (v) v.paused ? v.play() : v.pause();
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.code === 'KeyZ' || e.code === 'KeyY')) { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  function handleTypeSelected(type: AdType) {
    setShowCreateModal(false);
    if (type === 'auto') addMarker(type, []);
    else setPendingType(type);
  }

  function addMarker(type: AdType, pickedAds: Ad[]) {
    const t = playerRef.current?.getCurrentTime() ?? 0;
    push([...markers, {
      id: generateId(), type, startTime: t,
      adIds: pickedAds.map((a) => a.id),
    }].sort((a, b) => a.startTime - b.startTime));
  }

  function deleteMarker(id: string) { push(markers.filter((m) => m.id !== id)); }

  function moveMarker(id: string, t: number) {
    push(markers.map((m) => m.id === id ? { ...m, startTime: t } : m).sort((a, b) => a.startTime - b.startTime));
  }

  function handleSeek(t: number) { playerRef.current?.seek(t); }
  function handleSeekIntoAd(markerId: string, elapsed: number) {
    playerRef.current?.seekIntoAd(markerId, elapsed);
  }
  // Pause the underlying video(s) while the playhead is being dragged
  // so playback doesn't march on under the cursor during a long hold;
  // resume on release if it was playing before.
  function handleScrubbingChange(active: boolean) {
    playerRef.current?.setScrubbing(active);
  }

  // Loading / error guards.
  if (loadError) {
    return (
      <div className="flex flex-col h-screen bg-[#f5f5f7]">
        <div className="shrink-0 bg-[#f5f5f7]/95 backdrop-blur border-b border-black/5 px-6 pt-4 pb-5">
          <button
            onClick={onBack}
            className="group inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-900 transition -ml-1 px-1 py-0.5 rounded"
          >
            <ArrowLeft size={13} className="transition group-hover:-translate-x-0.5" />
            <span>Ads</span>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <AlertCircle size={32} className="text-red-300" />
          <p className="text-red-500 text-sm font-medium">{loadError}</p>
          <button
            onClick={onBack}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
          >
            Back to episodes
          </button>
        </div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="flex flex-col h-screen bg-[#f5f5f7]">
        <div className="shrink-0 bg-[#f5f5f7]/95 backdrop-blur border-b border-black/5 px-6 pt-4 pb-5">
          <div className="h-3 w-16 rounded bg-gray-200 waveform-shimmer mb-2" />
          <div className="h-6 w-2/3 max-w-md rounded bg-gray-200 waveform-shimmer" />
        </div>
        <div className="flex flex-1 min-h-0 gap-3 p-3">
          <div className="w-[280px] shrink-0 bg-white rounded-xl border border-gray-100 waveform-shimmer" />
          <div className="flex-1 bg-white rounded-xl border border-gray-100 waveform-shimmer" />
        </div>
        <div className="shrink-0 px-3 pb-3">
          <div className="h-48 rounded-2xl bg-white border border-gray-200 waveform-shimmer" />
        </div>
      </div>
    );
  }

  const sorted = [...markers].sort((a, b) => a.startTime - b.startTime);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f5f5f7]">
      {/* Top header */}
      <div className="shrink-0 bg-[#f5f5f7]/95 backdrop-blur border-b border-black/5 px-6 pt-4 pb-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <button
              onClick={onBack}
              className="group inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-900 transition mb-2 -ml-1 px-1 py-0.5 rounded"
            >
              <ArrowLeft size={13} className="transition group-hover:-translate-x-0.5" />
              <span>Ads</span>
            </button>
            <h1 className="text-gray-900 font-bold leading-[1.22] tracking-tight text-[22px] sm:text-[24px] max-w-4xl">
              {video.title}
            </h1>
            <p className="text-gray-500 text-[13px] mt-2 tracking-wide">
              {video.episode && <span>Episode {video.episode}</span>}
              {video.episode && (video.publishedAt || video.createdAt) && <span className="mx-1.5">•</span>}
              {formatDate(video.publishedAt ?? video.createdAt)}
            </p>
          </div>
          <div className="pt-1 shrink-0 flex items-center gap-3">
            {video.transcript && (
              <button
                onClick={() => setShowTranscript((v) => !v)}
                className={cn(
                  'group relative inline-flex items-center gap-1.5 text-[13px] font-semibold text-white px-3.5 py-2 rounded-lg overflow-hidden transition-[transform,box-shadow] duration-200 active:scale-[0.97]',
                  showTranscript
                    ? 'bg-gray-900 hover:bg-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.1)]'
                    : 'transcript-fancy shadow-[0_4px_14px_-4px_rgba(124,58,237,0.55),0_2px_4px_rgba(17,24,39,0.15)] hover:shadow-[0_6px_20px_-4px_rgba(124,58,237,0.7),0_2px_6px_rgba(17,24,39,0.2)]',
                )}
                aria-pressed={showTranscript}
              >
                <Sparkles
                  size={13}
                  className={cn(
                    'shrink-0 relative z-[1]',
                    !showTranscript && 'transcript-sparkle',
                  )}
                />
                <span className="relative z-[1]">Transcript</span>
              </button>
            )}
            <TopbarUser />
          </div>
        </div>
      </div>

      {/* Main 2-col area */}
      <div className="flex flex-1 min-h-0 gap-3 p-3">
        {/* LEFT: Ad markers panel */}
        <div className="w-[280px] shrink-0 flex flex-col bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <span className="text-gray-900 text-sm font-semibold">Ad markers</span>
            <span className="text-gray-400 text-xs">{markers.length} markers</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6 py-8">
                <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center mb-2.5">
                  <Info size={16} className="text-gray-400" />
                </div>
                <p className="text-gray-500 text-sm font-medium">No ad markers yet</p>
                <p className="text-gray-400 text-xs mt-1">Create your first marker below</p>
              </div>
            ) : (
              <table className="w-full">
                <tbody>
                  {sorted.map((m, i) => (
                    <tr
                      key={m.id}
                      className="border-b border-gray-50 hover:bg-gray-50 transition group cursor-pointer animate-fade-in"
                      onClick={() => playerRef.current?.seek(m.startTime)}
                    >
                      <td className="pl-4 pr-2 py-3 text-xs text-gray-400 w-5">{i + 1}</td>
                      <td className="px-2 py-3 text-xs font-mono text-gray-700 whitespace-nowrap">{formatTime(m.startTime)}</td>
                      <td className="px-2 py-3">
                        <span className={cn('px-2 py-0.5 rounded-md text-[11px] font-semibold', TYPE_BADGE[m.type])}>
                          {TYPE_LABELS[m.type]}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingMarker(m); }}
                          className="text-[12px] text-gray-500 hover:text-gray-900 font-medium transition px-1"
                        >
                          Edit
                        </button>
                      </td>
                      <td className="pr-3 py-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteMarker(m.id); }}
                          className="p-1.5 text-white bg-red-400 hover:bg-red-500 rounded-md transition"
                        >
                          <Trash2 size={10} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="px-4 py-3 border-t border-gray-100 space-y-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-white bg-gray-900 hover:bg-gray-700 rounded-lg py-2.5 transition"
            >
              <Plus size={13} />
              Create ad marker
            </button>
            <button className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg py-2 transition">
              Automatically place
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            </button>
          </div>
        </div>

        {/* RIGHT: Video player (+ optional transcript panel) */}
        <div className="flex-1 min-w-0 flex gap-3">
          <div className="flex-1 min-w-0">
            <VideoPlayer
              ref={playerRef}
              src={video.playbackUrl ?? ''}
              adMarkers={markers}
              ads={ads}
              onTimeUpdate={setCurrentTime}
              onDurationChange={setDuration}
              onAdProgress={setAdProgress}
              onError={setVideoError}
            />
          </div>
          {showTranscript && video.transcript && (
            <TranscriptPanel
              transcript={video.transcript}
              currentTime={currentTime}
              onSeek={handleSeek}
              onClose={() => setShowTranscript(false)}
            />
          )}
        </div>
      </div>

      {/* BOTTOM: Timeline */}
      <div className="shrink-0 px-3 pb-3">
        <Timeline
          duration={duration}
          currentTime={currentTime}
          markers={markers}
          ads={ads}
          adProgress={adProgress}
          error={videoError}
          waveformData={video.waveformData}
          onSeek={handleSeek}
          onSeekIntoAd={handleSeekIntoAd}
          onScrubbingChange={handleScrubbingChange}
          onMarkerDelete={deleteMarker}
          onMarkerMove={moveMarker}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateMarkerModal onSelect={handleTypeSelected} onCancel={() => setShowCreateModal(false)} />
      )}
      {pendingType && (
        <SelectAdsModal
          mode={pendingType === 'ab' ? 'ab' : 'static'}
          ads={ads}
          onConfirm={(selected) => { addMarker(pendingType!, selected); setPendingType(null); }}
          onCancel={() => setPendingType(null)}
        />
      )}
      {editingMarker && (
        <SelectAdsModal
          mode={editingMarker.type === 'ab' ? 'ab' : 'static'}
          ads={ads}
          onConfirm={(selected) => {
            push(markers.map((m) => m.id === editingMarker.id ? { ...m, adIds: selected.map((a) => a.id) } : m));
            setEditingMarker(null);
          }}
          onCancel={() => setEditingMarker(null)}
        />
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────
function AdsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const videoId = searchParams.get('video');

  if (videoId) {
    return (
      <AdEditor
        videoId={videoId}
        onBack={() => router.replace('/ads')}
      />
    );
  }
  return (
    <EpisodesList
      onSelect={(id) => router.replace(`/ads?video=${id}`)}
    />
  );
}

export default function AdsPage() {
  return <Suspense><AdsPageInner /></Suspense>;
}
