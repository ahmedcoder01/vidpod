'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useApp } from '@/context/app-context';
import { HlsPlayer, HlsPlayerHandle } from '@/components/video/hls-player';
import { WatchTranscript } from '@/components/video/watch-transcript';
import { UserMenu } from '@/components/user-menu';
import type { VideoDetailDto } from '@/lib/types';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 30_000;

type StatusKey = 'pending' | 'uploaded' | 'chunking' | 'completed';
const STATUS_CONFIG: Record<StatusKey, { label: string; icon: typeof CheckCircle2; color: string }> = {
  completed: { label: 'HLS ready',  icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  uploaded:  { label: 'Uploaded',   icon: CheckCircle2, color: 'text-blue-600 bg-blue-50 border-blue-100' },
  chunking:  { label: 'Processing', icon: Loader2,      color: 'text-amber-600 bg-amber-50 border-amber-100' },
  pending:   { label: 'Pending',    icon: Clock,        color: 'text-zinc-500 bg-zinc-100 border-zinc-200' },
};

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

export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { apiFetch } = useApp();

  const [video, setVideo] = useState<VideoDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [descExpanded, setDescExpanded] = useState(false);
  // Transcript defaults open on the watch page — the video is the main
  // attraction but the transcript is the reason the user has landed here
  // after chunking. Keep the toggle so they can reclaim width any time.
  const [showTranscript, setShowTranscript] = useState(true);

  const playerRef = useRef<HlsPlayerHandle>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/videos/${id}`, { cache: 'no-store' });
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error(`GET /api/videos/${id} failed: ${res.status}`);
      const dto = (await res.json()) as VideoDetailDto;
      setVideo(dto);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load episode');
    }
  }, [apiFetch, id]);

  // Initial fetch.
  useEffect(() => { void load(); }, [load]);

  // Poll every 30s while the worker is still chunking. Pause while the tab
  // is hidden — no point hammering the API when the user isn't looking.
  useEffect(() => {
    if (!video || video.status === 'completed') return;
    let timer: number | undefined;
    const tick = () => { void load(); };
    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(tick, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer != null) { window.clearInterval(timer); timer = undefined; }
    };
    if (!document.hidden) start();
    const onVis = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [video, load]);

  const handleSeek = useCallback((t: number) => {
    playerRef.current?.seek(t);
  }, []);

  if (notFound) {
    return (
      <div className="flex-1 overflow-y-auto">
        <Header />
        <div className="max-w-[720px] mx-auto px-6 py-16 text-center">
          <AlertCircle size={32} className="text-red-300 mx-auto mb-3" />
          <p className="text-gray-800 text-sm font-medium">Episode not found</p>
          <p className="text-gray-400 text-xs mt-1">It may have been deleted or you don&apos;t have access.</p>
          <Link
            href="/dashboard"
            className="inline-flex mt-4 text-xs text-indigo-600 hover:text-indigo-700 font-medium bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (loadError && !video) {
    return (
      <div className="flex-1 overflow-y-auto">
        <Header />
        <div className="max-w-[720px] mx-auto px-6 py-16 text-center">
          <AlertCircle size={32} className="text-red-300 mx-auto mb-3" />
          <p className="text-red-500 text-sm font-medium">{loadError}</p>
          <button
            onClick={load}
            className="inline-flex mt-4 text-xs text-indigo-600 hover:text-indigo-700 font-medium bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!video) {
    // First-load skeleton — reuse the app's shimmer treatment.
    return (
      <div className="flex-1 overflow-y-auto">
        <Header />
        <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-5">
          <div className="h-6 w-2/3 rounded bg-gray-200 waveform-shimmer" />
          <div className="aspect-video rounded-2xl bg-gray-200 waveform-shimmer" />
          <div className="h-40 rounded-2xl bg-gray-200 waveform-shimmer" />
        </div>
      </div>
    );
  }

  const statusKey = (video.status in STATUS_CONFIG ? video.status : 'pending') as StatusKey;
  const statusCfg = STATUS_CONFIG[statusKey];
  const StatusIcon = statusCfg.icon;

  const hlsReady = video.status === 'completed' && !!video.chunksURL;
  // Public /hls/* URL goes straight to hls.js — no presigning. MP4 fallback
  // stays on the private bucket, so we use the signed `playbackUrl`.
  const hlsUrl = hlsReady ? video.chunksURL : null;
  const mp4Url = video.playbackUrl;
  const canPlay = !!(hlsUrl || mp4Url);

  const transcriptOpen = showTranscript && !!video.transcript;
  // Widen the page when the transcript side panel is open so the video
  // doesn't shrink below a comfortable viewing size. 1500px gives ~1060px
  // for the video column (~600px tall at 16:9) when the 400px panel sits
  // beside it; when closed, we snap back to 1100px for a centered reading
  // width on the description + toggle row.
  const containerMax = transcriptOpen ? 'max-w-[1500px]' : 'max-w-[1100px]';

  return (
    <div className="flex-1 overflow-y-auto">
      <Header />
      <div className={cn(containerMax, 'mx-auto px-6 py-6 space-y-5 transition-[max-width] duration-200')}>
        {/* Header strip — back + title + status + transcript toggle */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-900 transition -ml-1 px-1 py-0.5 rounded"
            >
              <ArrowLeft size={13} className="transition group-hover:-translate-x-0.5" />
              <span>Dashboard</span>
            </Link>
            <h1 className="mt-2 text-gray-900 font-bold leading-[1.2] tracking-tight text-[22px] sm:text-[24px] break-words">
              {video.title}
            </h1>
            <p className="text-gray-500 text-[13px] mt-1.5 tracking-wide flex items-center gap-1.5 flex-wrap">
              {video.episode && <><span>Episode {video.episode}</span><span>•</span></>}
              <span>{formatDate(video.publishedAt ?? video.createdAt)}</span>
              {video.duration > 0 && <><span>•</span><span>{formatDuration(video.duration)}</span></>}
              {video.author && <><span>•</span><span>{video.author}</span></>}
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {video.transcript && (
              <button
                onClick={() => setShowTranscript((v) => !v)}
                aria-pressed={showTranscript}
                className={cn(
                  'group relative inline-flex items-center gap-1.5 text-[13px] font-semibold text-white px-3.5 py-2 rounded-lg overflow-hidden transition-[transform,box-shadow] duration-200 active:scale-[0.97]',
                  showTranscript
                    ? 'bg-gray-900 hover:bg-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.1)]'
                    : 'transcript-fancy shadow-[0_4px_14px_-4px_rgba(124,58,237,0.55),0_2px_4px_rgba(17,24,39,0.15)] hover:shadow-[0_6px_20px_-4px_rgba(124,58,237,0.7),0_2px_6px_rgba(17,24,39,0.2)]',
                )}
              >
                <Sparkles
                  size={13}
                  className={cn('shrink-0 relative z-1', !showTranscript && 'transcript-sparkle')}
                />
                <span className="relative z-1">Transcript</span>
              </button>
            )}
            <span className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border',
              statusCfg.color,
            )}>
              <StatusIcon size={11} className={video.status === 'chunking' ? 'animate-spin' : ''} />
              {statusCfg.label}
            </span>
          </div>
        </div>

        {/* Video + transcript side-by-side. `min-w-0` on the video column
            lets it shrink inside the flex row so `aspect-video` can do its
            job; the transcript column stays fixed at 400px. */}
        <div className="flex gap-5 items-start">
          <div className="flex-1 min-w-0 space-y-5">
            {canPlay ? (
              <div className="rounded-2xl overflow-hidden bg-black aspect-video shadow-[0_10px_32px_-12px_rgba(17,24,39,0.35)] relative">
                <HlsPlayer
                  ref={playerRef}
                  hlsUrl={hlsUrl}
                  mp4Url={mp4Url}
                  poster={video.thumbnail}
                  onTimeUpdate={setCurrentTime}
                  onError={setPlayerError}
                />
                {!hlsReady && (
                  <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium bg-black/55 text-white backdrop-blur">
                    <Loader2 size={11} className="animate-spin" />
                    HLS upgrade pending — playing direct MP4
                  </div>
                )}
                {playerError && (
                  <div className="absolute bottom-3 left-3 right-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium bg-red-500/90 text-white backdrop-blur">
                    <AlertCircle size={12} />
                    Playback error: {playerError}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-white border border-gray-100 p-10 text-center">
                <Loader2 size={22} className="text-amber-500 animate-spin mx-auto mb-3" />
                <p className="text-gray-800 text-sm font-medium">Still processing this episode…</p>
                <p className="text-gray-400 text-xs mt-1">Auto-refreshing every 30 seconds.</p>
              </div>
            )}

            {video.description && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5 md:p-6">
                <p
                  className={cn(
                    'text-gray-700 text-sm leading-relaxed whitespace-pre-wrap',
                    !descExpanded && 'line-clamp-3',
                  )}
                >
                  {video.description}
                </p>
                {video.description.length > 180 && (
                  <button
                    onClick={() => setDescExpanded((v) => !v)}
                    className="mt-2 text-[13px] font-medium text-gray-900 hover:text-gray-700 transition"
                  >
                    {descExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Transcript side panel. Sticky so it tracks the video on scroll
              and stays useful while the user is reading a long description. */}
          {transcriptOpen && video.transcript && (
            <div className="sticky top-[84px] self-start max-h-[calc(100vh-112px)] flex">
              <WatchTranscript
                transcript={video.transcript}
                currentTime={currentTime}
                onSeek={handleSeek}
                onClose={() => setShowTranscript(false)}
              />
            </div>
          )}
        </div>

        {!video.transcript && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 md:p-6 flex items-center gap-2.5 text-gray-500 text-[13px]">
            <Sparkles size={14} className="text-gray-400" />
            Transcript isn&apos;t available for this episode yet.
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="sticky top-0 z-10 bg-[#f5f5f7]/80 backdrop-blur border-b border-black/6 px-6 py-4 flex items-center justify-between">
      <div>
        <p className="text-zinc-400 text-xs">Watch</p>
        <h1 className="text-zinc-900 text-lg font-semibold">Episode player</h1>
      </div>
      <UserMenu />
    </div>
  );
}
