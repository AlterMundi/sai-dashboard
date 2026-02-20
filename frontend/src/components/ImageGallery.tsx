import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useInView } from 'react-intersection-observer';
import toast from 'react-hot-toast';
import { ImageCard } from './ImageCard';
import { ExecutionListItem } from './ExecutionListItem';
import { BatchActionBar } from './BatchActionBar';
import { ImageModal } from './ImageModal';
import { LoadingSpinner, LoadingState } from './ui/LoadingSpinner';
import { useExecutions } from '@/hooks/useExecutions';
import { executionsApi, tokenManager } from '@/services/api';
import { ExecutionWithImageUrls, ExecutionFilters } from '@/types';
import { cn } from '@/utils';
import { useTranslation } from '@/contexts/LanguageContext';
import { Grid, List, RefreshCw, ArrowUp } from 'lucide-react';

interface ImageGalleryProps {
  initialFilters?: ExecutionFilters;
  className?: string;
  refreshTrigger?: number;
  onPrependRegister?: (prependFn: (executions: ExecutionWithImageUrls[]) => void) => void;
}

export function ImageGallery({ initialFilters = {}, className, refreshTrigger, onPrependRegister }: ImageGalleryProps) {
  const { t } = useTranslation();
  const [selectedExecution, setSelectedExecution] = useState<ExecutionWithImageUrls | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const galleryRef = useRef<HTMLDivElement>(null);
  
  const {
    executions,
    isLoading,
    error,
    hasNext,
    loadMore,
    refresh,
    updateFilters,
    filters,
    prependExecutions,
  } = useExecutions(initialFilters, refreshTrigger);

  // Intersection observer for infinite scroll
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0.1,
    rootMargin: '100px 0px',
  });

  // Load more when scrolling into view
  useEffect(() => {
    if (inView && hasNext && !isLoading) {
      loadMore();
    }
  }, [inView, hasNext, isLoading, loadMore]);

  // Track scroll position for "back to top" button
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 500);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Register prepend function with parent for batch updates
  useEffect(() => {
    if (onPrependRegister && prependExecutions) {
      onPrependRegister(prependExecutions);
    }
  }, [onPrependRegister, prependExecutions]);

  // Memoize serialized filters to avoid unnecessary effect triggers
  const initialFiltersJson = useMemo(() => JSON.stringify(initialFilters), [initialFilters]);
  const currentFiltersRef = useRef<string>('');

  // Watch for external filter changes from Dashboard
  useEffect(() => {
    // Only update if filters actually changed (deep comparison)
    if (currentFiltersRef.current !== initialFiltersJson) {
      currentFiltersRef.current = initialFiltersJson;
      updateFilters(initialFilters);
    }
  }, [initialFiltersJson, initialFilters, updateFilters]);

  // Clear selection when view mode changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [viewMode]);

  // Clear selection when filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [initialFiltersJson]);

  // Selection handlers
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === executions.length) {
        return new Set();
      }
      return new Set(executions.map(e => e.id));
    });
  }, [executions]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkFalsePositive = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const result = await executionsApi.bulkMarkFalsePositive(ids, true, 'Batch marked');
    toast.success(t('gallery.markedFalsePositive', { count: String(result.updatedCount) }));
    clearSelection();
    refresh();
  }, [selectedIds, clearSelection, refresh]);

  const handleExportCsv = useCallback(() => {
    const selected = executions.filter(e => selectedIds.has(e.id));
    const headers = ['id', 'timestamp', 'camera', 'location', 'alertLevel', 'hasSmoke', 'detectionCount', 'confidenceSmoke', 'isFalsePositive'];
    const rows = selected.map(e => [
      e.id,
      e.executionTimestamp,
      e.cameraId ?? '',
      e.location ?? '',
      e.alertLevel ?? '',
      e.hasSmoke ?? false,
      e.detectionCount ?? 0,
      e.confidenceSmoke ?? '',
      e.isFalsePositive ?? false,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sai-executions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('gallery.exported', { count: String(selected.length) }));
  }, [executions, selectedIds]);

  const handleDownloadImages = useCallback(async () => {
    const selected = executions.filter(e => selectedIds.has(e.id) && e.hasImage);
    if (selected.length === 0) {
      toast.error(t('gallery.noImagesAvailable'));
      return;
    }

    const token = tokenManager.get();
    let downloaded = 0;

    for (const exec of selected) {
      try {
        const url = executionsApi.getImageUrl(exec.id, false);
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) continue;

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `sai-execution-${exec.id}.webp`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        downloaded++;
      } catch {
        // skip failed downloads
      }
    }

    if (downloaded > 0) {
      toast.success(t('gallery.downloaded', { count: String(downloaded), s: downloaded > 1 ? 's' : '' }));
    } else {
      toast.error(t('gallery.downloadFailed'));
    }
  }, [executions, selectedIds]);

  const handleCardClick = useCallback((execution: ExecutionWithImageUrls) => {
    setSelectedExecution(execution);
    setIsModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    setSelectedExecution(null);
  }, []);

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const gridClasses = {
    grid: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4',
    list: 'grid grid-cols-1 gap-4',
  };

  if (error && executions.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-danger-600 text-6xl mb-4">⚠️</div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">{t('gallery.failedToLoad')}</h3>
        <p className="text-gray-500 mb-4">{error}</p>
        <button
          onClick={handleRefresh}
          className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('gallery.tryAgain')}
        </button>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)} ref={galleryRef}>
      {/* Gallery Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <h2 className="text-xl font-semibold text-gray-900">
            {t('gallery.executions')} {executions.length > 0 && (
              <span className="text-sm font-normal text-gray-500">
                ({t('gallery.loaded', { count: String(executions.length) })})
              </span>
            )}
          </h2>
          
          {error && executions.length > 0 && (
            <div className="text-sm text-danger-600 bg-danger-50 px-3 py-1 rounded-full">
              ⚠️ {error}
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            title={t('gallery.refreshExecutions')}
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </button>

          {/* View Mode Toggle */}
          <div className="flex border border-gray-300 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-2 transition-colors',
                viewMode === 'grid' 
                  ? 'bg-primary-600 text-white' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              )}
              title={t('gallery.gridView')}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-2 transition-colors',
                viewMode === 'list' 
                  ? 'bg-primary-600 text-white' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              )}
              title={t('gallery.listView')}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Loading state for initial load */}
      <LoadingState isLoading={isLoading && executions.length === 0} error={null}>
        <>
          {/* Empty state */}
          {executions.length === 0 && !isLoading && (
            <div className="text-center py-12">
              <div className="text-gray-400 text-6xl mb-4">📷</div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">{t('gallery.noExecutionsFound')}</h3>
              <p className="text-gray-500 mb-4">
                {Object.keys(filters).length > 0
                  ? t('gallery.adjustFilters')
                  : t('gallery.noExecutionsYet')
                }
              </p>
              {Object.keys(filters).length > 0 && (
                <button
                  onClick={() => updateFilters({})}
                  className="text-primary-600 hover:text-primary-800 font-medium"
                >
                  {t('gallery.clearAllFilters')}
                </button>
              )}
            </div>
          )}

          {/* Executions Grid/List */}
          {executions.length > 0 && viewMode === 'grid' && (
            <div className={gridClasses[viewMode]}>
              {executions.map((execution) => (
                <ImageCard
                  key={execution.id}
                  execution={execution}
                  onClick={handleCardClick}
                />
              ))}
            </div>
          )}

          {/* List View */}
          {executions.length > 0 && viewMode === 'list' && (
            <div className="space-y-2">
              {/* List Header */}
              <div className="hidden sm:flex items-center gap-4 px-3 py-2 bg-gray-50 rounded-lg text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="w-8 flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === executions.length}
                    ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < executions.length; }}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 accent-primary-600 cursor-pointer"
                    aria-label={t('gallery.selectAll')}
                  />
                </div>
                <div className="w-24 text-center">{t('gallery.image')}</div>
                <div className="w-20 text-center">{t('gallery.id')}</div>
                <div className="w-28 text-center">{t('gallery.time')}</div>
                <div className="flex-1">{t('gallery.cameraLocation')}</div>
                <div className="w-24 text-center">{t('gallery.alert')}</div>
                <div className="w-20 text-center">{t('gallery.listDetections')}</div>
                <div className="w-8"></div>
              </div>
              {/* List Items */}
              {executions.map((execution) => (
                <ExecutionListItem
                  key={execution.id}
                  execution={execution}
                  onClick={handleCardClick}
                  isSelected={selectedIds.has(execution.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}

          {/* Infinite scroll loading trigger */}
          {hasNext && (
            <div
              ref={loadMoreRef}
              className="flex justify-center items-center py-8"
            >
              <LoadingSpinner size="lg" />
              <span className="ml-3 text-gray-600">{t('gallery.loadingMore')}</span>
            </div>
          )}

          {/* End of results indicator */}
          {!hasNext && executions.length > 0 && (
            <div className="text-center py-8">
              <div className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-600 rounded-full text-sm">
                <span>{t('gallery.endOfResults')}</span>
              </div>
            </div>
          )}
        </>
      </LoadingState>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && viewMode === 'list' && (
        <BatchActionBar
          selectedCount={selectedIds.size}
          onMarkFalsePositive={handleBulkFalsePositive}
          onExportCsv={handleExportCsv}
          onDownloadImages={handleDownloadImages}
          onClearSelection={clearSelection}
        />
      )}

      {/* Image Modal */}
      <ImageModal
        execution={selectedExecution}
        isOpen={isModalOpen}
        onClose={handleModalClose}
      />

      {/* Back to Top Button */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-40 p-3 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 transition-all duration-300 hover:scale-110"
          title={t('gallery.backToTop')}
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}