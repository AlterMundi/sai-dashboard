# Statistics Page Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the generic workflow metrics on the Statistics page with detection-focused KPIs and daily histograms relevant to paying field operators.

**Architecture:** All data comes from the existing `getDailySummary(7)` endpoint. The backend gets one new field (`lowAlertDetections`). The frontend `DailySummary` type is synced with the backend, a generic `SmallBarChart` CSS component is created, and `StatsDashboard` is rewritten to show 4 KPI cards + 3 small histograms.

**Tech Stack:** TypeScript, React 18, Tailwind CSS, no external chart libraries.

---

### Task 1: Add `lowAlertDetections` to backend `getDailySummary`

**Files:**
- Modify: `backend/src/services/new-execution-service.ts` (around line 456 in the SELECT, line 494 in the return map)
- Modify: `backend/src/types/index.ts` (line 196, `DailySummary` interface)

**Step 1: Add the SQL field**

In `new-execution-service.ts`, inside `getDailySummary`, find the SELECT block and add one line after `COUNT(CASE WHEN ea.alert_level = 'critical' THEN 1 END) as critical_detections,`:

```sql
COUNT(CASE WHEN ea.alert_level = 'low' THEN 1 END) as low_alert_detections,
```

**Step 2: Map the field in the return object**

In the same function, in the `results.map(...)` return block, add after `criticalDetections`:

```typescript
lowAlertDetections: parseInt(row.low_alert_detections) || 0,
```

**Step 3: Add the field to the backend `DailySummary` interface**

In `backend/src/types/index.ts`, add to `DailySummary`:

```typescript
lowAlertDetections: number;
```

**Step 4: Type check**

```bash
npm run type-check:backend
```
Expected: no errors.

**Step 5: Commit**

```bash
git add backend/src/services/new-execution-service.ts backend/src/types/index.ts
git commit -m "feat(stats): add lowAlertDetections to getDailySummary"
```

---

### Task 2: Sync frontend `DailySummary` type

**Files:**
- Modify: `frontend/src/types/api.ts` (line 102, `DailySummary` interface)

The frontend type is missing most of the enhanced fields the backend already returns. Replace the whole `DailySummary` interface:

**Step 1: Replace the interface**

```typescript
export interface DailySummary {
  date: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  avgExecutionTime: number | null;
  fireDetections: number;
  smokeDetections: number;
  highRiskDetections: number;
  criticalDetections: number;
  lowAlertDetections: number;
  executionsWithImages: number;
  telegramNotificationsSent: number;
  avgProcessingTimeMs: number;
  avgConfidenceScore: number;
}
```

**Step 2: Type check**

```bash
npm run type-check:frontend
```
Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/src/types/api.ts
git commit -m "fix(types): sync frontend DailySummary with backend fields"
```

---

### Task 3: Add i18n keys

**Files:**
- Modify: `frontend/src/translations/en.ts` (inside `stats: { ... }`)
- Modify: `frontend/src/translations/es.ts` (inside `stats: { ... }`)

**Step 1: Add to `en.ts` `stats` section**

```typescript
smokeDetections7d: 'Smoke Detections',
criticalAlerts7d: 'Critical Alerts',
highAlerts7d: 'High Alerts',
telegramSent7d: 'Telegram Sent',
weeklyLabel: 'Last 7 days',
smokePerDay: 'Smoke per Day',
alertsByLevel: 'Alerts by Level',
avgConfidencePerDay: 'Avg Confidence',
noDetections: 'No detections this week',
```

**Step 2: Add to `es.ts` `stats` section**

```typescript
smokeDetections7d: 'Detecciones de Humo',
criticalAlerts7d: 'Alertas Críticas',
highAlerts7d: 'Alertas Altas',
telegramSent7d: 'Telegram Enviados',
weeklyLabel: 'Últimos 7 días',
smokePerDay: 'Humo por Día',
alertsByLevel: 'Alertas por Nivel',
avgConfidencePerDay: 'Confianza Promedio',
noDetections: 'Sin detecciones esta semana',
```

**Step 3: Type check**

```bash
npm run type-check:frontend
```
Expected: no errors (TypeScript will catch missing keys since `es.ts` implements `TranslationKeys`).

**Step 4: Commit**

```bash
git add frontend/src/translations/en.ts frontend/src/translations/es.ts
git commit -m "feat(i18n): add stats page translation keys"
```

---

### Task 4: Create `SmallBarChart` component

**Files:**
- Create: `frontend/src/components/charts/SmallBarChart.tsx`

This is a CSS-only bar chart with no external dependencies. Two variants: simple (one value per day) and stacked (multiple series per day).

**Step 1: Create the file**

```typescript
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
      {/* X-axis: first and last label */}
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
      {/* Legend */}
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
```

**Step 2: Type check**

```bash
npm run type-check:frontend
```
Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/src/components/charts/SmallBarChart.tsx
git commit -m "feat(charts): add SmallBarChart and StackedBarChart components"
```

---

### Task 5: Rewrite `StatsDashboard`

**Files:**
- Modify: `frontend/src/components/StatsDashboard.tsx`

Replace the entire file content with the new detection-focused layout.

**Step 1: Rewrite `StatsDashboard.tsx`**

```typescript
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
```

**Step 2: Type check**

```bash
npm run type-check:frontend
```
Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/src/components/StatsDashboard.tsx
git commit -m "feat(stats): rewrite StatsDashboard with detection KPIs and histograms"
```

---

### Task 6: Check `useDailySummary` error field

**Files:**
- Read: `frontend/src/hooks/useExecutions.ts` around line 246

The new `StatsDashboard` uses `{ summary, isLoading, error }` from `useDailySummary`. Verify the hook actually returns an `error` field. If it doesn't, the type check will catch it — fix by adding it or adjusting the destructuring to match what the hook returns.

**Step 1: Check the hook return shape**

```bash
grep -A 30 "export function useDailySummary" frontend/src/hooks/useExecutions.ts
```

If `error` is not returned, either add it to the hook or change the StatsDashboard to not use it (remove the error check block and simplify to just check `summary.length === 0`).

**Step 2: Type check**

```bash
npm run type-check:frontend
```
Expected: no errors.

**Step 3: Commit any fixes**

```bash
git add frontend/src/hooks/useExecutions.ts frontend/src/components/StatsDashboard.tsx
git commit -m "fix(stats): align useDailySummary hook return shape"
```

---

### Task 7: Final verification and PR

**Step 1: Full type check**

```bash
npm run type-check
```
Expected: clean.

**Step 2: Verify old unused imports are gone**

`StatsDashboard.tsx` previously imported `api`, `TrendChart`, `LiveStatsCard`. Confirm none remain:

```bash
grep -n "import.*api\|TrendChart\|LiveStatsCard\|getEnhancedStatistics" frontend/src/components/StatsDashboard.tsx
```
Expected: no output.

**Step 3: PR and merge**

Use the `/commit-push-pr` skill (or manually):

```bash
git push master fix/bounding-box-parsing
gh pr create --base release --title "feat(stats): detection-focused statistics page" ...
```
