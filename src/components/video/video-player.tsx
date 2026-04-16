'use client';

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { AdMarker } from '@/lib/types';
import { formatTime } from '@/lib/utils';

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

export interface VideoPlayerHandle {
  getCurrentTime: () => number;
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
}

interface Props {
  src: string;
  adMarkers: AdMarker[];
  onTimeUpdate?: (t: number) => void;
  onDurationChange?: (d: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, adMarkers, onTimeUpdate, onDurationChange, onPlayingChange },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [adPlaying, setAdPlaying] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const hitMarkers = useRef<Set<string>>(new Set());

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    seek: (t) => { if (videoRef.current) videoRef.current.currentTime = t; },
    play: () => videoRef.current?.play(),
    pause: () => videoRef.current?.pause(),
  }));

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      setCurrentTime(v.currentTime);
      onTimeUpdate?.(v.currentTime);
      for (const m of adMarkers) {
        if (!hitMarkers.current.has(m.id) && Math.abs(v.currentTime - m.startTime) < 0.5) {
          hitMarkers.current.add(m.id);
          if (m.type !== 'auto') {
            v.pause();
            setAdPlaying(true);
            setTimeout(() => { setAdPlaying(false); v.play(); }, 3000);
          }
        }
      }
    };
    const onMeta = () => {
      setDuration(v.duration || 0);
      setVideoError(null);
      onDurationChange?.(v.duration || 0);
    };
    const onPlay = () => { setPlaying(true); onPlayingChange?.(true); };
    const onPause = () => { setPlaying(false); onPlayingChange?.(false); };
    const onError = () => setVideoError('Video unavailable. The URL may have expired.');

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('error', onError);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('error', onError);
    };
  }, [adMarkers, onTimeUpdate, onDurationChange, onPlayingChange]);

  useEffect(() => { hitMarkers.current = new Set(); }, [adMarkers]);
  useEffect(() => { setVideoError(null); }, [src]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  }, []);

  function seekBy(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clamp(v.currentTime + delta, 0, v.duration);
  }

  function seekToClientX(clientX: number) {
    const rect = progressRef.current?.getBoundingClientRect();
    const v = videoRef.current;
    if (!rect || !v || !v.duration) return;
    v.currentTime = clamp((clientX - rect.left) / rect.width, 0, 1) * v.duration;
    hitMarkers.current = new Set(adMarkers.filter((m) => m.startTime < v.currentTime - 1).map((m) => m.id));
  }

  function handleProgressMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    dragging.current = true;
    seekToClientX(e.clientX);
    const onMove = (ev: MouseEvent) => { if (dragging.current) seekToClientX(ev.clientX); };
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function cycleSpeed() {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  const progress = duration ? currentTime / duration : 0;

  return (
    <div className="flex flex-col bg-white rounded-xl border border-gray-100 overflow-hidden h-full">
      {/* Video frame */}
      <div className="relative flex-1 bg-gray-900 min-h-0 overflow-hidden">
        {src && (
          <video
            ref={videoRef}
            src={src}
            className={`w-full h-full object-contain ${videoError ? 'opacity-0' : ''}`}
          />
        )}
        {!src && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
            No video selected
          </div>
        )}
        {videoError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center bg-gray-900">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <p className="text-red-400 text-xs font-medium leading-snug">{videoError}</p>
          </div>
        )}
        {adPlaying && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center animate-fade-in z-10">
            <div className="bg-white/10 border border-white/20 rounded-xl px-6 py-4 text-center">
              <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Advertisement</div>
              <div className="text-white text-sm font-medium">Playing ad...</div>
              <div className="mt-2.5 h-0.5 w-32 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full" style={{ animation: 'slideProgress 3s linear forwards' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Thin progress bar — draggable */}
      <div
        ref={progressRef}
        className="h-1 bg-gray-200 cursor-pointer group relative select-none"
        onMouseDown={handleProgressMouseDown}
      >
        <div className="h-full bg-gray-900 relative transition-none" style={{ width: `${progress * 100}%` }}>
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1.5 w-2.5 h-2.5 rounded-full bg-gray-900 opacity-0 group-hover:opacity-100 transition" />
        </div>
        {adMarkers.map((m) => (
          <div
            key={m.id}
            className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 pointer-events-none"
            style={{ left: `${(m.startTime / (duration || 1)) * 100}%` }}
          />
        ))}
      </div>

      {/* Controls — matching Figma exactly */}
      <div className="px-3 py-3 flex items-center justify-between gap-1">
        {/* Left: Jump to start + back 10s */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0; }}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 transition px-2 py-1.5 rounded-lg hover:bg-gray-100"
          >
            {/* Jump to start icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>
            </svg>
            <span className="hidden sm:inline">Jump to start</span>
          </button>
          <button
            onClick={() => seekBy(-10)}
            className="flex items-center gap-0.5 text-[11px] text-gray-500 hover:text-gray-900 transition px-2 py-1.5 rounded-lg hover:bg-gray-100"
          >
            {/* Back 10s icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
            </svg>
            <span>10s</span>
          </button>
        </div>

        {/* Center: rewind | play | ff */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => seekBy(-5)}
            className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 5L1 12l10 7V5zm11 0L12 12l10 7V5z"/>
            </svg>
          </button>
          <button
            onClick={togglePlay}
            className="w-9 h-9 bg-gray-900 hover:bg-gray-700 text-white rounded-full flex items-center justify-center transition shadow-sm"
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            )}
          </button>
          <button
            onClick={() => seekBy(5)}
            className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 5l10 7-10 7V5zM2 5l10 7-10 7V5z"/>
            </svg>
          </button>
        </div>

        {/* Right: fwd 10s + Jump to end */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => seekBy(10)}
            className="flex items-center gap-0.5 text-[11px] text-gray-500 hover:text-gray-900 transition px-2 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <span>10s</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.51"/>
            </svg>
          </button>
          <button
            onClick={() => { const v = videoRef.current; if (v) v.currentTime = v.duration; }}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900 transition px-2 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <span className="hidden sm:inline">Jump to end</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Volume + speed row */}
      <div className="px-3 pb-2.5 flex items-center gap-2 border-t border-gray-50 pt-2">
        <button onClick={toggleMute} className="text-gray-400 hover:text-gray-700 transition">
          {muted || volume === 0 ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 0 5.07 7M10.54 21.26A7 7 0 0 0 19 12c0-1.03-.2-2.01-.56-2.91"/></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
          )}
        </button>
        <input
          type="range" min="0" max="1" step="0.05"
          value={muted ? 0 : volume}
          onChange={(e) => {
            const val = Number(e.target.value);
            setVolume(val);
            if (videoRef.current) { videoRef.current.volume = val; videoRef.current.muted = val === 0; }
            setMuted(val === 0);
          }}
          className="w-16 h-1 accent-gray-900"
        />
        <div className="flex-1" />
        <button onClick={cycleSpeed} className="text-[10px] text-gray-400 hover:text-gray-700 font-mono border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50 transition">
          {speed}x
        </button>
        <span className="text-[10px] text-gray-400 font-mono">{formatTime(currentTime)}</span>
      </div>
    </div>
  );
});
