'use client';

import { useRef, useEffect, useCallback, useState, useMemo, useLayoutEffect, startTransition } from 'react';
import { Ad, AdMarker } from '@/lib/types';

const DEFAULT_AD_DUR = 30;

type AdInfo = { thumb?: string; duration: number };

type CFG = {
  bg: string;
  bgHi: string;
  handle: string;
  badgeText: string;
  badgeBorder: string;
  label: string;
};

const TYPE_CFG: Record<'auto' | 'static' | 'ab', CFG> = {
  auto: {
    bg: '#86efac',
    bgHi: '#6ee7a8',
    handle: '#166534',
    badgeText: '#166534',
    badgeBorder: '#166534',
    label: 'A',
  },
  static: {
    bg: '#93c5fd',
    bgHi: '#7cb3fa',
    handle: '#1e40af',
    badgeText: '#1e40af',
    badgeBorder: '#1e40af',
    label: 'S',
  },
  ab: {
    bg: '#fdba74',
    bgHi: '#fca85a',
    handle: '#9a3412',
    badgeText: '#9a3412',
    badgeBorder: '#9a3412',
    label: 'A/B',
  },
};

function hms(s: number) {
  const safe = Math.max(0, Math.floor(s));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function makeAdDurationResolver(adInfo: Record<string, AdInfo>) {
  return (m: AdMarker): number => {
    const ids = m.adIds ?? [];
    if (!ids.length) return DEFAULT_AD_DUR;
    // A/B: use the longest ad so the block fits any rotation pick.
    const durs = ids.map((id) => adInfo[id]?.duration ?? DEFAULT_AD_DUR);
    return Math.max(...durs);
  };
}

export interface TimelineProps {
  duration: number;
  currentTime: number;
  markers: AdMarker[];
  ads: Ad[];
  adProgress?: { markerId: string; elapsed: number } | null;
  error?: string | null;
  waveformData: number[];
  onSeek: (t: number) => void;
  onSeekIntoAd?: (markerId: string, elapsed: number) => void;
  onMarkerMove: (id: string, newTime: number) => void;
  onMarkerDelete?: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const STRIP_H = 108;
const FRAME_PAD = 4;

export function Timeline({
  duration,
  currentTime,
  markers,
  ads,
  adProgress,
  error,
  waveformData,
  onSeek,
  onSeekIntoAd,
  onMarkerMove,
  onMarkerDelete,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: TimelineProps) {
  const [zoom, setZoom] = useState(1);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Clear the selection if the selected marker was deleted from the outside
  // (undo/redo, external edit, etc.).
  useEffect(() => {
    if (selectedId && !markers.some((m) => m.id === selectedId)) {
      setSelectedId(null);
    }
  }, [markers, selectedId]);

  // Delete / Backspace while a marker is selected → remove it. Skipped when
  // an input has focus so typing in the ad search/filter doesn't nuke ads.
  useEffect(() => {
    if (!selectedId || !onMarkerDelete) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onMarkerDelete!(selectedId!);
        setSelectedId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, onMarkerDelete]);

  const AD_INFO = useMemo<Record<string, AdInfo>>(
    () => Object.fromEntries(ads.map((a) => [a.id, { thumb: a.thumbnail, duration: a.duration }])),
    [ads],
  );
  const getAdDuration = useMemo(() => makeAdDurationResolver(AD_INFO), [AD_INFO]);

  // Optimistic display time (where user is pointing). Overrides the derived
  // playhead while a click/drag is in progress so seeks feel instant rather
  // than waiting ~250ms for <video>'s timeupdate event.
  const [pendingDisplayTime, setPendingDisplayTime] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [visibleW, setVisibleW] = useState(900);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setVisibleW(entry.contentRect.width));
    obs.observe(el);
    setVisibleW(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  const sortedIdx = useMemo(() => {
    return markers
      .map((m) => ({ m, dur: getAdDuration(m) }))
      .sort((a, b) => a.m.startTime - b.m.startTime);
  }, [markers, getAdDuration]);

  const totalAdDur = useMemo(
    () => sortedIdx.reduce((acc, x) => acc + x.dur, 0),
    [sortedIdx],
  );

  const isLoading = duration <= 0;
  const videoDur = Math.max(1, duration);
  const totalDur = videoDur + totalAdDur;

  // Pre-compute each ad's display-start (absolute time on the combined ruler).
  const adLayout = useMemo(() => {
    let acc = 0;
    return sortedIdx.map((a) => {
      const displayStart = a.m.startTime + acc;
      acc += a.dur;
      return { ...a, displayStart, displayEnd: displayStart + a.dur };
    });
  }, [sortedIdx]);

  // Waveform segments: gaps BETWEEN ad blocks that host the pink bars.
  const segments = useMemo(() => {
    const segs: { videoStart: number; videoEnd: number; displayStart: number; displayEnd: number }[] = [];
    let videoCursor = 0;
    let displayCursor = 0;
    for (const a of adLayout) {
      const segEndVideo = a.m.startTime;
      if (segEndVideo > videoCursor) {
        const segDur = segEndVideo - videoCursor;
        segs.push({
          videoStart: videoCursor,
          videoEnd: segEndVideo,
          displayStart: displayCursor,
          displayEnd: displayCursor + segDur,
        });
        displayCursor += segDur;
      }
      videoCursor = a.m.startTime;
      displayCursor += a.dur;
    }
    if (videoCursor < videoDur) {
      segs.push({
        videoStart: videoCursor,
        videoEnd: videoDur,
        displayStart: displayCursor,
        displayEnd: displayCursor + (videoDur - videoCursor),
      });
    }
    return segs;
  }, [adLayout, videoDur]);

  // video → display and display → video helpers.
  const adOffsetAtVideoTime = useCallback(
    (vt: number) => {
      let off = 0;
      for (const a of sortedIdx) {
        if (a.m.startTime < vt) off += a.dur;
        else break;
      }
      return off;
    },
    [sortedIdx],
  );

  const displayTimeFromVideoTime = useCallback(
    (vt: number) => vt + adOffsetAtVideoTime(vt),
    [adOffsetAtVideoTime],
  );

  // Map a click/drag display time back to a video time. If the display time
  // lands inside an ad block, "skip" — return the moment just past the ad's
  // start (video resumes post-ad).
  const videoTimeFromDisplayTime = useCallback(
    (dt: number): { vt: number; skippedAds: AdMarker[] } => {
      let acc = 0;
      const skipped: AdMarker[] = [];
      for (const a of adLayout) {
        if (dt < a.displayStart) return { vt: dt - acc, skippedAds: skipped };
        if (dt < a.displayEnd) {
          // Inside ad block: jump past it.
          skipped.push(a.m);
          return { vt: a.m.startTime + 0.01, skippedAds: skipped };
        }
        skipped.push(a.m);
        acc += a.dur;
      }
      return { vt: dt - acc, skippedAds: skipped };
    },
    [adLayout],
  );

  const innerW = Math.max(visibleW, visibleW * zoom);
  const pxPerSec = innerW / totalDur;

  // Memoized waveform SVG. Deliberately does NOT depend on playheadDisplayTime
  // or currentTime — the "played-region" brightness is painted by a single
  // overlay div (see below), not by per-bar opacity. Keeping this stable
  // across timeupdate ticks is the core of the perf fix: 300 <rect>s no
  // longer diff 4× per second.
  const waveformSvg = useMemo(() => {
    return segments.map((seg, i) => {
      const segLeftPx = seg.displayStart * pxPerSec;
      const segWidthPx = (seg.displayEnd - seg.displayStart) * pxPerSec;
      const srcLen = waveformData.length;

      // Empty state — backend hasn't populated waveformData yet.
      if (srcLen === 0) {
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 waveform-shimmer"
            style={{
              left: segLeftPx,
              width: segWidthPx,
              background:
                'linear-gradient(180deg, #f0abfc 0%, #e879f9 50%, #f0abfc 100%)',
              pointerEvents: 'none',
            }}
          />
        );
      }

      const totalBars = Math.max(8, Math.floor(segWidthPx / 4));
      const srcStart = (seg.videoStart / videoDur) * srcLen;
      const srcEnd = (seg.videoEnd / videoDur) * srcLen;
      const midY = STRIP_H / 2;
      const halfMax = STRIP_H * 0.42;
      const barGap = 1;
      const barW = Math.max(
        1.5,
        (segWidthPx - barGap * (totalBars - 1)) / totalBars,
      );

      return (
        <svg
          key={i}
          className="absolute"
          style={{
            top: 0,
            left: segLeftPx,
            width: segWidthPx,
            height: STRIP_H,
            background: '#f0abfc',
            pointerEvents: 'none',
          }}
          viewBox={`0 0 ${Math.max(1, segWidthPx)} ${STRIP_H}`}
          preserveAspectRatio="none"
        >
          {Array.from({ length: totalBars }).map((_, k) => {
            const srcIdx = Math.floor(
              srcStart + ((k + 0.5) / totalBars) * (srcEnd - srcStart),
            );
            const rawAmp = waveformData[clamp(srcIdx, 0, srcLen - 1)] ?? 0;
            const amp = Math.max(0.06, rawAmp);
            const halfH = amp * halfMax;
            const xCenter = ((k + 0.5) / totalBars) * segWidthPx;
            const x = xCenter - barW / 2;

            // Stagger-rise on mount only. Delay is small enough to stay
            // under 150ms total for a 300-bar strip.
            const delay = `${(k * 0.4).toFixed(1)}ms`;

            return (
              <rect
                key={k}
                className="waveform-bar"
                x={x}
                y={midY - halfH}
                width={barW}
                height={halfH * 2}
                rx={Math.min(barW / 2, 1.2)}
                fill="#ffffff"
                opacity={0.82}
                style={{ ['--d' as string]: delay } as React.CSSProperties}
              />
            );
          })}
        </svg>
      );
    });
  }, [segments, waveformData, pxPerSec, videoDur]);

  const derivedDisplayTime = displayTimeFromVideoTime(currentTime);

  // While an ad is playing the main video is paused, so derivedDisplayTime
  // is frozen at the ad's displayStart. Drive the playhead from the ad's own
  // elapsed time so it slides smoothly through the ad block instead.
  const adPlayheadTime = useMemo(() => {
    if (!adProgress) return null;
    const slot = adLayout.find((a) => a.m.id === adProgress.markerId);
    if (!slot) return null;
    return slot.displayStart + Math.min(slot.dur, adProgress.elapsed);
  }, [adProgress, adLayout]);

  const playheadDisplayTime =
    pendingDisplayTime ?? adPlayheadTime ?? derivedDisplayTime;
  const playheadPx = playheadDisplayTime * pxPerSec;

  // Smoothly interpolate between the ad's ~4 Hz timeupdate events.
  const playheadTransition = scrubbing ? 'none' : adProgress ? 'left 0.28s linear' : 'none';

  // Whenever the video actually reports a new currentTime, clear the pending
  // optimistic override so the displayed playhead tracks real playback.
  useEffect(() => {
    setPendingDisplayTime(null);
  }, [currentTime]);

  // ── Ticks ──────────────────────────────────────────────────────────────
  const { majorStep, minorStep } = useMemo(() => {
    const candidates = [10, 15, 30, 60, 120, 300, 600];
    const minLabelPx = 85;
    let major = 60;
    for (const c of candidates) {
      if (c * pxPerSec >= minLabelPx) {
        major = c;
        break;
      }
      major = c;
    }
    const minor = major / (major >= 60 ? 4 : 2);
    return { majorStep: major, minorStep: minor };
  }, [pxPerSec]);

  // Generate ticks strictly *inside* [0, totalDur). The endpoint tick would
  // sit at left=innerW and its centered label would extrude past the right
  // edge, causing the scroll container to show a phantom horizontal overflow.
  const majorTicks = useMemo(() => {
    const r: number[] = [];
    for (let t = 0; t < totalDur - 0.001; t += majorStep) r.push(t);
    return r;
  }, [totalDur, majorStep]);

  const minorTicks = useMemo(() => {
    const r: number[] = [];
    for (let t = 0; t < totalDur - 0.001; t += minorStep) {
      if (Math.abs(t % majorStep) > 0.001) r.push(t);
    }
    return r;
  }, [totalDur, minorStep, majorStep]);

  // ── Interactions ───────────────────────────────────────────────────────
  function seekFromClientX(clientX: number): number {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = clamp(clientX - rect.left, 0, innerW);
    const dt = (x / innerW) * totalDur;
    setPendingDisplayTime(dt); // instant visual

    // Did the click land inside an ad block? If so, route it to the ad
    // session handler instead of seeking the main video past the ad.
    const inAd = adLayout.find((a) => dt >= a.displayStart && dt < a.displayEnd);
    if (inAd && onSeekIntoAd) {
      const elapsed = Math.max(0, Math.min(inAd.dur, dt - inAd.displayStart));
      onSeekIntoAd(inAd.m.id, elapsed);
      return dt;
    }

    const { vt } = videoTimeFromDisplayTime(dt);
    onSeek(clamp(vt, 0, videoDur));
    return dt;
  }

  function onStripMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-marker]')) return;
    // Clicking empty strip deselects any focused ad.
    setSelectedId(null);
    e.preventDefault();
    setScrubbing(true);
    seekFromClientX(e.clientX);
    const onMove = (ev: MouseEvent) => seekFromClientX(ev.clientX);
    const onUp = () => {
      setScrubbing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startPlayheadDrag(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setScrubbing(true);
    seekFromClientX(e.clientX);
    const onMove = (ev: MouseEvent) => seekFromClientX(ev.clientX);
    const onUp = () => {
      setScrubbing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startMarkerDrag(e: React.MouseEvent, m: AdMarker) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(m.id);
    setDraggingId(m.id);
    const startX = e.clientX;
    const startTime = m.startTime;
    const adDur = getAdDuration(m);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dt = (dx / innerW) * totalDur;
      const newTime = clamp(startTime + dt, 0, Math.max(0, videoDur - adDur));
      onMarkerMove(m.id, newTime);
    };
    const onUp = () => {
      setDraggingId(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Zoom updates are interruptible — React can defer the heavy waveform
  // re-layout so the slider thumb / button click stays responsive.
  const bumpZoom = (delta: number) =>
    startTransition(() =>
      setZoom((z) => clamp(+(z + delta).toFixed(2), 1, 8)),
    );

  // Wheel handling on the strip: Ctrl/⌘+wheel zooms (anchored at cursor),
  // plain wheel scrolls horizontally. Always preventDefault so the page
  // behind the timeline doesn't scroll/zoom at the same time.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (isLoading) return;
      ev.preventDefault();
      ev.stopPropagation();

      if (ev.ctrlKey || ev.metaKey) {
        // Zoom around the cursor's current display-time anchor.
        const rect = el.getBoundingClientRect();
        const cursorXInScroll = ev.clientX - rect.left + el.scrollLeft;
        const anchorFraction = cursorXInScroll / innerW;
        const next = clamp(
          +(zoom + (ev.deltaY < 0 ? 0.25 : -0.25)).toFixed(2),
          1,
          8,
        );
        if (next === zoom) return;
        startTransition(() => setZoom(next));
        // After the zoom applies, re-anchor so the cursor stays over the
        // same display-time point.
        requestAnimationFrame(() => {
          const nextInnerW = Math.max(visibleW, visibleW * next);
          el.scrollLeft = anchorFraction * nextInnerW - (ev.clientX - rect.left);
        });
        return;
      }

      // Horizontal scroll — support both trackpad (deltaX) and wheel (deltaY).
      const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      el.scrollLeft += delta;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, innerW, visibleW, isLoading]);

  // Auto-scroll when playhead leaves viewport (not while user is scrubbing).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || scrubbing) return;
    const left = el.scrollLeft;
    const right = left + el.clientWidth;
    if (playheadPx < left + 40 || playheadPx > right - 40) {
      el.scrollTo({ left: Math.max(0, playheadPx - el.clientWidth / 2), behavior: 'smooth' });
    }
  }, [playheadPx, scrubbing]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-3 items-center px-5 py-3.5">
        <div className="flex items-center gap-5">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="flex items-center gap-2 text-[13px] text-gray-700 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
          >
            <span className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center bg-white hover:border-gray-400 transition">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6" />
                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
              </svg>
            </span>
            <span className="font-medium">Undo</span>
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            className="flex items-center gap-2 text-[13px] text-gray-700 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
          >
            <span className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center bg-white hover:border-gray-400 transition">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 7v6h-6" />
                <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
              </svg>
            </span>
            <span className="font-medium">Redo</span>
          </button>
        </div>

        <div className="flex justify-center">
          <div className="font-mono text-[13px] text-gray-900 border border-gray-200 rounded-lg px-5 py-1.5 tabular-nums tracking-wider bg-white select-none min-w-[124px] text-center">
            {isLoading ? '--:--:--' : hms(playheadDisplayTime)}
          </div>
        </div>

        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={() => bumpZoom(-0.5)}
            className="text-gray-500 hover:text-gray-900 transition active:scale-90"
            aria-label="Zoom out"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7.5" />
              <line x1="7.5" y1="11" x2="14.5" y2="11" />
              <line x1="17" y1="17" x2="21" y2="21" />
            </svg>
          </button>
          <input
            type="range"
            min={1}
            max={8}
            step={0.1}
            value={zoom}
            onChange={(e) => {
              const v = Number(e.target.value);
              startTransition(() => setZoom(v));
            }}
            className="timeline-zoom w-36 cursor-pointer"
          />
          <button
            onClick={() => bumpZoom(0.5)}
            className="text-gray-500 hover:text-gray-900 transition active:scale-90"
            aria-label="Zoom in"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7.5" />
              <line x1="11" y1="7.5" x2="11" y2="14.5" />
              <line x1="7.5" y1="11" x2="14.5" y2="11" />
              <line x1="17" y1="17" x2="21" y2="21" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-3">
        <div
          ref={scrollRef}
          className="timeline-scroll relative overflow-x-auto overflow-y-visible"
          style={{ paddingTop: 18, paddingLeft: 10, paddingRight: 10 }}
        >
          <div style={{ width: innerW, position: 'relative' }}>
            {/* Dark frame wrapper */}
            <div
              className="relative rounded-[8px]"
              style={{
                background: '#0a0a0a',
                padding: FRAME_PAD,
              }}
            >
              {/* Inner strip */}
              <div
                ref={stripRef}
                className="relative rounded-[4px] overflow-hidden"
                style={{
                  height: STRIP_H,
                  background: '#0a0a0a',
                  cursor: isLoading ? 'wait' : scrubbing ? 'grabbing' : 'crosshair',
                }}
                onMouseDown={isLoading ? undefined : onStripMouseDown}
              >
                {/* Waveform segments. Memoized — see `waveformSvg` above.
                    Independent of currentTime/playhead so timeupdate ticks
                    don't rerender the 300+ <rect>s. */}
                {waveformSvg}

                {/* Played-region overlay. One element; its width is the only
                    thing that updates on timeupdate. The low-alpha white
                    bump makes bars to the left of the playhead read slightly
                    brighter, matching the old per-bar opacity split. */}
                {!isLoading && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: 0,
                      width: Math.max(0, playheadPx),
                      background: 'rgba(255,255,255,0.14)',
                      mixBlendMode: 'screen',
                      zIndex: 5,
                      transition: playheadTransition,
                    }}
                  />
                )}

                {/* Ad markers — fill their slots completely (no floating) */}
                {adLayout.map((a) => {
                  const cfg = TYPE_CFG[a.m.type];
                  const rawLeft = a.displayStart * pxPerSec;
                  const rawWidth = a.dur * pxPerSec;
                  // Gap between ad block and the clip it splits. Scale it with
                  // the slot width so tight (zoomed-out) slots don't overflow
                  // into the neighboring waveform.
                  const gap = Math.min(3, Math.max(0, (rawWidth - 4) / 2));
                  const leftPx = rawLeft + gap;
                  const widthPx = Math.max(3, rawWidth - gap * 2);
                  const isHov = hoveredId === a.m.id;
                  const isDrag = draggingId === a.m.id;
                  const isSel = selectedId === a.m.id;
                  const thumbId = a.m.adIds?.[0];
                  const thumb = thumbId ? AD_INFO[thumbId]?.thumb : undefined;
                  const narrow = widthPx < 60;
                  const outline = isDrag
                    ? '2px solid rgba(255,255,255,0.85)'
                    : isSel
                    ? '2px solid #ffffff'
                    : 'none';

                  return (
                    <div
                      key={a.m.id}
                      data-marker
                      onMouseDown={(e) => startMarkerDrag(e, a.m)}
                      onMouseEnter={() => setHoveredId(a.m.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className="absolute select-none ad-marker-in"
                      style={{
                        left: leftPx,
                        top: 2,
                        bottom: 2,
                        width: widthPx,
                        background: isHov || isDrag || isSel ? cfg.bgHi : cfg.bg,
                        cursor: isDrag ? 'grabbing' : 'grab',
                        zIndex: isDrag ? 30 : isSel ? 25 : isHov ? 20 : 15,
                        borderRadius: 3,
                        outline,
                        outlineOffset: -2,
                        boxShadow: isSel
                          ? '0 4px 14px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.08)'
                          : 'none',
                        transition:
                          'background 0.12s ease, outline-color 0.15s ease, transform 0.12s ease, box-shadow 0.18s ease',
                        transform: (isHov && !isDrag) || isSel ? 'translateY(-0.5px)' : 'translateY(0)',
                      }}
                    >
                      <div
                        className="absolute top-1.5 left-1.5 flex items-center justify-center font-bold select-none pointer-events-none"
                        style={{
                          background: '#ffffff',
                          color: cfg.badgeText,
                          border: `1px solid ${cfg.badgeBorder}`,
                          fontSize: 9,
                          minWidth: a.m.type === 'ab' ? 26 : 18,
                          height: 16,
                          padding: '0 4px',
                          borderRadius: 4,
                          letterSpacing: '0.04em',
                          lineHeight: 1,
                        }}
                      >
                        {cfg.label}
                      </div>

                      {a.m.type === 'static' && thumb && !narrow && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-1">
                          <img
                            src={thumb}
                            alt=""
                            draggable={false}
                            className="object-cover rounded-md shadow-md"
                            style={{
                              maxWidth: 'calc(100% - 6px)',
                              maxHeight: 58,
                              opacity: isHov || isDrag ? 1 : 0.94,
                              transition: 'opacity 0.15s',
                            }}
                          />
                        </div>
                      )}

                      <div
                        className="absolute bottom-1.5 left-1/2 -translate-x-1/2 pointer-events-none"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 3px)',
                          gridTemplateRows: 'repeat(2, 3px)',
                          gap: 2.5,
                        }}
                      >
                        {Array.from({ length: 6 }).map((_, k) => (
                          <div
                            key={k}
                            style={{
                              width: 3,
                              height: 3,
                              borderRadius: 999,
                              background: cfg.handle,
                              opacity: isHov || isDrag ? 1 : 0.85,
                              transition: 'opacity 0.15s',
                            }}
                          />
                        ))}
                      </div>

                      {/* Floating delete button — appears on selection */}
                      {isSel && onMarkerDelete && (
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkerDelete(a.m.id);
                            setSelectedId(null);
                          }}
                          title="Delete ad (Del)"
                          aria-label="Delete ad"
                          className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition active:scale-90 delete-pop"
                          style={{
                            boxShadow:
                              '0 4px 12px rgba(239,68,68,0.5), 0 1px 3px rgba(0,0,0,0.25), 0 0 0 2px #0a0a0a',
                          }}
                        >
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                            <line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Playhead line — snaps on click, slides during ad playback */}
                {!isLoading && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: playheadPx,
                      transform: 'translateX(-50%)',
                      zIndex: 40,
                      transition: playheadTransition,
                    }}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: 2,
                        background: '#ef4444',
                        boxShadow: '0 0 4px rgba(239,68,68,0.45)',
                      }}
                    />
                  </div>
                )}

                {/* Loading / error overlay — shown until <video> reports its
                    real duration, or surfaces an error if the URL is dead. */}
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50 px-6">
                    {error ? (
                      <div className="flex items-center gap-2.5 text-[11px] text-red-300 font-medium tracking-wide text-center">
                        <span className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                            <line x1="12" y1="8" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                        </span>
                        {error}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-[11px] text-white/70 font-medium tracking-wide">
                        <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white/80 animate-spin" />
                        Loading timeline…
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Playhead top handle */}
            <div
              className="absolute"
              onMouseDown={isLoading ? undefined : startPlayheadDrag}
              style={{
                left: playheadPx + FRAME_PAD,
                top: -10,
                transform: 'translateX(-50%)',
                zIndex: 50,
                cursor: scrubbing ? 'grabbing' : 'grab',
                opacity: isLoading ? 0 : 1,
                pointerEvents: isLoading ? 'none' : 'auto',
                transition: `opacity 0.2s ease, ${playheadTransition === 'none' ? 'left 0s' : playheadTransition}`,
              }}
            >
              <div
                className="bg-[#ef4444] rounded-[5px] flex items-center justify-center hover:bg-[#dc2626] active:scale-95 transition-[background,transform]"
                style={{
                  width: 22,
                  height: 26,
                  boxShadow: '0 2px 6px rgba(239,68,68,0.45), 0 1px 2px rgba(0,0,0,0.15)',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 2.5px)',
                    gridTemplateRows: 'repeat(3, 2.5px)',
                    gap: 2,
                  }}
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      style={{ width: 2.5, height: 2.5, borderRadius: 1, background: 'rgba(255,255,255,0.95)' }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Ruler */}
            <div className="relative select-none" style={{ height: 28, marginTop: 4 }}>
              {minorTicks.map((t) => (
                <div
                  key={`mi-${t}`}
                  className="absolute top-0"
                  style={{ left: t * pxPerSec, width: 1, height: 4, background: '#e5e7eb' }}
                />
              ))}
              {majorTicks.map((t, i) => {
                // Keep edge labels inside innerW so they never push the scroll
                // container past its natural width.
                const labelAlign =
                  i === 0 ? 'translateX(0)' : 'translateX(-50%)';
                return (
                  <div
                    key={`ma-${t}`}
                    className="absolute top-0 flex flex-col items-center"
                    style={{ left: t * pxPerSec }}
                  >
                    <div style={{ width: 1, height: 7, background: '#9ca3af' }} />
                    <span
                      className="text-[10px] font-mono text-gray-500 mt-1 tabular-nums whitespace-nowrap"
                      style={{ transform: labelAlign }}
                    >
                      {hms(t)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
