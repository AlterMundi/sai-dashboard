import { useEffect, useState } from 'react';
import {
  Activity, Clock, AlertCircle,
  CheckCircle, XCircle, BarChart3, Flame
} from 'lucide-react';
import { cn } from '@/utils';
import { useTranslation } from '@/contexts/LanguageContext';
import { api } from '@/services/api';
import { useDailySummary } from '@/hooks/useExecutions';
import { TrendChart } from '@/components/charts/TrendChart';

interface StatisticsData {
  overview: {
    totalExecutions: number;
    successRate: number;
    errorRate: number;
    averageExecutionTime: number;
    activeToday: number;
  };
  statusBreakdown: {
    success: number;
    error: number;
    running: number;
    waiting: number;
    canceled: number;
  };
  recentActivity: {
    lastHour: number;
    last24Hours: number;
    last7Days: number;
    last30Days: number;
  };
  performanceMetrics: {
    avgResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    medianResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
  hourlyDistribution: Array<{ hour: number; count: number }>;
  errorTrend: Array<{ date: string; errors: number; total: number; errorRate: number }>;
}

export function StatsDashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch daily summary for trend chart
  const { summary: dailySummary, isLoading: summaryLoading } = useDailySummary(14);

  useEffect(() => {
    fetchStatistics();
    const interval = setInterval(fetchStatistics, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const fetchStatistics = async () => {
    try {
      setLoading(true);
      const response = await api.get('/executions/stats/enhanced');
      setStats(response.data.data);
      setError(null);
    } catch (err) {
      setError(t('stats.failedToLoad'));
      console.error('Error fetching statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-600" />
          <span className="text-red-800">{error}</span>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const formatTime = (seconds: number) => {
    if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-600';
      case 'error': return 'text-red-600';
      case 'running': return 'text-blue-600';
      case 'waiting': return 'text-yellow-600';
      case 'canceled': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{t('stats.totalExecutions')}</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats.overview.totalExecutions.toLocaleString()}
              </p>
            </div>
            <BarChart3 className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{t('stats.successRate')}</p>
              <p className="text-2xl font-bold text-green-600">
                {stats.overview.successRate.toFixed(1)}%
              </p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{t('stats.errorRate')}</p>
              <p className="text-2xl font-bold text-red-600">
                {stats.overview.errorRate.toFixed(1)}%
              </p>
            </div>
            <XCircle className="h-8 w-8 text-red-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{t('stats.avgExecutionTime')}</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatTime(stats.overview.averageExecutionTime)}
              </p>
            </div>
            <Clock className="h-8 w-8 text-purple-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">{t('stats.activeToday')}</p>
              <p className="text-2xl font-bold text-gray-900">
                {stats.overview.activeToday}
              </p>
            </div>
            <Activity className="h-8 w-8 text-orange-500" />
          </div>
        </div>

        {/* Detection Summary Card */}
        {!summaryLoading && dailySummary.length > 0 && (() => {
          const totalFire = dailySummary.reduce((sum, day) => sum + (day.fireDetections || 0), 0);
          const totalSmoke = dailySummary.reduce((sum, day) => sum + (day.smokeDetections || 0), 0);
          return (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{t('stats.detections14d')}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-lg font-bold text-red-600">{totalFire} {t('stats.fire')}</span>
                    <span className="text-lg font-bold text-gray-500">{totalSmoke} {t('stats.smoke')}</span>
                  </div>
                </div>
                <Flame className="h-8 w-8 text-red-500" />
              </div>
            </div>
          );
        })()}
      </div>

      {/* Detection Trend Chart */}
      {!summaryLoading && dailySummary.length > 0 && (
        <TrendChart
          data={dailySummary.map(day => ({
            date: day.date,
            fire: day.fireDetections || 0,
            smoke: day.smokeDetections || 0,
            total: day.totalExecutions,
          })).reverse()}
          title={t('stats.detectionTrends')}
        />
      )}

      {/* Status Breakdown and Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Breakdown */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">{t('stats.statusBreakdown')}</h3>
          <div className="space-y-3">
            {Object.entries(stats.statusBreakdown).map(([status, count]) => {
              const total = Object.values(stats.statusBreakdown).reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? (count / total) * 100 : 0;
              
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn('capitalize font-medium', getStatusColor(status))}>
                      {status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div 
                        className={cn('h-2 rounded-full', {
                          'bg-green-500': status === 'success',
                          'bg-red-500': status === 'error',
                          'bg-blue-500': status === 'running',
                          'bg-yellow-500': status === 'waiting',
                          'bg-gray-500': status === 'canceled'
                        })}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-600 w-16 text-right">
                      {count.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">{t('stats.recentActivity')}</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">{t('stats.lastHour')}</span>
              <span className="font-semibold">{stats.recentActivity.lastHour}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">{t('stats.last24Hours')}</span>
              <span className="font-semibold">{stats.recentActivity.last24Hours}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">{t('stats.last7Days')}</span>
              <span className="font-semibold">{stats.recentActivity.last7Days}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">{t('stats.last30Days')}</span>
              <span className="font-semibold">{stats.recentActivity.last30Days}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">{t('stats.performanceMetrics')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <p className="text-sm text-gray-600">{t('stats.average')}</p>
            <p className="text-lg font-semibold">{formatTime(stats.performanceMetrics.avgResponseTime)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">{t('stats.minimum')}</p>
            <p className="text-lg font-semibold">{formatTime(stats.performanceMetrics.minResponseTime)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">{t('stats.maximum')}</p>
            <p className="text-lg font-semibold">{formatTime(stats.performanceMetrics.maxResponseTime)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">{t('stats.median')}</p>
            <p className="text-lg font-semibold">{formatTime(stats.performanceMetrics.medianResponseTime)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">P95</p>
            <p className="text-lg font-semibold">{formatTime(stats.performanceMetrics.p95ResponseTime)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">P99</p>
            <p className="text-lg font-semibold">{formatTime(stats.performanceMetrics.p99ResponseTime)}</p>
          </div>
        </div>
      </div>

      {/* Hourly Distribution */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">{t('stats.hourlyActivity')}</h3>
        <div className="flex items-end gap-1 h-32">
          {Array.from({ length: 24 }, (_, i) => {
            const data = stats.hourlyDistribution.find(h => h.hour === i);
            const count = data?.count || 0;
            const maxCount = Math.max(...stats.hourlyDistribution.map(h => h.count), 1);
            const height = (count / maxCount) * 100;
            
            return (
              <div key={i} className="flex-1 flex flex-col items-center">
                <div 
                  className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors"
                  style={{ height: `${height}%` }}
                  title={t('stats.executionsAt', { hour: String(i), count: String(count) })}
                />
                {i % 3 === 0 && (
                  <span className="text-xs text-gray-500 mt-1">{i}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error Trend */}
      {stats.errorTrend.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">{t('stats.errorTrend')}</h3>
          <div className="space-y-2">
            {stats.errorTrend.map((day) => (
              <div key={day.date} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  {new Date(day.date).toLocaleDateString()}
                </span>
                <div className="flex items-center gap-4">
                  <span className="text-sm">
                    {day.errors} / {day.total}
                  </span>
                  <span className={cn('text-sm font-semibold', {
                    'text-green-600': day.errorRate < 1,
                    'text-yellow-600': day.errorRate >= 1 && day.errorRate < 5,
                    'text-red-600': day.errorRate >= 5
                  })}>
                    {day.errorRate.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}