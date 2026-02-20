# Statistics Page Redesign

**Date:** 2026-02-19
**Status:** Approved

## Context

The Statistics page exists but shows generic workflow metrics (success rate, P95 response time, error trend) that are not relevant to field operators. The audience is paying customers who want to know what their detection system caught this week, not infrastructure health (that lives in Grafana).

## Goal

Replace the current Statistics page content with detection-focused metrics oriented to the question: *"¿qué detectó mi sistema esta semana?"*

## Layout

### Row 1 — KPI Cards (4 cards, last 7 days)

All values computed on the frontend from the existing `useDailySummary(7)` hook:

| Card | Value | Color |
|---|---|---|
| 💨 Humo | `sum(smokeDetections)` | blue-gray |
| 🚨 Crítico | `sum(criticalDetections)` | dark red |
| ⚠️ Alto | `sum(highRiskDetections)` | orange |
| 📱 Telegram | `sum(telegramNotificationsSent)` | blue |

### Row 2 — Temporal Histograms (3 small charts, 7-day view)

Three small bar charts in a 3-column grid:

1. **Detecciones de Humo por día** — simple bars, `smokeDetections` per date, blue-gray color
2. **Alertas por nivel por día** — stacked bars: critical (red) + high (orange) + low (yellow) per day
3. **Confianza promedio por día** — bars, `avgConfidenceScore * 100`, teal color

## Changes Required

### Backend (minimal)

One line added to `getDailySummary` query in `new-execution-service.ts`:

```sql
COUNT(CASE WHEN ea.alert_level = 'low' THEN 1 END) as low_alert_detections
```

Map the new field in the return object as `lowAlertDetections`.

Update the `DailySummary` TypeScript interface to include `lowAlertDetections: number`.

### Frontend

**New component:** `frontend/src/components/charts/SmallBarChart.tsx`
- Generic CSS-only bar chart (no external libraries), same pattern as `TrendChart`
- Props: `title`, `data: Array<{ date: string; value: number }>`, `color`
- For stacked variant: `series: Array<{ key: string; color: string; label: string }>`

**Rewrite:** `frontend/src/components/StatsDashboard.tsx`
- Remove all existing sections (performance metrics, status breakdown, hourly distribution, error trend)
- Remove `getEnhancedStatistics` API call
- Use only `useDailySummary(7)`
- Render KPI row + 3 histograms

**i18n:** Add keys to `en.ts` and `es.ts`:
- `stats.smokeDetections7d`
- `stats.criticalAlerts7d`
- `stats.highAlerts7d`
- `stats.telegramSent7d`
- `stats.smokePerDay`
- `stats.alertsByLevel`
- `stats.avgConfidence`
- `stats.last7Days` (already exists)

## What is Removed

- Performance metrics section (avg/min/max/p95/p99 response time)
- Status breakdown (success/error/running/waiting/canceled)
- Hourly distribution histogram
- Error trend table
- Detection Trends (14-day fire+smoke+total chart)
- `getEnhancedStatistics` API call

## Data Flow

```
useDailySummary(7)
  └── GET /executions/summary/daily?days=7
        └── getDailySummary() in new-execution-service.ts
              └── Returns 7 DailySummary rows
                    └── StatsDashboard computes sums for KPIs
                    └── Passes daily arrays to SmallBarChart components
```

## Out of Scope

- Per-camera breakdown (handled by Grafana)
- False positive rate
- Date range selector (future enhancement)
