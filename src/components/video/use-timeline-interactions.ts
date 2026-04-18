import { useCallback, RefObject, MutableRefObject } from 'react';
import { AdMarker } from '@/lib/types';
import { AdLayoutItem, TimelineProps, FRAME_PAD } from './timeline-types';
import { clamp, hms } from './timeline-utils';

interface UseTimelineInteractionsArgs {
  innerW: number;
  totalDur: number;
  videoDur: number;
  pxPerSec: number;
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
  // Ghost drag refs — ghost block and ruler time indicator (both live outside
  // stripRef so they aren't clipped by overflow:hidden)
  ghostDomRef: MutableRefObject<HTMLDivElement | null>;
  ghostTimeLabelRef: RefObject<HTMLDivElement | null>;
  // Pending initial position for the ghost before React commits the DOM node
  ghostPendingPos: MutableRefObject<{ left: number; width: number } | null>;
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
  pxPerSec,
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
  ghostDomRef,
  ghostTimeLabelRef,
  ghostPendingPos,
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
    setDraggingId(m.id);  // triggers React render → ghost mounts → ghostCallbackRef fires

    const adDur = getAdDuration(m);

    // Compute ghost geometry at drag-start (pxPerSec is snapshotted from
    // this render's value — stays consistent for the whole drag).
    const rawWidth = adDur * pxPerSec;
    const gap = Math.min(3, Math.max(0, (rawWidth - 4) / 2));
    const ghostWidth = Math.max(3, rawWidth - gap * 2);

    // Click offset: distance from the ghost's left edge to where the user
    // clicked. Keeps the ghost block visually "stuck" under the cursor
    // at the same relative position rather than snapping to its left edge.
    const a = adLayout.find(x => x.m.id === m.id);
    const ghostMarkerLeft = a ? a.displayStart * pxPerSec + gap : 0;
    const stripX = stripOffsetFromClientX(e.clientX) ?? ghostMarkerLeft;
    const clickOffset = clamp(stripX - ghostMarkerLeft, 0, ghostWidth);

    const initialLeft = clamp(stripX - clickOffset, 0, innerW - ghostWidth);

    // Position the ghost DOM node if already mounted, otherwise queue it for
    // the callback ref that fires after React commits this render.
    if (ghostDomRef.current) {
      ghostDomRef.current.style.left = `${initialLeft}px`;
      ghostDomRef.current.style.width = `${ghostWidth}px`;
    } else {
      ghostPendingPos.current = { left: initialLeft, width: ghostWidth };
    }

    // Compute the target videoTime for a given ghost-left, EXCLUDING the
    // dragging marker from the layout. Using `videoTimeFromDisplayTime`
    // directly would subtract the dragging marker's own duration when the
    // drop lands past its original block — the marker would land adDur
    // seconds to the LEFT of where the user dropped, and the parent's ad
    // trigger (1.5s forward window) would never catch it on replay.
    const others = adLayout.filter(x => x.m.id !== m.id);
    const computeDropVt = (ghostLeft: number): number => {
      const ghostDisplayTime = (ghostLeft / innerW) * totalDur;
      let accOffset = 0;
      let result = ghostDisplayTime;
      for (const o of others) {
        const oDisplayStart = o.m.startTime + accOffset;
        const oDisplayEnd = oDisplayStart + o.dur;
        if (ghostDisplayTime < oDisplayStart) {
          return Math.max(0, ghostDisplayTime - accOffset);
        }
        if (ghostDisplayTime < oDisplayEnd) {
          // Ghost inside another marker's block — snap before/after based on midpoint
          const mid = oDisplayStart + o.dur / 2;
          return ghostDisplayTime < mid
            ? Math.max(0, o.m.startTime - 0.01)
            : o.m.startTime + 0.01;
        }
        accOffset += o.dur;
        result = ghostDisplayTime - accOffset;
      }
      return Math.max(0, result);
    };

    // Helper to write the ruler time indicator imperatively.
    const updateLabel = (ghostLeft: number) => {
      const labelEl = ghostTimeLabelRef.current;
      if (!labelEl) return;
      labelEl.style.left = `${ghostLeft + ghostWidth / 2}px`;
      labelEl.style.visibility = 'visible';
      const vt = computeDropVt(ghostLeft);
      const span = labelEl.querySelector<HTMLElement>('[data-ghost-time]');
      if (span) span.textContent = hms(clamp(vt, 0, videoDur));
    };
    updateLabel(initialLeft);

    const onMove = (ev: MouseEvent) => {
      const newStripX = stripOffsetFromClientX(ev.clientX) ?? 0;
      const newLeft = clamp(newStripX - clickOffset, 0, innerW - ghostWidth);

      if (ghostDomRef.current) {
        ghostDomRef.current.style.left = `${newLeft}px`;
      } else {
        // Ghost not yet mounted — queue for callback ref.
        ghostPendingPos.current = { left: newLeft, width: ghostWidth };
      }
      updateLabel(newLeft);
    };

    const onUp = () => {
      // Read final ghost position and commit the single state update.
      const finalLeft = parseFloat(ghostDomRef.current?.style.left ?? String(initialLeft));
      const vt = computeDropVt(finalLeft);
      onMarkerMove(m.id, clamp(vt, 0, Math.max(0, videoDur - adDur)));

      // Hide ruler label before the ghost unmounts.
      const labelEl = ghostTimeLabelRef.current;
      if (labelEl) labelEl.style.visibility = 'hidden';

      ghostPendingPos.current = null;
      setDraggingId(null);  // unmounts ghost, restores real marker appearance
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [
    setSelectedId, setDraggingId, getAdDuration, pxPerSec, adLayout,
    stripOffsetFromClientX, ghostDomRef, ghostTimeLabelRef, ghostPendingPos,
    innerW, totalDur, videoDur, onMarkerMove,
  ]);

  return { beginScrub, onStripMouseDown, startPlayheadDrag, startMarkerDrag };
}
