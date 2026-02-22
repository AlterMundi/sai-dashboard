import { useTranslation } from '@/contexts/LanguageContext';
import { useStatsRanking } from '@/hooks/useExecutions';
import { StatsRankingItem } from '@/types';
import { cn } from '@/utils';

interface RankingPanelProps {
  startDate: string;
  endDate: string;
  className?: string;
  onItemClick?: (dimension: 'cameraId' | 'location' | 'nodeId', value: string) => void;
}

interface MiniBarListProps {
  title: string;
  items: StatsRankingItem[];
  getValue: (item: StatsRankingItem) => number;
  bgClass: string;
  noDataLabel: string;
  onItemClick?: (id: string) => void;
}

function MiniBarList({ title, items, getValue, bgClass, noDataLabel, onItemClick }: MiniBarListProps) {
  const sorted = [...items].sort((a, b) => getValue(b) - getValue(a));
  const maxVal = Math.max(...sorted.map(getValue), 1);

  return (
    <div>
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-gray-300">{noDataLabel}</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((item) => {
            const val = getValue(item);
            const widthPct = (val / maxVal) * 100;
            return (
              <div
                key={item.id}
                className={cn(
                  'flex items-center gap-2',
                  onItemClick && 'cursor-pointer hover:bg-gray-50 -mx-1 px-1 rounded transition-colors',
                )}
                role={onItemClick ? 'button' : undefined}
                onClick={onItemClick ? () => onItemClick(item.id) : undefined}
              >
                <span className="text-[11px] text-gray-500 w-24 truncate shrink-0" title={item.id}>
                  {item.id}
                </span>
                <div className="flex-1 h-3 bg-gray-100 rounded-sm overflow-hidden">
                  <div
                    className={cn('h-full rounded-sm transition-all', bgClass)}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-gray-500 w-6 text-right shrink-0">
                  {val}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RankingPanel({ startDate, endDate, className, onItemClick }: RankingPanelProps) {
  const { t } = useTranslation();
  const { ranking, isLoading } = useStatsRanking(startDate, endDate);

  if (isLoading && !ranking) {
    return (
      <div className={cn('bg-white rounded-xl border border-gray-100 p-5', className)}>
        <div className="h-4 w-32 bg-gray-100 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              {[0, 1, 2, 3, 4].map((j) => (
                <div key={j} className="flex items-center gap-2">
                  <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
                  <div className="flex-1 h-3 bg-gray-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!ranking) return null;

  const noData = t('stats.ranking.noData');

  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 p-5', className)}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-5">
        {t('stats.ranking.title')}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MiniBarList
          title={t('stats.ranking.cameras')}
          items={ranking.cameras}
          getValue={(item) => item.smokeDetections}
          bgClass="bg-slate-400"
          noDataLabel={noData}
          onItemClick={onItemClick ? (id) => onItemClick('cameraId', id) : undefined}
        />
        <MiniBarList
          title={t('stats.ranking.locations')}
          items={ranking.locations}
          getValue={(item) => item.smokeDetections}
          bgClass="bg-red-400"
          noDataLabel={noData}
          onItemClick={onItemClick ? (id) => onItemClick('location', id) : undefined}
        />
        <MiniBarList
          title={t('stats.ranking.nodes')}
          items={ranking.nodes}
          getValue={(item) => item.totalExecutions}
          bgClass="bg-sky-400"
          noDataLabel={noData}
          onItemClick={onItemClick ? (id) => onItemClick('nodeId', id) : undefined}
        />
      </div>
    </div>
  );
}
