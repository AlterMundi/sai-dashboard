import { useState, useCallback, useRef, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { ImageCard } from './ImageCard';
import { ImageModal } from './ImageModal';
import { FilterBar } from './FilterBar';
import { LoadingSpinner, LoadingState } from './ui/LoadingSpinner';
import { useExecutions } from '@/hooks/useExecutions';
import { ExecutionWithImageUrls, ExecutionFilters } from '@/types';
import { cn } from '@/utils';
import { Grid, List, RefreshCw, ArrowUp, Filter } from 'lucide-react';

interface ImageGalleryProps {
  initialFilters?: ExecutionFilters;
  className?: string;
  refreshTrigger?: number;
  onPrependRegister?: (prependFn: (executions: ExecutionWithImageUrls[]) => void) => void;
}

export function ImageGallery({ initialFilters = {}, className, refreshTrigger, onPrependRegister }: ImageGalleryProps) {
  const [selectedExecution, setSelectedExecution] = useState<ExecutionWithImageUrls | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
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

  const handleFiltersReset = useCallback(() => {
    updateFilters({ page: 0, limit: 50 });
  }, [updateFilters]);

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
        <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to Load Executions</h3>
        <p className="text-gray-500 mb-4">{error}</p>
        <button
          onClick={handleRefresh}
          className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Try Again
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
            Executions {executions.length > 0 && (
              <span className="text-sm font-normal text-gray-500">
                ({executions.length} loaded)
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
          {/* Filter Toggle Button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'p-2 transition-colors rounded-lg',
              showFilters 
                ? 'bg-blue-600 text-white' 
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            )}
            title="Toggle filters"
          >
            <Filter className="h-4 w-4" />
          </button>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh executions"
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
              title="Grid view"
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
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Enhanced Filter Bar */}
      {showFilters && (
        <div className="mb-6">
          <FilterBar
            filters={filters}
            onFiltersChange={updateFilters}
            onReset={handleFiltersReset}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Loading state for initial load */}
      <LoadingState isLoading={isLoading && executions.length === 0} error={null}>
        <>
          {/* Empty state */}
          {executions.length === 0 && !isLoading && (
            <div className="text-center py-12">
              <div className="text-gray-400 text-6xl mb-4">📷</div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Executions Found</h3>
              <p className="text-gray-500 mb-4">
                {Object.keys(filters).length > 0 
                  ? 'Try adjusting your filters to see more results.' 
                  : 'No SAI workflow executions are available yet.'
                }
              </p>
              {Object.keys(filters).length > 0 && (
                <button
                  onClick={() => updateFilters({})}
                  className="text-primary-600 hover:text-primary-800 font-medium"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {/* Executions Grid */}
          {executions.length > 0 && (
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

          {/* Infinite scroll loading trigger */}
          {hasNext && (
            <div
              ref={loadMoreRef}
              className="flex justify-center items-center py-8"
            >
              <LoadingSpinner size="lg" />
              <span className="ml-3 text-gray-600">Loading more executions...</span>
            </div>
          )}

          {/* End of results indicator */}
          {!hasNext && executions.length > 0 && (
            <div className="text-center py-8">
              <div className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-600 rounded-full text-sm">
                <span>You've reached the end of the results</span>
              </div>
            </div>
          )}
        </>
      </LoadingState>

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
          title="Back to top"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}