'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Upload, Play, MoreHorizontal, Loader2, CheckCircle2, Clock, AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useApp } from '@/context/app-context';
import { UploadVideoModal } from '@/components/video/upload-video-modal';
import { UserMenu } from '@/components/user-menu';
import { VIDEO_UPLOADED_EVENT } from '@/components/sidebar';

type StatusKey = 'pending' | 'uploaded' | 'chunking' | 'completed';

interface VideoDto {
  id: string;
  title: string;
  description: string;
  author: string;
  status: string;
  episode: string | null;
  duration: number;
  thumbnail: string | null;
  createdAt: string;
  publishedAt: string | null;
  adMarkerCount: number;
}

const statusConfig: Record<StatusKey, { label: string; icon: typeof CheckCircle2; color: string }> = {
  completed: { label: 'Ready',      icon: CheckCircle2, color: 'text-emerald-500 bg-emerald-50' },
  uploaded:  { label: 'Uploaded',   icon: CheckCircle2, color: 'text-blue-500 bg-blue-50' },
  chunking:  { label: 'Processing', icon: Loader2,      color: 'text-amber-500 bg-amber-50' },
  pending:   { label: 'Pending',    icon: Clock,        color: 'text-zinc-500 bg-zinc-100' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function DashboardPage() {
  const { currentPodcast, currentPodcastId, apiFetch, loading: podcastsLoading } = useApp();

  const [videos, setVideos] = useState<VideoDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dragging, setDragging] = useState(false);

  // Upload modal state. `modalInitialFile` carries a drag-dropped file into
  // the modal's Step 2 so the user doesn't have to pick it a second time.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [modalInitialFile, setModalInitialFile] = useState<File | null>(null);

  const loadVideos = useCallback(async () => {
    if (!currentPodcastId) {
      setVideos([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/videos', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/videos failed: ${res.status}`);
      const data = (await res.json()) as VideoDto[];
      setVideos(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, [currentPodcastId, apiFetch]);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // Refresh when an upload completes elsewhere in the app (e.g. from the
  // sidebar's "Create an episode" button while the user is already here).
  useEffect(() => {
    const handler = () => { void loadVideos(); };
    window.addEventListener(VIDEO_UPLOADED_EVENT, handler);
    return () => window.removeEventListener(VIDEO_UPLOADED_EVENT, handler);
  }, [loadVideos]);

  const openUploadModal = useCallback((prefill: File | null = null) => {
    if (!currentPodcastId) return; // nothing to upload to yet
    setModalInitialFile(prefill);
    setUploadOpen(true);
  }, [currentPodcastId]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.type.startsWith('video/')) return;
    openUploadModal(file);
  }, [openUploadModal]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  const showingEmpty =
    !loading && !podcastsLoading && !error && videos.length === 0;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#f5f5f7]/80 backdrop-blur border-b border-black/6 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-zinc-400 text-xs">Dashboard</p>
          <h1 className="text-zinc-900 text-lg font-semibold">
            {currentPodcast ? currentPodcast.title : 'Your episodes'}
          </h1>
          {currentPodcast?.description && (
            <p className="text-zinc-400 text-xs mt-0.5 max-w-xl truncate">
              {currentPodcast.description}
            </p>
          )}
        </div>
        <UserMenu />
      </div>

      <div className="p-6 space-y-6">
        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => openUploadModal(null)}
          className={cn(
            'border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all',
            dragging
              ? 'border-indigo-400 bg-indigo-50'
              : 'border-zinc-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40'
          )}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center">
              <Upload size={24} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-zinc-800 font-medium text-sm">
                {currentPodcast ? 'Drop your episode here' : 'Select a podcast first'}
              </p>
              <p className="text-zinc-400 text-xs mt-0.5">
                {currentPodcast
                  ? 'or click to browse · MP4, MOV, WebM · up to 5 GiB'
                  : 'pick a show from the sidebar to add episodes to it'}
              </p>
            </div>
          </div>
        </div>

        {/* Episodes list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-zinc-700 text-sm font-semibold">All episodes</h2>
            <span className="text-zinc-400 text-xs">
              {loading ? '…' : `${videos.length} episode${videos.length === 1 ? '' : 's'}`}
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-black/6 overflow-hidden">
            {loading && (
              <div className="py-12 text-center">
                <Loader2 size={24} className="text-zinc-300 mx-auto animate-spin" />
                <p className="text-zinc-400 text-xs mt-2">Loading episodes…</p>
              </div>
            )}

            {error && !loading && (
              <div className="py-12 text-center">
                <AlertCircle size={28} className="text-red-300 mx-auto mb-2" />
                <p className="text-red-500 text-sm font-medium">{error}</p>
                <button
                  onClick={loadVideos}
                  className="mt-3 text-xs text-indigo-600 hover:text-indigo-700 font-medium bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
                >
                  Retry
                </button>
              </div>
            )}

            {!loading && !error && videos.map((video, idx) => {
              const key = (video.status in statusConfig ? video.status : 'pending') as StatusKey;
              const status = statusConfig[key];
              const StatusIcon = status.icon;
              return (
                <div
                  key={video.id}
                  className={cn(
                    'flex items-center gap-4 px-4 py-3.5 transition hover:bg-zinc-50 group',
                    idx !== videos.length - 1 && 'border-b border-zinc-100'
                  )}
                >
                  <div className="w-16 h-10 rounded-lg bg-zinc-100 shrink-0 overflow-hidden relative">
                    {video.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={video.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-zinc-200 to-zinc-300 flex items-center justify-center">
                        <Play size={14} className="text-zinc-500" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-900 text-sm font-medium truncate">{video.title}</p>
                    <p className="text-zinc-400 text-xs mt-0.5">
                      {video.episode && <span>{video.episode} · </span>}
                      {formatDate(video.publishedAt ?? video.createdAt)}
                      {video.adMarkerCount > 0 && (
                        <span className="ml-2 text-indigo-500">{video.adMarkerCount} ad markers</span>
                      )}
                    </p>
                  </div>

                  <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0', status.color)}>
                    <StatusIcon size={11} className={video.status === 'chunking' ? 'animate-spin' : ''} />
                    {status.label}
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <Link
                      href={`/ads?video=${video.id}`}
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-medium bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition"
                    >
                      Manage ads
                    </Link>
                    <button className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition">
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </div>
              );
            })}

            {showingEmpty && (
              <div className="py-12 text-center">
                <AlertCircle size={32} className="text-zinc-300 mx-auto mb-3" />
                <p className="text-zinc-500 text-sm">
                  {currentPodcast
                    ? 'No episodes yet. Upload your first one above.'
                    : 'Create a podcast from the sidebar to get started.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {uploadOpen && (
        <UploadVideoModal
          initialFile={modalInitialFile}
          onClose={() => { setUploadOpen(false); setModalInitialFile(null); }}
          onUploaded={() => { void loadVideos(); }}
        />
      )}
    </div>
  );
}
