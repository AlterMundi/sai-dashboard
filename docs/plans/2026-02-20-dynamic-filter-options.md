# Dynamic Filter Options Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded filter dropdown values with dynamic lists fetched on-demand from the database, covering SaiNET Model, Camera ID, Node ID, Device ID, and Location fields.

**Architecture:** A single `GET /dashboard/api/filter-options` endpoint queries `SELECT DISTINCT` on 5 columns (with a 60s in-memory TTL cache on the server) and returns all options in one payload. The frontend fetches lazily on first Advanced panel open, then holds results for the session. A `requestIdleCallback` idle-prefetch hides the spinner for most users.

**Tech Stack:** PostgreSQL (DISTINCT queries), Node.js/Express (controller + in-memory cache), React 18 + TypeScript (hook + Select components), Axios (existing api service)

---

### Task 1: Database migration — DISTINCT-query indexes

**Files:**
- Create: `database/migrations/011_filter_options_indexes.sql`

**Context:** Migration 009 already added some indexes. We follow the same pattern: `CONCURRENTLY`, `IF NOT EXISTS`, `IS NOT NULL` partials for sparse columns, trailing `ANALYZE`. Note: `idx_executions_camera` already exists for `(camera_id, execution_timestamp DESC)` — we need a simpler single-column index for DISTINCT scans; PostgreSQL may use the existing one but a dedicated partial index avoids the composite key overhead.

**Step 1: Create migration file**

```sql
-- ============================================================================
-- Migration 011: Filter Options Indexes
-- Purpose: Support fast SELECT DISTINCT queries for dynamic filter dropdowns
-- Date: 2026-02-20
--
-- NOTE: CONCURRENTLY cannot run inside a transaction block.
-- Run outside a transaction (psql \i or standalone connection).
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exec_distinct_location
  ON executions(location)
  WHERE location IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exec_distinct_node_id
  ON executions(node_id)
  WHERE node_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exec_distinct_device_id
  ON executions(device_id)
  WHERE device_id IS NOT NULL;

-- camera_id already indexed via idx_executions_camera; add dedicated partial for DISTINCT
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exec_distinct_camera_id
  ON executions(camera_id)
  WHERE camera_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ea_distinct_yolo_model
  ON execution_analysis(yolo_model_version)
  WHERE yolo_model_version IS NOT NULL;

ANALYZE executions;
ANALYZE execution_analysis;

DO $$
BEGIN
  RAISE NOTICE '=== Migration 011 complete: Filter-options indexes created ===';
END $$;
```

**Step 2: Apply migration**

```bash
psql -U sai_dashboard_user -d sai_dashboard -f database/migrations/011_filter_options_indexes.sql
```

Expected output ends with: `NOTICE:  === Migration 011 complete: Filter-options indexes created ===`

**Step 3: Verify index-only scans**

```bash
psql -U sai_dashboard_user -d sai_dashboard -c \
  "EXPLAIN ANALYZE SELECT DISTINCT camera_id FROM executions WHERE camera_id IS NOT NULL ORDER BY 1;"
```

Expected: plan shows `Index Only Scan` or `Unique` node on the new index, not `Seq Scan`. Run similar for `location`, `node_id`, `device_id`, and `yolo_model_version` on `execution_analysis`.

**Step 4: Commit**

```bash
git add database/migrations/011_filter_options_indexes.sql
git commit -m "feat(db): add DISTINCT indexes for dynamic filter options"
```

---

### Task 2: Backend — filter-options service method

**Files:**
- Modify: `backend/src/services/new-execution-service.ts`

**Context:** `NewExecutionService` is a class exported as `newExecutionService` singleton. We add a method `getFilterOptions()` that:
1. Checks an in-memory cache (object with `data` + `expiresAt`).
2. On miss: runs 5 `SELECT DISTINCT … ORDER BY 1` queries in parallel via `Promise.all`.
3. Stores result in cache with `expiresAt = Date.now() + 60_000`.
4. Returns the result.

The `dualDb` pool is already imported. Use the `sai` pool (sai_dashboard database).

**Step 1: Add the cache object and method at the bottom of the class**

Locate the end of the `NewExecutionService` class in `backend/src/services/new-execution-service.ts` (before the `export const newExecutionService` line) and add:

