import { useState, useEffect, useCallback, useRef } from 'react';
import { executionsApi } from '@/services/api';
import { ExecutionWithImageUrls, ExecutionFilters, UseExecutionsReturn, ExecutionStats, DailySummary, StatsFilters, StatsRanking, ProcessingStage } from '@/types';

export function useExecutions(
  initialFilters: ExecutionFilters = {},
  refreshTrigger?: number
): UseExecutionsReturn {
  const [executions, setExecutions] = useState<ExecutionWithImageUrls[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isFirstMount = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [filters, setFilters] = useState<ExecutionFilters>(initialFilters);

  const fetchExecutions = useCallback(async (
    newFilters: ExecutionFilters = filters,
    reset = true
  ) => {
    if (reset) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const response = await executionsApi.getExecutions({
        ...newFilters,
        page: reset ? 0 : newFilters.page || currentPage,
      });

      if (reset) {
        setExecutions(response.executions);
        setCurrentPage(0);
      } else {
        // Append new executions for pagination, deduplicating in case of overlap
        setExecutions(prev => {
          const existingIds = new Set(prev.map(exec => exec.id));
          const uniqueNewExecutions = response.executions.filter(
            (exec: ExecutionWithImageUrls) => !existingIds.has(exec.id)
          );
          return [...prev, ...uniqueNewExecutions];
        });
        setCurrentPage(prev => prev + 1);
      }

      setHasNext(response.meta?.hasNext || false);
      setTotalResults(response.meta?.total || 0);
      setError(null);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch executions';
      setError(errorMessage);
      
      if (reset) {
        setExecutions([]);
        setHasNext(false);
        setTotalResults(0);
      }
    } finally {
      if (reset) {
        setIsLoading(false);
      }
    }
  }, [filters, currentPage]);

  // Load more executions (pagination)
  const loadMore = useCallback(async () => {
    if (!hasNext || isLoading) return;

    await fetchExecutions({
      ...filters,
      page: currentPage + 1,
    }, false);
  }, [filters, currentPage, hasNext, isLoading, fetchExecutions]);

  // Refresh executions (reload first page)
  const refresh = useCallback(async () => {
    await fetchExecutions(filters, true);
  }, [filters, fetchExecutions]);

  // Update filters and fetch new data
  const updateFilters = useCallback((newFilters: ExecutionFilters) => {
    setFilters(newFilters);
    fetchExecutions(newFilters, true);
  }, [fetchExecutions]);

  // Prepend new executions (for real-time updates)
  const prependExecutions = useCallback((newExecutions: ExecutionWithImageUrls[]) => {
    if (!newExecutions || newExecutions.length === 0) return;

    setExecutions(prev => {
      // Filter out duplicates based on ID
      const existingIds = new Set(prev.map(exec => exec.id));
      const uniqueNewExecutions = newExecutions.filter(exec => !existingIds.has(exec.id));

      if (uniqueNewExecutions.length === 0) return prev;

      console.log(`🆕 Prepending ${uniqueNewExecutions.length} new executions to gallery`);
      return [...uniqueNewExecutions, ...prev];
    });
  }, []);

  // Update execution processing stage (for Stage 2 completion)
  const updateExecutionStage = useCallback((executionId: number, stage: ProcessingStage, additionalData?: any): boolean => {
    let found = false;

    setExecutions(prev => prev.map(exec => {
      if (exec.id !== executionId) return exec;

      found = true;
      const updatedExec = {
        ...exec,
        processingStage: stage,
        ...additionalData
      };

      if (stage === 'stage2' && additionalData) {
        updatedExec.hasSmoke = additionalData.has_smoke ?? exec.hasSmoke;
        updatedExec.alertLevel = additionalData.alert_level ?? exec.alertLevel;
        updatedExec.detectionCount = additionalData.detection_count ?? exec.detectionCount;
        updatedExec.hasImage = additionalData.has_image ?? exec.hasImage;
        updatedExec.telegramSent = additionalData.telegram_sent ?? exec.telegramSent;
      }

      console.log(`🔄 Updated execution ${executionId} to stage ${stage}`);
      return updatedExec;
    }));

    return found;
  }, []);

  // Sync internal filters when external initialFilters change
  const initialFiltersKey = JSON.stringify(initialFilters);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    setFilters(initialFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiltersKey]);

  // Initial fetch and refetch when filters change
  useEffect(() => {
    fetchExecutions(filters, true);
  }, [filters]); // Refetch when filters change

  // Handle external refresh triggers (from SSE updates)
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      console.log('🔄 useExecutions: External refresh trigger activated:', refreshTrigger);
      fetchExecutions(filters, true);
    }
  }, [refreshTrigger, filters, fetchExecutions]);

  return {
    executions,
    isLoading,
    error,
    hasNext,
    loadMore,
    refresh,
    updateFilters,
    filters,
    prependExecutions,
    updateExecutionStage,
    totalResults,
  };
}

