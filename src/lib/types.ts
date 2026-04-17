export type AdType = 'static' | 'auto' | 'ab';

export interface AdMarker {
  id: string;
  type: AdType;
  startTime: number; // seconds
  // Attached ads, in display order. 1 entry for static/auto; 2+ for A/B.
  // Empty means "marker reserved, no ad picked yet".
  adIds: string[];
  label?: string;
}

export interface Rendition {
  resolution: '240p' | '480p' | '720p' | '1080p';
  playlistUrl: string;
  bitrateKbps: number;
  width: number;
  height: number;
}

export type PodcastStatus = 'pending' | 'uploaded' | 'chunking' | 'completed';

export interface Podcast {
  id: string;
  title: string;
  description: string;
  author: string;
  status: PodcastStatus;
  episode?: string;
  date?: string;
  duration?: number; // seconds
  thumbnail?: string;
  videoUrl?: string;
  fullS3Url?: string;
  chunksURL?: string;
  renditions?: Rendition[];
  adMarkers: AdMarker[];
  waveformData?: number[]; // normalized 0-1
}

export interface Ad {
  id: string;
  title: string;
  advertiser: string;
  campaign: string;
  duration: number; // seconds
  thumbnail?: string;
  videoUrl?: string;
  tags: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

// ── Podcast show (a feed/channel) that contains many episodes (Video/Podcast).
// Distinct from the legacy `Podcast` interface above which represents an
// episode in the current mocked UI. Will map to the `Podcast` Prisma model
// when the DB migration lands.
export interface PodcastShow {
  id: string;
  title: string;
  description?: string;
  coverArt?: string;
  initials?: string;
  coverGradient?: string; // tailwind "from-X to-Y" fragment
}
