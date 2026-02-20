import { useState, useEffect, useCallback, useRef } from 'react';
import { executionsApi } from '@/services/api';
import { FilterOptions } from '@/types';

const EMPTY: FilterOptions = {
  cameraId: [],
  location: [],
  nodeId: [],
  deviceId: [],
  yoloModelVersion: [],
};

// Module-level singleton so all hook instances share state
let cachedOptions: FilterOptions | null = null;
let fetchPromise: Promise<FilterOptions> | null = null;

async function doFetch(): Promise<FilterOptions> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = executionsApi.getFilterOptions().then((opts) => {
    cachedOptions = opts;
    fetchPromise = null;
    return opts;
  }).catch((err) => {
    fetchPromise = null;
    throw err;
  });
  return fetchPromise;
}

export function useFilterOptions() {
  const [options, setOptions]   = useState<FilterOptions>(cachedOptions ?? EMPTY);
  const [isLoading, setLoading] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const fetchOptions = useCallback(async (force = false) => {
    if (cachedOptions && !force) {
      setOptions(cachedOptions);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const opts = await doFetch();
      if (mounted.current) setOptions(opts);
    } catch (e: unknown) {
      if (mounted.current) {
        const msg = e instanceof Error ? e.message : 'Failed to load filter options';
        setError(msg);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // Idle prefetch on mount — fires after first paint if not already cached
  useEffect(() => {
    if (cachedOptions) return;
    const id = requestIdleCallback(() => fetchOptions(), { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }, [fetchOptions]);

  return {
    options,
    isLoading,
    error,
    triggerFetch: () => fetchOptions(),
    refresh: () => { cachedOptions = null; fetchOptions(true); },
  };
}