// Hook for searching executions
export function useExecutionSearch() {
  const [results, setResults] = useState<ExecutionWithImageUrls[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string, limit?: number) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const searchResults = await executionsApi.searchExecutions(query, limit);
      setResults(searchResults);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Search failed';
      setError(errorMessage);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return {
    results,
    isLoading,
    error,
    search,
    clearResults,
  };
}

// Hook for getting execution statistics
export function useExecutionStats() {
  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const executionStats = await executionsApi.getStats();
      setStats(executionStats);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch statistics';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    error,
    refresh: fetchStats,
  };
}

// Hook for daily summary — accepts either a number (days) or StatsFilters object
export function useDailySummary(params: StatsFilters | number = 30) {
  const [summary, setSummary] = useState<DailySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable key so useCallback only re-runs when params actually change
  const paramsKey = JSON.stringify(params);

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const dailySummary = await executionsApi.getDailySummary(params);
      setSummary(dailySummary);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch daily summary';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return {
    summary,
    isLoading,
    error,
    refresh: fetchSummary,
  };
}

/**
 * Fetch all shots from a specific camera (nodeId+cameraId) around a pivot
 * timestamp, ignoring any gallery filters.  Used by ImageGallery to build
 * the camera-mode navigator so that navigation is never restricted by the
 * active gallery filter.
 *
 * The pivot is the timestamp of the execution the user first opened in camera
 * mode for this camera.  It is intentionally NOT updated on navigation (only
 * on camera identity change) so that we don't re-fetch while the user scrolls
 * through shots.
 */
export function useCameraExecutions(
  nodeId?: string,
  cameraId?: string,
  pivotTimestamp?: string,
) {
  const [executions, setExecutions] = useState<ExecutionWithImageUrls[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!nodeId || !cameraId || !pivotTimestamp) {
      setExecutions([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    // Two parallel fetches centred on the pivot so the selected execution
    // is ALWAYS included regardless of how frequently the camera fires:
    //   before: 100 shots ending at the pivot (newest-first → desc)
    //   after:  100 shots starting at the pivot (oldest-first → asc)
    // We then merge, deduplicate (pivot appears in both), and sort ASC.
    Promise.all([
      executionsApi.getExecutions({
        nodeId, cameraId,
        endDate:   pivotTimestamp,
        sortBy:    'date',
        sortOrder: 'desc',
        limit:     100,
      }),
      executionsApi.getExecutions({
        nodeId, cameraId,
        startDate: pivotTimestamp,
        sortBy:    'date',
        sortOrder: 'asc',
        limit:     100,
      }),
    ])
      .then(([before, after]) => {
        if (cancelled) return;
        const seen = new Set<number>();
        const merged = [...before.executions, ...after.executions]
          .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; })
          .sort((a, b) => new Date(a.executionTimestamp).getTime() - new Date(b.executionTimestamp).getTime());
        setExecutions(merged);
      })
      .catch(() => { if (!cancelled) setExecutions([]); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [nodeId, cameraId, pivotTimestamp]);

  return { executions, isLoading };
}

// Hook for stats ranking (top cameras/locations/nodes)
export function useStatsRanking(startDate: string, endDate: string) {
  const [ranking, setRanking] = useState<StatsRanking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRanking = useCallback(async () => {
    if (!startDate || !endDate) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await executionsApi.getStatsRanking(startDate, endDate);
      setRanking(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch ranking');
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchRanking();
  }, [fetchRanking]);

  return { ranking, isLoading, error };
}