```typescript
  // -----------------------------------------------------------------------
  // Filter Options (dynamic dropdown values)
  // -----------------------------------------------------------------------

  private filterOptionsCache: {
    data: FilterOptions | null;
    expiresAt: number;
  } = { data: null, expiresAt: 0 };

  async getFilterOptions(): Promise<FilterOptions> {
    const now = Date.now();
    if (this.filterOptionsCache.data && now < this.filterOptionsCache.expiresAt) {
      return this.filterOptionsCache.data;
    }

    const pool = dualDb.getSaiPool();

    const [
      cameraResult,
      locationResult,
      nodeResult,
      deviceResult,
      modelResult,
    ] = await Promise.all([
      pool.query<{ camera_id: string }>(
        'SELECT DISTINCT camera_id FROM executions WHERE camera_id IS NOT NULL ORDER BY 1'
      ),
      pool.query<{ location: string }>(
        'SELECT DISTINCT location FROM executions WHERE location IS NOT NULL ORDER BY 1'
      ),
      pool.query<{ node_id: string }>(
        'SELECT DISTINCT node_id FROM executions WHERE node_id IS NOT NULL ORDER BY 1'
      ),
      pool.query<{ device_id: string }>(
        'SELECT DISTINCT device_id FROM executions WHERE device_id IS NOT NULL ORDER BY 1'
      ),
      pool.query<{ yolo_model_version: string }>(
        'SELECT DISTINCT yolo_model_version FROM execution_analysis WHERE yolo_model_version IS NOT NULL ORDER BY 1'
      ),
    ]);

    const options: FilterOptions = {
      cameraId:        cameraResult.rows.map(r => r.camera_id),
      location:        locationResult.rows.map(r => r.location),
      nodeId:          nodeResult.rows.map(r => r.node_id),
      deviceId:        deviceResult.rows.map(r => r.device_id),
      yoloModelVersion: modelResult.rows.map(r => r.yolo_model_version),
    };

    this.filterOptionsCache = { data: options, expiresAt: now + 60_000 };
    logger.debug('filter-options: cache miss, fetched from DB');
    return options;
  }
```

**Step 2: Add the `FilterOptions` interface to `backend/src/types/index.ts`**

Append near the bottom of the file (before last export or at end):

```typescript
export interface FilterOptions {
  cameraId:         string[];
  location:         string[];
  nodeId:           string[];
  deviceId:         string[];
  yoloModelVersion: string[];
}
```

**Step 3: Import `FilterOptions` in new-execution-service.ts**

The file already imports from `@/types`. Add `FilterOptions` to that import:

```typescript
import {
  ExecutionWithImage,
  ExecutionFilters,
  DailySummary,
  FilterOptions,
} from '@/types';
```

**Step 4: Verify `dualDb.getSaiPool()` exists**

```bash
grep -n "getSaiPool\|saiPool\|getPool" backend/src/database/dual-pool.ts | head -20
```

If the method is named differently (e.g., `sai`, `dashboard`, `getPool`), use that name in the service method.

**Step 5: Type-check**

```bash
npm run type-check:backend
```

Expected: no errors.

**Step 6: Commit**

```bash
git add backend/src/services/new-execution-service.ts backend/src/types/index.ts
git commit -m "feat(backend): add getFilterOptions() with 60s in-memory cache"
```

---

### Task 3: Backend — filter-options controller + route

**Files:**
- Modify: `backend/src/controllers/executions.ts`
- Modify: `backend/src/routes/index.ts`

**Context:** The pattern in the project is: thin controller function that calls the service, wraps response in `{ data: ... }`. The route is added to `executionRouter` which sits under the protected middleware.

**Step 1: Add controller function to `backend/src/controllers/executions.ts`**

Find the last exported controller function and add after it:

```typescript
export const getFilterOptions = asyncHandler(async (_req: Request, res: Response) => {
  const options = await newExecutionService.getFilterOptions();
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: options });
});
```

Make sure `newExecutionService` is already imported in the controller. If not, add:

```typescript
import { newExecutionService } from '@/services/new-execution-service';
```

**Step 2: Add route to `backend/src/routes/index.ts`**

Import `getFilterOptions` alongside existing controller imports:

