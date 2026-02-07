import { useState, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import {
  Calendar,
  Clock,
  X,
} from 'lucide-react';
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

export function DateTimeRangeSelector({
  value,
  onChange,
  className,
  disabled = false
}: DateTimeRangeSelectorProps) {
  const [startDate, setStartDate] = useState(value?.startDate || '');
  const [startTime, setStartTime] = useState(value?.startDate ? new Date(value.startDate).toTimeString().slice(0, 5) : '00:00');
  const [endDate, setEndDate] = useState(value?.endDate || '');
  const [endTime, setEndTime] = useState(value?.endDate ? new Date(value.endDate).toTimeString().slice(0, 5) : '23:59');


  const handleApply = useCallback(() => {
    if (!startDate || !endDate) {
      onChange(undefined);
      return;
    }

    const startDateTime = new Date(`${startDate}T${startTime}:00`);
    const endDateTime = new Date(`${endDate}T${endTime}:00`);

    if (startDateTime >= endDateTime) {
      // Invalid range, don't apply
      console.warn('Invalid date range: start time must be before end time');
      return;
    }

    console.log('Applying date range:', {
      start: startDateTime.toISOString(),
      end: endDateTime.toISOString()
    });

    onChange({
      startDate: startDateTime.toISOString(),
      endDate: endDateTime.toISOString()
    });
  }, [startDate, startTime, endDate, endTime, onChange]);

  const handleClear = useCallback(() => {
    setStartDate('');
    setStartTime('00:00');
    setEndDate('');
    setEndTime('23:59');
    onChange(undefined);
  }, [onChange]);


  const handlePreset = useCallback((minutes: number) => {
    const now = new Date();
    const start = new Date(now.getTime() - minutes * 60 * 1000);

    setStartDate(start.toISOString().split('T')[0]);
    setStartTime(start.toTimeString().slice(0, 5));
    setEndDate(now.toISOString().split('T')[0]);
    setEndTime(now.toTimeString().slice(0, 5));

    onChange({
      startDate: start.toISOString(),
      endDate: now.toISOString()
    });
  }, [onChange]);

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const hasActiveRange = value?.startDate && value?.endDate;

  return (
    <div className={cn("bg-white border border-gray-200 rounded-lg p-4 space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Calendar className="h-5 w-5 text-gray-600" />
          <h3 className="text-sm font-semibold text-gray-900">Precise Date-Time Range</h3>
          {hasActiveRange && (
            <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
              Active
            </Badge>
          )}
        </div>
        {hasActiveRange && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={disabled}
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Quick Presets */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-gray-500 self-center mr-2">Quick:</span>
        {[
          { label: '5 min', minutes: 5 },
          { label: '15 min', minutes: 15 },
          { label: '30 min', minutes: 30 },
          { label: '1 hour', minutes: 60 },
          { label: '2 hours', minutes: 120 },
          { label: '6 hours', minutes: 360 },
          { label: '12 hours', minutes: 720 },
          { label: '24 hours', minutes: 1440 },
        ].map((preset) => (
          <Button
            key={preset.minutes}
            variant="outline"
            size="sm"
            onClick={() => handlePreset(preset.minutes)}
            disabled={disabled}
            className="text-xs px-2 py-1 h-7"
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Date-Time Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Start Date-Time */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 flex items-center">
            <Clock className="h-3.5 w-3.5 mr-1" />
            Start Date & Time
          </label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={disabled}
              className="flex-1"
            />
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={disabled}
              className="w-24"
              step="60"
            />
          </div>
        </div>

        {/* End Date-Time */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 flex items-center">
            <Clock className="h-3.5 w-3.5 mr-1" />
            End Date & Time
          </label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={disabled}
              className="flex-1"
            />
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={disabled}
              className="w-24"
              step="60"
            />
          </div>
        </div>
      </div>

      {/* Apply Button */}
      <div className="flex justify-between items-center pt-2 border-t border-gray-200">
        <div className="text-xs text-gray-500">
          {hasActiveRange && (
            <span>
              Range: {formatDateTime(value!.startDate!)} → {formatDateTime(value!.endDate!)}
            </span>
          )}
        </div>
        <Button
          onClick={handleApply}
          disabled={disabled || !startDate || !endDate}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          Apply Range
        </Button>
      </div>
    </div>
  );
}