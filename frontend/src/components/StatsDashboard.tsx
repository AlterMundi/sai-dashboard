import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wind, AlertTriangle, AlertOctagon, MessageCircle, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { useDailySummary } from '@/hooks/useExecutions';
import { SimpleBarChart, StackedBarChart } from '@/components/charts/SmallBarChart';
import { StatsControls, defaultStatsFilters } from '@/components/StatsControls';
import { RankingPanel } from '@/components/RankingPanel';
import { StatsFilters } from '@/types';

function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  const delta = current - previous;
  if (Math.abs(delta) < 1) return <Minus className="h-4 w-4 text-gray-300" />;
  if (delta > 0) return <TrendingUp className="h-4 w-4 text-red-400" />;
  return <TrendingDown className="h-4 w-4 text-emerald-500" />;
}

function periodLabel(filters: StatsFilters): string {
  try {
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${fmt(start)} – ${fmt(end)}`;
  } catch {
    return '';
  }
}

export function StatsDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<StatsFilters>(defaultStatsFilters);

  const { summary, isLoading, error } = useDailySummary(filters);

  // Build dimension filter params from active stats dimension
  const buildDimensionParams = useCallback(() => {
    const params: Record<string, string> = {};
    if (filters.dimensionValue && filters.dimensionKey) {
      switch (filters.dimensionKey) {
        case 'cameraId': params.cameraId = filters.dimensionValue; break;
        case 'location': params.location = filters.dimensionValue; break;
        case 'nodeId': params.nodeId = filters.dimensionValue; break;
      }
    }
    return params;
  }, [filters.dimensionKey, filters.dimensionValue]);

  // Navigate to gallery with filters for a given date
  const drillDown = useCallback((date: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    // Normalize: date may be ISO "2026-02-18T00:00:00.000Z" or plain "2026-02-18"
    const ymd = date.slice(0, 10); // always "YYYY-MM-DD"
    const [y, m, d] = ymd.split('-').map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);
    params.set('startDate', start.toISOString());
    params.set('endDate', end.toISOString());
    // Dimension filter
    const dim = buildDimensionParams();
    for (const [k, v] of Object.entries(dim)) params.set(k, v);
    // Extra filters (hasSmoke, alertLevels, etc.)
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    navigate({ pathname: '/', search: params.toString() });
  }, [navigate, buildDimensionParams]);

  const handleSmokeBarClick = useCallback((date: string) => {
    drillDown(date, { hasSmoke: 'true' });
  }, [drillDown]);

  const handleAlertBarClick = useCallback((date: string, seriesKey?: string) => {
    const extra: Record<string, string> = { hasSmoke: 'true' };
    if (seriesKey) extra.alertLevels = seriesKey;
    drillDown(date, extra);
  }, [drillDown]);

  const handleConfidenceBarClick = useCallback((date: string) => {
    drillDown(date, { hasSmoke: 'true' });
  }, [drillDown]);

  if (isLoading && summary.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 border-t-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-xl p-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700">{t('stats.failedToLoad')}</span>
        </div>
      </div>
    );
  }

  // Totals over the full window
  const totals = summary.reduce(
    (acc, day) => ({
      smoke: acc.smoke + (day.smokeDetections ?? 0),
      critical: acc.critical + (day.criticalDetections ?? 0),
      high: acc.high + (day.highRiskDetections ?? 0),
      telegram: acc.telegram + (day.telegramNotificationsSent ?? 0),
    }),
    { smoke: 0, critical: 0, high: 0, telegram: 0 }
  );

  // Half-window split for trend comparison
  const half = Math.floor(summary.length / 2);
  const recent = summary.slice(0, half);
  const earlier = summary.slice(half);
  const recentSmoke = recent.reduce((s, d) => s + (d.smokeDetections ?? 0), 0);
  const earlierSmoke = earlier.reduce((s, d) => s + (d.smokeDetections ?? 0), 0);

  // Chronological order for charts (oldest → newest, left → right)
  const chronological = [...summary].reverse();

  const smokeData = chronological.map(d => ({ date: d.date, value: d.smokeDetections ?? 0 }));
  const alertData = chronological.map(d => ({
    date: d.date,
    critical: d.criticalDetections ?? 0,
    high: d.highRiskDetections ?? 0,
    low: d.lowAlertDetections ?? 0,
  }));
  const confidenceData = chronological.map(d => ({
    date: d.date,
    value: Math.round((d.avgConfidenceScore ?? 0) * 100),
  }));

  const rangeLabel = periodLabel(filters);
  const gran = filters.granularity;
  const showRanking = !filters.dimensionValue;

  const kpis = [
    {
      label: t('stats.smokeDetections7d'),
      value: totals.smoke,
      icon: Wind,
      accent: 'border-t-[3px] border-t-slate-400',
      numColor: 'text-slate-700',
      iconColor: 'text-slate-300',
      bgClass: 'bg-slate-50',
      trend: <Trend current={recentSmoke} previous={earlierSmoke} />,
    },
    {
      label: t('stats.criticalAlerts7d'),
      value: totals.critical,
      icon: AlertOctagon,
      accent: 'border-t-[3px] border-t-red-600',
      numColor: 'text-red-700',
      iconColor: 'text-red-200',
      bgClass: 'bg-red-50',
      trend: null,
    },
    {
      label: t('stats.highAlerts7d'),
      value: totals.high,
      icon: AlertTriangle,
      accent: 'border-t-[3px] border-t-orange-400',
      numColor: 'text-orange-600',
      iconColor: 'text-orange-200',
      bgClass: 'bg-orange-50',
      trend: null,
    },
    {
      label: t('stats.telegramSent7d'),
      value: totals.telegram,
      icon: MessageCircle,
      accent: 'border-t-[3px] border-t-sky-500',
      numColor: 'text-sky-700',
      iconColor: 'text-sky-200',
      bgClass: 'bg-sky-50',
      trend: null,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Period selector + dimension filter */}
      <StatsControls value={filters} onChange={setFilters} />

      {/* Period range label */}
      {rangeLabel && (
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          {rangeLabel}
        </p>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, icon: Icon, accent, numColor, iconColor, bgClass, trend }) => (
          <div
            key={label}
            className={`bg-white rounded-xl shadow-sm ${accent} relative overflow-hidden`}
          >
            {/* Icon badge */}
            <div className="absolute right-3 top-3">
              <div className={`p-2 rounded-lg ${bgClass}`}>
                <Icon className={`h-5 w-5 ${iconColor}`} />
              </div>
            </div>

            <div className="p-5 pr-14">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 leading-none mb-3">
                {label}
              </p>
              <div className="flex items-end gap-2">
                <p className={`text-4xl font-black tabular-nums leading-none ${numColor}`}>
                  {value.toLocaleString()}
                </p>
                {trend && <div className="mb-1">{trend}</div>}
              </div>
              <p className="text-[10px] text-gray-300 mt-2 uppercase tracking-wide font-medium">
                {rangeLabel}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SimpleBarChart
          title={t('stats.smokePerDay')}
          data={smokeData}
          color="#64748b"
          bgClass="bg-slate-400"
          emptyMessage={t('stats.noDetections')}
          granularity={gran}
          onBarClick={handleSmokeBarClick}
        />
        <StackedBarChart
          title={t('stats.alertsByLevel')}
          data={alertData}
          series={[
            { key: 'critical', label: t('filters.critical'), color: '#dc2626', bgClass: 'bg-red-600' },
            { key: 'high',     label: t('filters.high'),     color: '#f97316', bgClass: 'bg-orange-400' },
            { key: 'low',      label: t('filters.low'),      color: '#fbbf24', bgClass: 'bg-amber-300' },
          ]}
          emptyMessage={t('stats.noDetections')}
          granularity={gran}
          onBarClick={handleAlertBarClick}
        />
        <SimpleBarChart
          title={t('stats.avgConfidencePerDay')}
          data={confidenceData}
          color="#0d9488"
          bgClass="bg-teal-500"
          unit="%"
          emptyMessage={t('stats.noDetections')}
          granularity={gran}
          onBarClick={handleConfidenceBarClick}
        />
      </div>

      {/* Ranking Panel (hidden when a specific dimension value is selected) */}
      {showRanking && (
        <RankingPanel
          startDate={filters.startDate}
          endDate={filters.endDate}
        />
      )}
    </div>
  );
}
