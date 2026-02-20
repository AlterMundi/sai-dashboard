import { useState, useCallback } from 'react';
import { ExecutionFilters } from '@/types';
import { useFilterOptions } from '@/hooks/useFilterOptions';
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
  className?: string;
}

export function AlertFilterComponent({
  filters,
  onFiltersChange,
  onReset,
  isLoading = false,
  totalResults = 0,
  className
}: AlertFilterComponentProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { options, isLoading: optionsLoading, triggerFetch } = useFilterOptions();

  const handleToggleAdvanced = useCallback(() => {
    setShowAdvanced(prev => {
      if (!prev) triggerFetch();
      return !prev;
    });
  }, [triggerFetch]);

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

  // Smoke master toggle: active only when all three alert levels are on
  const SMOKE_ALERT_LEVELS = ['critical', 'high', 'low'] as const;
  const smokeAllActive = SMOKE_ALERT_LEVELS.every(l => filters.alertLevels?.includes(l));

  const handleSmokeToggle = () => {
    if (smokeAllActive) {
      onFiltersChange({ ...filters, alertLevels: undefined, hasSmoke: undefined, page: 0 });
    } else {
      onFiltersChange({ ...filters, alertLevels: ['critical', 'high', 'low'], hasSmoke: true, page: 0 });
    }
  };

  const handleAlertLevelToggle = (level: 'critical' | 'high' | 'low') => {
    const currentLevels = filters.alertLevels || [];
    const newLevels = currentLevels.includes(level)
      ? currentLevels.filter(l => l !== level)
      : [...currentLevels, level];
    // If deselecting a level while smoke master was fully on, also clear hasSmoke
    const newHasSmoke = newLevels.length === 3 ? filters.hasSmoke : undefined;
    onFiltersChange({ ...filters, alertLevels: newLevels.length > 0 ? newLevels : undefined, hasSmoke: newHasSmoke, page: 0 });
  };

  return (
    <div className={cn("bg-white border border-gray-200 rounded-lg p-6 space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Filter className="h-5 w-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">{t('filters.title')}</h2>
          {activeCount > 0 && (
            <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
              {activeCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center space-x-2">
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

      {/* Basic Filters — mobile: 3 stacked rows, desktop: single flex row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">

        {/* Row 1 (mobile) / first (desktop): Location | Camera | All Time */}
        <div className="order-1 flex items-center divide-x divide-gray-200 rounded-lg border border-gray-200 bg-white overflow-hidden w-full sm:w-auto">
          <Select
            value={filters.location || ''}
            onValueChange={(value) => handleFilterChange('location', value || undefined)}
          >
            <SelectTrigger className="border-0 rounded-none shadow-none h-9 px-3 gap-1.5 text-sm text-gray-700 focus:ring-0 flex-1 sm:min-w-[150px] sm:flex-none">
              <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <SelectValue placeholder={t('filters.allLocations')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t('filters.allLocations')}</SelectItem>
              {options.location.map((loc) => (
                <SelectItem key={loc} value={loc}>{loc}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.cameraId || ''}
            onValueChange={(value) => handleFilterChange('cameraId', value || undefined)}
          >
            <SelectTrigger className="border-0 rounded-none shadow-none h-9 px-3 gap-1.5 text-sm text-gray-700 focus:ring-0 flex-1 sm:min-w-[140px] sm:flex-none">
              <Camera className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <SelectValue placeholder={t('filters.allCameras')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t('filters.allCameras')}</SelectItem>
              {options.cameraId.map((id) => (
                <SelectItem key={id} value={id}>{id}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.datePreset || ''}
            onValueChange={(value) => handleFilterChange('datePreset', value || undefined)}
          >
            <SelectTrigger className="border-0 rounded-none shadow-none h-9 px-3 gap-1.5 text-sm text-gray-700 focus:ring-0 flex-1 sm:min-w-[120px] sm:flex-none">
              <Calendar className="h-3.5 w-3.5 text-gray-400 shrink-0" />
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

        {/* Row 2 (mobile) / last (desktop): Smoke Detections */}
        <div className="order-2 sm:order-3 flex justify-center sm:justify-start">
          <Button
            variant={smokeAllActive ? 'default' : 'outline'}
            size="sm"
            onClick={handleSmokeToggle}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5',
              smokeAllActive && 'bg-gray-700 hover:bg-gray-800 text-white'
            )}
          >
            <Wind className="h-3.5 w-3.5" />
            {t('filters.smokeDetections')}
          </Button>
        </div>

        {/* Row 3 (mobile) / second (desktop): Critical | High | Low */}
        <div className="order-3 sm:order-2 flex justify-center sm:justify-start">
          <div className="flex items-center divide-x divide-gray-200 rounded-lg border border-gray-200 bg-white overflow-hidden">
            {(['critical', 'high', 'low'] as const).map((level) => {
              const isActive = !!filters.alertLevels?.includes(level);
              const activeStyles: Record<string, string> = {
                critical: 'bg-red-50 text-red-700',
                high: 'bg-orange-50 text-orange-700',
                low: 'bg-blue-50 text-blue-700',
              };
              return (
                <button
                  key={level}
                  onClick={() => handleAlertLevelToggle(level)}
                  disabled={isLoading}
                  className={cn(
                    'flex items-center gap-1.5 h-9 px-3 text-sm font-medium transition-colors',
                    isActive ? activeStyles[level] : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  )}
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {t(`filters.${level}`)}
                </button>
              );
            })}
          </div>
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
                {t('filters.saiModel')}
              </label>
              <Select
                value={filters.yoloModelVersion || ''}
                onValueChange={(value) => handleFilterChange('yoloModelVersion', value || undefined)}
                disabled={optionsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('filters.anySaiModel')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('filters.anySaiModel')}</SelectItem>
                  {options.yoloModelVersion.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
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
              <Select
                value={filters.cameraId || ''}
                onValueChange={(value) => handleFilterChange('cameraId', value || undefined)}
                disabled={optionsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('filters.allCameras')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('filters.allCameras')}</SelectItem>
                  {options.cameraId.map((id) => (
                    <SelectItem key={id} value={id}>{id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Select
                value={filters.nodeId || ''}
                onValueChange={(value) => handleFilterChange('nodeId', value || undefined)}
                disabled={optionsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('filters.allNodes')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('filters.allNodes')}</SelectItem>
                  {options.nodeId.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('filters.deviceId')}
              </label>
              <Select
                value={filters.deviceId || ''}
                onValueChange={(value) => handleFilterChange('deviceId', value || undefined)}
                disabled={optionsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('filters.allDevices')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('filters.allDevices')}</SelectItem>
                  {options.deviceId.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        <div className="flex items-center justify-between gap-3 text-sm text-gray-600">
          <div className="font-medium">
            {t('filters.results')}: {t('filters.executionsFound', { count: totalResults.toLocaleString() })}
          </div>
          <div className="flex items-center">
            <button
              onClick={handleToggleAdvanced}
              className="sm:hidden text-gray-600 hover:text-gray-900 flex items-center"
              aria-label={showAdvanced ? t('filters.basic') : t('filters.advanced')}
            >
              <ChevronDown className={cn(
                "h-4 w-4 transition-transform",
                showAdvanced && "rotate-180"
              )} />
            </button>
            <button
              onClick={handleToggleAdvanced}
              className="hidden sm:flex text-sm text-gray-600 hover:text-gray-900 items-center"
            >
              {showAdvanced ? t('filters.basic') : t('filters.advanced')}
              <ChevronDown className={cn(
                "h-4 w-4 ml-1 transition-transform",
                showAdvanced && "rotate-180"
              )} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
