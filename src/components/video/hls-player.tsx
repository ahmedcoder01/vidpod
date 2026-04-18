'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import Hls from 'hls.js';

// HLS-first player with MP4 fallback. Ad-free — the `VideoPlayer` in the Ads
// editor owns dual <video> tags + ad skip state; this one is a clean reader
// for the Watch page. We use the native `controls` attribute so the browser
// gives us play/pause/scrub/volume/fullscreen/PIP for free — mirroring what
// YouTube / Descript preview / Loom do on a plain watch page.
interface Props {
  hlsUrl: string | null;     // chunksURL, handed verbatim (public /hls/* path)
  mp4Url: string | null;     // fallback signed MP4 URL (playbackUrl)
  poster?: string | null;
  onTimeUpdate?: (t: number) => void;
  onDurationChange?: (d: number) => void;
  onError?: (msg: string | null) => void;
}

export interface HlsPlayerHandle {
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
}

export const HlsPlayer = forwardRef<HlsPlayerHandle, Props>(function HlsPlayer(
  { hlsUrl, mp4Url, poster, onTimeUpdate, onDurationChange, onError },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Cache current playback time across src swaps (e.g. MP4 → HLS when the
  // backend flips status to completed) so the user doesn't get bounced to 0.
  const lastTimeRef = useRef<number>(0);

  useImperativeHandle(ref, () => ({
    seek: (t: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(t)) return;
      v.currentTime = Math.max(0, t);
    },
    play: () => { void videoRef.current?.play(); },
    pause: () => { videoRef.current?.pause(); },
  }), []);

  // Core attach/detach. Effects depend on BOTH URLs: swapping MP4→HLS (or the
  // other direction) destroys the old attachment and re-mounts the right one.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Cache current position before any swap.
    if (!Number.isNaN(video.currentTime) && video.currentTime > 0) {
      lastTimeRef.current = video.currentTime;
    }

    // Tear down any previous hls.js instance before starting a new one.
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    onError?.(null);

    const resumeAt = lastTimeRef.current;
    const tryResume = () => {
      if (resumeAt > 0.1 && Number.isFinite(resumeAt)) {
        try { video.currentTime = resumeAt; } catch { /* ignore seek race */ }
      }
    };

    // 1) hls.js path — preferred when chunksURL is ready and the browser can
    //    host MSE (everything except Safari). VOD tuning: workers on for big
    //    podcast segments, no low-latency hacks.
    if (hlsUrl && Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: false,
        enableWorker: true,
      });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, tryResume);
      let recovered = false;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true;
          try { hls.recoverMediaError(); } catch { /* fallthrough */ }
          return;
        }
        onError?.(data.details || 'Playback error');
      });
      return () => {
        hls.destroy();
        if (hlsRef.current === hls) hlsRef.current = null;
      };
    }

    // 2) Safari native-HLS path. No XHRs to .ts — the browser handles it.
    if (hlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      const onMeta = () => tryResume();
      video.addEventListener('loadedmetadata', onMeta, { once: true });
      return () => video.removeEventListener('loadedmetadata', onMeta);
    }

    // 3) MP4 fallback — runs before HLS is ready (status !== completed) or
    //    if the environment can't play HLS at all.
    if (mp4Url) {
      video.src = mp4Url;
      const onMeta = () => tryResume();
      video.addEventListener('loadedmetadata', onMeta, { once: true });
      return () => video.removeEventListener('loadedmetadata', onMeta);
    }

    // Nothing playable yet.
    video.removeAttribute('src');
    video.load();
    return undefined;
  }, [hlsUrl, mp4Url, onError]);

  // Native <video> errors bubble up too (e.g. signed URL expired mid-play).
  const handleNativeError = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.error) return;
    onError?.(v.error.message || 'Video element error');
  }, [onError]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    lastTimeRef.current = v.currentTime;
    onTimeUpdate?.(v.currentTime);
  }, [onTimeUpdate]);

  const handleDurationChange = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration)) onDurationChange?.(v.duration);
  }, [onDurationChange]);

  return (
    <video
      ref={videoRef}
      poster={poster ?? undefined}
      controls
      playsInline
      preload="metadata"
      className="w-full h-full bg-black"
      onTimeUpdate={handleTimeUpdate}
      onDurationChange={handleDurationChange}
      onError={handleNativeError}
    />
  );
});
