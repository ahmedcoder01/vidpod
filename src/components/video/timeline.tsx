'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { AdMarker } from '@/lib/types';
import { formatTime } from '@/lib/utils';

const TYPE_COLORS: Record<string, { bg: string; border: string; badge: string; text: string }> = {
  auto:   { bg: '#22c55e', border: '#16a34a', badge: '#15803d', text: 'A' },
  static: { bg: '#818cf8', border: '#6366f1', badge: '#4f46e5', text: 'S' },
  ab:     { bg: '#f97316', border: '#ea580c', badge: '#c2410c', text: 'A/B' },
};

interface Props {
  duration: number;
  currentTime: number;
  markers: AdMarker[];
  waveformData: number[];
  zoom: number;
  onSeek: (t: number) => void;
  onMarkerMove: (id: string, newTime: number) => void;
}

export function Timeline({ duration, currentTime, markers, waveformData, zoom, onSeek, onMarkerMove }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragMarker = useRef<{ id: string; startX: number; startTime: number } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hoveredMarker, setHoveredMarker] = useState<string | null>(null);

  const timeToX = useCallback((t: number, width: number) =>
    (t / (duration || 1)) * width * zoom - scrollLeft, [duration, zoom, scrollLeft]);

  const xToTime = useCallback((x: number, width: number) =>
    ((x + scrollLeft) / (width * zoom)) * (duration || 1), [duration, zoom, scrollLeft]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const tickH = 20; // bottom tick area height

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, W, H);

    const waveTop = 10;
    const waveH = H - tickH - waveTop;
    const totalW = W * zoom;

    // Draw ad segment colored blocks BEHIND waveform
    for (const m of markers) {
      const x = timeToX(m.startTime, W);
      const segDur = 30; // approximate 30s ad
      const segW = Math.max(24, (segDur / (duration || 1)) * totalW);
      const col = TYPE_COLORS[m.type] ?? TYPE_COLORS.auto;

      // Segment fill — more opaque so block is prominent like Figma
      ctx.fillStyle = col.bg + 'cc';
      ctx.fillRect(x, waveTop, segW, waveH);

      // Segment border left
      ctx.fillStyle = col.border;
      ctx.fillRect(x, waveTop, 2, waveH);
    }

    // Waveform bars
    if (waveformData.length > 0) {
      for (let i = 0; i < waveformData.length; i++) {
        const x = (i / waveformData.length) * totalW - scrollLeft;
        if (x < -3 || x > W + 3) continue;
        const barW = Math.max(1.5, (totalW / waveformData.length) * 0.6);
        const h = waveformData[i] * (waveH * 0.85);
        const timeAtI = (i / waveformData.length) * (duration || 1);

        // Check if inside an ad segment
        const inSeg = markers.some((m) => timeAtI >= m.startTime && timeAtI <= m.startTime + 30);
        if (inSeg) {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
        } else if (timeAtI < currentTime) {
          ctx.fillStyle = '#a855f7';
        } else {
          ctx.fillStyle = '#c084fc';
        }
        ctx.fillRect(x - barW / 2, waveTop + (waveH - h) / 2, barW, h);
      }
    }

    // Ad segment overlay badges (small square at top of each segment)
    for (const m of markers) {
      const x = timeToX(m.startTime, W);
      const col = TYPE_COLORS[m.type] ?? TYPE_COLORS.auto;
      const isHov = hoveredMarker === m.id;
      const segDur = 30;
      const segW = Math.max(24, (segDur / (duration || 1)) * totalW);

      // Full block border
      ctx.strokeStyle = col.border;
      ctx.lineWidth = isHov ? 2 : 1;
      ctx.strokeRect(x + 0.5, waveTop + 0.5, segW - 1, waveH - 1);

      // Badge at top
      const badgeW = m.type === 'ab' ? 28 : 20;
      const badgeH = 18;
      ctx.fillStyle = col.badge;
      roundRect(ctx, x + 4, waveTop + 4, badgeW, badgeH, 4);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = `bold 9px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(col.text, x + 4 + badgeW / 2, waveTop + 4 + badgeH / 2);

      // Drag handle (6-dot grid) at bottom center of block
      const dotR = 1.5;
      const dotGap = 4;
      const gridW = 2 * dotGap; // 3 cols → 2 gaps
      const gridH = 1 * dotGap; // 2 rows → 1 gap
      const hx = x + segW / 2 - gridW / 2;
      const hy = waveTop + waveH - 12 - gridH / 2;
      ctx.fillStyle = isHov ? '#ffffffcc' : col.bg + 'aa';
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.beginPath();
          ctx.arc(hx + c * dotGap, hy + r * dotGap, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Time ticks at bottom — always HH:MM:SS
    const tickInterval = zoom > 4 ? 10 : zoom > 2 ? 30 : 60;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= duration; t += tickInterval) {
      const x = timeToX(t, W);
      if (x < -30 || x > W + 30) continue;
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(x, H - tickH, 1, 4);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '9px monospace';
      const hh = String(Math.floor(t / 3600)).padStart(2, '0');
      const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
      const ss = String(Math.floor(t % 60)).padStart(2, '0');
      ctx.fillText(`${hh}:${mm}:${ss}`, x, H - tickH + 5);
    }

    // Playhead
    const px = timeToX(currentTime, W);
    if (px >= 0 && px <= W) {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(px - 0.5, waveTop, 1.5, waveH);
      // Triangle at top
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(px - 5, waveTop);
      ctx.lineTo(px + 5, waveTop);
      ctx.lineTo(px, waveTop + 8);
      ctx.closePath();
      ctx.fill();
      // Small red square indicator above waveform
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(px - 5, 0, 10, waveTop - 1);
    }

    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }, [waveformData, markers, currentTime, duration, zoom, scrollLeft, hoveredMarker, timeToX]);

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      draw();
    };
    resize();
    const obs = new ResizeObserver(resize);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  function getMarkerAt(x: number): AdMarker | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const W = canvas.width;
    for (const m of markers) {
      const mx = timeToX(m.startTime, W);
      const segW = Math.max(24, (30 / (duration || 1)) * W * zoom);
      if (x >= mx && x <= mx + segW) return m;
    }
    return null;
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (dragMarker.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dx = x - dragMarker.current.startX;
      const dt = (dx / (canvas.width * zoom)) * (duration || 1);
      const newT = clamp(dragMarker.current.startTime + dt, 0, duration);
      onMarkerMove(dragMarker.current.id, newT);
      return;
    }
    const m = getMarkerAt(x);
    setHoveredMarker(m?.id ?? null);
    e.currentTarget.style.cursor = m ? 'grab' : 'crosshair';
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const m = getMarkerAt(x);
    if (m) {
      dragMarker.current = { id: m.id, startX: x, startTime: m.startTime };
      e.currentTarget.style.cursor = 'grabbing';
    } else {
      const canvas = canvasRef.current;
      if (canvas) onSeek(xToTime(x, canvas.width));
    }
  }

  function onMouseUp() { dragMarker.current = null; }

  function onWheel(e: React.WheelEvent) {
    if (zoom <= 1) return;
    setScrollLeft((s) => {
      const canvas = canvasRef.current;
      const max = canvas ? canvas.width * (zoom - 1) : 0;
      return clamp(s + e.deltaX + e.deltaY * 0.3, 0, max);
    });
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      />
    </div>
  );
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
