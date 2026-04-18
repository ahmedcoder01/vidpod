'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Quote,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { Transcript, TranscriptWord } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  escapeRegExp,
  findActiveLineIndex,
  findActiveWordIndex,
  groupWordsIntoLines,
  mmss,
  type Line,
} from './transcript-core';

// Side-panel transcript for the Watch page. Shares the grouping/search core
// with the sidebar `TranscriptPanel` (transcript-core.ts) and adds the
// animated design — gradient active-bar, karaoke word pop, cascade entrance,
// search glow — that the ads-editor sidebar intentionally keeps calmer.
//
// Perf note: the word-level karaoke updates at the HTML5 video `timeupdate`
// cadence (~4 Hz, sometimes faster). A 2-hour podcast has ~800 lines and
// ~20k words; naively re-rendering every word on every tick stalls the
// main thread. We memoize each `LineRow` so only the one or two lines whose
// inputs actually changed (the entering + leaving active line) re-render.
// Within the active line, only the activeWord boolean flips per word.
interface Props {
  transcript: Transcript;
  currentTime: number;
  onSeek: (t: number) => void;
  onClose?: () => void;
}

const MANUAL_SCROLL_LOCK_MS = 4000;

export function WatchTranscript({ transcript, currentTime, onSeek, onClose }: Props) {
  const lines = useMemo(() => groupWordsIntoLines(transcript.words), [transcript.words]);

  const activeLineIdx = useMemo(
    () => findActiveLineIndex(lines, currentTime),
    [lines, currentTime],
  );
  const activeWordIdx = useMemo(() => {
    if (activeLineIdx < 0) return -1;
    return findActiveWordIndex(lines[activeLineIdx], currentTime);
  }, [lines, activeLineIdx, currentTime]);

  // ── Auto-scroll + manual lock ────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const programmaticScrollRef = useRef(false);
  const manualLockUntilRef = useRef(0);
  const [lockedOffscreen, setLockedOffscreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

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
    if (!autoScroll) return;
    if (activeLineIdx < 0) return;
    if (Date.now() < manualLockUntilRef.current) return;
    scrollActiveIntoView();
  }, [activeLineIdx, scrollActiveIntoView, autoScroll]);

  useEffect(() => {
    const check = () => {
      if (!autoScroll) { setLockedOffscreen(false); return; }
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
  }, [activeLineIdx, autoScroll]);

  // ── Search ───────────────────────────────────────────────────────────
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

  // Stable regex (identity flips only when the query string changes) so
  // LineRow's memo compare doesn't bust on every tick.
  const queryRegex = useMemo(
    () => (query ? new RegExp(`(${escapeRegExp(query)})`, 'gi') : null),
    [query],
  );

  // Stable ref setter for LineRow so memo'd children don't need to refresh.
  const setLineRef = useCallback((i: number, el: HTMLDivElement | null) => {
    lineRefs.current[i] = el;
  }, []);

  const headerMatchLabel = query
    ? matches.length
      ? `${Math.min(matchCursor + 1, matches.length)} of ${matches.length}`
      : 'No matches'
    : `${transcript.words.length.toLocaleString()} words`;

  return (
    <section className="relative w-[400px] shrink-0 bg-white border border-gray-100 rounded-2xl shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg watch-title-badge shrink-0">
              <Quote size={12} className="text-white" />
            </span>
            <div className="min-w-0">
              <h2 className="text-gray-900 text-sm font-semibold leading-tight">Transcript</h2>
              <p className="text-gray-400 text-[11px] tabular-nums mt-0.5">{headerMatchLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <label
              className={cn(
                'inline-flex items-center gap-1 cursor-pointer text-[11px] font-medium px-2 h-7 rounded-md border transition',
                autoScroll
                  ? 'bg-gray-900 border-gray-900 text-white'
                  : 'border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50',
              )}
              title={autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              <Sparkles size={10} className={cn(autoScroll && 'watch-autoscroll-shine')} />
              Auto
            </label>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition"
                aria-label="Close transcript"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex-1 relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={rawQuery}
              onChange={(e) => { setRawQuery(e.target.value); setMatchCursor(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); jumpToMatch(matchCursor); }
                else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const next = matchCursor + 1; setMatchCursor(next); jumpToMatch(next);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  const next = matchCursor - 1; setMatchCursor(next); jumpToMatch(next);
                } else if (e.key === 'Escape') { setRawQuery(''); }
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
        className="flex-1 overflow-y-auto overscroll-contain relative px-2 py-3"
      >
        {lines.length === 0 ? (
          <div className="h-full flex items-center justify-center px-6">
            <p className="text-gray-400 text-sm text-center">No spoken content detected.</p>
          </div>
        ) : (
          <div>
            {lines.map((line, i) => (
              <LineRow
                key={i}
                index={i}
                line={line}
                isActive={i === activeLineIdx}
                // -1 for inactive lines so memo compare stays stable across
                // ticks when `activeWordIdx` changes inside another line.
                activeWordInLine={i === activeLineIdx ? activeWordIdx : -1}
                isMatch={matchSet.has(i)}
                queryRegex={queryRegex}
                onSeek={onSeek}
                setRef={setLineRef}
              />
            ))}
          </div>
        )}

        {lockedOffscreen && (
          <button
            onClick={() => {
              manualLockUntilRef.current = 0;
              scrollActiveIntoView();
              setLockedOffscreen(false);
            }}
            className="sticky float-right bottom-3 mr-2 inline-flex items-center gap-1.5 bg-gray-900 text-white text-xs font-medium rounded-full px-3 py-1.5 shadow-lg hover:bg-gray-800 transition"
          >
            <ChevronDown size={11} />
            Jump to current
          </button>
        )}
      </div>
    </section>
  );
}

// ── LineRow ─────────────────────────────────────────────────────────────
// Memoized per-line row. Only re-renders when the props it actually depends
// on change — crucially NOT when `activeWordIdx` changes inside a different
// line (because the parent passes -1 for inactive lines, a stable value).
interface LineRowProps {
  index: number;
  line: Line;
  isActive: boolean;
  activeWordInLine: number;   // -1 when isActive is false
  isMatch: boolean;
  queryRegex: RegExp | null;
  onSeek: (t: number) => void;
  setRef: (i: number, el: HTMLDivElement | null) => void;
}

const LineRow = memo(function LineRow({
  index,
  line,
  isActive,
  activeWordInLine,
  isMatch,
  queryRegex,
  onSeek,
  setRef,
}: LineRowProps) {
  return (
    <div
      ref={(el) => setRef(index, el)}
      onClick={() => line.words.length && onSeek(line.words[0].start)}
      className={cn(
        'watch-line group relative grid grid-cols-[3rem_1fr] gap-3 items-start py-2 px-2.5 rounded-lg cursor-pointer transition-colors',
        isActive ? 'watch-line-active bg-gray-50' : 'hover:bg-gray-50',
        isMatch && !isActive && 'watch-line-match',
      )}
    >
      {isActive && <span className="watch-active-bar" aria-hidden />}
      <span className="pt-0.5 font-mono tabular-nums text-[10px] text-gray-400 select-none">
        {mmss(line.start)}
      </span>
      <p className="text-[13px] leading-[1.6] flex flex-wrap gap-x-0.5 gap-y-0.5 min-w-0">
        {line.words.map((w, k) => (
          <Word
            key={k}
            word={w}
            isActiveWord={isActive && k === activeWordInLine}
            isActiveLine={isActive}
            queryRegex={queryRegex}
            onSeek={onSeek}
          />
        ))}
      </p>
    </div>
  );
});

// ── Word ────────────────────────────────────────────────────────────────
// Also memoized — inside the active line, only the two words whose
// `isActiveWord` flipped re-render on each tick.
interface WordProps {
  word: TranscriptWord;
  isActiveWord: boolean;
  isActiveLine: boolean;
  queryRegex: RegExp | null;
  onSeek: (t: number) => void;
}

const Word = memo(function Word({
  word,
  isActiveWord,
  isActiveLine,
  queryRegex,
  onSeek,
}: WordProps) {
  const lowConf = word.conf > 0 && word.conf < 0.5;
  const tone = isActiveWord
    ? 'text-gray-900 font-semibold watch-word-light'
    : isActiveLine
      ? 'text-gray-700 hover:text-gray-900'
      : lowConf
        ? 'text-gray-400 underline decoration-dotted underline-offset-2 hover:text-gray-700'
        : 'text-gray-500 hover:text-gray-900';

  // String.split with a capturing regex returns: [before, match, between, match, ..., after].
  // Odd indices are the matched spans — no need to re-test (which was also
  // incorrect: a global regex's `.test()` mutates `lastIndex`).
  let content: React.ReactNode = word.text;
  if (queryRegex) {
    const parts = word.text.split(queryRegex);
    if (parts.length > 1) {
      content = parts.map((p, i) =>
        i % 2 === 1
          ? <mark key={i} className="bg-yellow-200 text-gray-900 rounded-sm px-0">{p}</mark>
          : <span key={i}>{p}</span>,
      );
    }
  }

  // `data-text` is the sizer source: a CSS ::after pseudo-element renders the
  // word at bold weight with height:0 so the word's box always reserves its
  // bold width. Flipping `font-semibold` on activation no longer reflows the
  // line — same cadence the word was going to occupy is already claimed.
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onSeek(word.start); }}
      data-text={word.text}
      className={cn('watch-word rounded-sm px-0.5 cursor-pointer transition-colors', tone)}
    >
      {content}
    </span>
  );
});
