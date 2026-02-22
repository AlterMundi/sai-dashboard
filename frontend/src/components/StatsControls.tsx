import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useTranslation } from '@/contexts/LanguageContext';
import { useFilterOptions } from '@/hooks/useFilterOptions';
import { StatsFilters } from '@/types';
import { X } from 'lucide-react';
import { cn } from '@/utils';

// ─── helpers ────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function computeGranularity(start: string, end: string): 'day' | 'week' | 'month' {
  const days = Math.ceil(
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (days <= 30) return 'day';
  if (days <= 90) return 'week';
  return 'month';
}

function defaultFilters(): StatsFilters {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 7);
  return {
    startDate: toDateStr(start),
    endDate: toDateStr(today),
    granularity: 'day',
  };
}

const PRESETS: { label: string; key: string; applyDays?: number; applyMonths?: number; applyYears?: number }[] = [
  { label: '7d',  key: '7d',  applyDays: 7 },
  { label: '14d', key: '14d', applyDays: 14 },
  { label: '30d', key: '30d', applyDays: 30 },
  { label: '90d', key: '90d', applyDays: 90 },
  { label: '6m',  key: '6m',  applyMonths: 6 },
  { label: '1y',  key: '1y',  applyYears: 1 },
];

// ─── types ───────────────────────────────────────────────────────────────────

interface StatsControlsProps {
  value: StatsFilters;
  onChange: (filters: StatsFilters) => void;
  className?: string;
}

// ─── component ───────────────────────────────────────────────────────────────

