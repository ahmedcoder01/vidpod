'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { mockPodcasts } from '@/lib/mock-data';
import { AdMarker, AdType, Ad, Podcast } from '@/lib/types';
import { formatTime, generateId } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useHistory } from '@/hooks/use-history';
import { useAds } from '@/hooks/use-ads';
import { VideoPlayer, VideoPlayerHandle } from '@/components/video/video-player';
import { Timeline } from '@/components/video/timeline';
import { CreateMarkerModal } from '@/components/ads/create-marker-modal';
import { SelectAdsModal } from '@/components/ads/select-ads-modal';
import {
  Plus, Trash2,
  HelpCircle, Info, ArrowLeft, Play, Radio,
  Settings, Bell, ChevronDown,
} from 'lucide-react';

const TYPE_LABELS = { auto: 'Auto', static: 'Static', ab: 'A/B' };
const TYPE_BADGE: Record<string, string> = {
  auto:   'bg-emerald-100 text-emerald-700 border border-emerald-200',
  static: 'bg-blue-100 text-blue-700 border border-blue-200',
  ab:     'bg-orange-100 text-orange-700 border border-orange-200',
};

// ── Podcast selector list ──────────────────────────────────────────────────
function PodcastList({ onSelect }: { onSelect: (p: Podcast) => void }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 bg-[#f5f5f7]/90 backdrop-blur border-b border-black/6 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-gray-400 text-xs">Ads</p>
          <h1 className="text-gray-900 text-lg font-semibold">Choose an episode</h1>
        </div>
        <TopbarUser />
      </div>
      <div className="p-6">
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {mockPodcasts.map((podcast, idx) => (
            <button
              key={podcast.id}
              onClick={() => onSelect(podcast)}
              className={cn(
                'w-full flex items-center gap-4 px-4 py-4 text-left transition hover:bg-indigo-50/60 group',
                idx !== mockPodcasts.length - 1 && 'border-b border-gray-100'
              )}
            >
              <div className="w-20 h-12 rounded-lg bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                <Play size={16} className="text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 text-sm font-medium leading-snug line-clamp-2 group-hover:text-indigo-700 transition">
                  {podcast.title}
                </p>
                <p className="text-gray-400 text-xs mt-0.5">
                  {podcast.episode && <span>{podcast.episode} · </span>}{podcast.date}
                  <span className="ml-2 text-indigo-400">{podcast.adMarkers.length} ad markers</span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium bg-indigo-50 group-hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition shrink-0">
                <Radio size={12} />Manage ads
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

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
      <button className="flex items-center gap-2 hover:bg-gray-100 rounded-lg px-2 py-1.5 transition">
        <div className="w-6 h-6 rounded-full bg-linear-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
          EW
        </div>
        <span className="text-gray-700 text-sm font-medium">Emma Warren</span>
        <ChevronDown size={13} className="text-gray-400" />
      </button>
    </div>
  );
}

// ── Full ad editor ─────────────────────────────────────────────────────────
function AdEditor({ podcast, onBack }: { podcast: Podcast; onBack: () => void }) {
  const { markers, push, undo, redo, canUndo, canRedo } = useHistory(podcast.adMarkers);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(podcast.duration ?? 0);
  const [adProgress, setAdProgress] = useState<{ markerId: string; elapsed: number } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingType, setPendingType] = useState<AdType | null>(null);
  const [editingMarker, setEditingMarker] = useState<AdMarker | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const { ads } = useAds();

  // Spacebar + Ctrl+Z/Y
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

  useEffect(() => {
    const idx = mockPodcasts.findIndex((p) => p.id === podcast.id);
    if (idx !== -1) mockPodcasts[idx].adMarkers = markers;
  }, [markers, podcast.id]);

  function handleTypeSelected(type: AdType) {
    setShowCreateModal(false);
    if (type === 'auto') addMarker(type, []);
    else setPendingType(type);
  }

  function addMarker(type: AdType, ads: Ad[]) {
    const t = playerRef.current?.getCurrentTime() ?? 0;
    push([...markers, {
      id: generateId(), type, startTime: t,
      assetUrl: ads[0]?.id, assetUrls: ads.map((a) => a.id),
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

  const sorted = [...markers].sort((a, b) => a.startTime - b.startTime);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f5f5f7]">
      {/* Top header */}
      <div className="shrink-0 bg-[#f5f5f7]/95 backdrop-blur border-b border-black/5 px-6 pt-4 pb-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <button
              onClick={onBack}
              className="group inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900 transition mb-2 -ml-1 px-1 py-0.5 rounded"
            >
              <ArrowLeft size={13} className="transition group-hover:-translate-x-0.5" />
              <span>Ads</span>
            </button>
            <h1 className="text-gray-900 font-bold leading-[1.22] tracking-tight text-[22px] sm:text-[24px] max-w-4xl">
              {podcast.title}
            </h1>
            <p className="text-gray-500 text-[12px] mt-2 tracking-wide">
              {podcast.episode && <span>Episode {podcast.episode}</span>}
              {podcast.episode && podcast.date && <span className="mx-1.5">•</span>}
              {podcast.date}
            </p>
          </div>
          <div className="pt-1 shrink-0">
            <TopbarUser />
          </div>
        </div>
      </div>

      {/* Main 2-col area */}
      <div className="flex flex-1 min-h-0 gap-3 p-3">
        {/* LEFT: Ad markers panel */}
        <div className="w-[280px] shrink-0 flex flex-col bg-white rounded-xl border border-gray-100 overflow-hidden">
          {/* Panel header */}
          <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <span className="text-gray-900 text-sm font-semibold">Ad markers</span>
            <span className="text-gray-400 text-xs">{markers.length} markers</span>
          </div>

          {/* Markers table */}
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
                        <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-semibold', TYPE_BADGE[m.type])}>
                          {TYPE_LABELS[m.type]}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingMarker(m); }}
                          className="text-[11px] text-gray-500 hover:text-gray-900 font-medium transition px-1"
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

          {/* Footer */}
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

        {/* RIGHT: Video player */}
        <div className="flex-1 min-w-0">
          <VideoPlayer
            ref={playerRef}
            src={podcast.videoUrl ?? ''}
            adMarkers={markers}
            ads={ads}
            onTimeUpdate={setCurrentTime}
            onDurationChange={setDuration}
            onAdProgress={setAdProgress}
            onError={setVideoError}
          />
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
          waveformData={podcast.waveformData ?? []}
          onSeek={handleSeek}
          onSeekIntoAd={handleSeekIntoAd}
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
            push(markers.map((m) => m.id === editingMarker.id ? { ...m, assetUrl: selected[0]?.id, assetUrls: selected.map((a) => a.id) } : m));
            setEditingMarker(null);
          }}
          onCancel={() => setEditingMarker(null)}
        />
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────
function AdsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [selected, setSelected] = useState<Podcast | null>(() => {
    const id = searchParams.get('podcast');
    return id ? (mockPodcasts.find((p) => p.id === id) ?? null) : null;
  });

  if (selected) {
    return (
      <AdEditor
        podcast={selected}
        onBack={() => { router.replace('/ads'); setSelected(null); }}
      />
    );
  }
  return (
    <PodcastList
      onSelect={(p) => { router.replace(`/ads?podcast=${p.id}`); setSelected(p); }}
    />
  );
}

export default function AdsPage() {
  return <Suspense><AdsPageInner /></Suspense>;
}
