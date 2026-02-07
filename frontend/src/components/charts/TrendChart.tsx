import { useMemo } from 'react';
import { cn } from '@/utils';

interface DataPoint {
  date: string;
  fire: number;
  smoke: number;
  total: number;
}

interface TrendChartProps {
  data: DataPoint[];
  title?: string;
  className?: string;
}

/**
 * Simple CSS-based trend chart showing fire/smoke detections over time.
 * No external charting library required.
 */
export function TrendChart({ data, title, className }: TrendChartProps) {
  const { maxValue, chartData } = useMemo(() => {
    if (!data || data.length === 0) {
      return { maxValue: 0, chartData: [] };
    }

    const max = Math.max(...data.map(d => Math.max(d.fire, d.smoke, d.total)));
    return {
      maxValue: max || 1,
      chartData: data.slice(-14), // Last 14 days
    };
  }, [data]);

  if (chartData.length === 0) {
    return (
      <div className={cn('bg-white rounded-lg shadow p-6', className)}>
        <h3 className="text-lg font-semibold mb-4">{title || 'Detection Trends'}</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">
          No data available
        </div>
      </div>
    );
  }

  return (
    <div className={cn('bg-white rounded-lg shadow p-6', className)}>
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}

      {/* Legend */}
      <div className="flex items-center gap-6 mb-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span className="text-gray-600">Fire</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gray-400" />
          <span className="text-gray-600">Smoke</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span className="text-gray-600">Total</span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative h-48">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-6 w-8 flex flex-col justify-between text-xs text-gray-400">
          <span>{maxValue}</span>
          <span>{Math.round(maxValue / 2)}</span>
          <span>0</span>
        </div>

        {/* Chart area */}
        <div className="ml-10 h-full flex items-end gap-1">
          {chartData.map((point, index) => {
            const fireHeight = (point.fire / maxValue) * 100;
            const smokeHeight = (point.smoke / maxValue) * 100;
            const totalHeight = (point.total / maxValue) * 100;

            return (
              <div
                key={point.date}
                className="flex-1 flex flex-col items-center group relative"
              >
                {/* Bars container */}
                <div className="w-full flex-1 flex items-end justify-center gap-0.5 mb-1">
                  {/* Fire bar */}
                  <div
                    className="w-2 bg-red-500 rounded-t transition-all hover:bg-red-600"
                    style={{ height: `${fireHeight}%`, minHeight: point.fire > 0 ? '2px' : 0 }}
                    title={`Fire: ${point.fire}`}
                  />
                  {/* Smoke bar */}
                  <div
                    className="w-2 bg-gray-400 rounded-t transition-all hover:bg-gray-500"
                    style={{ height: `${smokeHeight}%`, minHeight: point.smoke > 0 ? '2px' : 0 }}
                    title={`Smoke: ${point.smoke}`}
                  />
                  {/* Total bar (behind, lighter) */}
                  <div
                    className="w-2 bg-blue-200 rounded-t transition-all hover:bg-blue-300"
                    style={{ height: `${totalHeight}%`, minHeight: point.total > 0 ? '2px' : 0 }}
                    title={`Total: ${point.total}`}
                  />
                </div>

                {/* X-axis label (show every other on mobile, all on desktop) */}
                <span className={cn(
                  'text-xs text-gray-400 transform -rotate-45 origin-top-left whitespace-nowrap',
                  index % 2 !== 0 && 'hidden sm:inline'
                )}>
                  {formatDateLabel(point.date)}
                </span>

                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    <div className="font-medium">{formatDateLabel(point.date, true)}</div>
                    <div className="text-red-300">Fire: {point.fire}</div>
                    <div className="text-gray-300">Smoke: {point.smoke}</div>
                    <div className="text-blue-300">Total: {point.total}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatDateLabel(dateStr: string, full = false): string {
  try {
    const date = new Date(dateStr);
    if (full) {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * Sparkline-style mini chart for dashboard cards
 */
export function MiniTrendChart({ data, color = 'blue', className }: {
  data: number[];
  color?: 'blue' | 'red' | 'green' | 'gray';
  className?: string;
}) {
  const max = Math.max(...data, 1);
  const colorClass = {
    blue: 'bg-blue-500',
    red: 'bg-red-500',
    green: 'bg-green-500',
    gray: 'bg-gray-400',
  }[color];

  return (
    <div className={cn('flex items-end gap-px h-8', className)}>
      {data.slice(-10).map((value, i) => (
        <div
          key={i}
          className={cn('flex-1 rounded-t', colorClass)}
          style={{
            height: `${(value / max) * 100}%`,
            minHeight: value > 0 ? '2px' : 0,
            opacity: 0.4 + (i / data.length) * 0.6,
          }}
        />
      ))}
    </div>
  );
}
