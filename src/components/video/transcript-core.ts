import type { TranscriptWord } from '@/lib/types';

// Grouped readable line. `lowerText` is pre-cached for case-insensitive search.
export type Line = {
  start: number;
  end: number;
  words: TranscriptWord[];
  text: string;
  lowerText: string;
};

const LINE_MAX_DUR = 12;     // seconds
const LINE_MAX_CHARS = 180;

// Group the flat word array into readable lines. Priority: sentence boundary
// (word text ends in . ? !), else duration ≥ 12s, else ~180 chars. The backend
// appends punctuation onto the preceding word's text, so we sniff the last char.
export function groupWordsIntoLines(words: TranscriptWord[]): Line[] {
  if (!words.length) return [];
  const lines: Line[] = [];
  let buf: TranscriptWord[] = [];
  let chars = 0;
  let startT = words[0].start;

  const flush = () => {
    if (!buf.length) return;
    const text = buf.map((w) => w.text).join(' ');
    lines.push({
      start: startT,
      end: buf[buf.length - 1].end,
      words: buf,
      text,
      lowerText: text.toLowerCase(),
    });
    buf = [];
    chars = 0;
  };

  for (const w of words) {
    if (!buf.length) startT = w.start;
    buf.push(w);
    chars += w.text.length + 1;

    const last = w.text[w.text.length - 1];
    const isSentenceEnd = last === '.' || last === '!' || last === '?';
    const overDur = w.end - startT >= LINE_MAX_DUR;
    const overChars = chars >= LINE_MAX_CHARS;

    if (isSentenceEnd || overDur || overChars) flush();
  }
  flush();
  return lines;
}

// Binary search for the line containing `t`. Returns -1 if none — during a
// silence gap between lines we prefer no active line over stale highlighting.
export function findActiveLineIndex(lines: Line[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const l = lines[mid];
    if (t < l.start) hi = mid - 1;
    else if (t >= l.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

// Binary search for the word under the playhead inside a single line.
export function findActiveWordIndex(line: Line, t: number): number {
  const ws = line.words;
  let lo = 0;
  let hi = ws.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = ws[mid];
    if (t < w.start) hi = mid - 1;
    else if (t >= w.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

// Escape a user search query for safe RegExp construction (match highlight).
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mmss(s: number): string {
  const safe = Math.max(0, Math.floor(s));
  const m = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
