import { useMemo } from 'react';
import { cn } from '@/utils';

interface BarSeries {
  key: string;
  label: string;
  color: string;   // CSS color value (hex/rgb) for tooltip dot
  bgClass: string; // Tailwind bg class for bars and legend
}

interface SimpleBarChartProps {
  title: string;
  data: Array<{ date: string; value: number }>;
  color: string;    // CSS hex/rgb color for tooltip accent
  bgClass: string;  // Tailwind bg class for bars
  unit?: string;
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

function formatDayShort(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return String(d.getUTCDate());
  } catch {
    return dateStr;
  }
}

const CHART_H = 140; // px
const GRID_LINES = [0.25, 0.5, 0.75, 1];

export function SimpleBarChart({
  title,
  data,
  color,
  bgClass,
  unit = '',
  emptyMessage = 'No data',
  className,
}: SimpleBarChartProps) {
  const maxValue = useMemo(() => Math.max(...data.map(d => d.value), 1), [data]);
  const hasData = data.some(d => d.value > 0);

  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 p-5', className)}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">{title}</h3>

      <div className="relative" style={{ height: CHART_H }}>
        {/* Gridlines */}
        {GRID_LINES.map(pct => (
          <div
            key={pct}
            className="absolute left-0 right-0 border-t border-dashed border-gray-100"
            style={{ bottom: `${pct * 100}%` }}
          />
        ))}

        {!hasData ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-300 font-medium tracking-wide uppercase">
            {emptyMessage}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-end gap-1">
            {data.map((point) => {
              const heightPct = (point.value / maxValue) * 100;
              const showLabel = point.value > 0;
              return (
                <div
                  key={point.date}
                  className="flex-1 flex flex-col items-center justify-end group relative h-full"
                >
                  {/* Value label above bar */}
                  {showLabel && (
                    <span
                      className="absolute text-[10px] font-semibold tabular-nums text-gray-500 leading-none"
                      style={{ bottom: `${heightPct}%`, transform: 'translateY(-4px)' }}
                    >
                      {point.value}{unit}
                    </span>
                  )}

                  {/* Bar */}
                  <div
                    className={cn('w-full rounded-sm transition-opacity hover:opacity-70', bgClass)}
                    style={{ height: `${heightPct}%`, minHeight: point.value > 0 ? 3 : 0 }}
                  />

                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 pointer-events-none">
                    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
                      <div className="font-medium text-gray-300 mb-0.5">{formatDay(point.date)}</div>
                      <div className="font-bold" style={{ color }}>{point.value}{unit}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* X-axis labels — all days */}
      {hasData && (
        <div className="flex gap-1 mt-2">
          {data.map((point) => (
            <div key={point.date} className="flex-1 text-center">
              <span className="text-[9px] text-gray-300 font-medium tabular-nums">
                {formatDayShort(point.date)}
              </span>
            </div>
          ))}
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
  const maxValue = useMemo(
    () => Math.max(...data.map(d => series.reduce((s, { key }) => s + ((d[key] as number) || 0), 0)), 1),
    [data, series]
  );
  const hasData = data.some(d => series.some(({ key }) => (d[key] as number) > 0));

  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 p-5', className)}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">{title}</h3>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4">
        {series.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className={cn('w-2 h-2 rounded-sm flex-shrink-0', s.bgClass)} />
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="relative" style={{ height: CHART_H }}>
        {/* Gridlines */}
        {GRID_LINES.map(pct => (
          <div
            key={pct}
            className="absolute left-0 right-0 border-t border-dashed border-gray-100"
            style={{ bottom: `${pct * 100}%` }}
          />
        ))}

        {!hasData ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-300 font-medium tracking-wide uppercase">
            {emptyMessage}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-end gap-1">
            {data.map((point) => {
              const total = series.reduce((s, { key }) => s + ((point[key] as number) || 0), 0);
              const totalHeightPct = (total / maxValue) * 100;
              return (
                <div
                  key={point.date as string}
                  className="flex-1 flex flex-col items-center justify-end group relative h-full"
                >
                  {total > 0 && (
                    <span
                      className="absolute text-[10px] font-semibold tabular-nums text-gray-500 leading-none"
                      style={{ bottom: `${totalHeightPct}%`, transform: 'translateY(-4px)' }}
                    >
                      {total}
                    </span>
                  )}

                  {/* Stacked bar */}
                  <div
                    className="w-full rounded-sm overflow-hidden flex flex-col-reverse"
                    style={{ height: `${totalHeightPct}%`, minHeight: total > 0 ? 3 : 0 }}
                  >
                    {series.map(({ key, bgClass }) => {
                      const val = (point[key] as number) || 0;
                      const segPct = total > 0 ? (val / total) * 100 : 0;
                      return (
                        <div
                          key={key}
                          className={cn('w-full flex-shrink-0', bgClass)}
                          style={{ height: `${segPct}%`, minHeight: val > 0 ? 1 : 0 }}
                        />
                      );
                    })}
                  </div>

                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 pointer-events-none">
                    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
                      <div className="font-medium text-gray-300 mb-1">{formatDay(point.date as string)}</div>
                      {series.map(({ key, label, bgClass }) => {
                        const val = (point[key] as number) || 0;
                        if (!val) return null;
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <div className={cn('w-2 h-2 rounded-sm', bgClass)} />
                            <span className="text-gray-300">{label}:</span>
                            <span className="font-bold">{val}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* X-axis labels */}
      {hasData && (
        <div className="flex gap-1 mt-2">
          {data.map((point) => (
            <div key={point.date as string} className="flex-1 text-center">
              <span className="text-[9px] text-gray-300 font-medium tabular-nums">
                {formatDayShort(point.date as string)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
