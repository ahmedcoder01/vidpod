import { useState, useCallback } from 'react';
import { AdMarker } from '@/lib/types';

export function useHistory(initial: AdMarker[]) {
  const [past, setPast] = useState<AdMarker[][]>([]);
  const [present, setPresent] = useState<AdMarker[]>(initial);
  const [future, setFuture] = useState<AdMarker[][]>([]);

  const push = useCallback((next: AdMarker[]) => {
    setPast((p) => [...p, present]);
    setPresent(next);
    setFuture([]);
  }, [present]);

  const undo = useCallback(() => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [present, ...f]);
    setPresent(prev);
  }, [past, present]);

  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, present]);
    setPresent(next);
  }, [future, present]);

  const reset = useCallback((markers: AdMarker[]) => {
    setPast([]);
    setPresent(markers);
    setFuture([]);
  }, []);

  return {
    markers: present,
    push,
    undo,
    redo,
    reset,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
