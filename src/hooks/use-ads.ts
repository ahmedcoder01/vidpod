'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ad } from '@/lib/types';

// Module-level cache shared across every consumer so we only hit /api/ads once
// per page load. A single in-flight promise dedupes concurrent mounts.
let cached: Ad[] | null = null;
let inflight: Promise<Ad[]> | null = null;
// Pub/sub so `refresh()` called in one component updates every useAds() site
// on the page at once — avoids stale lists in a separate modal.
const subs = new Set<(data: Ad[]) => void>();

function broadcast(data: Ad[]) {
  for (const fn of subs) fn(data);
}

async function loadAds(force = false): Promise<Ad[]> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = fetch('/api/ads', { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(`GET /api/ads failed: ${r.status}`);
      return r.json() as Promise<Ad[]>;
    })
    .then((data) => {
      cached = data;
      inflight = null;
      broadcast(data);
      return data;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

export function useAds() {
  const [ads, setAds] = useState<Ad[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    const sub = (data: Ad[]) => { if (alive) setAds(data); };
    subs.add(sub);

    if (!cached) {
      loadAds()
        .then((data) => {
          if (!alive) return;
          setAds(data);
          setLoading(false);
        })
        .catch((err) => {
          if (!alive) return;
          setError(err);
          setLoading(false);
        });
    }

    return () => {
      alive = false;
      subs.delete(sub);
    };
  }, []);

  // Force a re-fetch. Resolves with the fresh list so callers can chain
  // (e.g. select the just-uploaded ad after upload-complete).
  const refresh = useCallback(async (): Promise<Ad[]> => {
    setLoading(true);
    try {
      const data = await loadAds(true);
      setError(null);
      setLoading(false);
      return data;
    } catch (err) {
      setError(err as Error);
      setLoading(false);
      throw err;
    }
  }, []);

  return { ads, loading, error, refresh };
}
