import { useRef, useEffect, RefObject } from 'react';
import { Segment, STRIP_H } from './timeline-types';
import { clamp, addRoundedRectPath } from './timeline-utils';

interface UseWaveformCanvasArgs {
  segments: Segment[];
  waveformData: number[];
  pxPerSec: number;
  videoDur: number;
  innerW: number;
}

// Draws the waveform onto a single <canvas> covering the entire strip.
// One canvas means the browser paints all bars in a single fill call, and
// React no longer reconciles thousands of SVG children on zoom/marker changes.
export function useWaveformCanvas({
  segments,
  waveformData,
  pxPerSec,
  videoDur,
  innerW,
}: UseWaveformCanvasArgs): RefObject<HTMLCanvasElement | null> {
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Reference-equality tracker for `waveformData` so the mount-in stagger
  // only plays when the underlying data changes (new video loaded), not
  // every time zoom / markers shift the layout.
  const lastWaveformDataRef = useRef<number[] | null>(null);

  useEffect(() => {
    const cv = waveformCanvasRef.current;
    if (!cv) return;

    // HiDPI, but cap the device pixel ratio so extremely wide timelines
    // (e.g. long video × 8× zoom) don't blow past the browser's maximum
    // canvas surface size.
    const MAX_PHYS_W = 8192;
    const cssW = Math.max(1, Math.floor(innerW));
    const cssH = STRIP_H;
    const idealDpr = Math.min(2, window.devicePixelRatio || 1);
    const dpr =
      cssW * idealDpr > MAX_PHYS_W ? Math.max(1, MAX_PHYS_W / cssW) : idealDpr;

    if (cv.width !== Math.floor(cssW * dpr) || cv.height !== Math.floor(cssH * dpr)) {
      cv.width = Math.floor(cssW * dpr);
      cv.height = Math.floor(cssH * dpr);
    }
    cv.style.width = `${cssW}px`;
    cv.style.height = `${cssH}px`;

    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const srcLen = waveformData.length;

    // Empty state — the shimmer overlays in JSX handle the look. Clear the
    // canvas so a stale frame from a previous video doesn't linger.
    if (srcLen === 0) {
      ctx.clearRect(0, 0, cssW, cssH);
      return;
    }

    const midY = STRIP_H / 2;
    const halfMax = STRIP_H * 0.42;
    const BAR_GAP = 1;

    // Precompute every bar position up front so the rAF loop only does
    // path-building + one fill per frame, not data sampling.
    type BarPack = { x: number; w: number; halfH: number; delay: number };
    type SegPack = { leftPx: number; widthPx: number; bars: BarPack[] };
    const packs: SegPack[] = segments.map((seg) => {
      const segLeftPx = seg.displayStart * pxPerSec;
      const segWidthPx = Math.max(0, (seg.displayEnd - seg.displayStart) * pxPerSec);
      if (segWidthPx < 2) return { leftPx: segLeftPx, widthPx: segWidthPx, bars: [] };

      const totalBars = Math.max(8, Math.floor(segWidthPx / 4));
      const srcStart = (seg.videoStart / videoDur) * srcLen;
      const srcEnd = (seg.videoEnd / videoDur) * srcLen;
      const barW = Math.max(1.5, (segWidthPx - BAR_GAP * (totalBars - 1)) / totalBars);
      const bars: BarPack[] = new Array(totalBars);
      for (let k = 0; k < totalBars; k++) {
        const srcIdx = Math.floor(srcStart + ((k + 0.5) / totalBars) * (srcEnd - srcStart));
        const rawAmp = waveformData[clamp(srcIdx, 0, srcLen - 1)] ?? 0;
        const amp = Math.max(0.06, rawAmp);
        const halfH = amp * halfMax;
        const xCenter = ((k + 0.5) / totalBars) * segWidthPx;
        bars[k] = { x: segLeftPx + xCenter - barW / 2, w: barW, halfH, delay: k * 0.4 };
      }
      return { leftPx: segLeftPx, widthPx: segWidthPx, bars };
    });

    // Only restage the intro animation when waveformData *itself* changes
    // (new video loaded). Zoom / pan / marker edits paint the final state
    // immediately — matches the old behavior where React reused existing
    // <rect>s and didn't re-fire the CSS keyframes.
    const doStagger = lastWaveformDataRef.current !== waveformData;
    lastWaveformDataRef.current = waveformData;

    const RISE_MS = 380;
    const mountedAt = performance.now();
    let rafId = 0;

    // Matches the original cubic-bezier(0.25, 0.9, 0.3, 1) closely enough
    // for the human eye; the intro is <200ms so a cheap ease-out is fine.
    const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

    const drawFrame = (progressMs: number | null): boolean => {
      ctx.clearRect(0, 0, cssW, cssH);

      ctx.fillStyle = '#f0abfc';
      for (const p of packs) {
        if (p.widthPx <= 0) continue;
        ctx.fillRect(p.leftPx, 0, p.widthPx, STRIP_H);
      }

      // All bars batched into one path → a single fill call for the whole
      // strip, regardless of bar count. This is the hot path during the
      // intro animation.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.beginPath();
      let allDone = true;
      for (const p of packs) {
        for (const b of p.bars) {
          let s: number;
          if (progressMs == null) {
            s = 1;
          } else {
            s = easeOut((progressMs - b.delay) / RISE_MS);
            if (s < 1) allDone = false;
          }
          const halfH = b.halfH * s;
          if (halfH < 0.25) continue;
          const r = Math.min(b.w / 2, 1.2);
          addRoundedRectPath(ctx, b.x, midY - halfH, b.w, halfH * 2, r);
        }
      }
      ctx.fill();
      return allDone;
    };

    if (doStagger) {
      const tick = () => {
        const done = drawFrame(performance.now() - mountedAt);
        if (!done) rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } else {
      drawFrame(null);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [segments, waveformData, pxPerSec, videoDur, innerW]);

  return waveformCanvasRef;
}
