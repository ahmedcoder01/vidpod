'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, Play, MoreHorizontal, Loader2, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { mockPodcasts } from '@/lib/mock-data';
import { Podcast } from '@/lib/types';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const statusConfig = {
  completed: { label: 'Ready', icon: CheckCircle2, color: 'text-emerald-500 bg-emerald-50' },
  uploaded: { label: 'Uploaded', icon: CheckCircle2, color: 'text-blue-500 bg-blue-50' },
  chunking: { label: 'Processing', icon: Loader2, color: 'text-amber-500 bg-amber-50' },
  pending: { label: 'Pending', icon: Clock, color: 'text-zinc-500 bg-zinc-100' },
};

export default function DashboardPage() {
  const [podcasts, setPodcasts] = useState<Podcast[]>(mockPodcasts);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.type.startsWith('video/')) return;

    setUploading(true);
    // Simulate upload delay
    await new Promise((r) => setTimeout(r, 1800));

    const newPodcast: Podcast = {
      id: Math.random().toString(36).slice(2),
      title: file.name.replace(/\.[^/.]+$/, ''),
      description: '',
      author: 'Emma Warren',
      status: 'uploaded',
      date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      duration: 0,
      thumbnail: '',
      videoUrl: URL.createObjectURL(file),
      adMarkers: [],
      waveformData: Array.from({ length: 500 }, () => 0.3 + Math.random() * 0.4),
    };

    setPodcasts((prev) => [newPodcast, ...prev]);
    setUploading(false);
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#f5f5f7]/80 backdrop-blur border-b border-black/6 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-zinc-400 text-xs">Dashboard</p>
          <h1 className="text-zinc-900 text-lg font-semibold">Your episodes</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-xs font-semibold">
            EW
          </div>
          <span className="text-zinc-700 text-sm font-medium">Emma Warren</span>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all',
            dragging
              ? 'border-indigo-400 bg-indigo-50'
              : 'border-zinc-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40'
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={36} className="text-indigo-500 animate-spin" />
              <p className="text-zinc-600 text-sm font-medium">Uploading episode...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center">
                <Upload size={24} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-zinc-800 font-medium text-sm">Drop your episode here</p>
                <p className="text-zinc-400 text-xs mt-0.5">or click to browse · MP4, MOV, WebM supported</p>
              </div>
            </div>
          )}
        </div>

        {/* Episodes list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-zinc-700 text-sm font-semibold">All episodes</h2>
            <span className="text-zinc-400 text-xs">{podcasts.length} episodes</span>
          </div>

          <div className="bg-white rounded-2xl border border-black/6 overflow-hidden">
            {podcasts.map((podcast, idx) => {
              const status = statusConfig[podcast.status];
              const StatusIcon = status.icon;
              return (
                <div
                  key={podcast.id}
                  className={cn(
                    'flex items-center gap-4 px-4 py-3.5 transition hover:bg-zinc-50 group',
                    idx !== podcasts.length - 1 && 'border-b border-zinc-100'
                  )}
                >
                  {/* Thumbnail */}
                  <div className="w-16 h-10 rounded-lg bg-zinc-100 shrink-0 overflow-hidden relative">
                    {podcast.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={podcast.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-zinc-200 to-zinc-300 flex items-center justify-center">
                        <Play size={14} className="text-zinc-500" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-900 text-sm font-medium truncate">{podcast.title}</p>
                    <p className="text-zinc-400 text-xs mt-0.5">
                      {podcast.episode && <span>{podcast.episode} · </span>}
                      {podcast.date}
                      {podcast.adMarkers.length > 0 && (
                        <span className="ml-2 text-indigo-500">{podcast.adMarkers.length} ad markers</span>
                      )}
                    </p>
                  </div>

                  {/* Status badge */}
                  <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0', status.color)}>
                    <StatusIcon size={11} className={podcast.status === 'chunking' ? 'animate-spin' : ''} />
                    {status.label}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <Link
                      href={`/ads?podcast=${podcast.id}`}
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

            {podcasts.length === 0 && (
              <div className="py-12 text-center">
                <AlertCircle size={32} className="text-zinc-300 mx-auto mb-3" />
                <p className="text-zinc-500 text-sm">No episodes yet. Upload your first one above.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