export function StatsControls({ value, onChange, className }: StatsControlsProps) {
  const { t } = useTranslation();
  const { options, triggerFetch } = useFilterOptions();

  const [fromDate, setFromDate] = useState(value.startDate);
  const [toDate, setToDate]     = useState(value.endDate);
  const [dimensionKey, setDimensionKey] = useState<StatsFilters['dimensionKey']>(value.dimensionKey);
  const [dimensionValue, setDimensionValue] = useState(value.dimensionValue ?? '');

  // Sync local state when parent value changes (e.g. preset click from parent)
  useEffect(() => {
    setFromDate(value.startDate);
    setToDate(value.endDate);
    setDimensionKey(value.dimensionKey);
    setDimensionValue(value.dimensionValue ?? '');
  }, [value.startDate, value.endDate, value.dimensionKey, value.dimensionValue]);

  // Emit change whenever dates change
  const emitChange = useCallback(
    (start: string, end: string, dimKey?: StatsFilters['dimensionKey'], dimVal?: string) => {
      if (!start || !end) return;
      onChange({
        startDate: start,
        endDate: end,
        granularity: computeGranularity(start, end),
        dimensionKey: dimKey,
        dimensionValue: dimVal || undefined,
      });
    },
    [onChange]
  );

  const handleFromChange = useCallback((v: string) => {
    setFromDate(v);
    if (v && toDate) emitChange(v, toDate, dimensionKey, dimensionValue);
  }, [toDate, dimensionKey, dimensionValue, emitChange]);

  const handleToChange = useCallback((v: string) => {
    setToDate(v);
    if (fromDate && v) emitChange(fromDate, v, dimensionKey, dimensionValue);
  }, [fromDate, dimensionKey, dimensionValue, emitChange]);

  const handlePreset = useCallback((preset: typeof PRESETS[0]) => {
    // Parse date strings as LOCAL time (not UTC) to avoid off-by-one timezone shifts
    const parseLocal = (dateStr: string): Date => {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    const applyOffset = (anchor: Date, forward: boolean): Date => {
      const d = new Date(anchor);
      if (preset.applyDays)        forward ? d.setDate(d.getDate() + preset.applyDays!)              : d.setDate(d.getDate() - preset.applyDays!);
      else if (preset.applyMonths) forward ? d.setMonth(d.getMonth() + preset.applyMonths!)          : d.setMonth(d.getMonth() - preset.applyMonths!);
      else if (preset.applyYears)  forward ? d.setFullYear(d.getFullYear() + preset.applyYears!)     : d.setFullYear(d.getFullYear() - preset.applyYears!);
      return d;
    };

    let s: string, e: string;
    if (fromDate) {
      const anchor = parseLocal(fromDate);
      s = toDateStr(anchor);
      e = toDateStr(applyOffset(anchor, true));
    } else if (toDate) {
      const anchor = parseLocal(toDate);
      s = toDateStr(applyOffset(anchor, false));
      e = toDateStr(anchor);
    } else {
      const today = new Date();
      s = toDateStr(applyOffset(today, false));
      e = toDateStr(today);
    }
    setFromDate(s);
    setToDate(e);
    emitChange(s, e, dimensionKey, dimensionValue);
  }, [fromDate, toDate, dimensionKey, dimensionValue, emitChange]);

  const handleClear = useCallback(() => {
    const def = defaultFilters();
    setFromDate(def.startDate);
    setToDate(def.endDate);
    setDimensionKey(undefined);
    setDimensionValue('');
    onChange(def);
  }, [onChange]);

  const handleDimensionKeyChange = useCallback((key: string) => {
    const dk = (key === 'all' ? undefined : key) as StatsFilters['dimensionKey'];
    setDimensionKey(dk);
    setDimensionValue('');
    if (dk) triggerFetch();
    emitChange(fromDate, toDate, dk, undefined);
  }, [fromDate, toDate, triggerFetch, emitChange]);

  const handleDimensionValueChange = useCallback((v: string) => {
    setDimensionValue(v);
    emitChange(fromDate, toDate, dimensionKey, v || undefined);
  }, [fromDate, toDate, dimensionKey, emitChange]);

  const granLabel = t(`stats.granularity.${value.granularity}`);

  // Available values for the selected dimension
  const dimValues: string[] = dimensionKey
    ? (options[dimensionKey === 'yoloModelVersion' ? 'yoloModelVersion' : dimensionKey] ?? [])
    : [];

  const hasCustomRange =
    value.startDate !== defaultFilters().startDate ||
    value.endDate !== defaultFilters().endDate;

  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2', className)}>

      {/* From date */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 shrink-0">{t('stats.period.from')}</label>
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => handleFromChange(e.target.value)}
          className="h-8 text-sm w-auto"
        />
      </div>

      {/* Quick presets */}
      <div className="flex items-center gap-1 flex-nowrap overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] pb-px sm:pb-0">
        <div className="hidden sm:block h-5 w-px bg-gray-300 mx-1" />
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            variant="outline"
            size="sm"
            onClick={() => handlePreset(p)}
            className="text-xs px-2 py-0.5 h-6 shrink-0"
          >
            {t(`stats.period.presets.${p.key}`)}
          </Button>
        ))}
        <div className="hidden sm:block h-5 w-px bg-gray-300 mx-1" />
      </div>

      {/* To date + granularity badge + clear */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 shrink-0">{t('stats.period.to')}</label>
        <Input
          type="date"
          value={toDate}
          onChange={(e) => handleToChange(e.target.value)}
          className="h-8 text-sm w-auto"
        />
        {/* Granularity badge */}
        <span className="text-[10px] uppercase tracking-widest text-gray-400 shrink-0">
          · {granLabel}
        </span>
        {hasCustomRange && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600 shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Vertical separator */}
      <div className="hidden sm:block h-5 w-px bg-gray-300 mx-1" />

      {/* Dimension filter */}
      <div className="flex items-center">
        <div className="divide-x rounded-lg border border-gray-200 overflow-hidden flex text-sm">
          {/* Dimension type */}
          <select
            value={dimensionKey ?? 'all'}
            onChange={(e) => handleDimensionKeyChange(e.target.value)}
            className="h-8 px-2 text-xs bg-white text-gray-700 focus:outline-none cursor-pointer"
          >
            <option value="all">{t('stats.dimension.all')}</option>
            <option value="cameraId">{t('stats.dimension.cameraId')}</option>
            <option value="location">{t('stats.dimension.location')}</option>
            <option value="nodeId">{t('stats.dimension.nodeId')}</option>
            <option value="yoloModelVersion">{t('stats.dimension.yoloModel')}</option>
          </select>

          {/* Dimension value (conditional) */}
          {dimensionKey && (
            <select
              value={dimensionValue}
              onChange={(e) => handleDimensionValueChange(e.target.value)}
              className="h-8 px-2 text-xs bg-white text-gray-700 focus:outline-none cursor-pointer border-l border-gray-200"
            >
              <option value="">{t('common.any')}</option>
              {dimValues.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}

export { defaultFilters as defaultStatsFilters };
