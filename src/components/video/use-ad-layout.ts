import { useRef, useMemo, useCallback, useEffect } from 'react';
import { Ad, AdMarker } from '@/lib/types';
import { AdInfo, AdLayoutItem, Segment, TimelineProps } from './timeline-types';
import { makeAdDurationResolver } from './timeline-utils';

export function useAdLayout(
  markers: AdMarker[],
  ads: Ad[],
  duration: number,
  adProgress: TimelineProps['adProgress'],
  currentTime: number,
) {
  const AD_INFO = useMemo<Record<string, AdInfo>>(
    () => Object.fromEntries(ads.map((a) => [a.id, { thumb: a.thumbnail, duration: a.duration }])),
    [ads],
  );
  const getAdDuration = useMemo(() => makeAdDurationResolver(AD_INFO), [AD_INFO]);

  const videoDur = Math.max(1, duration);

  const sortedIdx = useMemo(() => {
    return markers
      .map((m) => ({ m, dur: getAdDuration(m) }))
      .sort((a, b) => a.m.startTime - b.m.startTime);
  }, [markers, getAdDuration]);

  const totalAdDur = useMemo(
    () => sortedIdx.reduce((acc, x) => acc + x.dur, 0),
    [sortedIdx],
  );

  const totalDur = videoDur + totalAdDur;

  // Pre-compute each ad's display-start (absolute time on the combined ruler).
  const adLayout = useMemo<AdLayoutItem[]>(() => {
    let acc = 0;
    return sortedIdx.map((a) => {
      const displayStart = a.m.startTime + acc;
      acc += a.dur;
      return { ...a, displayStart, displayEnd: displayStart + a.dur };
    });
  }, [sortedIdx]);

  // Waveform segments: gaps BETWEEN ad blocks that host the waveform bars.
  const segments = useMemo<Segment[]>(() => {
    const segs: Segment[] = [];
    let videoCursor = 0;
    let displayCursor = 0;
    for (const a of adLayout) {
      const segEndVideo = a.m.startTime;
      if (segEndVideo > videoCursor) {
        const segDur = segEndVideo - videoCursor;
        segs.push({
          videoStart: videoCursor,
          videoEnd: segEndVideo,
          displayStart: displayCursor,
          displayEnd: displayCursor + segDur,
        });
        displayCursor += segDur;
      }
      videoCursor = a.m.startTime;
      displayCursor += a.dur;
    }
    if (videoCursor < videoDur) {
      segs.push({
        videoStart: videoCursor,
        videoEnd: videoDur,
        displayStart: displayCursor,
        displayEnd: displayCursor + (videoDur - videoCursor),
      });
    }
    return segs;
  }, [adLayout, videoDur]);

  // ── Ad completion tracking ────────────────────────────────────────────────
  // Proof-of-completion set for ad markers. An ad earns its place here
  // the moment `adProgress` transitions away from it (session ended and
  // the main video resumed). Used by `adOffsetAtVideoTime` below to
  // tell a just-entered ad boundary apart from a just-exited one.
  //
  // Updated synchronously during render so the fresh value is visible on
  // the same frame as the prop change; a `useEffect`-mediated update would
  // land one render late and create the opposite glitch (playhead jumping
  // *back* for a frame when an ad finishes).
  const prevCurrentTimeRef = useRef(currentTime);
  const completedAdsRef = useRef<Set<string>>(new Set());
  const prevAdProgressRef = useRef(adProgress);

  if (prevAdProgressRef.current !== adProgress) {
    const prev = prevAdProgressRef.current;
    const curr = adProgress;
    let next = completedAdsRef.current;
    // Session ended for `prev.markerId` → mark completed.
    if (prev && (!curr || curr.markerId !== prev.markerId) && !next.has(prev.markerId)) {
      next = new Set(next);
      next.add(prev.markerId);
    }
    // Session (re)started on `curr.markerId` → wipe any prior completion
    // so it behaves as "fresh" again (handles re-seek-into-played-ad).
    if (curr && next.has(curr.markerId)) {
      next = new Set(next);
      next.delete(curr.markerId);
    }
    completedAdsRef.current = next;
    prevAdProgressRef.current = adProgress;
  }
  // Backward seek past an ad's startTime — clear its completion so the
  // just-entered-boundary glitch protection works again when they re-cross.
  if (currentTime < prevCurrentTimeRef.current - 0.5) {
    let next = completedAdsRef.current;
    let changed = false;
    for (const id of next) {
      const a = sortedIdx.find((x) => x.m.id === id);
      if (a && a.m.startTime >= currentTime) {
        if (!changed) { next = new Set(next); changed = true; }
        next.delete(id);
      }
    }
    if (changed) completedAdsRef.current = next;
  }

  // Classify the latest `currentTime` delta: small forward step = natural
  // playback (smooth it); anything else = seek / reverse (snap).
  // Read before the effect updates the ref so callers see the pre-render value.
  const naturalProgress =
    currentTime - prevCurrentTimeRef.current >= 0 &&
    currentTime - prevCurrentTimeRef.current <= 1.0;

  useEffect(() => {
    prevCurrentTimeRef.current = currentTime;
  }, [currentTime]);

  // ── Coordinate transforms ─────────────────────────────────────────────────
  const adOffsetAtVideoTime = useCallback(
    (vt: number) => {
      let off = 0;
      for (const a of sortedIdx) {
        if (a.m.startTime >= vt) break;
        const isActive = adProgress?.markerId === a.m.id;
        const isCompleted = completedAdsRef.current.has(a.m.id);
        // If `vt` has crossed this ad's start but neither the ad is currently
        // playing nor has it completed before, we're inside the one-frame
        // window just before the parent flips to ad playback. Park the
        // playhead at this marker's displayStart by NOT adding its duration
        // to the offset — `adPlayheadTime` will take over on the next render.
        if (!isActive && !isCompleted) break;
        off += a.dur;
      }
      return off;
    },
    [sortedIdx, adProgress],
  );

  const displayTimeFromVideoTime = useCallback(
    (vt: number) => vt + adOffsetAtVideoTime(vt),
    [adOffsetAtVideoTime],
  );

  // Map a click/drag display time back to a video time. If the display time
  // lands inside an ad block, "skip" — return the moment just past the ad's
  // start (video resumes post-ad).
  const videoTimeFromDisplayTime = useCallback(
    (dt: number): { vt: number; skippedAds: AdMarker[] } => {
      let acc = 0;
      const skipped: AdMarker[] = [];
      for (const a of adLayout) {
        if (dt < a.displayStart) return { vt: dt - acc, skippedAds: skipped };
        if (dt < a.displayEnd) {
          skipped.push(a.m);
          return { vt: a.m.startTime + 0.01, skippedAds: skipped };
        }
        skipped.push(a.m);
        acc += a.dur;
      }
      return { vt: dt - acc, skippedAds: skipped };
    },
    [adLayout],
  );

  // While an ad is playing the main video is paused, so derivedDisplayTime
  // is frozen at the ad's displayStart. Drive the playhead from the ad's own
  // elapsed time so it slides smoothly through the ad block.
  const adPlayheadTime = useMemo(() => {
    if (!adProgress) return null;
    const slot = adLayout.find((a) => a.m.id === adProgress.markerId);
    if (!slot) return null;
    return slot.displayStart + Math.min(slot.dur, adProgress.elapsed);
  }, [adProgress, adLayout]);

  return {
    AD_INFO,
    getAdDuration,
    sortedIdx,
    totalAdDur,
    videoDur,
    totalDur,
    adLayout,
    segments,
    adOffsetAtVideoTime,
    displayTimeFromVideoTime,
    videoTimeFromDisplayTime,
    adPlayheadTime,
    naturalProgress,
  };
}
