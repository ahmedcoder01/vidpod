import { Ad, AdMarker, Podcast, User } from './types';

export const mockUser: User = {
  id: 'u1',
  name: 'Emma Warren',
  email: 'emma@thediary.com',
};

// Generate waveform data
function genWaveform(points: number): number[] {
  const data: number[] = [];
  for (let i = 0; i < points; i++) {
    const base = 0.3 + Math.random() * 0.4;
    const spike = Math.random() > 0.85 ? Math.random() * 0.3 : 0;
    data.push(Math.min(1, base + spike));
  }
  return data;
}

export const mockAds: Ad[] = [
  {
    id: 'ad1',
    title: 'Eight Sleep Got Part 2 - v1',
    advertiser: 'Demo Lagnoff',
    campaign: 'Fight Sleep',
    duration: 30,
    thumbnail: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=160&h=90&fit=crop',
    tags: ['Fight Sleep', 'Part 1'],
  },
  {
    id: 'ad2',
    title: 'Eight Sleep Got Part 2 - v2',
    advertiser: 'Demo Lagnoff',
    campaign: 'Fight Sleep',
    duration: 30,
    thumbnail: 'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=160&h=90&fit=crop',
    tags: ['Fight Sleep', 'Part 1'],
  },
  {
    id: 'ad3',
    title: 'Brilliant (Hateful & gracious)',
    advertiser: 'Brilliant',
    campaign: 'Miracle Campaign',
    duration: 45,
    thumbnail: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=160&h=90&fit=crop',
    tags: ['G1 Prime', 'Recommended ad'],
  },
  {
    id: 'ad4',
    title: 'Athletic Greens - Morning Routine',
    advertiser: 'AG1',
    campaign: 'Miracle Campaign',
    duration: 60,
    thumbnail: 'https://images.unsplash.com/photo-1622484211751-4b82b2240caf?w=160&h=90&fit=crop',
    tags: ['Pro 3'],
  },
  {
    id: 'ad5',
    title: 'Huel Daily Nutrition',
    advertiser: 'Huel',
    campaign: 'Mikaplan',
    duration: 30,
    thumbnail: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=160&h=90&fit=crop',
    tags: ['Mikaplan'],
  },
];

const STEVEN_VIDEO_URL =
  'https://vidpod-demo.s3.us-east-2.amazonaws.com/YTDown.com_YouTube_Meet-Steven-Bartlett-The-College-Dropout_Media_gCS0-1YhmPw_001_1080p.mp4?response-content-disposition=inline&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEPz%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMiJHMEUCIQCqXgRHguP78846Rqzqjf0RSg8tt%2FgLbFuZpkoTt7uOMAIgDpduYhDSYBCYldZ0WnnFShYpKUYdlxirzEM8%2BfcnI78qvgMIxf%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARAAGgwxNDc3MjMwMzY3MTIiDAIqdGS4MM8tjC8zYyqSA90LNL0HGKIwNWvMrORfdGf98%2Fs37Gf7mYsCtRQdB187B2Daba6HPgHeueFlqoXravSeSAJJ33Ox%2FP0FECzq3dEzHsagO8lqAcrF64f0JSEv6vy%2FOydppf0Fyj2DOCUUUqM6xJhfjbJjwYke90KoSTOA0b39aEi04xYTE5k4nxw6xYWs6E9YlkIKKXzcRe8D1Y9JzMfmqeJHKAczF5Hj3KnK%2F%2FE6uxauxvBoD0GUc1KJlv0wYFsgIAC48rl%2F%2BphgdZZbTIGNWKgX2SbnMhF99PcEhopN21pAlDv3N9a7ZDKD28vdh%2BD15SNnesdwWKNFB26h5W7OveM5xktlkznmxXRezToMDUvM3BWlw0NQXtaaZsgvcgIDxd%2BTl6UPNcdokoGCMH%2FzEYdy0S3lqFDqhuFUvtJyePaifxjqAorBl3gpWfvFmyK%2FdY8gXtmnB%2BqCT%2B0f6nHjoOFkdQRUwOrPt2nf4i4xDHNCPr%2BOxzoWayNIiD2Zr6oEtgElMUwD8s4F20Kvdt1SnvQXhbau8xufLysbizCzgYXPBjreAvGqalUvalluQ9OHlP86vkDQ3vtzJWH%2FwwlRsarbVYUCARMnFQ3bLLnnz6lpIyM1%2Ftmu6Bp6JXZzX49AtIi82kCgqBVEGQkvURyVNh77HCuQ93WxpnJqGG%2FGv2oFO1ayvjJe8DlnMtMWiBEh0z4RlEb580pdhnqi8sJakD9B63z68bVvlfGun6HD1%2FKf60jv9DjXdQdSOfnEruo7LUzYLLYTFe8w5iVxL5O%2FAqpf6tQNJTBfUyv6MEHhsoFSpPFX8F1gQr2%2Fr%2ByskyvTY0YhfGSagxQIGCSEqtMUudGDKJpLJZE3vtgdZFbbXPCn%2BtzOHlWKgCUWn1tSpueZdvlxQmxKoVtInrZElv4FpIuN0c7OmWr8myV7QO0m82LMeq%2FSwELzzVPcA%2BfxKlFUgiaREqVV%2FeWjhGIzpSTNfvb9pV93UwMBeZ%2FpEJSiXzoMxjPGHzzW%2By4%2FDh8DVIyo7o85&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIASEZH2VAUHQOBBOC5%2F20260416%2Fus-east-2%2Fs3%2Faws4_request&X-Amz-Date=20260416T201156Z&X-Amz-Expires=43200&X-Amz-SignedHeaders=host&X-Amz-Signature=fda7726c3671aec0e67b76d179ad4aa6dfb194b618840776abf13d057a150663';

export const mockPodcasts: Podcast[] = [
  {
    id: 'p1',
    title: 'Meet Steven Bartlett: The College Dropout Who Built A Podcast Empire (Diary Of A CEO Origin Story)',
    description: 'The origin story of how a college dropout became one of the most successful podcast creators in the world.',
    author: 'The Diary Of A CEO',
    status: 'completed',
    episode: 'S1:E1',
    date: '16 April 2026',
    duration: 0,
    thumbnail: '',
    videoUrl: STEVEN_VIDEO_URL,
    adMarkers: [],
    waveformData: genWaveform(500),
  },
];

export const adCampaigns = ['All Videos', 'Fight Sleep', 'Pro 3', 'G1 Prime', 'Miracle Campaign', 'Brilliant', 'Mikaplan'];
