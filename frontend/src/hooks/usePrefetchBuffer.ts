import { useRef, useCallback, useEffect, useReducer } from 'react';
import { tokenManager } from '@/services/api';

interface PrefetchEntry {
  blobUrl: string | null;
  loading: boolean;
  error: boolean;
  abort: AbortController;
}

/**
 * Circular image prefetch buffer.
 *
 * Manages a sliding window of pre-fetched blob URLs keyed by execution ID.
 * Only triggers a re-render on the owning component when the *current*
 * execution's image loads — background prefetches are silent.
 *
 * Memory bound: bufferAhead + bufferBehind + 1 blob URLs at a time.
 */
export function usePrefetchBuffer(getImageUrl: (id: number) => string) {
  const cache = useRef<Map<number, PrefetchEntry>>(new Map());
  const currentId = useRef<number | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const fetchOne = useCallback((id: number) => {
    if (cache.current.has(id)) return; // already in-flight or loaded
    const abort = new AbortController();
    cache.current.set(id, { blobUrl: null, loading: true, error: false, abort });

    (async () => {
      try {
        const token = tokenManager.get();
        if (!token) throw new Error('No token');

        const res = await fetch(getImageUrl(id), {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);

        // Pre-decode so the browser has layout dimensions ready immediately.
        const img = new Image();
        img.src = objectUrl;
        await img.decode().catch(() => { /* non-fatal */ });

        if (abort.signal.aborted) { URL.revokeObjectURL(objectUrl); return; }

        // Atomically replace any previous blobUrl for this id.
        const prev = cache.current.get(id);
        if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
        cache.current.set(id, { blobUrl: objectUrl, loading: false, error: false, abort });

        if (currentId.current === id) bump();
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const prev = cache.current.get(id);
        cache.current.set(id, {
          blobUrl: null,
          loading: false,
          error: true,
          abort: prev?.abort ?? new AbortController(),
        });
        if (currentId.current === id) bump();
      }
    })();
  }, [getImageUrl]);

  /**
   * Update the prefetch window. Evicts entries outside `ids`, starts fetching
   * any missing ones. Pass an empty array to clear everything (e.g., on close).
   */
  const prefetch = useCallback((ids: number[]) => {
    const desired = new Set(ids);
    // Evict
    for (const [id, entry] of cache.current) {
      if (!desired.has(id)) {
        entry.abort.abort();
        if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
        cache.current.delete(id);
      }
    }
    // Fetch missing
    for (const id of ids) fetchOne(id);
  }, [fetchOne]);

  /**
   * Declare which execution is currently on screen.
   * If its image is already loaded, forces a re-render so the component
   * picks up the cached result immediately. Otherwise bump() will fire
   * when the fetch completes.
   */
  const setCurrent = useCallback((id: number) => {
    currentId.current = id;
    const entry = cache.current.get(id);
    if (entry && !entry.loading) bump();
  }, []);

  /** Read the current entry for a given id. */
  const getEntry = useCallback((id: number) => {
    const e = cache.current.get(id);
    return e
      ? { blobUrl: e.blobUrl, loading: e.loading, error: e.error }
      : { blobUrl: null, loading: true, error: false };
  }, []);

  // Full cleanup on unmount.
  useEffect(() => () => {
    for (const entry of cache.current.values()) {
      entry.abort.abort();
      if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl);
    }
    cache.current.clear();
  }, []);

  return { prefetch, setCurrent, getEntry };
}