```typescript
import {
  getExecutions,
  getExecutionById,
  // ... existing imports ...
  getFilterOptions,           // ← add this
} from '@/controllers/executions';
```

Add a route to `executionRouter` BEFORE the `/:executionId` wildcard route (to avoid being captured by it):

```typescript
// Dynamic filter options (distinct values for dropdown population)
executionRouter.get('/filter-options', getFilterOptions);
```

**Step 3: Manual smoke test**

Start the backend in dev mode and call the endpoint with a valid token:

```bash
npm run dev:backend &
# wait a few seconds, then:
TOKEN=$(curl -s -X POST http://localhost:3001/dashboard/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"YOUR_PASSWORD"}' | jq -r '.data.token')

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/dashboard/api/executions/filter-options | jq .
```

Expected response shape:
```json
{
  "data": {
    "cameraId": ["cam1", "cam2"],
    "location": ["La Rancherita", "Molinari"],
    "nodeId": ["node-01"],
    "deviceId": ["device-01"],
    "yoloModelVersion": ["saiNET-v1"]
  }
}
```

**Step 4: Type-check**

```bash
npm run type-check:backend
```

**Step 5: Commit**

```bash
git add backend/src/controllers/executions.ts backend/src/routes/index.ts
git commit -m "feat(backend): expose GET /executions/filter-options endpoint"
```

---

### Task 4: Frontend — FilterOptions type + api method

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/services/api.ts`

**Step 1: Add `FilterOptions` type to `frontend/src/types/api.ts`**

Append near the bottom of the file:

```typescript
/**
 * Dynamic filter dropdown options (populated from DB DISTINCT queries)
 */
export interface FilterOptions {
  cameraId:         string[];
  location:         string[];
  nodeId:           string[];
  deviceId:         string[];
  yoloModelVersion: string[];
}
```

**Step 2: Import and expose `FilterOptions` in `frontend/src/types/index.ts`** (or wherever the barrel export lives)

```bash
grep -n "FilterOptions\|from.*api" frontend/src/types/index.ts | head -10
```

Add re-export if types are barrel-exported:
```typescript
export type { FilterOptions } from './api';
```

**Step 3: Add `getFilterOptions` to `executionsApi` in `frontend/src/services/api.ts`**

Import `FilterOptions`:
```typescript
import {
  // ... existing imports ...
  FilterOptions,
} from '@/types';
```

Add method to the `executionsApi` object:

```typescript
  async getFilterOptions(): Promise<FilterOptions> {
    const response = await api.get<{ data: FilterOptions }>('/executions/filter-options');
    return response.data.data;
  },
```

**Step 4: Type-check**

```bash
npm run type-check:frontend
```

**Step 5: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/services/api.ts
git commit -m "feat(frontend): add FilterOptions type and api.getFilterOptions()"
```

---

### Task 5: Frontend — `useFilterOptions` hook

**Files:**
- Create: `frontend/src/hooks/useFilterOptions.ts`

**Context:** Lazy-first + idle prefetch strategy. The hook:
- Keeps a module-level singleton cache (so multiple mounts share the same fetch).
- On mount, schedules a `requestIdleCallback` to prefetch if not already loaded.
- Exposes `triggerFetch()` which Advanced panel calls on first open.
- Returns `{ options, isLoading, error, refresh }`.

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { executionsApi } from '@/services/api';
import { FilterOptions } from '@/types';

const EMPTY: FilterOptions = {
  cameraId: [],
  location: [],
  nodeId: [],
  deviceId: [],
  yoloModelVersion: [],
};

// Module-level singleton so all hook instances share state
let cachedOptions: FilterOptions | null = null;
let fetchPromise: Promise<FilterOptions> | null = null;

async function doFetch(): Promise<FilterOptions> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = executionsApi.getFilterOptions().then((opts) => {
    cachedOptions = opts;
    fetchPromise = null;
    return opts;
  }).catch((err) => {
    fetchPromise = null;
    throw err;
  });
  return fetchPromise;
}

