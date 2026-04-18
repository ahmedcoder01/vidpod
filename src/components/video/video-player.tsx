'use client';

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, useMemo } from 'react';
import { Ad, AdMarker } from '@/lib/types';
import { formatTime } from '@/lib/utils';
import { SkipForward } from 'lucide-react';

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

export interface VideoPlayerHandle {
  getCurrentTime: () => number;
  seek: (t: number) => void;
  seekIntoAd: (markerId: string, elapsed: number) => void;
  play: () => void;
  pause: () => void;
  // Called by the timeline when the user grabs/releases the playhead. On
  // `true` we remember which video (main or ad) was playing and pause
  // both so a long hold doesn't let playback drift out from under the
  // cursor. On `false` we resume whichever video is now the foreground
  // (may differ if the user released inside an ad block).
  setScrubbing: (active: boolean) => void;
}

interface Props {
  src: string;
  adMarkers: AdMarker[];
  ads: Ad[];
  onTimeUpdate?: (t: number) => void;
  onDurationChange?: (d: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onAdProgress?: (info: { markerId: string; elapsed: number } | null) => void;
  onError?: (message: string | null) => void;
}

type AdSession = { ad: Ad; marker: AdMarker };

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, adMarkers, ads, onTimeUpdate, onDurationChange, onPlayingChange, onAdProgress, onError },
  ref,
) {
  const adsById = useMemo(
    () => Object.fromEntries(ads.map((a) => [a.id, a])) as Record<string, Ad>,
    [ads],
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const adVideoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hitMarkers = useRef<Set<string>>(new Set());
  const wasPlayingBeforeAd = useRef(false);
  // Previous `currentTime` snapshot for the forward-crossing detector.
  // Updated on every `timeupdate` and on every explicit seek so the next
  // tick compares against the right baseline.
  const prevTimeRef = useRef(0);
  // While true (set by `setScrubbing`), crossings are recorded as `hit`
  // but ads don't fire — drags past a marker "skip" rather than "play."
  const suppressAdFireRef = useRef(false);
  // Whether *any* video (main or ad) was playing at the moment a scrub
  // began. Restored on release so "I was watching → grabbed the
  // playhead → dropped it somewhere new" keeps playing at the new
  // position, while "I was paused → scrubbed → dropped" stays paused.
  const wasPlayingBeforeScrub = useRef(false);
  // When non-null, the ad-session effect reads this to pick a starting
  // elapsed time + whether to auto-play. Cleared after consumption.
  const pendingAdStart = useRef<{ elapsed: number; autoPlay: boolean } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [adSession, setAdSession] = useState<AdSession | null>(null);
  const [adElapsed, setAdElapsed] = useState(0);
  const [adCanSkipAt, setAdCanSkipAt] = useState(5);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Keep latest adSession in a ref so the timeupdate listener can check it
  // without being torn down and re-subscribed on every session change.
  const adSessionRef = useRef<AdSession | null>(null);
  useEffect(() => { adSessionRef.current = adSession; }, [adSession]);

  const resolveAdForMarker = useCallback(
    (m: AdMarker): Ad | null => {
      const ids = m.adIds ?? [];
      if (ids.length === 0) return null;
      // A/B picks randomly; static/auto always has exactly one entry so the
      // random pick collapses to that single ad.
      const id = ids.length === 1 ? ids[0] : ids[Math.floor(Math.random() * ids.length)];
      const ad = adsById[id];
      return ad && ad.videoUrl ? ad : null;
    },
    [adsById],
  );

  // Skip-semantics bookkeeping for explicit seeks: forward seeks mark any
  // crossed markers as `hit` (so they don't re-fire on resume); backward
  // seeks clear `hit` for markers past the new position (re-enabling them
  // for the next forward play — standard DVR UX).
  const applyHitMarkersForSeek = (prev: number, newT: number) => {
    if (newT > prev) {
      for (const m of adMarkers) {
        if (prev < m.startTime && m.startTime <= newT) {
          hitMarkers.current.add(m.id);
        }
      }
    } else if (newT < prev) {
      for (const m of adMarkers) {
        if (m.startTime > newT) {
          hitMarkers.current.delete(m.id);
        }
      }
    }
  };

  // Shared by all "just jump" code paths (imperative seek, internal progress
  // bar, jump-to-start/end buttons). Never bypasses hit-tracking — any raw
  // `v.currentTime = X` elsewhere leaves hitMarkers inconsistent and makes
  // subsequent +10s seeks silently skip ads they should fire.
  const skipSeek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const prev = v.currentTime;
    const newT = clamp(t, 0, v.duration || t);
    applyHitMarkersForSeek(prev, newT);
    v.currentTime = newT;
    prevTimeRef.current = newT;
  };

  // Synchronously commits all state mutations for "an ad just started at
  // marker m." Centralizes the dance so natural crossings and +10s step
  // fires stay in sync — including the crucial `onAdProgress({elapsed:0})`
  // that keeps the Timeline's playhead pinned to the ad block instead of
  // briefly showing derivedDisplayTime during the render gap before the
  // first adV timeupdate.
  const fireAdSession = (m: AdMarker, ad: Ad) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = m.startTime;
    prevTimeRef.current = m.startTime;
    hitMarkers.current.add(m.id);
    wasPlayingBeforeAd.current = !v.paused;
    v.pause();
    setCurrentTime(m.startTime);
    onTimeUpdate?.(m.startTime);
    setAdElapsed(0);
    setAdCanSkipAt(Math.min(5, Math.floor(ad.duration / 3)) || 0);
    setAdSession({ ad, marker: m });
    onAdProgress?.({ markerId: m.id, elapsed: 0 });
  };

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    seek: (t) => {
      const v = videoRef.current;
      if (!v) return;

      const newT = clamp(t, 0, v.duration || t);

      // If we were mid-ad, cancel the session and inherit its playing state
      // for the main video. The ad <video> is about to unmount, so the
      // `playing` flag won't get any more events from it — we have to drive
      // the new state explicitly here.
      if (adSessionRef.current) {
        const adV = adVideoRef.current;
        const wasAdPlaying = adV ? !adV.paused : false;
        const currentMarker = adSessionRef.current.marker;
        setAdSession(null);
        setAdElapsed(0);
        onAdProgress?.(null);

        const prev = v.currentTime;
        // Mark the just-exited ad so it doesn't auto-fire when playback
        // resumes, then apply normal directional hit-bookkeeping.
        hitMarkers.current.add(currentMarker.id);
        applyHitMarkersForSeek(prev, newT);

        v.currentTime = newT;
        prevTimeRef.current = newT;

        if (wasAdPlaying) {
          // onPlay listener will flip `playing` back to true once it fires.
          v.play().catch(() => {});
        } else {
          setPlaying(false);
          onPlayingChange?.(false);
        }
        return;
      }

      const prev = v.currentTime;
      applyHitMarkersForSeek(prev, newT);
      v.currentTime = newT;
      prevTimeRef.current = newT;
    },
    seekIntoAd: (markerId, elapsed) => {
      const m = adMarkers.find((x) => x.id === markerId);
      if (!m) return;
      const ad = resolveAdForMarker(m);
      const v = videoRef.current;
      if (!v) return;

      if (!ad) {
        // Marker has no playable asset — fall back to skipping past it.
        v.currentTime = m.startTime + 0.01;
        hitMarkers.current.add(m.id);
        return;
      }

      const clampedElapsed = Math.max(0, Math.min(ad.duration, elapsed));

      // Park the main video at the ad boundary and mark this ad as "hit" so
      // it doesn't auto-fire again when playback resumes after the ad ends.
      v.pause();
      v.currentTime = m.startTime;
      hitMarkers.current.add(m.id);
      wasPlayingBeforeAd.current = true;

      // If we're already in a session for this exact marker, just seek inside
      // the ad video — no need to tear the session down and rebuild it.
      if (adSessionRef.current?.marker.id === m.id && adVideoRef.current) {
        adVideoRef.current.currentTime = clampedElapsed;
        setAdElapsed(clampedElapsed);
        onAdProgress?.({ markerId: m.id, elapsed: clampedElapsed });
        return;
      }

      pendingAdStart.current = { elapsed: clampedElapsed, autoPlay: false };
      setAdElapsed(clampedElapsed);
      setAdCanSkipAt(Math.min(5, Math.floor(ad.duration / 3)) || 0);
      setAdSession({ ad, marker: m });
      onAdProgress?.({ markerId: m.id, elapsed: clampedElapsed });
    },
    play: () => { videoRef.current?.play().catch(() => {}); },
    pause: () => videoRef.current?.pause(),
    setScrubbing: (active: boolean) => {
      // Suppresses ad firing for the duration of a scrub. Crossings that
      // happen while suppressed still get recorded as `hit` (by onTime),
      // so they don't spuriously fire when playback resumes forward.
      suppressAdFireRef.current = active;
      const v = videoRef.current;
      const adV = adVideoRef.current;
      if (active) {
        // Snapshot the current playback state across both videos, then
        // pause anything that was running. Uses OR so the scrub-end
        // handler resumes as long as *something* was playing, without
        // caring which one — the foreground may have changed mid-scrub.
        const mainPlaying = !!v && !v.paused;
        const adPlaying = !!adV && !adV.paused;
        wasPlayingBeforeScrub.current = mainPlaying || adPlaying;
        if (mainPlaying) v!.pause();
        if (adPlaying) adV!.pause();
      } else {
        if (wasPlayingBeforeScrub.current) {
          // Resume the video that's currently foreground. If the user
          // released inside an ad block, `adSession` will be set and
          // the ad video is the one to play; otherwise the main one.
          if (adSessionRef.current && adV) adV.play().catch(() => {});
          else if (v) v.play().catch(() => {});
        }
        wasPlayingBeforeScrub.current = false;
      }
    },
  }));

  // Main-video event wiring + ad trigger detection.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      // Don't drive UI off the main video while an ad is playing —
      // it's paused but we still want the displayed time to freeze at the
      // ad-boundary and not flicker.
      if (adSessionRef.current) return;
      const prev = prevTimeRef.current;
      const now = v.currentTime;
      prevTimeRef.current = now;

      setCurrentTime(now);
      onTimeUpdate?.(now);

      // Only forward motion can cross a marker. Works identically for
      // natural playback ticks, step-forward seeks, and drag scrubs — the
      // `suppressAdFireRef` flag below is what differentiates skip vs play.
      if (now <= prev) return;

      for (const m of adMarkers) {
        if (hitMarkers.current.has(m.id)) continue;
        if (prev < m.startTime && m.startTime <= now) {
          if (suppressAdFireRef.current) {
            // Drag/scrub past marker: record as hit, don't fire.
            hitMarkers.current.add(m.id);
            continue;
          }
          const ad = resolveAdForMarker(m);
          if (!ad) { hitMarkers.current.add(m.id); continue; }
          fireAdSession(m, ad);
          return;  // fire at most one ad per tick
        }
      }
    };
    const onMeta = () => {
      setDuration(v.duration || 0);
      setVideoError(null);
      onDurationChange?.(v.duration || 0);
      // Seed the crossing-detector baseline with the actual initial position
      // so a non-zero resume point doesn't fire every marker before it.
      prevTimeRef.current = v.currentTime;
    };
    const onPlay = () => {
      if (adSessionRef.current) return; // play state during ad is driven by ad video
      setPlaying(true);
      onPlayingChange?.(true);
    };
    const onPause = () => {
      if (adSessionRef.current) return;
      setPlaying(false);
      onPlayingChange?.(false);
    };
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
  }, [adMarkers, resolveAdForMarker, onTimeUpdate, onDurationChange, onPlayingChange]);

  // Reset hit list whenever the markers array identity changes (fresh session
  // after edit) and the video src changes (new podcast).
  useEffect(() => { hitMarkers.current = new Set(); }, [adMarkers]);
  useEffect(() => { setVideoError(null); hitMarkers.current = new Set(); }, [src]);

  // Propagate error state to any parent that needs to react (e.g. Timeline
  // should stop its loading spinner and show an error message).
  useEffect(() => { onError?.(videoError); }, [videoError, onError]);

  // Safety net: if metadata hasn't loaded after a reasonable window, assume
  // the URL is dead and surface an error. Otherwise the Timeline would spin
  // forever when signed S3 URLs expire.
  useEffect(() => {
    if (!src) return;
    if (duration > 0) return;
    if (videoError) return;
    const timer = window.setTimeout(() => {
      if (!videoRef.current) return;
      if (videoRef.current.duration > 0) return;
      setVideoError('Video unavailable. The URL may have expired.');
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [src, duration, videoError]);

  // When an ad session starts, kick off ad playback + wire its lifecycle.
  useEffect(() => {
    if (!adSession) return;
    const adV = adVideoRef.current;
    if (!adV) return;

    const start = pendingAdStart.current ?? { elapsed: 0, autoPlay: true };
    pendingAdStart.current = null;

    adV.currentTime = start.elapsed;
    adV.volume = muted ? 0 : volume;
    adV.muted = muted;
    if (start.autoPlay) {
      adV.play().catch(() => {
        // Autoplay blocked — stay paused; user can press the play button.
      });
    }

    const onTime = () => {
      setAdElapsed(adV.currentTime);
      onAdProgress?.({ markerId: adSession.marker.id, elapsed: adV.currentTime });
    };
    const onEnded = () => endAdSession(true);
    const onError = () => endAdSession(false);
    const onPlay = () => { setPlaying(true); onPlayingChange?.(true); };
    const onPause = () => { setPlaying(false); onPlayingChange?.(false); };

    adV.addEventListener('timeupdate', onTime);
    adV.addEventListener('ended', onEnded);
    adV.addEventListener('error', onError);
    adV.addEventListener('play', onPlay);
    adV.addEventListener('pause', onPause);
    return () => {
      adV.removeEventListener('timeupdate', onTime);
      adV.removeEventListener('ended', onEnded);
      adV.removeEventListener('error', onError);
      adV.removeEventListener('play', onPlay);
      adV.removeEventListener('pause', onPause);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adSession]);

  function endAdSession(autoResume: boolean) {
    setAdSession(null);
    setAdElapsed(0);
    onAdProgress?.(null);
    const v = videoRef.current;
    if (!v) return;
    if (autoResume && wasPlayingBeforeAd.current) {
      v.play().catch(() => {});
    }
  }

  const togglePlay = useCallback(() => {
    if (adSessionRef.current) {
      const adV = adVideoRef.current;
      if (!adV) return;
      if (adV.paused) adV.play().catch(() => {});
      else adV.pause();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  // Play-semantics seek: used by the +10s / −10s step buttons. A forward
  // step that crosses an uncrossed marker FIRES the ad at that marker; the
  // video resumes at the marker's startTime after the ad ends. A backward
  // step clears hit state for markers past the new position so they
  // re-fire on the next forward play. (Plain drag-scrubs use `seek` with
  // skip-semantics.)
  function seekBy(delta: number) {
    if (adSession) return;
    const v = videoRef.current;
    if (!v) return;
    const prev = v.currentTime;
    const newT = clamp(prev + delta, 0, v.duration || prev + delta);

    if (delta > 0) {
      // Find the first uncrossed marker in (prev, newT] and fire its ad.
      const sorted = [...adMarkers].sort((a, b) => a.startTime - b.startTime);
      for (const m of sorted) {
        if (hitMarkers.current.has(m.id)) continue;
        if (prev < m.startTime && m.startTime <= newT) {
          const ad = resolveAdForMarker(m);
          if (!ad) { hitMarkers.current.add(m.id); continue; }
          fireAdSession(m, ad);
          return;
        }
      }
    }

    // No ad fired — plain skip-seek (marks forward crossings hit, clears
    // backward ones so rewound ads become re-fireable).
    skipSeek(newT);
  }

  function seekToClientX(clientX: number) {
    const rect = progressRef.current?.getBoundingClientRect();
    const v = videoRef.current;
    if (!rect || !v || !v.duration) return;
    skipSeek(clamp((clientX - rect.left) / rect.width, 0, 1) * v.duration);
  }

  function handleProgressMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (adSession) return;
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
    if (adVideoRef.current) adVideoRef.current.playbackRate = next;
  }

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (videoRef.current) videoRef.current.muted = nextMuted;
    if (adVideoRef.current) adVideoRef.current.muted = nextMuted;
  }

  const progress = duration ? currentTime / duration : 0;
  const adDurationTotal = adSession?.ad.duration ?? 0;
  const adProgressPct = adDurationTotal ? Math.min(1, adElapsed / adDurationTotal) : 0;
  const adRemaining = Math.max(0, Math.ceil(adDurationTotal - adElapsed));
  const canSkip = adElapsed >= adCanSkipAt;

  return (
    <div className="flex flex-col bg-white rounded-xl border border-gray-100 overflow-hidden h-full">
      {/* Video frame */}
      <div className="relative flex-1 bg-gray-900 min-h-0 overflow-hidden">
        {src && (
          <video
            ref={videoRef}
            src={src}
            playsInline
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

        {/* Ad overlay — real <video> playing the ad's videoUrl */}
        {adSession && (
          <div className="absolute inset-0 bg-black z-10 animate-fade-in">
            <video
              ref={adVideoRef}
              src={adSession.ad.videoUrl}
              playsInline
              autoPlay
              className="w-full h-full object-contain"
              onClick={togglePlay}
            />
            {/* Top-left label */}
            <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
              <div className="bg-white/10 border border-white/20 backdrop-blur-sm rounded-md px-2.5 py-1 text-[11px] text-white uppercase tracking-widest font-semibold">
                Advertisement
              </div>
              <div className="text-white/70 text-[13px] font-medium truncate max-w-[200px]">
                {adSession.ad.title}
              </div>
            </div>
            {/* Top-right skip */}
            <div className="absolute top-3 right-3">
              {canSkip ? (
                <button
                  onClick={() => endAdSession(true)}
                  className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/25 backdrop-blur-sm text-white text-xs font-medium rounded-md px-3 py-1.5 transition active:scale-95"
                >
                  Skip ad
                  <SkipForward size={12} />
                </button>
              ) : (
                <div className="bg-white/10 border border-white/20 backdrop-blur-sm text-white/80 text-xs font-medium rounded-md px-3 py-1.5 select-none">
                  Skip in {Math.max(0, Math.ceil(adCanSkipAt - adElapsed))}s
                </div>
              )}
            </div>
            {/* Bottom progress */}
            <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/15">
              <div
                className="h-full bg-yellow-400 transition-[width] duration-150 linear"
                style={{ width: `${adProgressPct * 100}%` }}
              />
            </div>
            {/* Bottom-left countdown */}
            <div className="absolute bottom-2 left-3 text-white/80 text-[10px] font-mono tabular-nums pointer-events-none">
              {adRemaining}s
            </div>
          </div>
        )}
      </div>

      {/* Thin progress bar — main video */}
      <div
        ref={progressRef}
        className={`h-1 bg-gray-200 group relative select-none ${adSession ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
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

      {/* Controls
          Jump-to-start and Jump-to-end sit pinned at the left/right edges;
          the 10s skips + double-chevrons + play/pause form a compact
          centered cluster. Icon sizes are tuned to match the timeline's
          Undo/Redo so the page reads as one consistent control family. */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-2">
        <button
          onClick={() => { if (!adSession) skipSeek(0); }}
          disabled={!!adSession}
          title="Jump to start"
          className="flex items-center gap-1.5 text-[13px] text-gray-700 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
        >
          <span className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center bg-white hover:border-gray-400 transition">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </span>
          <span className="font-medium hidden sm:inline">Jump to start</span>
        </button>

        <div className="flex items-center gap-5">
          <button
            onClick={() => seekBy(-10)}
            disabled={!!adSession}
            title="Back 10 seconds"
            className="flex items-center gap-1 text-[13px] text-gray-700 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3.51" />
            </svg>
            <span className="font-medium tabular-nums">10s</span>
          </button>
          <button
            onClick={() => seekBy(-5)}
            disabled={!!adSession}
            title="Rewind 5 seconds"
            aria-label="Rewind 5 seconds"
            className="text-gray-900 hover:text-black disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-90"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 5L1 12l10 7V5zm11 0L12 12l10 7V5z" />
            </svg>
          </button>
          <button
            onClick={togglePlay}
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
            className="text-gray-900 hover:text-black transition active:scale-90"
          >
            {playing ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="0.5" />
                <rect x="14" y="4" width="4" height="16" rx="0.5" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 21 12 6 21 6 3" />
              </svg>
            )}
          </button>
          <button
            onClick={() => seekBy(5)}
            disabled={!!adSession}
            title="Forward 5 seconds"
            aria-label="Forward 5 seconds"
            className="text-gray-900 hover:text-black disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-90"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 5l10 7-10 7V5zM2 5l10 7-10 7V5z" />
            </svg>
          </button>
          <button
            onClick={() => seekBy(10)}
            disabled={!!adSession}
            title="Forward 10 seconds"
            className="flex items-center gap-1 text-[13px] text-gray-700 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
          >
            <span className="font-medium tabular-nums">10s</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-.49-3.51" />
            </svg>
          </button>
        </div>

        <button
          onClick={() => { const v = videoRef.current; if (!adSession && v) skipSeek(v.duration); }}
          disabled={!!adSession}
          title="Jump to end"
          className="flex items-center gap-1.5 text-[13px] text-gray-700 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
        >
          <span className="font-medium hidden sm:inline">Jump to end</span>
          <span className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center bg-white hover:border-gray-400 transition">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </span>
        </button>
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
            if (adVideoRef.current) { adVideoRef.current.volume = val; adVideoRef.current.muted = val === 0; }
            setMuted(val === 0);
          }}
          className="w-16 h-1 accent-gray-900"
        />
        <div className="flex-1" />
        <button onClick={cycleSpeed} className="text-[10px] text-gray-400 hover:text-gray-700 font-mono border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50 transition">
          {speed}x
        </button>
        <span className="text-[10px] text-gray-400 font-mono">
          {adSession ? `Ad · ${adRemaining}s` : formatTime(currentTime)}
        </span>
      </div>
    </div>
  );
});
