import { Wind, AlertTriangle, AlertOctagon, MessageCircle, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { useDailySummary } from '@/hooks/useExecutions';
import { SimpleBarChart, StackedBarChart } from '@/components/charts/SmallBarChart';

export function StatsDashboard() {
  const { t } = useTranslation();
  const { summary, isLoading, error } = useDailySummary(7);

  if (isLoading && summary.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <span className="text-red-800">{t('stats.failedToLoad')}</span>
        </div>
      </div>
    );
  }

  // Compute KPI totals from the 7-day summary
  const totals = summary.reduce(
    (acc, day) => ({
      smoke: acc.smoke + (day.smokeDetections ?? 0),
      critical: acc.critical + (day.criticalDetections ?? 0),
      high: acc.high + (day.highRiskDetections ?? 0),
      telegram: acc.telegram + (day.telegramNotificationsSent ?? 0),
    }),
    { smoke: 0, critical: 0, high: 0, telegram: 0 }
  );

  // Prepare chart data (oldest → newest for left-to-right display)
  const chronological = [...summary].reverse();

  const smokeData = chronological.map(d => ({
    date: d.date,
    value: d.smokeDetections ?? 0,
  }));

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

  const kpis = [
    {
      label: t('stats.smokeDetections7d'),
      value: totals.smoke,
      icon: Wind,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      iconColor: 'text-blue-500',
    },
    {
      label: t('stats.criticalAlerts7d'),
      value: totals.critical,
      icon: AlertOctagon,
      color: 'text-red-700',
      bg: 'bg-red-50',
      iconColor: 'text-red-600',
    },
    {
      label: t('stats.highAlerts7d'),
      value: totals.high,
      icon: AlertTriangle,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
      iconColor: 'text-orange-500',
    },
    {
      label: t('stats.telegramSent7d'),
      value: totals.telegram,
      icon: MessageCircle,
      color: 'text-blue-700',
      bg: 'bg-blue-50',
      iconColor: 'text-blue-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, icon: Icon, color, bg, iconColor }) => (
          <div key={label} className="bg-white rounded-lg shadow p-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">{label}</p>
              <p className={`text-3xl font-bold mt-1 ${color}`}>{value.toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">{t('stats.weeklyLabel')}</p>
            </div>
            <div className={`p-3 rounded-full ${bg}`}>
              <Icon className={`h-6 w-6 ${iconColor}`} />
            </div>
          </div>
        ))}
      </div>

      {/* Histograms Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SimpleBarChart
          title={t('stats.smokePerDay')}
          data={smokeData}
          color="bg-slate-400"
          emptyMessage={t('stats.noDetections')}
        />
        <StackedBarChart
          title={t('stats.alertsByLevel')}
          data={alertData}
          series={[
            { key: 'critical', label: t('filters.critical'), color: 'bg-red-600' },
            { key: 'high',     label: t('filters.high'),     color: 'bg-orange-400' },
            { key: 'low',      label: t('filters.low'),      color: 'bg-yellow-300' },
          ]}
          emptyMessage={t('stats.noDetections')}
        />
        <SimpleBarChart
          title={t('stats.avgConfidencePerDay')}
          data={confidenceData}
          color="bg-teal-500"
          unit="%"
          emptyMessage={t('stats.noDetections')}
        />
      </div>
    </div>
  );
}
