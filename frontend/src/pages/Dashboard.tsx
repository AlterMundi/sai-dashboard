import { useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ImageGallery } from '@/components/ImageGallery';
import { AlertFilterComponent } from '@/components/AlertFilterComponent';
import { LoadingState } from '@/components/ui/LoadingSpinner';
import { LiveStatsCard, SystemHealthIndicator } from '@/components/LiveStatsCard';
import { useExecutionStats, useDailySummary, useExecutions } from '@/hooks/useExecutions';
import { executionsApi } from '@/services/api';
import { useSSEHandler, useSSE } from '@/contexts/SSEContext';
import { ExecutionFilters } from '@/types';
import { formatPercentage } from '@/utils';
import {
  Activity,
  CheckCircle,
  Users,
  Timer,
} from 'lucide-react';

function parseFiltersFromURL(searchParams: URLSearchParams): ExecutionFilters {
  const filters: ExecutionFilters = {};
  const status = searchParams.get('status');
  if (status === 'success' || status === 'error') filters.status = status;
  const alertLevels = searchParams.get('alertLevels');
  if (alertLevels) filters.alertLevels = alertLevels.split(',') as ExecutionFilters['alertLevels'];
  const hasFire = searchParams.get('hasFire');
  if (hasFire !== null) filters.hasFire = hasFire === 'true';
  const hasSmoke = searchParams.get('hasSmoke');
  if (hasSmoke !== null) filters.hasSmoke = hasSmoke === 'true';
  const search = searchParams.get('search');
  if (search) filters.search = search;
  const datePreset = searchParams.get('datePreset');
  if (datePreset) filters.datePreset = datePreset as ExecutionFilters['datePreset'];
  const sortBy = searchParams.get('sortBy');
  if (sortBy) filters.sortBy = sortBy as ExecutionFilters['sortBy'];
  const sortOrder = searchParams.get('sortOrder');
  if (sortOrder === 'asc' || sortOrder === 'desc') filters.sortOrder = sortOrder;
  return filters;
}

function filtersToSearchParams(filters: ExecutionFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.alertLevels?.length) params.set('alertLevels', filters.alertLevels.join(','));
  if (filters.hasFire !== undefined) params.set('hasFire', String(filters.hasFire));
  if (filters.hasSmoke !== undefined) params.set('hasSmoke', String(filters.hasSmoke));
  if (filters.search) params.set('search', filters.search);
  if (filters.datePreset) params.set('datePreset', filters.datePreset);
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);
  return params;
}

