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
  Timer,
  X,
  Flame,
  Wind,
  AlertTriangle,
  Calendar,
  Camera,
  MessageCircle,
  Image as ImageIcon
} from 'lucide-react';

export function Dashboard() {
  const [filters, setFilters] = useState<ExecutionFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [batchUpdateTrigger, setBatchUpdateTrigger] = useState(0);
  const galleryPrependRef = useRef<((executions: any[]) => void) | null>(null);

  const { stats, isLoading: statsLoading, error: statsError } = useExecutionStats();
  useDailySummary(7);
  const { isConnected, systemHealth } = useSSE();

  // Handle real-time updates via SSE
  const onNewExecution = useCallback(() => {
    // New executions are handled automatically by the gallery's own data fetching
  }, []);

  const onExecutionError = useCallback(() => {
    // Handle execution errors if needed
  }, []);

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

  useSSEHandler({
    onNewExecution,
    onExecutionError,
    onExecutionBatch,
  });

  // Filter Management - ADDITIVE LOGIC with multi-select support
  const toggleArrayFilter = useCallback((key: 'alertLevels' | 'cameraTypes', value: string) => {
    setFilters(prev => {
      const currentArray = (prev[key] as string[]) || [];
      const hasValue = currentArray.includes(value);

      let newArray: string[];
      if (hasValue) {
        // Remove value from array
        newArray = currentArray.filter(v => v !== value);
      } else {
        // Add value to array
        newArray = [...currentArray, value];
      }

      const newFilters = { ...prev, page: 0 };
      if (newArray.length === 0) {
        delete newFilters[key];
      } else {
        newFilters[key] = newArray as any;
      }

      console.log(`🔄 Array Toggle ${hasValue ? 'OFF' : 'ON'}:`, key, value, '→', newArray);
      return newFilters;
    });
  }, []);

  const toggleFilter = useCallback((key: keyof ExecutionFilters, value: any) => {
    setFilters(prev => {
      const current = prev[key];
      // If same value, clear it (toggle off)
      if (current === value) {
        const newFilters = { ...prev };
        delete newFilters[key];
        console.log('🔄 Toggle OFF:', key, '→ Filters:', newFilters);
        return { ...newFilters, page: 0 };
      }
      // Otherwise set new value (toggle on or change)
      const newFilters = { ...prev, [key]: value, page: 0 };
      console.log('🔄 Toggle ON:', key, '=', value, '→ Filters:', newFilters);
      return newFilters;
    });
  }, []);

  const updateFilter = useCallback((key: keyof ExecutionFilters, value: any) => {
    setFilters(prev => {
      if (value === undefined || value === '' || value === null) {
        const newFilters = { ...prev };
        delete newFilters[key];
        return { ...newFilters, page: 0 };
      }
      return { ...prev, [key]: value, page: 0 };
    });
  }, []);

  const removeFilter = useCallback((key: keyof ExecutionFilters) => {
    setFilters(prev => {
      const newFilters = { ...prev };
      delete newFilters[key];
      return { ...newFilters, page: 0 };
    });
    if (key === 'search') {
      setSearchQuery('');
    }
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({});
    setSearchQuery('');
  }, []);

  // Search handler
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilter('search', searchQuery.trim() || undefined);
  };

  // Get active filter count (excluding pagination/sorting)
  const getActiveFilterCount = () => {
    const excludeKeys = ['page', 'limit', 'sortBy', 'sortOrder'];
    return Object.entries(filters).filter(([key, value]) =>
      !excludeKeys.includes(key) &&
      value !== undefined &&
      value !== '' &&
      value !== null
    ).length;
  };

  const activeFilterCount = getActiveFilterCount();

  // Filter chip labels
  const getFilterLabel = (key: string, value: any): string => {
    const labels: Record<string, any> = {
      status: { success: 'Success', error: 'Error' },
      alertLevel: { none: 'No Alert', low: 'Low Alert', high: 'High Alert', critical: 'Critical Alert' },
      hasFire: { true: 'Fire Detected', false: 'No Fire' },
      hasSmoke: { true: 'Smoke Detected', false: 'No Smoke' },
      hasImage: { true: 'With Image', false: 'No Image' },
      telegramSent: { true: 'Telegram Sent', false: 'Telegram Not Sent' },
      cameraType: { onvif: 'ONVIF', rtsp: 'RTSP' },
      datePreset: {
        today: 'Today',
        yesterday: 'Yesterday',
        last7days: 'Last 7 Days',
        last30days: 'Last 30 Days',
        thisMonth: 'This Month',
        lastMonth: 'Last Month'
      },
    };

    if (key === 'search') return `"${value}"`;
    if (key === 'startDate') return `From: ${value}`;
    if (key === 'endDate') return `To: ${value}`;

    return labels[key]?.[String(value)] || String(value);
  };

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

        {/* Search and Filter Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search Bar */}
            <form onSubmit={handleSearch} className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by location, device, camera..."
                  className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); removeFilter('search'); }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </form>

            {/* Filter Toggle Button */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 border rounded-lg font-medium transition-colors",
                  showFilters
                    ? "bg-primary-50 border-primary-300 text-primary-700"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                )}
              >
                <Filter className="h-5 w-5" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-primary-600 text-white text-xs font-semibold rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Active Filter Chips */}
          {activeFilterCount > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(filters)
                .filter(([key, value]) =>
                  !['page', 'limit', 'sortBy', 'sortOrder'].includes(key) &&
                  value !== undefined && value !== null && value !== ''
                )
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-100 text-primary-800 rounded-full text-sm font-medium"
                  >
                    <span>{getFilterLabel(key, value)}</span>
                    <button
                      onClick={() => removeFilter(key as keyof ExecutionFilters)}
                      className="hover:bg-primary-200 rounded-full p-0.5 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* Expanded Filters */}
          {showFilters && (
            <div className="mt-6 pt-6 border-t border-gray-200 space-y-6">
              {/* Quick Action Buttons - YOLO Detection */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Filters (Click to toggle)</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => toggleFilter('hasFire', true)}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      filters.hasFire === true
                        ? "bg-red-600 text-white shadow-md"
                        : "bg-red-100 text-red-700 hover:bg-red-200"
                    )}
                  >
                    <Flame className="h-4 w-4" />
                    Fire Detected
                  </button>

                  <button
                    onClick={() => toggleFilter('hasSmoke', true)}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      filters.hasSmoke === true
                        ? "bg-gray-700 text-white shadow-md"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    )}
                  >
                    <Wind className="h-4 w-4" />
                    Smoke Detected
                  </button>

                  <button
                    onClick={() => toggleArrayFilter('alertLevels', 'critical')}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      filters.alertLevels?.includes('critical')
                        ? "bg-red-700 text-white shadow-md"
                        : "bg-red-200 text-red-900 hover:bg-red-300"
                    )}
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Critical Alerts
                  </button>

                  <button
                    onClick={() => toggleArrayFilter('alertLevels', 'high')}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      filters.alertLevels?.includes('high')
                        ? "bg-orange-600 text-white shadow-md"
                        : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                    )}
                  >
                    <AlertTriangle className="h-4 w-4" />
                    High Alerts
                  </button>

                  <button
                    onClick={() => toggleFilter('datePreset', 'today')}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      filters.datePreset === 'today'
                        ? "bg-primary-600 text-white shadow-md"
                        : "bg-primary-100 text-primary-700 hover:bg-primary-200"
                    )}
                  >
                    <Calendar className="h-4 w-4" />
                    Today
                  </button>

                  <button
                    onClick={() => toggleArrayFilter('cameraTypes', 'onvif')}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      filters.cameraTypes?.includes('onvif')
                        ? "bg-blue-600 text-white shadow-md"
                        : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                    )}
                  >
                    <Camera className="h-4 w-4" />
                    ONVIF Cameras
                  </button>

                  <button
                    onClick={() => toggleFilter('hasImage', true)}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      filters.hasImage === true
                        ? "bg-green-600 text-white shadow-md"
                        : "bg-green-100 text-green-700 hover:bg-green-200"
                    )}
                  >
                    <ImageIcon className="h-4 w-4" />
                    With Images
                  </button>

                  <button
                    onClick={() => toggleFilter('telegramSent', true)}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      filters.telegramSent === true
                        ? "bg-blue-600 text-white shadow-md"
                        : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                    )}
                  >
                    <MessageCircle className="h-4 w-4" />
                    Telegram Sent
                  </button>
                </div>
              </div>

              {/* Advanced Filters */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Advanced Filters</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {/* Status */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                    <select
                      value={filters.status || ''}
                      onChange={(e) => updateFilter('status', e.target.value || undefined)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">All</option>
                      <option value="success">Success</option>
                      <option value="error">Error</option>
                    </select>
                  </div>

                  {/* Alert Level */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Alert Level</label>
                    <select
                      value={filters.alertLevel || ''}
                      onChange={(e) => updateFilter('alertLevel', e.target.value || undefined)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">All</option>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="low">Low</option>
                      <option value="none">None</option>
                    </select>
                  </div>

                  {/* Date Preset */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
                    <select
                      value={filters.datePreset || ''}
                      onChange={(e) => updateFilter('datePreset', e.target.value || undefined)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">Custom</option>
                      <option value="today">Today</option>
                      <option value="yesterday">Yesterday</option>
                      <option value="last7days">Last 7 days</option>
                      <option value="last30days">Last 30 days</option>
                      <option value="thisMonth">This month</option>
                      <option value="lastMonth">Last month</option>
                    </select>
                  </div>

                  {/* Camera Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Camera Type</label>
                    <select
                      value={filters.cameraType || ''}
                      onChange={(e) => updateFilter('cameraType', e.target.value || undefined)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">All</option>
                      <option value="onvif">ONVIF</option>
                      <option value="rtsp">RTSP</option>
                    </select>
                  </div>

                  {/* From Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
                    <input
                      type="date"
                      value={filters.startDate || ''}
                      onChange={(e) => updateFilter('startDate', e.target.value || undefined)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>

                  {/* To Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
                    <input
                      type="date"
                      value={filters.endDate || ''}
                      onChange={(e) => updateFilter('endDate', e.target.value || undefined)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                </div>
              </div>
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
