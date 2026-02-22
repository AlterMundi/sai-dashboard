import { useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ImageGallery } from '@/components/ImageGallery';
import { AlertFilterComponent } from '@/components/AlertFilterComponent';
import { ExportDropdown } from '@/components/ExportDropdown';
import { AdvancedSearchPanel, CompoundSearchCriteria } from '@/components/AdvancedSearchPanel';
import { useDailySummary, useExecutions } from '@/hooks/useExecutions';
import { executionsApi, detectionsApi, DetectionFilterCriteria } from '@/services/api';
import { useSSEHandler } from '@/contexts/SSEContext';
import { ExecutionFilters, ExecutionWithImageUrls, SSEStage2CompletionEvent, SSEStage2FailureEvent } from '@/types';
import toast from 'react-hot-toast';

function parseFiltersFromURL(searchParams: URLSearchParams): ExecutionFilters {
  const filters: ExecutionFilters = {};
  const status = searchParams.get('status');
  if (status === 'success' || status === 'error') filters.status = status;
  const alertLevels = searchParams.get('alertLevels');
  if (alertLevels) filters.alertLevels = alertLevels.split(',') as ExecutionFilters['alertLevels'];
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

  useDailySummary(7);
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
  const onStage2Complete = useCallback(async (data: SSEStage2CompletionEvent) => {
    console.log('🔄 Dashboard: Stage 2 completion received', data);
    if (!data.execution_id) return;

    const wasUpdated = updateExecutionStage(data.execution_id, 'stage2', {
      has_smoke: data.extracted_data?.has_smoke,
      alert_level: data.extracted_data?.alert_level,
      detection_count: data.extracted_data?.detection_count,
      has_image: data.extracted_data?.has_image,
      telegram_sent: data.extracted_data?.telegram_sent,
    });

    if (!wasUpdated && galleryPrependRef.current) {
      console.log(`📥 Dashboard: Execution ${data.execution_id} not in gallery, fetching and prepending`);
      try {
        const execution = await executionsApi.getExecutionById(data.execution_id);
        if (execution) {
          // execution already has imageUrl/thumbnailUrl from the API's transformExecution
          galleryPrependRef.current([{ ...execution, processingStage: 'stage2' } as ExecutionWithImageUrls]);
        }
      } catch (fetchError) {
        console.warn(`Failed to fetch execution ${data.execution_id} after Stage 2 completion`, fetchError);
      }
    }
  }, [updateExecutionStage, galleryPrependRef]);

  // Handle Stage 2 ETL failure
  const onStage2Failure = useCallback((data: SSEStage2FailureEvent) => {
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
    setAdvancedSearchActive(false);
  }, [setSearchParams]);

  // Advanced search state
  const [advancedSearchActive, setAdvancedSearchActive] = useState(false);
  const [advancedSearchLoading, setAdvancedSearchLoading] = useState(false);

  // Convert compound criteria to detection filter criteria
  const handleAdvancedSearch = useCallback(async (criteria: CompoundSearchCriteria) => {
    setAdvancedSearchLoading(true);
    try {
      // Convert compound criteria to DetectionFilterCriteria
      const detectionCriteria: DetectionFilterCriteria = {};

      for (const condition of criteria.conditions) {
        switch (condition.field) {
          case 'class':
            if (!detectionCriteria.hasClass) detectionCriteria.hasClass = [];
            if (Array.isArray(condition.value)) {
              detectionCriteria.hasClass.push(...condition.value);
            } else {
              detectionCriteria.hasClass.push(String(condition.value));
            }
            break;
          case 'confidence':
            if (condition.operator === 'greaterThan') {
              detectionCriteria.minConfidence = Number(condition.value);
            } else if (condition.operator === 'lessThan') {
              detectionCriteria.maxConfidence = Number(condition.value);
            } else if (condition.operator === 'between') {
              detectionCriteria.minConfidence = Number(condition.value);
              detectionCriteria.maxConfidence = condition.secondValue;
            }
            break;
          case 'detectionCount':
            if (condition.operator === 'greaterThan' || condition.operator === 'equals') {
              detectionCriteria.minDetections = Number(condition.value);
            }
            if (condition.operator === 'lessThan') {
              detectionCriteria.maxDetections = Number(condition.value);
            }
            break;
          case 'position':
            detectionCriteria.position = condition.value as DetectionFilterCriteria['position'];
            break;
          case 'hasSmoke':
            setFilters({ ...filters, hasSmoke: condition.value === true });
            break;
          case 'alertLevel':
            setFilters({ ...filters, alertLevels: [condition.value as 'none' | 'low' | 'medium' | 'high' | 'critical'] });
            break;
        }
      }

      // If we have detection-specific criteria, use the advanced API
      if (detectionCriteria.hasClass || detectionCriteria.minConfidence !== undefined ||
          detectionCriteria.position || detectionCriteria.minDetections !== undefined) {
        const results = await detectionsApi.search(detectionCriteria, 100);
        toast.success(`Found ${results.length} matching executions`);

        // Update filters to show these specific execution IDs (if supported)
        // For now, we'll just trigger a refresh with the smoke filter
        if (detectionCriteria.hasClass?.includes('smoke')) {
          setFilters({ ...filters, hasSmoke: true });
        }
      }

      setAdvancedSearchActive(true);
    } catch (error) {
      toast.error('Advanced search failed');
      console.error('Advanced search error:', error);
    } finally {
      setAdvancedSearchLoading(false);
    }
  }, [filters, setFilters]);

  const handleClearAdvancedSearch = useCallback(() => {
    setAdvancedSearchActive(false);
    clearAllFilters();
  }, [clearAllFilters]);

  return (
    <Layout>
      <div className="space-y-8">
        {/* Filters and Export */}
        <div className="space-y-4">
          <AlertFilterComponent
            filters={filters}
            onFiltersChange={setFilters}
            onReset={clearAllFilters}
            totalResults={totalResults}
            isLoading={false}
          />

          {/* Advanced Search Panel */}
          <AdvancedSearchPanel
            onSearch={handleAdvancedSearch}
            onClear={handleClearAdvancedSearch}
            isLoading={advancedSearchLoading}
            headerRight={<ExportDropdown filters={filters} totalResults={totalResults} />}
          />

          {advancedSearchActive && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              <span>Advanced search active</span>
              <button
                onClick={handleClearAdvancedSearch}
                className="text-blue-600 hover:text-blue-800 underline"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Main Gallery */}
        <ImageGallery
          initialFilters={filters}
          refreshTrigger={batchUpdateTrigger}
          onPrependRegister={(prependFn) => { galleryPrependRef.current = prependFn; }}
        />
      </div>
    </Layout>
  );
}
