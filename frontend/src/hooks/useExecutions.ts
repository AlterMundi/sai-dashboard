import { useState, useEffect, useCallback } from 'react';
import { executionsApi } from '@/services/api';
import { ExecutionWithImage, ExecutionFilters, UseExecutionsReturn, ExecutionStats, DailySummary, AnalysisStatus, AnalysisAlert } from '@/types';

export function useExecutions(
  initialFilters: ExecutionFilters = {},
  refreshTrigger?: number
): UseExecutionsReturn {
  const [executions, setExecutions] = useState<ExecutionWithImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [filters, setFilters] = useState<ExecutionFilters>(initialFilters);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [alerts, setAlerts] = useState<AnalysisAlert[]>([]);

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
        // Append new executions for pagination
        setExecutions(prev => [...prev, ...response.executions]);
        setCurrentPage(prev => prev + 1);
      }

      setHasNext(response.meta?.hasNext || false);
      setAnalysisStatus(response.meta?.analysisStatus || null);
      setAlerts(response.alerts || []);
      setError(null);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch executions';
      setError(errorMessage);
      
      if (reset) {
        setExecutions([]);
        setHasNext(false);
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
  const prependExecutions = useCallback((newExecutions: ExecutionWithImage[]) => {
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

  // Trigger analysis function
  const triggerAnalysis = useCallback(async () => {
    await executionsApi.triggerAnalysis();
    // Refresh executions after triggering to get updated status
    await fetchExecutions(filters, true);
  }, [filters, fetchExecutions]);

  // Initial fetch
  useEffect(() => {
    fetchExecutions(filters, true);
  }, []); // Only run on mount

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
    analysisStatus,
    alerts,
    triggerAnalysis,
    prependExecutions,
  };
}

// Hook for searching executions
export function useExecutionSearch() {
  const [results, setResults] = useState<ExecutionWithImage[]>([]);
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

// Hook for daily summary
export function useDailySummary(days = 30) {
  const [summary, setSummary] = useState<DailySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const dailySummary = await executionsApi.getDailySummary(days);
      setSummary(dailySummary);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch daily summary';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

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