import { useCallback, RefObject, MutableRefObject } from 'react';
import { AdMarker } from '@/lib/types';
import { AdLayoutItem, TimelineProps, FRAME_PAD } from './timeline-types';
import { clamp } from './timeline-utils';

interface UseTimelineInteractionsArgs {
  innerW: number;
  totalDur: number;
  videoDur: number;
  adLayout: AdLayoutItem[];
  onSeek: TimelineProps['onSeek'];
  onSeekIntoAd: TimelineProps['onSeekIntoAd'];
  onScrubbingChange: TimelineProps['onScrubbingChange'];
  onMarkerMove: TimelineProps['onMarkerMove'];
  getAdDuration: (m: AdMarker) => number;
  videoTimeFromDisplayTime: (dt: number) => { vt: number; skippedAds: AdMarker[] };
  stripRef: RefObject<HTMLDivElement | null>;
  playheadLineRef: RefObject<HTMLDivElement | null>;
  handleRef: RefObject<HTMLDivElement | null>;
  playedOverlayRef: RefObject<HTMLDivElement | null>;
  scrubbingRef: MutableRefObject<boolean>;
  setSelectedId: (id: string | null) => void;
  setDraggingId: (id: string | null) => void;
  setPendingDisplayTime: (t: number | null) => void;
  setScrubbing: (v: boolean) => void;
}

export function useTimelineInteractions({
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
}: UseTimelineInteractionsArgs) {
  // Convert a viewport-space `clientX` into a logical-pixel offset inside
  // the timeline strip. Essential when a CSS `zoom` is applied to any
  // ancestor (e.g. `html { zoom: 1.1 }`): `clientX` and
  // `getBoundingClientRect()` live in visual (post-zoom) space, while
  // `clientWidth` and anything we assign to `style.left` live in logical
  // (pre-zoom) space. Without compensating for the ratio the playhead
  // drifts by the zoom factor and the gap grows with cursor position.
  const stripOffsetFromClientX = useCallback(
    (clientX: number): number | null => {
      const el = stripRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const scale = el.clientWidth > 0 ? rect.width / el.clientWidth : 1;
      return clamp((clientX - rect.left) / (scale || 1), 0, innerW);
    },
    [innerW, stripRef],
  );

  // Paint the three playhead DOM nodes imperatively for zero-latency cursor
  // tracking. Also zeroes out `transition` on each element first — if the
  // previous render left `left 0.25s linear` in place and a drag begins
  // before React commits the scrubbing state, the browser would *animate*
  // our imperative write and the playhead would visibly glide behind the
  // cursor. The next React render overwrites these inline styles from JSX.
  const paintPlayheadAt = useCallback((x: number) => {
    const line = playheadLineRef.current;
    const handle = handleRef.current;
    const overlay = playedOverlayRef.current;
    if (line) {
      line.style.transition = 'none';
      line.style.left = `${x}px`;
    }
    if (handle) {
      handle.style.transition = 'none';
      handle.style.left = `${x + FRAME_PAD}px`;
    }
    if (overlay) {
      overlay.style.transition = 'none';
      overlay.style.width = `${Math.max(0, x)}px`;
    }
  }, [playheadLineRef, handleRef, playedOverlayRef]);

  // Map a logical strip offset to a display-time, route the seek (into an ad
  // block or onto the main video), and update pending optimistic override.
  const applySeekAtX = useCallback((x: number) => {
    const dt = (x / innerW) * totalDur;
    setPendingDisplayTime(dt);

    const inAd = adLayout.find((a) => dt >= a.displayStart && dt < a.displayEnd);
    if (inAd && onSeekIntoAd) {
      const elapsed = Math.max(0, Math.min(inAd.dur, dt - inAd.displayStart));
      onSeekIntoAd(inAd.m.id, elapsed);
      return;
    }
    const { vt } = videoTimeFromDisplayTime(dt);
    onSeek(clamp(vt, 0, videoDur));
  }, [innerW, totalDur, adLayout, onSeekIntoAd, videoTimeFromDisplayTime, onSeek, videoDur, setPendingDisplayTime]);

  // Shared drag entry for strip clicks and direct handle grabs. Paints
  // the playhead synchronously with each mousemove event for a
  // cursor-attached feel independent of React's render cadence.
  const beginScrub = useCallback((firstClientX: number) => {
    scrubbingRef.current = true;
    setScrubbing(true);
    onScrubbingChange?.(true);
    const handleAt = (clientX: number) => {
      const x = stripOffsetFromClientX(clientX);
      if (x == null) return;
      paintPlayheadAt(x);
      applySeekAtX(x);
    };
    handleAt(firstClientX);
    const onMove = (ev: MouseEvent) => handleAt(ev.clientX);
    const onUp = () => {
      scrubbingRef.current = false;
      setScrubbing(false);
      onScrubbingChange?.(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [scrubbingRef, setScrubbing, onScrubbingChange, stripOffsetFromClientX, paintPlayheadAt, applySeekAtX]);

  const onStripMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-marker]')) return;
    setSelectedId(null);
    e.preventDefault();
    beginScrub(e.clientX);
  }, [setSelectedId, beginScrub]);

  const startPlayheadDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    beginScrub(e.clientX);
  }, [beginScrub]);

  const startMarkerDrag = useCallback((e: React.MouseEvent, m: AdMarker) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(m.id);
    setDraggingId(m.id);
    const startX = e.clientX;
    const startTime = m.startTime;
    const adDur = getAdDuration(m);

    // Snapshot the zoom scale at drag-start. clientX is visual-space
    // (post-zoom) but innerW / style.left are logical-space (pre-zoom).
    // Without this correction the marker moves faster than the cursor
    // by the zoom factor.
    const stripEl = stripRef.current;
    const stripRect = stripEl?.getBoundingClientRect();
    const scale = stripEl && stripRect && stripEl.clientWidth > 0
      ? stripRect.width / stripEl.clientWidth : 1;

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / (scale || 1);
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
  }, [setSelectedId, setDraggingId, getAdDuration, stripRef, innerW, totalDur, videoDur, onMarkerMove]);

  return { beginScrub, onStripMouseDown, startPlayheadDrag, startMarkerDrag };
}
