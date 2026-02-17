import { useState, useCallback } from 'react';
import { ExecutionFilters } from '@/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { DateTimeRangeSelector } from './DateTimeRangeSelector';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  Filter,
  Wind,
  AlertTriangle,
  Calendar,
  Camera,
  MapPin,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/utils';

interface AlertFilterComponentProps {
  filters: ExecutionFilters;
  onFiltersChange: (filters: ExecutionFilters) => void;
  onReset: () => void;
  isLoading?: boolean;
  totalResults?: number;
  currentPage?: number;
  totalPages?: number;
  pageSize?: number;
  className?: string;
}

export function AlertFilterComponent({
  filters,
  onFiltersChange,
  onReset,
  isLoading = false,
  totalResults = 0,
  currentPage = 1,
  totalPages = 1,
  pageSize = 50,
  className
}: AlertFilterComponentProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleFilterChange = useCallback((key: keyof ExecutionFilters, value: any) => {
    const newFilters = { ...filters, [key]: value, page: 0 };

    // Mutual exclusivity: datePreset and custom date range
    if (key === 'datePreset' && value) {
      // When selecting a preset, clear custom date range
      newFilters.startDate = undefined;
      newFilters.endDate = undefined;
    }

    onFiltersChange(newFilters);
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

  // Quick filter definitions
  const quickFilters = [
    {
      id: 'smoke_detected',
      labelKey: 'filters.smoke',
      icon: Wind,
      color: 'neutral',
      isActive: filters.hasSmoke === true,
      onClick: () => handleFilterChange('hasSmoke', filters.hasSmoke === true ? undefined : true)
    },
    {
      id: 'critical_alerts',
      labelKey: 'filters.critical',
      icon: AlertTriangle,
      color: 'danger',
      isActive: filters.alertLevels?.includes('critical'),
      onClick: () => {
        const currentLevels = filters.alertLevels || [];
        const newLevels = currentLevels.includes('critical')
          ? currentLevels.filter(l => l !== 'critical')
          : [...currentLevels, 'critical'];
        handleFilterChange('alertLevels', newLevels.length > 0 ? newLevels : undefined);
      }
    },
    {
      id: 'high_alerts',
      labelKey: 'filters.high',
      icon: AlertTriangle,
      color: 'warning',
      isActive: filters.alertLevels?.includes('high'),
      onClick: () => {
        const currentLevels = filters.alertLevels || [];
        const newLevels = currentLevels.includes('high')
          ? currentLevels.filter(l => l !== 'high')
          : [...currentLevels, 'high'];
        handleFilterChange('alertLevels', newLevels.length > 0 ? newLevels : undefined);
      }
    },
    {
      id: 'low_alerts',
      labelKey: 'filters.low',
      icon: AlertTriangle,
      color: 'info',
      isActive: filters.alertLevels?.includes('low'),
      onClick: () => {
        const currentLevels = filters.alertLevels || [];
        const newLevels = currentLevels.includes('low')
          ? currentLevels.filter(l => l !== 'low')
          : [...currentLevels, 'low'];
        handleFilterChange('alertLevels', newLevels.length > 0 ? newLevels : undefined);
      }
    }
  ];

  return (
    <div className={cn("bg-white border border-gray-200 rounded-lg p-6 space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Filter className="h-5 w-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">{t('filters.title')}</h2>
          {activeCount > 0 && (
            <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
              {activeCount} {t('common.active')}
            </Badge>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
          >
            {showAdvanced ? t('filters.basic') : t('filters.advanced')}
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
              {t('common.reset')}
            </Button>
          )}
        </div>
      </div>

      {/* Basic Filters: Location, Camera, Date Preset + Alert Quick Filters */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Location Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
            <MapPin className="h-3.5 w-3.5 mr-1" />
            {t('filters.location')}
          </label>
          <Select
            value={filters.location || ''}
            onValueChange={(value) => handleFilterChange('location', value || undefined)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('filters.allLocations')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t('filters.allLocations')}</SelectItem>
              <SelectItem value="La Rancherita">La Rancherita</SelectItem>
              <SelectItem value="Molinari">Molinari</SelectItem>
              <SelectItem value="Quintana">Quintana</SelectItem>
              <SelectItem value="La Paisanita">La Paisanita</SelectItem>
              <SelectItem value="La Serranita">La Serranita</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Camera / Cardinal Direction Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
            <Camera className="h-3.5 w-3.5 mr-1" />
            {t('filters.camera')}
          </label>
          <Select
            value={filters.cameraId || ''}
            onValueChange={(value) => handleFilterChange('cameraId', value || undefined)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('filters.allCameras')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t('filters.allCameras')}</SelectItem>
              <SelectItem value="cam1">cam1</SelectItem>
              <SelectItem value="cam2">cam2</SelectItem>
              <SelectItem value="cam3">cam3</SelectItem>
              <SelectItem value="cam4">cam4</SelectItem>
              <SelectItem value="cam5">cam5</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date Preset Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
            <Calendar className="h-3.5 w-3.5 mr-1" />
            {t('filters.datePreset')}
          </label>
          <Select
            value={filters.datePreset || ''}
            onValueChange={(value) => handleFilterChange('datePreset', value || undefined)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('filters.allTime')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t('filters.allTime')}</SelectItem>
              <SelectItem value="today">{t('filters.today')}</SelectItem>
              <SelectItem value="yesterday">{t('filters.yesterday')}</SelectItem>
              <SelectItem value="last7days">{t('filters.last7days')}</SelectItem>
              <SelectItem value="last30days">{t('filters.last30days')}</SelectItem>
              <SelectItem value="thisMonth">{t('filters.thisMonth')}</SelectItem>
              <SelectItem value="lastMonth">{t('filters.lastMonth')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Alert Quick Filters */}
        <div className="flex flex-wrap items-center gap-2 pb-0.5">
          {quickFilters.map((filter) => {
            const Icon = filter.icon;
            return (
              <Button
                key={filter.id}
                variant={filter.isActive ? "default" : "outline"}
                size="sm"
                onClick={filter.onClick}
                disabled={isLoading}
                className={cn(
                  "flex items-center space-x-2",
                  filter.isActive && "bg-blue-600 hover:bg-blue-700"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{t(filter.labelKey)}</span>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Precise Date-Time Range Selector */}
      <DateTimeRangeSelector
        value={filters.startDate && filters.endDate ? {
          startDate: filters.startDate,
          endDate: filters.endDate
        } : undefined}
        onChange={(range) => {
          const newFilters = {
            ...filters,
            startDate: range?.startDate,
            endDate: range?.endDate,
            datePreset: range ? undefined : filters.datePreset, // Clear date preset when using custom range
            page: 0
          };
          onFiltersChange(newFilters);
        }}
        disabled={isLoading}
      />

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="pt-4 border-t border-gray-200 space-y-6">
          {/* Smoke Detection Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                <Wind className="h-3.5 w-3.5 mr-1 text-gray-600" />
                {t('filters.smokeDetection')}
              </label>
              <Select
                value={filters.hasSmoke !== undefined ? String(filters.hasSmoke) : ''}
                onValueChange={(value) => handleFilterChange('hasSmoke', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('common.any')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.any')}</SelectItem>
                  <SelectItem value="true">{t('filters.detected')}</SelectItem>
                  <SelectItem value="false">{t('filters.notDetected')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.minDetections')}
              </label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 2"
                value={filters.detectionCount || ''}
                onChange={(e) => handleFilterChange('detectionCount', e.target.value ? parseInt(e.target.value) : undefined)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                <Wind className="h-3.5 w-3.5 mr-1 text-gray-600" />
                {t('filters.smokeConfidence')}
              </label>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.1"
                placeholder="0.0 - 1.0"
                value={filters.confidenceSmoke || ''}
                onChange={(e) => handleFilterChange('confidenceSmoke', e.target.value ? parseFloat(e.target.value) : undefined)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.detectionMode')}
              </label>
              <Select
                value={filters.detectionMode || ''}
                onValueChange={(value) => handleFilterChange('detectionMode', value || undefined)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('filters.anyMode')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('filters.anyMode')}</SelectItem>
                  <SelectItem value="smoke-only">{t('filters.smokeOnly')}</SelectItem>
                  <SelectItem value="both">{t('filters.both')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Device Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.cameraId')}
              </label>
              <Input
                type="text"
                placeholder="e.g., cam-01"
                value={filters.cameraId || ''}
                onChange={(e) => handleFilterChange('cameraId', e.target.value || undefined)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.cameraType')}
              </label>
              <Select
                value={filters.cameraTypes?.[0] || ''}
                onValueChange={(value) => handleFilterChange('cameraTypes', value ? [value] : undefined)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('filters.allTypes')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('filters.allTypes')}</SelectItem>
                  <SelectItem value="onvif">ONVIF</SelectItem>
                  <SelectItem value="rtsp">RTSP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.nodeId')}
              </label>
              <Input
                type="text"
                placeholder="e.g., node-01"
                value={filters.nodeId || ''}
                onChange={(e) => handleFilterChange('nodeId', e.target.value || undefined)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.deviceId')}
              </label>
              <Input
                type="text"
                placeholder="e.g., device-01"
                value={filters.deviceId || ''}
                onChange={(e) => handleFilterChange('deviceId', e.target.value || undefined)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.location')}
              </label>
              <Input
                type="text"
                placeholder="e.g., Building A"
                value={filters.location || ''}
                onChange={(e) => handleFilterChange('location', e.target.value || undefined)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.telegram')}
              </label>
              <Select
                value={filters.telegramSent !== undefined ? String(filters.telegramSent) : ''}
                onValueChange={(value) => handleFilterChange('telegramSent', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('common.any')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.any')}</SelectItem>
                  <SelectItem value="true">{t('filters.sent')}</SelectItem>
                  <SelectItem value="false">{t('filters.notSent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status & Images Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.status')}
              </label>
              <Select
                value={filters.status || ''}
                onValueChange={(value) => handleFilterChange('status', value || undefined)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('filters.allStatuses')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('filters.allStatuses')}</SelectItem>
                  <SelectItem value="success">{t('filters.success')}</SelectItem>
                  <SelectItem value="error">{t('filters.errorStatus')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.images')}
              </label>
              <Select
                value={filters.hasImage !== undefined ? String(filters.hasImage) : ''}
                onValueChange={(value) => handleFilterChange('hasImage', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('common.any')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.any')}</SelectItem>
                  <SelectItem value="true">{t('filters.withImages')}</SelectItem>
                  <SelectItem value="false">{t('filters.withoutImages')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Results Summary */}
      <div className="pt-4 border-t border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-gray-600">
          <div className="font-medium">
            {t('filters.results')}: {t('filters.executionsFound', { count: totalResults.toLocaleString() })}
          </div>
          <div className="text-gray-500">
            {t('filters.page', { current: String(currentPage), total: String(totalPages), size: String(pageSize) })}
          </div>
        </div>
      </div>
    </div>
  );
}