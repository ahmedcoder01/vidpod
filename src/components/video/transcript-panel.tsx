'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import type { Transcript, TranscriptWord } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  escapeRegExp,
  findActiveLineIndex,
  findActiveWordIndex,
  groupWordsIntoLines,
  mmss,
} from './transcript-core';

interface Props {
  transcript: Transcript;
  currentTime: number;
  onSeek: (t: number) => void;
  onClose: () => void;
}

const MANUAL_SCROLL_LOCK_MS = 4000;

export function TranscriptPanel({ transcript, currentTime, onSeek, onClose }: Props) {
  const lines = useMemo(() => groupWordsIntoLines(transcript.words), [transcript.words]);

  // Active line + active word inside it.
  const activeLineIdx = useMemo(() => findActiveLineIndex(lines, currentTime), [lines, currentTime]);
  const activeWordIdx = useMemo(() => {
    if (activeLineIdx < 0) return -1;
    return findActiveWordIndex(lines[activeLineIdx], currentTime);
  }, [lines, activeLineIdx, currentTime]);

  // ── Auto-scroll, with manual-scroll lock ──────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const programmaticScrollRef = useRef(false);
  const manualLockUntilRef = useRef(0);
  const [lockedOffscreen, setLockedOffscreen] = useState(false);

  // Detect manual scrolls: if a scroll event fires and we didn't trigger it
  // ourselves, lock auto-scroll for 4s.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      manualLockUntilRef.current = Date.now() + MANUAL_SCROLL_LOCK_MS;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollActiveIntoView = useCallback(() => {
    const el = scrollRef.current;
    const row = lineRefs.current[activeLineIdx];
    if (!el || !row) return;
    programmaticScrollRef.current = true;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeLineIdx]);

  useEffect(() => {
    if (activeLineIdx < 0) return;
    if (Date.now() < manualLockUntilRef.current) return;
    scrollActiveIntoView();
  }, [activeLineIdx, scrollActiveIntoView]);

  // While manual-locked, watch whether the active line is off-screen; if so,
  // reveal the "Jump to current" pill. All setState calls happen inside the
  // interval callback (async) so we don't trigger cascading renders.
  useEffect(() => {
    const check = () => {
      if (activeLineIdx < 0) { setLockedOffscreen(false); return; }
      if (Date.now() >= manualLockUntilRef.current) { setLockedOffscreen(false); return; }
      const el = scrollRef.current;
      const row = lineRefs.current[activeLineIdx];
      if (!el || !row) return;
      const elRect = el.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const off = rowRect.bottom < elRect.top + 8 || rowRect.top > elRect.bottom - 8;
      setLockedOffscreen(off);
    };
    const kick = window.setTimeout(check, 0);
    const t = window.setInterval(check, 500);
    return () => { window.clearTimeout(kick); window.clearInterval(t); };
  }, [activeLineIdx]);

  // ── Search ────────────────────────────────────────────────────────────
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(rawQuery.trim()), 120);
    return () => window.clearTimeout(t);
  }, [rawQuery]);

  const matches = useMemo(() => {
    if (!query) return [] as number[];
    const q = query.toLowerCase();
    const res: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].lowerText.includes(q)) res.push(i);
    }
    return res;
  }, [query, lines]);

  const matchSet = useMemo(() => new Set(matches), [matches]);

  const [matchCursor, setMatchCursor] = useState(0);

  const jumpToMatch = useCallback((idx: number) => {
    if (!matches.length) return;
    const lineIdx = matches[((idx % matches.length) + matches.length) % matches.length];
    const row = lineRefs.current[lineIdx];
    if (row) {
      programmaticScrollRef.current = true;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const line = lines[lineIdx];
    if (line && line.words.length) onSeek(line.words[0].start);
  }, [matches, lines, onSeek]);

  const queryRegex = useMemo(() => (query ? new RegExp(`(${escapeRegExp(query)})`, 'gi') : null), [query]);

  // ── Render helpers ────────────────────────────────────────────────────
  // Render a word, with search-match <mark> wrapping if applicable.
  function renderWord(
    w: TranscriptWord,
    isActiveWord: boolean,
    isActiveLine: boolean,
  ) {
    const base = 'rounded-sm px-0.5 cursor-pointer transition-colors';
    const lowConf = w.conf > 0 && w.conf < 0.5;
    const tone = isActiveWord
      ? 'text-gray-900 font-semibold'
      : isActiveLine
        ? 'text-gray-700 hover:text-gray-900'
        : lowConf
          ? 'text-gray-400 underline decoration-dotted underline-offset-2 hover:text-gray-700'
          : 'text-gray-500 hover:text-gray-900';

    // Split text by query matches for highlighting.
    let content: React.ReactNode = w.text;
    if (queryRegex) {
      const parts = w.text.split(queryRegex);
      if (parts.length > 1) {
        content = parts.map((p, i) =>
          queryRegex.test(p) && i % 2 === 1
            ? <mark key={i} className="bg-yellow-200 text-gray-900 rounded-sm px-0">{p}</mark>
            : <span key={i}>{p}</span>
        );
      }
    }

    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          onSeek(w.start);
        }}
        className={cn(base, tone)}
      >
        {content}
      </span>
    );
  }

  const headerMatchLabel = query
    ? matches.length
      ? `${Math.min(matchCursor + 1, matches.length)} of ${matches.length}`
      : '0 of 0'
    : `${transcript.words.length} words`;

  return (
    <div className="w-[380px] shrink-0 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-gray-900 text-sm font-semibold">Transcript</span>
            <span className="text-gray-400 text-xs tabular-nums">{headerMatchLabel}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition"
            aria-label="Close transcript"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex-1 relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={rawQuery}
              onChange={(e) => { setRawQuery(e.target.value); setMatchCursor(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  jumpToMatch(matchCursor);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const next = matchCursor + 1;
                  setMatchCursor(next);
                  jumpToMatch(next);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  const next = matchCursor - 1;
                  setMatchCursor(next);
                  jumpToMatch(next);
                } else if (e.key === 'Escape') {
                  setRawQuery('');
                }
              }}
              placeholder="Search transcript"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg h-8 pl-7 pr-2 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-900 transition"
            />
          </div>
          <button
            onClick={() => { const n = matchCursor - 1; setMatchCursor(n); jumpToMatch(n); }}
            disabled={!matches.length}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            aria-label="Previous match"
          >
            <ArrowUp size={12} />
          </button>
          <button
            onClick={() => { const n = matchCursor + 1; setMatchCursor(n); jumpToMatch(n); }}
            disabled={!matches.length}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            aria-label="Next match"
          >
            <ArrowDown size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain relative"
      >
        {lines.length === 0 ? (
          <div className="h-full flex items-center justify-center px-6">
            <p className="text-gray-400 text-sm text-center">No spoken content detected.</p>
          </div>
        ) : (
          <div className="py-2">
            {lines.map((line, i) => {
              const isActive = i === activeLineIdx;
              const isMatch = matchSet.has(i);
              return (
                <div
                  key={i}
                  ref={(el) => { lineRefs.current[i] = el; }}
                  onClick={() => line.words.length && onSeek(line.words[0].start)}
                  className={cn(
                    'group flex gap-3 px-4 py-2 cursor-pointer transition-colors border-l-2',
                    isActive
                      ? 'bg-gray-50 border-gray-900'
                      : 'border-transparent hover:bg-gray-50',
                    isMatch && !isActive && 'bg-yellow-50/40',
                  )}
                >
                  <span className="text-[10px] font-mono text-gray-400 tabular-nums w-10 shrink-0 pt-0.5 select-none">
                    {mmss(line.start)}
                  </span>
                  <p className="text-[13px] leading-[1.55] flex-1 min-w-0 flex flex-wrap gap-x-0.5 gap-y-0.5">
                    {line.words.map((w, k) => (
                      <span key={k}>
                        {renderWord(w, isActive && k === activeWordIdx, isActive)}
                      </span>
                    ))}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* "Jump to current" pill — appears only while auto-scroll is locked
            AND the active line is off-screen. Sticky at bottom-center. */}
        {lockedOffscreen && (
          <button
            onClick={() => {
              manualLockUntilRef.current = 0;
              scrollActiveIntoView();
              setLockedOffscreen(false);
            }}
            className="sticky bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 bg-gray-900 text-white text-xs font-medium rounded-full px-3 py-1.5 shadow-lg hover:bg-gray-800 transition"
            style={{ marginLeft: 'calc(50% - 68px)' }}
          >
            <ArrowDown size={11} />
            Jump to current
          </button>
        )}
      </div>
    </div>
  );
}
