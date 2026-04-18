'use client';

import { startTransition } from 'react';
import { hms } from './timeline-utils';

interface TimelineHeaderProps {
  isLoading: boolean;
  playheadDisplayTime: number;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (v: number) => void;
  bumpZoom: (delta: number) => void;
}

export function TimelineHeader({
  isLoading,
  playheadDisplayTime,
  zoom,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomChange,
  bumpZoom,
}: TimelineHeaderProps) {
  return (
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
            startTransition(() => onZoomChange(v));
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
  );
}
