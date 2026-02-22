import { useState, useCallback, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { TimePicker24h } from './ui/TimePicker24h';
import { useTranslation } from '@/contexts/LanguageContext';
import { X } from 'lucide-react';
import { cn } from '@/utils';

interface DateTimeRange {
  startDate?: string;
  endDate?: string;
}

interface DateTimeRangeSelectorProps {
  value?: DateTimeRange;
  onChange: (range: DateTimeRange | undefined) => void;
  className?: string;
  disabled?: boolean;
}

function toDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function combine(date: string, time: string): Date | null {
  if (!date) return null;
  const d = new Date(`${date}T${time || '00:00'}`);
  return isNaN(d.getTime()) ? null : d;
}

const presets = [
  { label: '5m',  minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h',  minutes: 60 },
  { label: '2h',  minutes: 120 },
  { label: '6h',  minutes: 360 },
  { label: '12h', minutes: 720 },
  { label: '24h', minutes: 1440 },
];

export function DateTimeRangeSelector({
  value,
  onChange,
  className,
  disabled = false
}: DateTimeRangeSelectorProps) {
  const { t } = useTranslation();

  const [fromDate, setFromDate] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toDate,   setToDate]   = useState('');
  const [toTime,   setToTime]   = useState('');
  const [lastTouched, setLastTouched] = useState<'from' | 'to'>('to');

  useEffect(() => {
    if (value?.startDate) {
      const { date, time } = toDateParts(value.startDate);
      setFromDate(date); setFromTime(time);
    } else {
      setFromDate(''); setFromTime('');
    }
    if (value?.endDate) {
      const { date, time } = toDateParts(value.endDate);
      setToDate(date); setToTime(time);
    } else {
      setToDate(''); setToTime('');
    }
  }, [value?.startDate, value?.endDate]);

  useEffect(() => {
    const start = combine(fromDate, fromTime);
    const end   = combine(toDate,   toTime);
    if (!start || !end || start >= end) return;
    const startIso = start.toISOString();
    const endIso   = end.toISOString();
    if (value?.startDate === startIso && value?.endDate === endIso) return;
    onChange({ startDate: startIso, endDate: endIso });
  }, [fromDate, fromTime, toDate, toTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = useCallback(() => {
    setFromDate(''); setFromTime('');
    setToDate('');   setToTime('');
    onChange(undefined);
  }, [onChange]);

  const handlePreset = useCallback((minutes: number) => {
    const offset = minutes * 60 * 1000;
    const fromDt = combine(fromDate, fromTime);
    const toDt   = combine(toDate,   toTime);
    if (lastTouched === 'from' && fromDt) {
      onChange({ startDate: fromDt.toISOString(), endDate: new Date(fromDt.getTime() + offset).toISOString() });
    } else if (toDt) {
      onChange({ startDate: new Date(toDt.getTime() - offset).toISOString(), endDate: toDt.toISOString() });
    } else if (fromDt) {
      onChange({ startDate: fromDt.toISOString(), endDate: new Date(fromDt.getTime() + offset).toISOString() });
    } else {
      const now = new Date();
      onChange({ startDate: new Date(now.getTime() - offset).toISOString(), endDate: now.toISOString() });
    }
  }, [lastTouched, fromDate, fromTime, toDate, toTime, onChange]);

  const hasActiveRange = value?.startDate && value?.endDate;

  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2', className)}>

      {/* From */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          <label className="text-xs text-gray-500 shrink-0">{t('dateRange.from')}</label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setLastTouched('from'); }}
            disabled={disabled}
            className="h-8 text-sm w-auto"
          />
        </div>
        <TimePicker24h value={fromTime} onChange={(v) => { setFromTime(v); setLastTouched('from'); }} disabled={disabled} />
      </div>

      {/* Quick presets */}
      <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden [scrollbar-width:none] pb-px sm:pb-0">
        <div className="hidden sm:block h-5 w-px bg-gray-300 mx-1" />
        {presets.map((p) => (
          <Button
            key={p.minutes}
            variant="outline"
            size="sm"
            onClick={() => handlePreset(p.minutes)}
            disabled={disabled}
            className="text-xs px-2 py-0.5 h-6"
          >
            {p.label}
          </Button>
        ))}
        <div className="hidden sm:block h-5 w-px bg-gray-300 mx-1" />
      </div>

      {/* To */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          <label className="text-xs text-gray-500 shrink-0">{t('dateRange.to')}</label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setLastTouched('to'); }}
            disabled={disabled}
            className="h-8 text-sm w-auto"
          />
        </div>
        <TimePicker24h value={toTime} onChange={(v) => { setToTime(v); setLastTouched('to'); }} disabled={disabled} />
        {hasActiveRange && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={disabled}
            className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
