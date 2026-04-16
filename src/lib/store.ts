// In-memory store for Phase 1 mock backend
import { Podcast } from './types';
import { mockPodcasts } from './mock-data';

// Shared singleton for dev environment
const globalStore = global as typeof global & { podcasts?: Podcast[] };

if (!globalStore.podcasts) {
  globalStore.podcasts = JSON.parse(JSON.stringify(mockPodcasts));
}

export const store = {
  getPodcasts: (): Podcast[] => globalStore.podcasts!,
  getPodcast: (id: string): Podcast | undefined =>
    globalStore.podcasts!.find((p) => p.id === id),
  updatePodcast: (id: string, data: Partial<Podcast>): Podcast | null => {
    const idx = globalStore.podcasts!.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    globalStore.podcasts![idx] = { ...globalStore.podcasts![idx], ...data };
    return globalStore.podcasts![idx];
  },
  addPodcast: (podcast: Podcast): Podcast => {
    globalStore.podcasts!.push(podcast);
    return podcast;
  },
};
