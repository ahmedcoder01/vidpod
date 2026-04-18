'use client';

import { AdMarker } from '@/lib/types';
import { AdInfo, AdLayoutItem, TYPE_CFG } from './timeline-types';

interface AdMarkerBlockProps {
  a: AdLayoutItem;
  pxPerSec: number;
  AD_INFO: Record<string, AdInfo>;
  hoveredId: string | null;
  draggingId: string | null;
  selectedId: string | null;
  onMouseDown: (e: React.MouseEvent, m: AdMarker) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
}

export function AdMarkerBlock({
  a,
  pxPerSec,
  AD_INFO,
  hoveredId,
  draggingId,
  selectedId,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: AdMarkerBlockProps) {
  const cfg = TYPE_CFG[a.m.type];
  const rawLeft = a.displayStart * pxPerSec;
  const rawWidth = a.dur * pxPerSec;
  // Gap between ad block and the clip it splits. Scale it with the slot
  // width so tight (zoomed-out) slots don't overflow into the neighbour.
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
    ? '2px dashed rgba(255,255,255,0.35)'
    : isSel
    ? '2px solid #ffffff'
    : 'none';

  return (
    <div
      key={a.m.id}
      data-marker
      onMouseDown={(e) => onMouseDown(e, a.m)}
      onMouseEnter={() => onMouseEnter(a.m.id)}
      onMouseLeave={onMouseLeave}
      className="absolute select-none ad-marker-in"
      style={{
        left: leftPx,
        top: 2,
        bottom: 2,
        width: widthPx,
        background: isHov || isSel ? cfg.bgHi : cfg.bg,
        opacity: isDrag ? 0.25 : 1,
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
          fontSize: 10,
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
    </div>
  );
}
