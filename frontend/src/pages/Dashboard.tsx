import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { ImageGallery } from '@/components/ImageGallery';
import { LoadingState } from '@/components/ui/LoadingSpinner';
import { useExecutionStats, useDailySummary } from '@/hooks/useExecutions';
import { useSSEHandler } from '@/hooks/useSSE';
import { ExecutionFilters } from '@/types';
import { formatPercentage, formatRelativeTime, cn } from '@/utils';
import { 
  TrendingUp, 
  Activity, 
  CheckCircle, 
  Clock,
  Search,
  Filter
} from 'lucide-react';

export function Dashboard() {
  const [filters, setFilters] = useState<ExecutionFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newExecutionsCount, setNewExecutionsCount] = useState(0);
  
  const { stats, isLoading: statsLoading, error: statsError } = useExecutionStats();
  useDailySummary(7);

  // Handle real-time updates via SSE
  const { isConnected } = useSSEHandler({
    onNewExecution: (data) => {
      console.log('New execution received:', data.execution);
      setNewExecutionsCount(prev => prev + 1);
      
      // Auto-refresh stats periodically
      setTimeout(() => {
        setNewExecutionsCount(prev => Math.max(0, prev - 1));
      }, 30000); // Remove notification after 30 seconds
    },
    onExecutionError: (data) => {
      console.log('Execution error received:', data);
    },
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
          <div className="mt-4 sm:mt-0 flex items-center space-x-2">
            {isConnected && (
              <div className="flex items-center px-3 py-1 bg-success-100 text-success-800 rounded-full text-sm">
                <div className="h-2 w-2 bg-success-600 rounded-full mr-2 animate-pulse" />
                Live Updates
              </div>
            )}
            {newExecutionsCount > 0 && (
              <div className="flex items-center px-3 py-1 bg-primary-100 text-primary-800 rounded-full text-sm">
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
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Activity className="h-6 w-6 text-primary-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-600">Total Executions</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {stats.totalExecutions.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <CheckCircle className="h-6 w-6 text-success-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-600">Success Rate</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {formatPercentage(stats.successRate)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <TrendingUp className="h-6 w-6 text-warning-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-600">Daily Average</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {stats.avgDailyExecutions.toFixed(1)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Clock className="h-6 w-6 text-gray-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-600">Last Execution</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {stats.lastExecution ? formatRelativeTime(stats.lastExecution) : 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
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

            {/* Filter Toggle */}
            <div className="flex items-center space-x-2">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  onClick={() => applyQuickFilter({ 
                    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                  })}
                  className="px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-sm hover:bg-primary-200 transition-colors"
                >
                  Last 24 hours
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Main Gallery */}
        <ImageGallery 
          initialFilters={filters}
          key={JSON.stringify(filters)} // Force re-render when filters change
        />
      </div>
    </Layout>
  );
}