'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { PodcastShow } from '@/lib/types';

// Payload accepted by createPodcast. All fields optional except title.
export interface CreatePodcastInput {
  title: string;
  description?: string;
  initials?: string;
  coverGradient?: string;
  coverArt?: string;
}

interface AppContextValue {
  podcasts: PodcastShow[];
  loading: boolean;
  error: string | null;

  currentPodcastId: string | null;
  currentPodcast: PodcastShow | null;
  setCurrentPodcastId: (id: string | null) => void;

  refresh: () => Promise<void>;
  createPodcast: (input: CreatePodcastInput) => Promise<PodcastShow>;

  // Convenience wrapper — native `fetch` with `X-Podcast-Id` auto-attached.
  apiFetch: typeof fetch;
}

const AppContext = createContext<AppContextValue | null>(null);

const STORAGE_KEY = 'vp.currentPodcastId';

export function AppProvider({ children }: { children: ReactNode }) {
  const [podcasts, setPodcasts] = useState<PodcastShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPodcastId, setCurrentPodcastIdState] = useState<string | null>(null);

  // Read last selection from localStorage once on mount. Avoided in initial
  // state so SSR and hydration match.
  const [initialPreferredId, setInitialPreferredId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setInitialPreferredId(window.localStorage.getItem(STORAGE_KEY));
    }
  }, []);

  const fetchPodcasts = useCallback(async () => {
    try {
      const res = await fetch('/api/me/podcasts', { cache: 'no-store' });
      if (res.status === 401) {
        // Not signed in — context renders nothing useful, just stay empty.
        setPodcasts([]);
        setError(null);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`GET /api/me/podcasts failed: ${res.status}`);
      const data = (await res.json()) as PodcastShow[];
      setPodcasts(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load podcasts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPodcasts();
  }, [fetchPodcasts]);

  // Reconcile the selected id whenever the list changes or the preferred id
  // arrives from localStorage.
  useEffect(() => {
    if (loading) return;
    if (!podcasts.length) {
      setCurrentPodcastIdState(null);
      return;
    }
    const preferred =
      currentPodcastId ??
      (initialPreferredId && podcasts.some((p) => p.id === initialPreferredId)
        ? initialPreferredId
        : null);
    if (preferred && podcasts.some((p) => p.id === preferred)) {
      setCurrentPodcastIdState(preferred);
    } else {
      setCurrentPodcastIdState(podcasts[0].id);
    }
  }, [podcasts, loading, initialPreferredId, currentPodcastId]);

  const setCurrentPodcastId = useCallback((id: string | null) => {
    setCurrentPodcastIdState(id);
    if (typeof window !== 'undefined') {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const createPodcast = useCallback(
    async (input: CreatePodcastInput): Promise<PodcastShow> => {
      const res = await fetch('/api/me/podcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data as { error?: string } | null)?.error ?? 'Failed to create podcast');
      }
      const created = data as PodcastShow;
      setPodcasts((prev) => [...prev, created]);
      setCurrentPodcastId(created.id);
      return created;
    },
    [setCurrentPodcastId],
  );

  const currentPodcast = useMemo(
    () => podcasts.find((p) => p.id === currentPodcastId) ?? null,
    [podcasts, currentPodcastId],
  );

  const apiFetch = useCallback<typeof fetch>(
    (input, init) => {
      const headers = new Headers(init?.headers);
      if (currentPodcastId) headers.set('X-Podcast-Id', currentPodcastId);
      return fetch(input, { ...init, headers });
    },
    [currentPodcastId],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      podcasts,
      loading,
      error,
      currentPodcastId,
      currentPodcast,
      setCurrentPodcastId,
      refresh: fetchPodcasts,
      createPodcast,
      apiFetch,
    }),
    [
      podcasts,
      loading,
      error,
      currentPodcastId,
      currentPodcast,
      setCurrentPodcastId,
      fetchPodcasts,
      createPodcast,
      apiFetch,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
