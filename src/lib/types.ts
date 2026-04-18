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
  isPublicAd?: boolean; // platform-provided ad vs user-uploaded
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface TranscriptWord {
  text: string;   // word token (may include trailing punctuation)
  start: number;  // seconds from video start
  end: number;    // seconds
  conf: number;   // confidence 0..1
}

export interface Transcript {
  text: string;              // concatenated readable transcript
  words: TranscriptWord[];
}

// ── DTOs shared between API routes, the dashboard, ads editor, and watch page.
// `VideoListDto` mirrors /api/videos (lightweight row) and `VideoDetailDto`
// mirrors /api/videos/[id] (full payload used by editor + player).
export interface VideoListDto {
  id: string;
  title: string;
  description: string;
  author: string;
  status: string;
  episode: string | null;
  duration: number;
  thumbnail: string | null;
  chunksURL: string | null;
  createdAt: string;
  publishedAt: string | null;
  adMarkerCount: number;
}

export interface VideoDetailDto {
  id: string;
  title: string;
  description: string;
  author: string;
  episode: string | null;
  status: string;
  duration: number;
  thumbnail: string | null;
  fullS3Url: string | null;
  chunksURL: string | null;
  playbackUrl: string | null;
  waveformData: number[];
  transcript: Transcript | null;
  adMarkers: AdMarker[];
  createdAt: string;
  publishedAt: string | null;
  podcastId: string;
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
