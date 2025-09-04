import { useState, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { ImageGallery } from '@/components/ImageGallery';
import { LoadingState } from '@/components/ui/LoadingSpinner';
import { LiveExecutionStrip } from '@/components/LiveExecutionStrip';
import { LiveStatsCard, SystemHealthIndicator } from '@/components/LiveStatsCard';
import { useExecutionStats, useDailySummary, useExecutions } from '@/hooks/useExecutions';
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
  const [newExecutionsCount, setNewExecutionsCount] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0); // Force gallery refresh
  
  const { stats, isLoading: statsLoading, error: statsError } = useExecutionStats();
  useDailySummary(7);
  
  // Get analysis status for compact header display  
  const { analysisStatus } = useExecutions({});

  // Get live SSE data
  const { isConnected, systemHealth } = useSSE();

  // Handle real-time updates via SSE - FIXED: Memoize individual handlers to prevent useEffect dependency issues
  const onNewExecution = useCallback((data: any) => {
    console.log('New execution received:', data.execution);
    setNewExecutionsCount(prev => prev + 1);
    
    // Auto-refresh stats periodically (fast for testing)
    setTimeout(() => {
      setNewExecutionsCount(prev => Math.max(0, prev - 1));
    }, 3000); // Remove notification after 3 seconds (fast for testing)
  }, []);

  const onExecutionError = useCallback((data: any) => {
    console.log('Execution error received:', data);
  }, []);

  const onExecutionBatch = useCallback((data: any) => {
    console.log('🎉 Dashboard: Batch received with', data.count, 'new executions', data);
    
    // Update new executions counter
    setNewExecutionsCount(prev => {
      console.log('🔢 Dashboard: Updating execution count from', prev, 'to', prev + data.count);
      return prev + data.count;
    });
    
    // Trigger gallery refresh by changing the key
    setRefreshTrigger(prev => {
      console.log('🔄 Dashboard: Triggering gallery refresh from', prev, 'to', prev + 1);
      return prev + 1;
    });
    
    // Clear counter after some time (fast for testing)
    setTimeout(() => {
      setNewExecutionsCount(prev => Math.max(0, prev - data.count));
    }, 3000); // 3 seconds for fast testing
  }, []);
  
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
            
            {/* New Executions Counter */}
            {newExecutionsCount > 0 && (
              <div className="flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                <Activity className="h-3 w-3 mr-1" />
                {newExecutionsCount} new
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

            {/* Compact Analysis Status */}
            <div className="flex items-center space-x-3">
              {analysisStatus && typeof analysisStatus.coverage === 'number' && (
                <div className="hidden sm:flex items-center px-3 py-1 bg-gray-50 rounded-full text-xs text-gray-600">
                  <div className={`w-2 h-2 rounded-full mr-2 ${
                    analysisStatus.coverage >= 90 ? 'bg-green-500' :
                    analysisStatus.coverage >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}></div>
                  Analysis: {Math.round(analysisStatus.coverage)}% Complete
                  {typeof analysisStatus.pending === 'number' && analysisStatus.pending > 0 && (
                    <span className="ml-1 text-gray-500">({analysisStatus.pending} pending)</span>
                  )}
                </div>
              )}
              
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">Risk Level</label>
                  <select
                    value={filters.riskLevel || ''}
                    onChange={(e) => applyQuickFilter({ riskLevel: (e.target.value as any) || undefined })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">All risk levels</option>
                    <option value="high">High Risk</option>
                    <option value="medium">Medium Risk</option>
                    <option value="low">Low Risk</option>
                    <option value="none">No Risk</option>
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
                  onClick={() => applyQuickFilter({ riskLevel: 'high' })}
                  className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm hover:bg-red-200 transition-colors"
                >
                  High Risk Only
                </button>
                <button
                  onClick={() => applyQuickFilter({ telegramSent: true })}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm hover:bg-blue-200 transition-colors"
                >
                  Telegram Delivered
                </button>
                <button
                  onClick={() => applyQuickFilter({ sortBy: 'risk', sortOrder: 'desc' })}
                  className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm hover:bg-orange-200 transition-colors"
                >
                  Sort by Risk (High first)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Live Execution Strip */}
        <LiveExecutionStrip />

        {/* Main Gallery */}
        <ImageGallery 
          initialFilters={filters}
          refreshTrigger={refreshTrigger}
          key={JSON.stringify(filters)} // Only re-render on filter changes
        />
      </div>
    </Layout>
  );
}