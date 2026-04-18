import { AdMarker } from '@/lib/types';
import { AdInfo, DEFAULT_AD_DUR } from './timeline-types';

export function hms(s: number): string {
  const safe = Math.max(0, Math.floor(s));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Append a rounded-rectangle sub-path to the current canvas path. Kept
// manual (rather than `ctx.roundRect`) so the timeline stays paintable on
// every evergreen browser without a polyfill.
export function addRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function makeAdDurationResolver(adInfo: Record<string, AdInfo>) {
  return (m: AdMarker): number => {
    const ids = m.adIds ?? [];
    if (!ids.length) return DEFAULT_AD_DUR;
    // A/B: use the longest ad so the block fits any rotation pick.
    const durs = ids.map((id) => adInfo[id]?.duration ?? DEFAULT_AD_DUR);
    return Math.max(...durs);
  };
}
