'use client';

import { useEffect, useState } from 'react';
import { Ad } from '@/lib/types';

// Module-level cache shared across every consumer so we only hit /api/ads once
// per page load. A single in-flight promise dedupes concurrent mounts.
let cached: Ad[] | null = null;
let inflight: Promise<Ad[]> | null = null;

async function loadAds(): Promise<Ad[]> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch('/api/ads')
    .then((r) => {
      if (!r.ok) throw new Error(`GET /api/ads failed: ${r.status}`);
      return r.json() as Promise<Ad[]>;
    })
    .then((data) => {
      cached = data;
      inflight = null;
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
    if (cached) return;
    let alive = true;
    loadAds()
      .then((data) => {
        if (alive) {
          setAds(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return { ads, loading, error };
}