export function useFilterOptions() {
  const [options, setOptions]   = useState<FilterOptions>(cachedOptions ?? EMPTY);
  const [isLoading, setLoading] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const fetch = useCallback(async (force = false) => {
    if (cachedOptions && !force) {
      setOptions(cachedOptions);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const opts = await doFetch();
      if (mounted.current) setOptions(opts);
    } catch (e: any) {
      if (mounted.current) setError(e?.message ?? 'Failed to load filter options');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // Idle prefetch on mount
  useEffect(() => {
    if (cachedOptions) return;
    const id = requestIdleCallback(() => fetch(), { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }, [fetch]);

  return {
    options,
    isLoading,
    error,
    triggerFetch: () => fetch(),
    refresh: () => { cachedOptions = null; fetch(true); },
  };
}
```

**Step 2: Type-check**

```bash
npm run type-check:frontend
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/useFilterOptions.ts
git commit -m "feat(frontend): useFilterOptions hook with lazy + idle-prefetch strategy"
```

---

### Task 6: UI — wire dynamic options into AlertFilterComponent

**Files:**
- Modify: `frontend/src/components/AlertFilterComponent.tsx`
- Modify: `frontend/src/translations/en.ts`
- Modify: `frontend/src/translations/es.ts`

**Context:** The Advanced panel currently has hardcoded `<SelectItem>` lists for Camera ID and Location, and a free-text Input for SaiNET Model. Node ID and Device ID are already `Input` fields. We replace all 5 with `Select` components fed by `useFilterOptions`, plus keep a free-text fallback note for Node ID and Device ID (which may have higher cardinality).

**Step 1: Add hook to the component**

At top of `AlertFilterComponent`:

```typescript
import { useFilterOptions } from '@/hooks/useFilterOptions';
```

Inside the component function, after existing state:

```typescript
const { options, isLoading: optionsLoading, triggerFetch } = useFilterOptions();
```

Pass `triggerFetch` to the Advanced panel toggle handler so the first open triggers the fetch:

```typescript
const handleToggleAdvanced = useCallback(() => {
  setShowAdvanced(prev => {
    if (!prev) triggerFetch();   // lazy fetch on first open
    return !prev;
  });
}, [triggerFetch]);
```

Replace the existing toggle button's `onClick={() => setShowAdvanced(!showAdvanced)}` with `onClick={handleToggleAdvanced}`.

**Step 2: Replace Camera ID Input with dynamic Select**

Find the Camera ID `<Input>` block in the Advanced section and replace:

```tsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-2">
    {t('filters.cameraId')}
  </label>
  <Select
    value={filters.cameraId || ''}
    onValueChange={(value) => handleFilterChange('cameraId', value || undefined)}
    disabled={optionsLoading}
  >
    <SelectTrigger>
      <SelectValue placeholder={t('filters.allCameras')} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="">{t('filters.allCameras')}</SelectItem>
      {options.cameraId.map((id) => (
        <SelectItem key={id} value={id}>{id}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

**Step 3: Replace Location Input with dynamic Select**

The top-level Location select (in the basic filters row) is a hardcoded list. Replace its `<SelectContent>` children with dynamic options:

```tsx
<SelectContent>
  <SelectItem value="">{t('filters.allLocations')}</SelectItem>
  {options.location.map((loc) => (
    <SelectItem key={loc} value={loc}>{loc}</SelectItem>
  ))}
</SelectContent>
```

Do the same for the Location field in the Advanced section if it appears there too.

**Step 4: Replace SaiNET Model Input with dynamic Select**

Find the `yoloModelVersion` Input block (added in previous feature) and replace:

```tsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-2">
    {t('filters.saiModel')}
  </label>
  <Select
    value={filters.yoloModelVersion || ''}
    onValueChange={(value) => handleFilterChange('yoloModelVersion', value || undefined)}
    disabled={optionsLoading}
  >
    <SelectTrigger>
      <SelectValue placeholder={t('filters.anySaiModel')} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="">{t('filters.anySaiModel')}</SelectItem>
      {options.yoloModelVersion.map((v) => (
        <SelectItem key={v} value={v}>{v}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

**Step 5: Replace Node ID and Device ID Inputs with dynamic Selects**

Same pattern as above:

```tsx
{/* Node ID */}
<Select
  value={filters.nodeId || ''}
  onValueChange={(value) => handleFilterChange('nodeId', value || undefined)}
  disabled={optionsLoading}
>
  <SelectTrigger><SelectValue placeholder={t('filters.allNodes')} /></SelectTrigger>
  <SelectContent>
    <SelectItem value="">{t('filters.allNodes')}</SelectItem>
    {options.nodeId.map((n) => (
      <SelectItem key={n} value={n}>{n}</SelectItem>
    ))}
  </SelectContent>
</Select>

{/* Device ID */}
<Select
  value={filters.deviceId || ''}
  onValueChange={(value) => handleFilterChange('deviceId', value || undefined)}
  disabled={optionsLoading}
>
  <SelectTrigger><SelectValue placeholder={t('filters.allDevices')} /></SelectTrigger>
  <SelectContent>
    <SelectItem value="">{t('filters.allDevices')}</SelectItem>
    {options.deviceId.map((d) => (
      <SelectItem key={d} value={d}>{d}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

**Step 6: Update translations**

`frontend/src/translations/en.ts` — add inside the `filters` object:

```typescript
anySaiModel: 'Any model',
allNodes:    'All nodes',
allDevices:  'All devices',
```

`frontend/src/translations/es.ts` — add inside the `filters` object:

```typescript
anySaiModel: 'Cualquier modelo',
allNodes:    'Todos los nodos',
allDevices:  'Todos los dispositivos',
```

**Step 7: Type-check full project**

```bash
npm run type-check
```

Expected: zero errors.

**Step 8: Manual smoke test**

1. Start `npm run dev`
2. Open the dashboard, expand Advanced filters
3. Open the Camera ID dropdown — it should populate from DB values (not hardcoded cam1–cam5)
4. Open Location — same
5. Open SaiNET Model — should list `saiNET-v1` (or whatever is in DB)
6. Open browser Network tab; verify one request to `/executions/filter-options` fires on panel open, and that re-opening the panel does NOT fire another request (served from module cache)
7. Check response headers include `Cache-Control: private, max-age=60`

**Step 9: Commit**

```bash
git add frontend/src/components/AlertFilterComponent.tsx \
        frontend/src/translations/en.ts \
        frontend/src/translations/es.ts
git commit -m "feat(ui): dynamic filter dropdowns for camera, location, node, device, saiNET model"
```

---

### Task 7: Final cleanup and validation

**Step 1: Remove unused hardcoded import references**

Check if `requestIdleCallback` TypeScript types are available (they're part of `lib.dom`). If you see TS errors about `requestIdleCallback` not existing, add to `frontend/tsconfig.json`:

```json
"lib": ["DOM", "DOM.Iterable", "ESNext"]
```

(It should already be there; confirm with `grep "lib" frontend/tsconfig.json`.)

**Step 2: Run full type-check**

```bash
npm run type-check
```

**Step 3: Run tests**

```bash
npm test
```

Expected: pre-existing failures only (babel parser issues with TS interfaces, unrelated to this feature).

**Step 4: Final commit if any fixup needed**

```bash
git add -A
git commit -m "chore: fix TS types for requestIdleCallback if needed"
```

**Step 5: Verify no regression on main gallery page load**

The idle prefetch fires after first paint. Open browser DevTools → Network, load the dashboard, and confirm `/executions/filter-options` request fires within 3s even if Advanced panel is never opened. This confirms the prefetch is working.

---

## Summary of Files Changed

| File | Action |
|------|--------|
| `database/migrations/011_filter_options_indexes.sql` | Create — 5 CONCURRENTLY DISTINCT indexes |
| `backend/src/types/index.ts` | Modify — add `FilterOptions` interface |
| `backend/src/services/new-execution-service.ts` | Modify — add `getFilterOptions()` + cache |
| `backend/src/controllers/executions.ts` | Modify — add `getFilterOptions` controller |
| `backend/src/routes/index.ts` | Modify — register `GET /executions/filter-options` |
| `frontend/src/types/api.ts` | Modify — add `FilterOptions` type |
| `frontend/src/services/api.ts` | Modify — add `getFilterOptions()` api method |
| `frontend/src/hooks/useFilterOptions.ts` | Create — lazy + idle-prefetch hook |
| `frontend/src/components/AlertFilterComponent.tsx` | Modify — wire dynamic Selects |
| `frontend/src/translations/en.ts` | Modify — 3 new translation keys |
| `frontend/src/translations/es.ts` | Modify — 3 new translation keys |
