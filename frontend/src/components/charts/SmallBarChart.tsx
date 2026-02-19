import { useMemo } from 'react';
import { cn } from '@/utils';

interface BarSeries {
  key: string;
  label: string;
  color: string; // Tailwind bg class, e.g. 'bg-red-500'
}

interface SimpleBarChartProps {
  title: string;
  data: Array<{ date: string; value: number }>;
  color: string; // Tailwind bg class
  unit?: string; // e.g. '%' for confidence
  emptyMessage?: string;
  className?: string;
}

interface StackedBarChartProps {
  title: string;
  data: Array<{ date: string; [key: string]: number | string }>;
  series: BarSeries[];
  emptyMessage?: string;
  className?: string;
}

function formatDay(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function SimpleBarChart({
  title,
  data,
  color,
  unit = '',
  emptyMessage = 'No data',
  className,
}: SimpleBarChartProps) {
  const maxValue = useMemo(() => Math.max(...data.map(d => d.value), 1), [data]);
  const hasData = data.some(d => d.value > 0);

  return (
    <div className={cn('bg-white rounded-lg shadow p-4', className)}>
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {!hasData ? (
        <div className="h-24 flex items-center justify-center text-xs text-gray-400">
          {emptyMessage}
        </div>
      ) : (
        <div className="flex items-end gap-1 h-24">
          {data.map((point) => {
            const height = (point.value / maxValue) * 100;
            return (
              <div key={point.date} className="flex-1 flex flex-col items-center group relative">
                <div
                  className={cn('w-full rounded-t transition-opacity hover:opacity-80', color)}
                  style={{ height: `${height}%`, minHeight: point.value > 0 ? '2px' : 0 }}
                  title={`${formatDay(point.date)}: ${point.value}${unit}`}
                />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 pointer-events-none">
                  <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    {formatDay(point.date)}: <span className="font-semibold">{point.value}{unit}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {hasData && data.length > 0 && (
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-400">{formatDay(data[0].date)}</span>
          <span className="text-xs text-gray-400">{formatDay(data[data.length - 1].date)}</span>
        </div>
      )}
    </div>
  );
}

export function StackedBarChart({
  title,
  data,
  series,
  emptyMessage = 'No data',
  className,
}: StackedBarChartProps) {
  const maxValue = useMemo(() => {
    return Math.max(
      ...data.map(d => series.reduce((sum, s) => sum + ((d[s.key] as number) || 0), 0)),
      1
    );
  }, [data, series]);

  const hasData = data.some(d => series.some(s => (d[s.key] as number) > 0));

  return (
    <div className={cn('bg-white rounded-lg shadow p-4', className)}>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
      <div className="flex flex-wrap gap-3 mb-2">
        {series.map(s => (
          <div key={s.key} className="flex items-center gap-1">
            <div className={cn('w-2 h-2 rounded-full', s.color)} />
            <span className="text-xs text-gray-500">{s.label}</span>
          </div>
        ))}
      </div>
      {!hasData ? (
        <div className="h-24 flex items-center justify-center text-xs text-gray-400">
          {emptyMessage}
        </div>
      ) : (
        <div className="flex items-end gap-1 h-20">
          {data.map((point) => {
            const total = series.reduce((sum, s) => sum + ((point[s.key] as number) || 0), 0);
            const totalHeight = (total / maxValue) * 100;
            return (
              <div
                key={point.date as string}
                className="flex-1 flex flex-col justify-end group relative"
                style={{ height: '100%' }}
                title={`${formatDay(point.date as string)}: ${total}`}
              >
                <div
                  className="w-full flex flex-col-reverse rounded-t overflow-hidden"
                  style={{ height: `${totalHeight}%`, minHeight: total > 0 ? '2px' : 0 }}
                >
                  {series.map(s => {
                    const val = (point[s.key] as number) || 0;
                    const segHeight = total > 0 ? (val / total) * 100 : 0;
                    return (
                      <div
                        key={s.key}
                        className={cn('w-full', s.color)}
                        style={{ height: `${segHeight}%`, minHeight: val > 0 ? '1px' : 0 }}
                      />
                    );
                  })}
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 pointer-events-none">
                  <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    <div className="font-medium mb-0.5">{formatDay(point.date as string)}</div>
                    {series.map(s => (
                      <div key={s.key}>{s.label}: {(point[s.key] as number) || 0}</div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {hasData && data.length > 0 && (
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-400">{formatDay(data[0].date as string)}</span>
          <span className="text-xs text-gray-400">{formatDay(data[data.length - 1].date as string)}</span>
        </div>
      )}
    </div>
  );
}
