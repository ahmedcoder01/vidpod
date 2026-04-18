import { Ad, AdMarker } from '@/lib/types';

export const DEFAULT_AD_DUR = 30;

export type AdInfo = { thumb?: string; duration: number };

export type CFG = {
  bg: string;
  bgHi: string;
  handle: string;
  badgeText: string;
  badgeBorder: string;
  label: string;
};

export const TYPE_CFG: Record<'auto' | 'static' | 'ab', CFG> = {
  auto: {
    bg: '#86efac',
    bgHi: '#6ee7a8',
    handle: '#166534',
    badgeText: '#166534',
    badgeBorder: '#166534',
    label: 'A',
  },
  static: {
    bg: '#93c5fd',
    bgHi: '#7cb3fa',
    handle: '#1e40af',
    badgeText: '#1e40af',
    badgeBorder: '#1e40af',
    label: 'S',
  },
  ab: {
    bg: '#fdba74',
    bgHi: '#fca85a',
    handle: '#9a3412',
    badgeText: '#9a3412',
    badgeBorder: '#9a3412',
    label: 'A/B',
  },
};

export interface TimelineProps {
  duration: number;
  currentTime: number;
  markers: AdMarker[];
  ads: Ad[];
  adProgress?: { markerId: string; elapsed: number } | null;
  error?: string | null;
  waveformData: number[];
  onSeek: (t: number) => void;
  onSeekIntoAd?: (markerId: string, elapsed: number) => void;
  // Fires true on scrub start (mousedown on strip or handle) and false on
  // release. The parent uses this to pause underlying playback for the
  // duration of the drag so the video doesn't drift out from under the
  // cursor while the user is still holding, then resume on release if
  // the video was playing before the scrub.
  onScrubbingChange?: (scrubbing: boolean) => void;
  onMarkerMove: (id: string, newTime: number) => void;
  onMarkerDelete?: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const STRIP_H = 108;
export const FRAME_PAD = 4;

// Derived layout for a single ad slot on the combined timeline ruler.
export type AdLayoutItem = {
  m: AdMarker;
  dur: number;
  displayStart: number;
  displayEnd: number;
};

// A contiguous waveform segment between ad blocks.
export type Segment = {
  videoStart: number;
  videoEnd: number;
  displayStart: number;
  displayEnd: number;
};