export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFiltersState] = useState<ExecutionFilters>(() => parseFiltersFromURL(searchParams));

  const setFilters = useCallback((newFilters: ExecutionFilters) => {
    setFiltersState(newFilters);
    setSearchParams(filtersToSearchParams(newFilters), { replace: true });
  }, [setSearchParams]);

  const [batchUpdateTrigger, setBatchUpdateTrigger] = useState(0);
  const galleryPrependRef = useRef<((executions: any[]) => void) | null>(null);

  const { stats, isLoading: statsLoading, error: statsError } = useExecutionStats();
  useDailySummary(7);
  const { isConnected, systemHealth, lastEvent } = useSSE();

  const {
    updateExecutionStage,
    totalResults,
  } = useExecutions(filters, batchUpdateTrigger);

  // Handle real-time updates via SSE
  const onExecutionBatch = useCallback(async (batchData: any) => {
    console.log('📦 Dashboard: Batch update received', batchData);

    if (galleryPrependRef.current) {
      try {
        const response = await executionsApi.getExecutions({
          ...filters,
          page: 0,
          limit: Math.min(batchData.count || 10, 20)
        });

        console.log(`📥 Dashboard: Prepending ${response.executions.length} new executions to gallery`);
        galleryPrependRef.current(response.executions);
      } catch (error) {
        console.warn('Failed to fetch new executions for prepending, falling back to refresh trigger', error);
        setBatchUpdateTrigger(prev => prev + 1);
      }
    } else {
      setBatchUpdateTrigger(prev => prev + 1);
    }
  }, [filters]);

  // Handle Stage 2 ETL completion
  const onStage2Complete = useCallback((data: any) => {
    console.log('🔄 Dashboard: Stage 2 completion received', data);

    // Update the specific execution with new Stage 2 data
    if (updateExecutionStage && data.execution_id) {
      updateExecutionStage(data.execution_id, 'stage2', {
        has_fire: data.extracted?.has_fire,
        has_smoke: data.extracted?.has_smoke,
        alert_level: data.extracted?.alert_level,
        detection_count: data.extracted?.detection_count,
        has_image: data.extracted?.has_image,
        telegram_sent: data.extracted?.telegram_sent,
      });
    }
  }, [updateExecutionStage]);

  // Handle Stage 2 ETL failure
  const onStage2Failure = useCallback((data: any) => {
    console.log('❌ Dashboard: Stage 2 failure received', data);

    // Update the execution to mark it as failed
    if (updateExecutionStage && data.execution_id) {
      updateExecutionStage(data.execution_id, 'failed', {
        stage2Error: data.error,
        retryCount: data.retry_count,
      });
    }
  }, [updateExecutionStage]);

  useSSEHandler({
    onExecutionBatch,
    onStage2Complete,
    onStage2Failure,
  });

  const clearAllFilters = useCallback(() => {
    setFiltersState({});
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  return (
    <Layout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="mt-2 text-gray-600">
              Real-time fire and smoke detection monitoring
            </p>
          </div>

          {/* Real-time Status */}
          <div className="mt-4 sm:mt-0 flex items-center space-x-3">
            {systemHealth && <SystemHealthIndicator />}

            {isConnected && (
              <div className="flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                <div className="h-2 w-2 bg-green-600 rounded-full mr-2 animate-pulse" />
                Live Updates
              </div>
            )}
          </div>
        </div>

        {/* Statistics Cards */}
        <LoadingState isLoading={statsLoading} error={statsError}>
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <LiveStatsCard
                title="Total Executions"
                icon={<Activity className="h-6 w-6" />}
                statKey="totalExecutions"
                initialValue={stats.totalExecutions}
                format={(v) => v.toLocaleString()}
              />

              <LiveStatsCard
                title="Success Rate"
                icon={<CheckCircle className="h-6 w-6" />}
                statKey="successRate"
                initialValue={stats.successRate}
                format={(v) => formatPercentage(v)}
              />

              <LiveStatsCard
                title="Queue Size"
                icon={<Users className="h-6 w-6" />}
                statKey="queueSize"
                initialValue={0}
                format={(v) => `${v} pending`}
              />

              <LiveStatsCard
                title="Avg Processing"
                icon={<Timer className="h-6 w-6" />}
                statKey="avgProcessingTime"
                initialValue={stats.avgProcessingTime || 0}
                format={(v) => `${v.toFixed(1)}s`}
              />
            </div>
          )}
        </LoadingState>

        {/* New Alert Filter Component */}
        <AlertFilterComponent
          filters={filters}
          onFiltersChange={setFilters}
          onReset={clearAllFilters}
          totalResults={totalResults}
          currentPage={1}
          totalPages={Math.ceil(totalResults / 50)}
          pageSize={50}
          lastUpdateTime={lastEvent?.timestamp ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: 'numeric', second: 'numeric' }).format(lastEvent.timestamp) : 'waiting\u2026'}
          isLoading={false}
        />

        {/* Main Gallery */}
        <ImageGallery
          initialFilters={filters}
          refreshTrigger={batchUpdateTrigger}
          onPrependRegister={(prependFn) => { galleryPrependRef.current = prependFn; }}
          onStage2Complete={onStage2Complete}
          onStage2Failure={onStage2Failure}
        />
      </div>
    </Layout>
  );
}
