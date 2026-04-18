'use client';

import { useRef, useEffect, useState, useMemo, useLayoutEffect, startTransition } from 'react';
import { TimelineProps, STRIP_H, FRAME_PAD } from './timeline-types';
import { hms, clamp } from './timeline-utils';
import { useAdLayout } from './use-ad-layout';
import { useWaveformCanvas } from './use-waveform-canvas';
import { useTimelineInteractions } from './use-timeline-interactions';
import { AdMarkerBlock } from './timeline-ad-marker';
import { TimelineHeader } from './timeline-header';

export type { TimelineProps };

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
  onScrubbingChange,
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
  const [pendingDisplayTime, setPendingDisplayTime] = useState<number | null>(null);
  const [visibleW, setVisibleW] = useState(900);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // Synchronous companion to the `scrubbing` state — flipped inline with the
  // mousedown handler so the pending-clear effect sees the correct value on
  // the first `timeupdate` after drag start.
  const scrubbingRef = useRef(false);
  // Direct refs to the three DOM nodes that represent the playhead. Written
  // imperatively in mousemove handlers for zero-latency cursor tracking.
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const playedOverlayRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setVisibleW(entry.contentRect.width));
    obs.observe(el);
    setVisibleW(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  // Clear the selection if the selected marker was deleted externally.
  useEffect(() => {
    if (selectedId && !markers.some((m) => m.id === selectedId)) {
      setSelectedId(null);
    }
  }, [markers, selectedId]);

  // Delete / Backspace while a marker is selected → remove it.
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

  const isLoading = duration <= 0;

  const {
    AD_INFO,
    getAdDuration,
    videoDur,
    totalDur,
    adLayout,
    segments,
    displayTimeFromVideoTime,
    videoTimeFromDisplayTime,
    adPlayheadTime,
    naturalProgress,
  } = useAdLayout(markers, ads, duration, adProgress, currentTime);

  const innerW = Math.max(visibleW, visibleW * zoom);
  const pxPerSec = innerW / totalDur;

  const waveformCanvasRef = useWaveformCanvas({ segments, waveformData, pxPerSec, videoDur, innerW });

  const { onStripMouseDown, startPlayheadDrag, startMarkerDrag } = useTimelineInteractions({
    innerW,
    totalDur,
    videoDur,
    adLayout,
    onSeek,
    onSeekIntoAd,
    onScrubbingChange,
    onMarkerMove,
    getAdDuration,
    videoTimeFromDisplayTime,
    stripRef,
    playheadLineRef,
    handleRef,
    playedOverlayRef,
    scrubbingRef,
    setSelectedId,
    setDraggingId,
    setPendingDisplayTime,
    setScrubbing,
  });

  // ── Ruler ticks ────────────────────────────────────────────────────────────
  const { majorStep, minorStep } = useMemo(() => {
    const candidates = [10, 15, 30, 60, 120, 300, 600];
    const minLabelPx = 85;
    let major = 60;
    for (const c of candidates) {
      if (c * pxPerSec >= minLabelPx) { major = c; break; }
      major = c;
    }
    const minor = major / (major >= 60 ? 4 : 2);
    return { majorStep: major, minorStep: minor };
  }, [pxPerSec]);

  // Generate ticks strictly *inside* [0, totalDur). The endpoint tick would
  // sit at left=innerW and its label would extrude past the right edge.
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

  // ── Playhead time ──────────────────────────────────────────────────────────
  const derivedDisplayTime = displayTimeFromVideoTime(currentTime);
  const playheadDisplayTime = pendingDisplayTime ?? adPlayheadTime ?? derivedDisplayTime;
  const playheadPx = playheadDisplayTime * pxPerSec;

  // CSS-transition smoothing between ~4 Hz `timeupdate` events.
  // Snap (no transition) when scrubbing, optimistic override is active,
  // or the delta isn't a natural forward tick (seek, reverse, cross-fade).
  const smoothPlayhead =
    !scrubbing &&
    pendingDisplayTime == null &&
    (adProgress != null || naturalProgress);
  const playheadTransition = smoothPlayhead ? 'left 0.25s linear' : 'none';
  const playedOverlayTransition = smoothPlayhead ? 'width 0.25s linear' : 'none';

  // Clear the optimistic override once the video reports back — but only
  // when no drag is in flight, otherwise we yank the playhead to the stale
  // timeupdate position between every mousemove.
  useEffect(() => {
    if (!scrubbingRef.current) setPendingDisplayTime(null);
  }, [currentTime]);

  // ── Zoom ───────────────────────────────────────────────────────────────────
  const bumpZoom = (delta: number) =>
    startTransition(() => setZoom((z) => clamp(+(z + delta).toFixed(2), 1, 8)));

  // Ctrl/⌘+wheel zooms (anchored at cursor); plain wheel scrolls horizontally.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (isLoading) return;
      ev.preventDefault();
      ev.stopPropagation();

      if (ev.ctrlKey || ev.metaKey) {
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
        requestAnimationFrame(() => {
          const nextInnerW = Math.max(visibleW, visibleW * next);
          el.scrollLeft = anchorFraction * nextInnerW - (ev.clientX - rect.left);
        });
        return;
      }

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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.04)] overflow-hidden">
      <TimelineHeader
        isLoading={isLoading}
        playheadDisplayTime={playheadDisplayTime}
        zoom={zoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        onZoomChange={setZoom}
        bumpZoom={bumpZoom}
      />

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
              style={{ background: '#0a0a0a', padding: FRAME_PAD }}
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
                {/* Waveform canvas */}
                <canvas
                  ref={waveformCanvasRef}
                  className="absolute inset-0 pointer-events-none"
                />

                {/* Empty-state shimmer — only until waveformData arrives */}
                {waveformData.length === 0 && segments.map((seg, i) => (
                  <div
                    key={`sh-${i}`}
                    className="absolute top-0 bottom-0 waveform-shimmer"
                    style={{
                      left: seg.displayStart * pxPerSec,
                      width: (seg.displayEnd - seg.displayStart) * pxPerSec,
                      background: 'linear-gradient(180deg, #f0abfc 0%, #e879f9 50%, #f0abfc 100%)',
                      pointerEvents: 'none',
                    }}
                  />
                ))}

                {/* Played-region overlay — width-only update on timeupdate */}
                {!isLoading && (
                  <div
                    ref={playedOverlayRef}
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: 0,
                      width: Math.max(0, playheadPx),
                      background: 'rgba(255,255,255,0.14)',
                      mixBlendMode: 'screen',
                      zIndex: 5,
                      transition: playedOverlayTransition,
                    }}
                  />
                )}

                {/* Ad marker blocks */}
                {adLayout.map((a) => (
                  <AdMarkerBlock
                    key={a.m.id}
                    a={a}
                    pxPerSec={pxPerSec}
                    AD_INFO={AD_INFO}
                    hoveredId={hoveredId}
                    draggingId={draggingId}
                    selectedId={selectedId}
                    onMouseDown={startMarkerDrag}
                    onMouseEnter={setHoveredId}
                    onMouseLeave={() => setHoveredId(null)}
                  />
                ))}

                {/* Playhead line */}
                {!isLoading && (
                  <div
                    ref={playheadLineRef}
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

                {/* Loading / error overlay */}
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50 px-6">
                    {error ? (
                      <div className="flex items-center gap-2.5 text-xs text-red-300 font-medium tracking-wide text-center">
                        <span className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                            <line x1="12" y1="8" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                        </span>
                        {error}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-white/70 font-medium tracking-wide">
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
              ref={handleRef}
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
                const labelAlign = i === 0 ? 'translateX(0)' : 'translateX(-50%)';
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
