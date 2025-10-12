import { useState, useCallback, useRef } from 'react';
import { Layout } from '@/components/Layout';
import { ImageGallery } from '@/components/ImageGallery';
import { LoadingState } from '@/components/ui/LoadingSpinner';
import { LiveStatsCard, SystemHealthIndicator } from '@/components/LiveStatsCard';
import { useExecutionStats, useDailySummary } from '@/hooks/useExecutions';
import { executionsApi } from '@/services/api';
import { useSSEHandler, useSSE } from '@/contexts/SSEContext';
import { ExecutionFilters } from '@/types';
import { formatPercentage, cn } from '@/utils';
import { 
  Activity, 
  CheckCircle, 
  Search,
  Filter,
  Users,
  Timer
} from 'lucide-react';

export function Dashboard() {
  const [filters, setFilters] = useState<ExecutionFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [batchUpdateTrigger, setBatchUpdateTrigger] = useState(0);
  const galleryPrependRef = useRef<((executions: any[]) => void) | null>(null);
  // Removed: newExecutionsCount - was debug UI, not useful for end users
  
  const { stats, isLoading: statsLoading, error: statsError } = useExecutionStats();
  useDailySummary(7);
  // Get live SSE data
  const { isConnected, systemHealth } = useSSE();

  // Handle real-time updates via SSE - simplified without debug counters
  const onNewExecution = useCallback(() => {
    // New executions are handled automatically by the gallery's own data fetching
  }, []);

  const onExecutionError = useCallback(() => {
    // Handle execution errors if needed
  }, []);

  const onExecutionBatch = useCallback(async (batchData: any) => {
    console.log('📦 Dashboard: Batch update received', batchData);
    
    // Try to fetch and prepend new executions if gallery prepend function is available
    if (galleryPrependRef.current) {
      try {
        // Fetch the most recent executions (limiting to a small number)
        const response = await executionsApi.getExecutions({ 
          ...filters,
          page: 0,
          limit: Math.min(batchData.count || 10, 20) // Get at most 20 recent executions
        });
        
        console.log(`📥 Dashboard: Prepending ${response.executions.length} new executions to gallery`);
        galleryPrependRef.current(response.executions);
      } catch (error) {
        console.warn('Failed to fetch new executions for prepending, falling back to refresh trigger', error);
        setBatchUpdateTrigger(prev => prev + 1);
      }
    } else {
      // Fallback to refresh trigger
      setBatchUpdateTrigger(prev => prev + 1);
    }
  }, [filters]);
  
  useSSEHandler({
    onNewExecution,
    onExecutionError,
    onExecutionBatch,
  });

  // Search handler
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters(prev => ({ ...prev, search: searchQuery.trim() || undefined }));
  };

  const clearSearch = () => {
    setSearchQuery('');
    setFilters(prev => ({ ...prev, search: undefined }));
  };

  // Quick filter handlers
  const applyQuickFilter = (newFilters: Partial<ExecutionFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  const clearFilters = () => {
    setFilters({});
    setSearchQuery('');
  };

  return (
    <Layout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="mt-2 text-gray-600">
              Visual management for SAI image analysis workflow
            </p>
          </div>
          
          {/* Real-time Status */}
          <div className="mt-4 sm:mt-0 flex items-center space-x-3">
            {/* System Health */}
            {systemHealth && <SystemHealthIndicator />}
            
            {/* Live Connection Status */}
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
                initialValue={0}
                format={(v) => `${v.toFixed(1)}s`}
              />
            </div>
          )}
        </LoadingState>

        {/* Search and Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 max-w-lg">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search analysis results..."
                  className="block w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                )}
              </div>
            </form>

            {/* Filter Toggle Section */}
            <div className="flex items-center space-x-3">
              {/* Filter Toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  'flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  showFilters
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                )}
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
              </button>
              
              {(Object.keys(filters).length > 0) && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Extended Filters */}
          {showFilters && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              {/* Analysis status is now handled in the ImageGallery FilterBar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {/* Status Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={filters.status || ''}
                    onChange={(e) => applyQuickFilter({ status: (e.target.value as any) || undefined })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">All statuses</option>
                    <option value="success">Success</option>
                    <option value="error">Error</option>
                    <option value="running">Running</option>
                    <option value="waiting">Waiting</option>
                  </select>
                </div>

                {/* Has Image Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Images</label>
                  <select
                    value={filters.hasImage === undefined ? '' : filters.hasImage.toString()}
                    onChange={(e) => applyQuickFilter({ 
                      hasImage: e.target.value === '' ? undefined : e.target.value === 'true' 
                    })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">All executions</option>
                    <option value="true">With images</option>
                    <option value="false">Without images</option>
                  </select>
                </div>

                {/* Risk Level Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Alert Level</label>
                  <select
                    value={filters.alertLevel || ''}
                    onChange={(e) => applyQuickFilter({ alertLevel: (e.target.value as any) || undefined })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">All alert levels</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="none">None</option>
                  </select>
                </div>

                {/* Telegram Delivery Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Telegram Delivery</label>
                  <select
                    value={filters.telegramSent === undefined ? '' : filters.telegramSent.toString()}
                    onChange={(e) => applyQuickFilter({ 
                      telegramSent: e.target.value === '' ? undefined : e.target.value === 'true' 
                    })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">All executions</option>
                    <option value="true">Delivered to Telegram</option>
                    <option value="false">Not delivered</option>
                  </select>
                </div>

                {/* Date Preset Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date Preset</label>
                  <select
                    value={filters.datePreset || ''}
                    onChange={(e) => applyQuickFilter({ datePreset: (e.target.value as any) || undefined })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Custom date range</option>
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="last7days">Last 7 days</option>
                    <option value="last30days">Last 30 days</option>
                    <option value="thisMonth">This month</option>
                    <option value="lastMonth">Last month</option>
                  </select>
                </div>

                {/* Sort By Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
                  <select
                    value={filters.sortBy || ''}
                    onChange={(e) => applyQuickFilter({ sortBy: (e.target.value as any) || undefined })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Default order</option>
                    <option value="date">Date</option>
                    <option value="risk">Risk Level</option>
                    <option value="status">Status</option>
                  </select>
                </div>

                {/* Sort Order Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sort Order</label>
                  <select
                    value={filters.sortOrder || ''}
                    onChange={(e) => applyQuickFilter({ sortOrder: (e.target.value as any) || undefined })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Default</option>
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </div>

                {/* Date Range */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
                  <input
                    type="date"
                    value={filters.startDate || ''}
                    onChange={(e) => applyQuickFilter({ startDate: e.target.value || undefined })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
                  <input
                    type="date"
                    value={filters.endDate || ''}
                    onChange={(e) => applyQuickFilter({ endDate: e.target.value || undefined })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>

              {/* Quick Filter Buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => applyQuickFilter({ status: 'success', hasImage: true })}
                  className="px-3 py-1 bg-success-100 text-success-700 rounded-full text-sm hover:bg-success-200 transition-colors"
                >
                  Successful with images
                </button>
                <button
                  onClick={() => applyQuickFilter({ status: 'error' })}
                  className="px-3 py-1 bg-danger-100 text-danger-700 rounded-full text-sm hover:bg-danger-200 transition-colors"
                >
                  Failed executions
                </button>
                <button
                  onClick={() => applyQuickFilter({ datePreset: 'today' })}
                  className="px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-sm hover:bg-primary-200 transition-colors"
                >
                  Today
                </button>
                <button
                  onClick={() => applyQuickFilter({ alertLevel: 'high' })}
                  className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm hover:bg-red-200 transition-colors"
                >
                  High Alert Only
                </button>
                <button
                  onClick={() => applyQuickFilter({ telegramSent: true })}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm hover:bg-blue-200 transition-colors"
                >
                  Telegram Delivered
                </button>
                <button
                  onClick={() => applyQuickFilter({ sortBy: 'alert', sortOrder: 'desc' })}
                  className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm hover:bg-orange-200 transition-colors"
                >
                  Sort by Alert (Critical first)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Main Gallery */}
        <ImageGallery 
          initialFilters={filters}
          refreshTrigger={batchUpdateTrigger}
          onPrependRegister={(prependFn) => { galleryPrependRef.current = prependFn; }}
          key={JSON.stringify(filters)} // Only re-render on filter changes
        />
      </div>
    </Layout>
  );
}