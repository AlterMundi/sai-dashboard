import { useState, useCallback } from 'react';
import { ExecutionFilters } from '@/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import {
  Filter,
  X,
  Search,
  Flame,
  Wind,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
  Calendar,
  Camera,
  MessageCircle
} from 'lucide-react';
import { cn } from '@/utils';

interface FilterBarProps {
  filters: ExecutionFilters;
  onFiltersChange: (filters: ExecutionFilters) => void;
  onReset: () => void;
  isLoading?: boolean;
  className?: string;
}

export function FilterBar({
  filters,
  onFiltersChange,
  onReset,
  isLoading = false,
  className
}: FilterBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [searchTerm, setSearchTerm] = useState(filters.search || '');

  const handleFilterChange = useCallback((key: keyof ExecutionFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value, page: 0 });
  }, [filters, onFiltersChange]);

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    handleFilterChange('search', searchTerm);
  }, [searchTerm, handleFilterChange]);

  const clearFilter = useCallback((key: keyof ExecutionFilters) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    onFiltersChange({ ...newFilters, page: 0 });

    if (key === 'search') {
      setSearchTerm('');
    }
  }, [filters, onFiltersChange]);

  const getActiveFilterCount = useCallback(() => {
    const excludeKeys = ['page', 'limit', 'sortBy', 'sortOrder'];
    return Object.entries(filters).filter(([key, value]) =>
      !excludeKeys.includes(key) &&
      value !== undefined &&
      value !== '' &&
      value !== null
    ).length;
  }, [filters]);

  const activeCount = getActiveFilterCount();

  return (
    <div className={cn("bg-white border border-gray-200 rounded-lg p-4 space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Filter className="h-5 w-5 text-gray-600" />
          <h3 className="font-semibold text-gray-900">Filters</h3>
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {activeCount} active
            </Badge>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
          >
            {showAdvanced ? 'Simple' : 'Advanced'}
            <ChevronDown className={cn(
              "h-4 w-4 ml-1 transition-transform",
              showAdvanced && "rotate-180"
            )} />
          </button>
          {activeCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              disabled={isLoading}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search executions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={isLoading}>
          Search
        </Button>
      </form>

      {/* Basic Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Status Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Status
          </label>
          <Select
            value={filters.status || ''}
            onValueChange={(value) => handleFilterChange('status', value || undefined)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Alert Level Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            Alert Level
          </label>
          <Select
            value={filters.alertLevel || ''}
            onValueChange={(value) => handleFilterChange('alertLevel', value || undefined)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All levels</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date Preset Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
            <Calendar className="h-3.5 w-3.5 mr-1" />
            Date Range
          </label>
          <Select
            value={filters.datePreset || ''}
            onValueChange={(value) => handleFilterChange('datePreset', value || undefined)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="last7days">Last 7 days</SelectItem>
              <SelectItem value="last30days">Last 30 days</SelectItem>
              <SelectItem value="thisMonth">This month</SelectItem>
              <SelectItem value="lastMonth">Last month</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Has Image Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Image
          </label>
          <Select
            value={filters.hasImage !== undefined ? String(filters.hasImage) : ''}
            onValueChange={(value) => handleFilterChange('hasImage', value === '' ? undefined : value === 'true')}
          >
            <SelectTrigger>
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="true">With image</SelectItem>
              <SelectItem value="false">Without image</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="pt-4 border-t border-gray-200 space-y-4">
          <h4 className="text-sm font-semibold text-gray-900">Advanced Filters</h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Fire Detection Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                <Flame className="h-3.5 w-3.5 mr-1 text-red-500" />
                Fire Detection
              </label>
              <Select
                value={filters.hasFire !== undefined ? String(filters.hasFire) : ''}
                onValueChange={(value) => handleFilterChange('hasFire', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  <SelectItem value="true">Detected</SelectItem>
                  <SelectItem value="false">Not detected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Smoke Detection Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                <Wind className="h-3.5 w-3.5 mr-1 text-gray-600" />
                Smoke Detection
              </label>
              <Select
                value={filters.hasSmoke !== undefined ? String(filters.hasSmoke) : ''}
                onValueChange={(value) => handleFilterChange('hasSmoke', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  <SelectItem value="true">Detected</SelectItem>
                  <SelectItem value="false">Not detected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Camera ID Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                <Camera className="h-3.5 w-3.5 mr-1" />
                Camera ID
              </label>
              <Input
                type="text"
                placeholder="e.g., cam-01"
                value={filters.cameraId || ''}
                onChange={(e) => handleFilterChange('cameraId', e.target.value || undefined)}
              />
            </div>

            {/* Telegram Sent Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                <MessageCircle className="h-3.5 w-3.5 mr-1" />
                Telegram Sent
              </label>
              <Select
                value={filters.telegramSent !== undefined ? String(filters.telegramSent) : ''}
                onValueChange={(value) => handleFilterChange('telegramSent', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  <SelectItem value="true">Sent</SelectItem>
                  <SelectItem value="false">Not sent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Node ID Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Node ID
              </label>
              <Input
                type="text"
                placeholder="e.g., node-01"
                value={filters.nodeId || ''}
                onChange={(e) => handleFilterChange('nodeId', e.target.value || undefined)}
              />
            </div>

            {/* Location Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location
              </label>
              <Input
                type="text"
                placeholder="e.g., Building A"
                value={filters.location || ''}
                onChange={(e) => handleFilterChange('location', e.target.value || undefined)}
              />
            </div>

            {/* Min Confidence Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Confidence
              </label>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.1"
                placeholder="0.0 - 1.0"
                value={filters.minConfidence || ''}
                onChange={(e) => handleFilterChange('minConfidence', e.target.value ? parseFloat(e.target.value) : undefined)}
              />
            </div>

            {/* Max Confidence Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Confidence
              </label>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.1"
                placeholder="0.0 - 1.0"
                value={filters.maxConfidence || ''}
                onChange={(e) => handleFilterChange('maxConfidence', e.target.value ? parseFloat(e.target.value) : undefined)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Active Filters Display */}
      {activeCount > 0 && (
        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-200">
          {filters.search && (
            <Badge variant="secondary" className="flex items-center gap-1">
              Search: {filters.search}
              <button
                onClick={() => clearFilter('search')}
                className="ml-1 hover:text-gray-900"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.status && (
            <Badge variant="secondary" className="flex items-center gap-1">
              Status: {filters.status}
              <button onClick={() => clearFilter('status')} className="ml-1">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.alertLevel && (
            <Badge variant="secondary" className="flex items-center gap-1">
              Alert: {filters.alertLevel}
              <button onClick={() => clearFilter('alertLevel')} className="ml-1">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.hasFire !== undefined && (
            <Badge variant="secondary" className="flex items-center gap-1">
              Fire: {filters.hasFire ? 'detected' : 'not detected'}
              <button onClick={() => clearFilter('hasFire')} className="ml-1">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.hasSmoke !== undefined && (
            <Badge variant="secondary" className="flex items-center gap-1">
              Smoke: {filters.hasSmoke ? 'detected' : 'not detected'}
              <button onClick={() => clearFilter('hasSmoke')} className="ml-1">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.cameraId && (
            <Badge variant="secondary" className="flex items-center gap-1">
              Camera: {filters.cameraId}
              <button onClick={() => clearFilter('cameraId')} className="ml-1">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.datePreset && (
            <Badge variant="secondary" className="flex items-center gap-1">
              Date: {filters.datePreset}
              <button onClick={() => clearFilter('datePreset')} className="ml-1">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
