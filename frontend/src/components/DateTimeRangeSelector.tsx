import { useState, useCallback, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
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

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const presets = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '6h', minutes: 360 },
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
  const [from, setFrom] = useState(value?.startDate ? toLocalDatetime(value.startDate) : '');
  const [to, setTo] = useState(value?.endDate ? toLocalDatetime(value.endDate) : '');

  // Sync external value changes (e.g. preset clicks) into local state
  useEffect(() => {
    setFrom(value?.startDate ? toLocalDatetime(value.startDate) : '');
    setTo(value?.endDate ? toLocalDatetime(value.endDate) : '');
  }, [value?.startDate, value?.endDate]);

  // Auto-apply when both inputs are valid and form a valid range
  useEffect(() => {
    if (!from || !to) return;
    const start = new Date(from);
    const end = new Date(to);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
    if (start >= end) return;

    const startIso = start.toISOString();
    const endIso = end.toISOString();

    // Only fire if actually different from current value
    if (value?.startDate === startIso && value?.endDate === endIso) return;

    onChange({ startDate: startIso, endDate: endIso });
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = useCallback(() => {
    setFrom('');
    setTo('');
    onChange(undefined);
  }, [onChange]);

  const handlePreset = useCallback((minutes: number) => {
    const offset = minutes * 60 * 1000;
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    if (fromDate && !isNaN(fromDate.getTime())) {
      // From is set (takes precedence even if To is also set): N minutes after From
      onChange({
        startDate: fromDate.toISOString(),
        endDate: new Date(fromDate.getTime() + offset).toISOString()
      });
    } else if (toDate && !isNaN(toDate.getTime())) {
      // Only To is set: N minutes before To
      onChange({
        startDate: new Date(toDate.getTime() - offset).toISOString(),
        endDate: toDate.toISOString()
      });
    } else {
      // Neither set: N minutes before now
      const now = new Date();
      onChange({
        startDate: new Date(now.getTime() - offset).toISOString(),
        endDate: now.toISOString()
      });
    }
  }, [from, to, onChange]);

  const hasActiveRange = value?.startDate && value?.endDate;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* From / To datetime-local inputs + clear */}
      <label className="text-xs text-gray-500">{t('dateRange.from')}</label>
      <Input
        type="datetime-local"
        lang="en-GB"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        disabled={disabled}
        className="h-8 text-sm w-auto"
      />
      <label className="text-xs text-gray-500">{t('dateRange.to')}</label>
      <Input
        type="datetime-local"
        lang="en-GB"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        disabled={disabled}
        className="h-8 text-sm w-auto"
      />
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

      {/* Separator */}
      <div className="h-5 w-px bg-gray-300 mx-1" />

      {/* Quick presets to the right */}
      <span className="text-xs text-gray-500">{t('dateRange.quick')}</span>
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
    </div>
  );
}
