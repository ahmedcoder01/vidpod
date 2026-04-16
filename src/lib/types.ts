export type AdType = 'static' | 'auto' | 'ab';

export interface AdMarker {
  id: string;
  type: AdType;
  startTime: number; // seconds
  assetUrl?: string;
  assetUrls?: string[]; // for A/B
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
