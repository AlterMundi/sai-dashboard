# Dataset Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Dataset Manager feature that lets researchers select images from the gallery, package them into YOLO-format datasets on the RAID filesystem, and explore them in a dedicated UI.

**Architecture:** Filesystem-first — `/mnt/raid1/datasets/` is the source of truth. Backend scans it at runtime (30s cache). DB holds only async job state (`dataset_jobs` table). No DB index of dataset contents. External YOLO datasets copied to the directory appear automatically.

**Tech Stack:** Node.js/Express backend, React/TypeScript frontend, PostgreSQL (single new table), filesystem (Sharp already present), Tailwind CSS.

**Design doc:** `docs/plans/2026-02-22-dataset-manager-design.md`

---

## Pre-flight: Create worktree and Lattice task

### Task 0: Set up isolated branch

**Step 1: Create git worktree**

```bash
git worktree add ../sai-dashboard-datasets feat/dataset-manager
cd ../sai-dashboard-datasets
```

**Step 2: Create Lattice epic**

```bash
lattice create "Dataset Manager epic" --actor agent:$(hostname)
# note the task ID returned, use it throughout
lattice status <TASK_ID> in_planning --actor agent:$(hostname)
```

**Step 3: Write plan reference in Lattice**

```bash
lattice comment <TASK_ID> "Plan: docs/plans/2026-02-22-dataset-manager-plan.md" --actor agent:$(hostname)
lattice branch-link <TASK_ID> feat/dataset-manager --actor agent:$(hostname)
lattice status <TASK_ID> planned --actor agent:$(hostname)
```

---

## Phase 1: Backend foundation

### Task 1: DB migration — dataset_jobs table

**Files:**
- Create: `database/migrations/015_dataset_jobs.sql`

**Step 1: Write migration**

```sql
-- 015_dataset_jobs.sql
-- Async job tracking for dataset image copy operations.
-- Datasets themselves live on the filesystem; this table only tracks in-flight work.

CREATE TABLE IF NOT EXISTS dataset_jobs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_name   VARCHAR     NOT NULL,
  split          VARCHAR     NOT NULL CHECK (split IN ('train', 'val')),
  execution_ids  BIGINT[]    NOT NULL,
  status         VARCHAR     NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','processing','completed','failed')),
  progress       INTEGER     NOT NULL DEFAULT 0,
  total          INTEGER     NOT NULL,
  created_by     VARCHAR,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  error          TEXT
);

CREATE INDEX idx_dataset_jobs_status   ON dataset_jobs(status);
CREATE INDEX idx_dataset_jobs_dataset  ON dataset_jobs(dataset_name);
CREATE INDEX idx_dataset_jobs_created  ON dataset_jobs(created_at DESC);
```

**Step 2: Apply migration**

```bash
psql -U postgres -d sai_dashboard -f database/migrations/015_dataset_jobs.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX` ×3

**Step 3: Verify**

```bash
psql -U postgres -d sai_dashboard -c "\d dataset_jobs"
```

Expected: table with 11 columns.

**Step 4: Commit**

```bash
git add database/migrations/015_dataset_jobs.sql
git commit -m "feat(db): add dataset_jobs table for async copy tracking"
```

---

### Task 2: Add SAI_RESEARCHER role

**Files:**
- Modify: `backend/src/types/index.ts` (line 149)
- Modify: `backend/src/auth/roles.ts` (lines 43-45)
- Modify: `backend/src/controllers/admin.ts` (line 12)
- Modify: `frontend/src/types/api.ts` (line 10)

**Step 1: Update backend DashboardRole type**

In `backend/src/types/index.ts`, find line 149:
```typescript
export type DashboardRole = 'SAI_ADMIN' | 'SAI_OPERATOR' | 'SAI_VIEWER';
```
Replace with:
```typescript
export type DashboardRole = 'SAI_ADMIN' | 'SAI_OPERATOR' | 'SAI_RESEARCHER' | 'SAI_VIEWER';
```

**Step 2: Add to role extraction priority**

In `backend/src/auth/roles.ts`, find lines 43-45:
```typescript
  if (roleNames.includes('SAI_ADMIN')) return 'SAI_ADMIN';
  if (roleNames.includes('SAI_OPERATOR')) return 'SAI_OPERATOR';
  if (roleNames.includes('SAI_VIEWER')) return 'SAI_VIEWER';
```
Replace with:
```typescript
  if (roleNames.includes('SAI_ADMIN')) return 'SAI_ADMIN';
  if (roleNames.includes('SAI_OPERATOR')) return 'SAI_OPERATOR';
  if (roleNames.includes('SAI_RESEARCHER')) return 'SAI_RESEARCHER';
  if (roleNames.includes('SAI_VIEWER')) return 'SAI_VIEWER';
```

**Step 3: Add to admin VALID_ROLES**

In `backend/src/controllers/admin.ts`, find line 12:
```typescript
const VALID_ROLES: DashboardRole[] = ['SAI_ADMIN', 'SAI_OPERATOR', 'SAI_VIEWER'];
```
Replace with:
```typescript
const VALID_ROLES: DashboardRole[] = ['SAI_ADMIN', 'SAI_OPERATOR', 'SAI_RESEARCHER', 'SAI_VIEWER'];
```

**Step 4: Update frontend DashboardRole type**

In `frontend/src/types/api.ts`, find line 10:
```typescript
export type DashboardRole = 'SAI_ADMIN' | 'SAI_OPERATOR' | 'SAI_VIEWER';
```
Replace with:
```typescript
export type DashboardRole = 'SAI_ADMIN' | 'SAI_OPERATOR' | 'SAI_RESEARCHER' | 'SAI_VIEWER';
```

**Step 5: Type-check**

```bash
npm run type-check
```

Expected: 0 errors.

**Step 6: Commit**

```bash
git add backend/src/types/index.ts backend/src/auth/roles.ts backend/src/controllers/admin.ts frontend/src/types/api.ts
git commit -m "feat(auth): add SAI_RESEARCHER role to DashboardRole and extraction priority"
```

---

### Task 3: Add DATASETS_BASE_PATH to config

**Files:**
- Modify: `backend/src/config/index.ts`
- Modify: `.env.example`

**Step 1: Add config after cacheConfig block**

In `backend/src/config/index.ts`, after the `cacheConfig` export (around line 190), add:

```typescript
const rawDatasetsBasePath = process.env.DATASETS_BASE_PATH || '/mnt/raid1/datasets';
const resolvedDatasetsBasePath = rawDatasetsBasePath.startsWith('/')
  ? rawDatasetsBasePath
  : resolve(projectRoot, rawDatasetsBasePath);

export const datasetsConfig = {
  basePath: resolvedDatasetsBasePath,
  scanCacheTtlMs: 30_000,
};
```

**Step 2: Add to .env.example**

Append to `.env.example`:
```
# Dataset Manager
DATASETS_BASE_PATH=/mnt/raid1/datasets
```

**Step 3: Ensure datasets directory exists on production**

```bash
# This runs on the server, not here. Document it.
# mkdir -p /mnt/raid1/datasets
```

**Step 4: Type-check**

```bash
npm run type-check:backend
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add backend/src/config/index.ts .env.example
git commit -m "feat(config): add DATASETS_BASE_PATH config for dataset filesystem root"
```

---

### Task 4: dataset-service — scan and create

**Files:**
- Create: `backend/src/services/dataset-service.ts`

This task implements `scanDatasets()` and `createDataset()`.

**Step 1: Create service skeleton**

```typescript
// backend/src/services/dataset-service.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { datasetsConfig } from '@/config';
import { logger } from '@/utils/logger';

export interface DatasetInfo {
  name: string;
  description: string | null;
  created_at: string | null;
  created_by: string | null;
  splits: {
    train: { count: number };
    val: { count: number };
  };
}

interface DatasetMeta {
  name: string;
  description?: string;
  created_at?: string;
  created_by?: string;
}

// 30-second in-memory cache for dataset scan results
let scanCache: { data: DatasetInfo[]; ts: number } | null = null;

export function invalidateScanCache(): void {
  scanCache = null;
}
```

**Step 2: Implement scanDatasets()**

Append to the service file:

```typescript
async function countImages(dir: string): Promise<number> {
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')).length;
  } catch {
    return 0;
  }
}

export async function scanDatasets(): Promise<DatasetInfo[]> {
  const now = Date.now();
  if (scanCache && now - scanCache.ts < datasetsConfig.scanCacheTtlMs) {
    return scanCache.data;
  }

  const base = datasetsConfig.basePath;

  try {
    await fs.mkdir(base, { recursive: true });
    const entries = await fs.readdir(base, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());

    const datasets = await Promise.all(dirs.map(async (dir): Promise<DatasetInfo> => {
      const datasetPath = path.join(base, dir.name);
      let meta: DatasetMeta = { name: dir.name };

      try {
        const raw = await fs.readFile(path.join(datasetPath, 'dataset.json'), 'utf-8');
        meta = { ...meta, ...JSON.parse(raw) };
      } catch {
        // External dataset without metadata — show with defaults
      }

      const [trainCount, valCount] = await Promise.all([
        countImages(path.join(datasetPath, 'train', 'images')),
        countImages(path.join(datasetPath, 'val', 'images')),
      ]);

      return {
        name: dir.name,
        description: meta.description ?? null,
        created_at: meta.created_at ?? null,
        created_by: meta.created_by ?? null,
        splits: {
          train: { count: trainCount },
          val: { count: valCount },
        },
      };
    }));

    scanCache = { data: datasets, ts: now };
    return datasets;
  } catch (err) {
    logger.error('dataset-service: scanDatasets failed', { err });
    throw err;
  }
}
```

**Step 3: Implement createDataset()**

Append:

```typescript
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function createDataset(
  name: string,
  description: string | undefined,
  createdBy: string,
): Promise<void> {
  if (!SLUG_PATTERN.test(name)) {
    throw Object.assign(new Error('Dataset name must be lowercase alphanumeric, hyphens or underscores, 2-64 chars'), { code: 'INVALID_NAME' });
  }

  const base = datasetsConfig.basePath;
  const datasetPath = path.join(base, name);

  try {
    await fs.mkdir(datasetPath, { exclusive: true } as any);
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      throw Object.assign(new Error(`Dataset "${name}" already exists`), { code: 'ALREADY_EXISTS' });
    }
    throw err;
  }

  // Create YOLO directory structure
  await Promise.all([
    fs.mkdir(path.join(datasetPath, 'train', 'images'), { recursive: true }),
    fs.mkdir(path.join(datasetPath, 'train', 'labels'), { recursive: true }),
    fs.mkdir(path.join(datasetPath, 'val', 'images'), { recursive: true }),
    fs.mkdir(path.join(datasetPath, 'val', 'labels'), { recursive: true }),
  ]);

  // Write metadata
  const meta: DatasetMeta = {
    name,
    description,
    created_at: new Date().toISOString(),
    created_by: createdBy,
  };
  await fs.writeFile(path.join(datasetPath, 'dataset.json'), JSON.stringify(meta, null, 2));

  // Write YOLO classes file
  await fs.writeFile(path.join(datasetPath, 'classes.txt'), 'smoke\n');

  invalidateScanCache();
  logger.info('dataset-service: created dataset', { name, createdBy });
}
```

**Step 4: Type-check**

```bash
npm run type-check:backend
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add backend/src/services/dataset-service.ts
git commit -m "feat(dataset): add scanDatasets and createDataset to dataset-service"
```

---

### Task 5: dataset-service — label generation and processJob

**Files:**
- Modify: `backend/src/services/dataset-service.ts`

**Step 1: Add imports at top of dataset-service.ts**

After the existing imports, add:
```typescript
import * as fsSync from 'fs';
import { Pool } from 'pg';
import { dualDb } from '@/database/dual-pool';
import { cacheConfig } from '@/config';
```

**Step 2: Implement generateYoloTxt()**

Append to the service file:

```typescript
interface Detection {
  class: string;
  confidence: number;
  bounding_box: { x: number; y: number; width: number; height: number };
}

/**
 * Convert pixel-space detections to YOLO normalized TXT format.
 * Returns empty string if no detections (negative sample).
 */
export function generateYoloTxt(
  detections: Detection[] | null,
  imageWidth: number,
  imageHeight: number,
): string {
  if (!detections || detections.length === 0) return '';

  return detections
    .map(d => {
      const cx = (d.bounding_box.x + d.bounding_box.width / 2) / imageWidth;
      const cy = (d.bounding_box.y + d.bounding_box.height / 2) / imageHeight;
      const w  = d.bounding_box.width / imageWidth;
      const h  = d.bounding_box.height / imageHeight;
      // class_id 0 = smoke (only class in this model)
      return `0 ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`;
    })
    .join('\n');
}
```

**Step 3: Implement processJob()**

Append:

```typescript
export async function processJob(jobId: string): Promise<void> {
  const db: Pool = dualDb.sai;

  // Claim job atomically
  const claimResult = await db.query(
    `UPDATE dataset_jobs
     SET status = 'processing'
     WHERE id = $1 AND status = 'pending'
     RETURNING dataset_name, split, execution_ids, total`,
    [jobId]
  );

  if (claimResult.rowCount === 0) {
    logger.warn('dataset-service: processJob — job not found or already claimed', { jobId });
    return;
  }

  const { dataset_name, split, execution_ids, total } = claimResult.rows[0];
  const destImages = path.join(datasetsConfig.basePath, dataset_name, split, 'images');
  const destLabels = path.join(datasetsConfig.basePath, dataset_name, split, 'labels');

  let progress = 0;
  const errors: string[] = [];

  for (const execId of execution_ids) {
    try {
      // Fetch image path + detection data from DB
      const row = await db.query(
        `SELECT
           ei.original_path,
           ei.width   AS image_width,
           ei.height  AS image_height,
           ea.detections
         FROM execution_images ei
         LEFT JOIN execution_analysis ea ON ea.execution_id = ei.execution_id
         WHERE ei.execution_id = $1`,
        [execId]
      );

      if (row.rowCount === 0 || !row.rows[0].original_path) {
        logger.warn('dataset-service: no image for execution', { execId });
        progress++;
        continue;
      }

      const { original_path, image_width, image_height, detections } = row.rows[0];
      const srcPath = path.join(cacheConfig.basePath, original_path);
      const dstImage = path.join(destImages, `${execId}.jpg`);
      const dstLabel = path.join(destLabels, `${execId}.txt`);

      // Copy image
      await fs.copyFile(srcPath, dstImage);

      // Generate and write label
      const parsed: Detection[] | null = typeof detections === 'string'
        ? JSON.parse(detections)
        : detections;
      const txt = generateYoloTxt(parsed, image_width ?? 1920, image_height ?? 1080);
      await fs.writeFile(dstLabel, txt);

      progress++;

      // Update progress every 10 items
      if (progress % 10 === 0) {
        await db.query(
          'UPDATE dataset_jobs SET progress = $1 WHERE id = $2',
          [progress, jobId]
        );
      }
    } catch (err: any) {
      logger.error('dataset-service: error processing execution', { execId, err: err.message });
      errors.push(`${execId}: ${err.message}`);
      progress++;
    }
  }

  const finalStatus = errors.length === total ? 'failed' : 'completed';
  await db.query(
    `UPDATE dataset_jobs
     SET status = $1, progress = $2, completed_at = NOW(), error = $3
     WHERE id = $4`,
    [finalStatus, progress, errors.length > 0 ? errors.join('\n') : null, jobId]
  );

  invalidateScanCache();
  logger.info('dataset-service: processJob complete', { jobId, progress, total, finalStatus });
}
```

**Step 4: Implement listSplitImages()**

Append:

```typescript
export interface DatasetImage {
  executionId: number;
  imagePath: string;        // URL path for frontend
  thumbnailPath: string;
  detections: Detection[] | null;
  alertLevel: string | null;
  hasSmoke: boolean;
  captureTimestamp: string | null;
  cameraId: string | null;
  location: string | null;
}

export async function listSplitImages(
  datasetName: string,
  split: 'train' | 'val',
  page: number,
  limit: number,
): Promise<{ items: DatasetImage[]; total: number }> {
  const imagesDir = path.join(datasetsConfig.basePath, datasetName, split, 'images');

  let files: string[];
  try {
    files = await fs.readdir(imagesDir);
  } catch {
    return { items: [], total: 0 };
  }

  const imageFiles = files
    .filter(f => /\.(jpg|jpeg|png)$/.test(f))
    .sort();

  const total = imageFiles.length;
  const offset = (page - 1) * limit;
  const page_files = imageFiles.slice(offset, offset + limit);

  if (page_files.length === 0) {
    return { items: [], total };
  }

  const executionIds = page_files.map(f => parseInt(f.replace(/\.[^.]+$/, ''), 10));

  const db: Pool = dualDb.sai;
  const result = await db.query(
    `SELECT
       e.id              AS execution_id,
       e.camera_id,
       e.location,
       e.capture_timestamp,
       ea.detections,
       ea.alert_level,
       ea.has_smoke
     FROM executions e
     LEFT JOIN execution_analysis ea ON ea.execution_id = e.id
     WHERE e.id = ANY($1::bigint[])`,
    [executionIds]
  );

  const rowMap = new Map(result.rows.map(r => [Number(r.execution_id), r]));

  const items: DatasetImage[] = executionIds.map(execId => {
    const row = rowMap.get(execId);
    const detections = row?.detections
      ? (typeof row.detections === 'string' ? JSON.parse(row.detections) : row.detections)
      : null;

    return {
      executionId: execId,
      imagePath: `/datasets/${datasetName}/${split}/image/${execId}`,
      thumbnailPath: `/datasets/${datasetName}/${split}/image/${execId}`,
      detections,
      alertLevel: row?.alert_level ?? null,
      hasSmoke: row?.has_smoke ?? false,
      captureTimestamp: row?.capture_timestamp?.toISOString() ?? null,
      cameraId: row?.camera_id ?? null,
      location: row?.location ?? null,
    };
  });

  return { items, total };
}
```

**Step 5: Type-check**

```bash
npm run type-check:backend
```

Expected: 0 errors.

**Step 6: Commit**

```bash
git add backend/src/services/dataset-service.ts
git commit -m "feat(dataset): add generateYoloTxt, processJob, listSplitImages to dataset-service"
```

---

### Task 6: Datasets router

**Files:**
- Create: `backend/src/routes/datasets.ts`
- Modify: `backend/src/routes/index.ts`

**Step 1: Create datasets router**

```typescript
// backend/src/routes/datasets.ts
import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { asyncHandler } from '@/utils';
import { requireAuth, authenticateToken, requireRole } from '@/middleware/auth';
import { dualDb } from '@/database/dual-pool';
import { datasetsConfig } from '@/config';
import {
  scanDatasets,
  createDataset,
  processJob,
  listSplitImages,
} from '@/services/dataset-service';
import { logger } from '@/utils/logger';

const router = Router();

// All dataset routes require authentication + researcher or admin role
router.use(authenticateToken, requireAuth, requireRole('SAI_RESEARCHER', 'SAI_ADMIN'));

// =================================================================
// GET /datasets — list all datasets (filesystem scan, 30s cache)
// =================================================================
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const datasets = await scanDatasets();
  res.json({ datasets });
}));

// =================================================================
// POST /datasets — create new dataset
// =================================================================
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const createdBy = req.user?.email ?? 'unknown';

  try {
    await createDataset(name, description, createdBy);
    res.status(201).json({ message: 'Dataset created', name });
  } catch (err: any) {
    if (err.code === 'INVALID_NAME') return res.status(400).json({ error: err.message });
    if (err.code === 'ALREADY_EXISTS') return res.status(409).json({ error: err.message });
    throw err;
  }
}));

// =================================================================
// DELETE /datasets/:name — delete dataset (SAI_ADMIN only)
// =================================================================
router.delete('/:name', requireRole('SAI_ADMIN'), asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const datasetPath = path.join(datasetsConfig.basePath, name);

  // Safety: name must not contain path traversal
  const resolved = path.resolve(datasetPath);
  if (!resolved.startsWith(path.resolve(datasetsConfig.basePath))) {
    return res.status(400).json({ error: 'Invalid dataset name' });
  }

  await fs.promises.rm(datasetPath, { recursive: true, force: true });
  logger.info('dataset: deleted dataset', { name, by: req.user?.email });
  res.json({ message: 'Dataset deleted' });
}));

// =================================================================
// GET /datasets/:name/:split — list images in split (paginated)
// =================================================================
router.get('/:name/:split', asyncHandler(async (req: Request, res: Response) => {
  const { name, split } = req.params;
  if (split !== 'train' && split !== 'val') {
    return res.status(400).json({ error: 'split must be train or val' });
  }

  const page  = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));

  const result = await listSplitImages(name, split, page, limit);
  res.json({ ...result, page, limit });
}));

// =================================================================
// GET /datasets/:name/:split/image/:executionId — serve image
// =================================================================
router.get('/:name/:split/image/:executionId', (req: Request, res: Response) => {
  const { name, split, executionId } = req.params;
  const imagePath = path.join(datasetsConfig.basePath, name, split, 'images', `${executionId}.jpg`);

  // Path traversal guard
  const resolved = path.resolve(imagePath);
  if (!resolved.startsWith(path.resolve(datasetsConfig.basePath))) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  res.sendFile(resolved, err => {
    if (err) res.status(404).json({ error: 'Image not found' });
  });
});

// =================================================================
// GET /datasets/:name/:split/label/:executionId — serve label TXT
// =================================================================
router.get('/:name/:split/label/:executionId', (req: Request, res: Response) => {
  const { name, split, executionId } = req.params;
  const labelPath = path.join(datasetsConfig.basePath, name, split, 'labels', `${executionId}.txt`);

  const resolved = path.resolve(labelPath);
  if (!resolved.startsWith(path.resolve(datasetsConfig.basePath))) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  res.setHeader('Content-Type', 'text/plain');
  res.sendFile(resolved, err => {
    if (err) res.status(404).json({ error: 'Label not found' });
  });
});

// =================================================================
// POST /datasets/jobs — create add-to-dataset job
// =================================================================
router.post('/jobs', asyncHandler(async (req: Request, res: Response) => {
  const { dataset_name, split, execution_ids, create_if_missing } = req.body as {
    dataset_name: string;
    split: 'train' | 'val';
    execution_ids: number[];
    create_if_missing?: boolean;
  };

  if (!dataset_name || !split || !execution_ids?.length) {
    return res.status(400).json({ error: 'dataset_name, split, and execution_ids are required' });
  }
  if (split !== 'train' && split !== 'val') {
    return res.status(400).json({ error: 'split must be train or val' });
  }

  // Optionally create dataset if missing
  if (create_if_missing) {
    try {
      await createDataset(dataset_name, undefined, req.user?.email ?? 'unknown');
    } catch (err: any) {
      if (err.code !== 'ALREADY_EXISTS') throw err;
    }
  }

  const db = dualDb.sai;
  const result = await db.query(
    `INSERT INTO dataset_jobs (dataset_name, split, execution_ids, total, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [dataset_name, split, execution_ids, execution_ids.length, req.user?.email ?? null]
  );

  const jobId: string = result.rows[0].id;

  // Kick off async processing (do not await)
  processJob(jobId).catch(err => {
    logger.error('dataset: processJob background error', { jobId, err });
  });

  res.status(202).json({ job_id: jobId });
}));

// =================================================================
// GET /datasets/jobs/:jobId — poll job status
// =================================================================
router.get('/jobs/:jobId', asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const db = dualDb.sai;
  const result = await db.query(
    'SELECT id, status, progress, total, completed_at, error FROM dataset_jobs WHERE id = $1',
    [jobId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(result.rows[0]);
}));

export default router;
```

**Step 2: Mount router in backend/src/routes/index.ts**

At the end of `backend/src/routes/index.ts`, before `export default router`, add:

```typescript
// =================================================================
// Dataset Routes (SAI_RESEARCHER + SAI_ADMIN)
// =================================================================
import datasetRouter from './datasets';
router.use('/datasets', datasetRouter);
```

(The import should be added with the other imports at the top of the file instead, but for minimal diff, placing the import inline is acceptable since this is CommonJS compiled — add the import at the top with other router imports.)

Actually: add the import at the top of routes/index.ts:
```typescript
import datasetRouter from './datasets';
```

And before `export default router` at the bottom:
```typescript
router.use('/datasets', datasetRouter);
```

**Step 3: Type-check**

```bash
npm run type-check:backend
```

Expected: 0 errors.

**Step 4: Quick smoke test (manual)**

```bash
# Start backend in dev
npm run dev:backend &

# Test list (should return empty array first time)
curl -s http://localhost:3001/dashboard/api/datasets \
  -H "Authorization: Bearer <dev-token>" | jq .

# Test create
curl -s -X POST http://localhost:3001/dashboard/api/datasets \
  -H "Authorization: Bearer <dev-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-dataset","description":"test"}' | jq .
```

Expected: `{"datasets":[]}` then `{"message":"Dataset created","name":"test-dataset"}`

**Step 5: Commit**

```bash
git add backend/src/routes/datasets.ts backend/src/routes/index.ts
git commit -m "feat(api): add /datasets router with CRUD, job dispatch, and image serving"
```

---

## Phase 2: Frontend

### Task 7: Frontend dataset types

**Files:**
- Create: `frontend/src/types/dataset.ts`

**Step 1: Write types**

```typescript
// frontend/src/types/dataset.ts

export interface DatasetSplit {
  count: number;
}

export interface Dataset {
  name: string;
  description: string | null;
  created_at: string | null;
  created_by: string | null;
  splits: {
    train: DatasetSplit;
    val: DatasetSplit;
  };
}

export interface DatasetImage {
  executionId: number;
  imagePath: string;
  thumbnailPath: string;
  detections: Array<{
    class: string;
    confidence: number;
    bounding_box: { x: number; y: number; width: number; height: number };
  }> | null;
  alertLevel: string | null;
  hasSmoke: boolean;
  captureTimestamp: string | null;
  cameraId: string | null;
  location: string | null;
}

export interface DatasetJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  total: number;
  completed_at: string | null;
  error: string | null;
}

export type DatasetSplitName = 'train' | 'val';
```

**Step 2: Commit**

```bash
git add frontend/src/types/dataset.ts
git commit -m "feat(frontend): add dataset TypeScript types"
```

---

### Task 8: useDatasets hook

**Files:**
- Create: `frontend/src/hooks/useDatasets.ts`

**Step 1: Write hook**

```typescript
// frontend/src/hooks/useDatasets.ts
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Dataset, DatasetImage, DatasetJob, DatasetSplitName } from '@/types/dataset';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/dashboard/api';

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function useDatasets() {
  const { token } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ datasets: Dataset[] }>('/datasets', token);
      setDatasets(data.datasets);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const createDataset = useCallback(async (name: string, description?: string) => {
    if (!token) throw new Error('Not authenticated');
    await apiFetch('/datasets', token, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    await load();
  }, [token, load]);

  return { datasets, loading, error, reload: load, createDataset };
}

export function useDatasetImages(
  datasetName: string | null,
  split: DatasetSplitName | null,
) {
  const { token } = useAuth();
  const [items, setItems] = useState<DatasetImage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!datasetName || !split || !token) { setItems([]); return; }

    let cancelled = false;
    setLoading(true);

    apiFetch<{ items: DatasetImage[]; total: number }>(`/datasets/${datasetName}/${split}?page=${page}&limit=50`, token)
      .then(data => {
        if (!cancelled) { setItems(data.items); setTotal(data.total); }
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [datasetName, split, page, token]);

  return { items, total, page, setPage, loading };
}

export function useJobPolling(jobId: string | null) {
  const { token } = useAuth();
  const [job, setJob] = useState<DatasetJob | null>(null);

  useEffect(() => {
    if (!jobId || !token) { setJob(null); return; }

    const poll = async () => {
      try {
        const data = await apiFetch<DatasetJob>(`/datasets/jobs/${jobId}`, token);
        setJob(data);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
        }
      } catch { /* ignore */ }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [jobId, token]);

  return job;
}

export async function createDatasetJob(
  token: string,
  datasetName: string,
  split: DatasetSplitName,
  executionIds: number[],
  createIfMissing = false,
): Promise<string> {
  const data = await apiFetch<{ job_id: string }>('/datasets/jobs', token, {
    method: 'POST',
    body: JSON.stringify({
      dataset_name: datasetName,
      split,
      execution_ids: executionIds,
      create_if_missing: createIfMissing,
    }),
  });
  return data.job_id;
}
```

**Step 2: Type-check**

```bash
npm run type-check:frontend
```

Expected: 0 errors.

**Step 3: Commit**

```bash
git add frontend/src/hooks/useDatasets.ts
git commit -m "feat(frontend): add useDatasets, useDatasetImages, useJobPolling hooks"
```

---

### Task 9: DatasetTree component

**Files:**
- Create: `frontend/src/components/datasets/DatasetTree.tsx`

**Step 1: Write component**

```tsx
// frontend/src/components/datasets/DatasetTree.tsx
import { useState } from 'react';
import { ChevronRight, ChevronDown, Database, FolderOpen, Folder, Plus } from 'lucide-react';
import { cn } from '@/utils';
import { Dataset, DatasetSplitName } from '@/types/dataset';

interface DatasetTreeProps {
  datasets: Dataset[];
  selectedDataset: string | null;
  selectedSplit: DatasetSplitName | null;
  onSelect: (dataset: string, split: DatasetSplitName) => void;
  onCreateClick: () => void;
  loading: boolean;
}

export function DatasetTree({
  datasets,
  selectedDataset,
  selectedSplit,
  onSelect,
  onCreateClick,
  loading,
}: DatasetTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <div className="w-56 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Datasets</span>
        <button
          onClick={onCreateClick}
          className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
          title="Nuevo dataset"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="px-3 py-2 text-xs text-gray-400">Cargando…</div>
        )}
        {!loading && datasets.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">
            Sin datasets.<br />
            <button onClick={onCreateClick} className="text-primary-600 hover:underline mt-1">
              Crear el primero
            </button>
          </div>
        )}
        {datasets.map(ds => {
          const isOpen = expanded.has(ds.name);
          return (
            <div key={ds.name}>
              {/* Dataset root */}
              <button
                onClick={() => toggle(ds.name)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {isOpen
                  ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                }
                <Database className="h-3.5 w-3.5 text-primary-500 flex-shrink-0" />
                <span className="truncate font-medium">{ds.name}</span>
              </button>

              {/* Splits */}
              {isOpen && (
                <div className="pl-6">
                  {(['train', 'val'] as DatasetSplitName[]).map(split => {
                    const count = ds.splits[split].count;
                    const isActive = selectedDataset === ds.name && selectedSplit === split;
                    return (
                      <button
                        key={split}
                        onClick={() => onSelect(ds.name, split)}
                        className={cn(
                          'w-full flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors rounded-md mx-1',
                          isActive
                            ? 'bg-primary-50 text-primary-700 font-medium'
                            : 'text-gray-600 hover:bg-gray-50'
                        )}
                      >
                        {isActive
                          ? <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
                          : <Folder className="h-3.5 w-3.5 flex-shrink-0" />
                        }
                        <span className="truncate">{split}</span>
                        <span className="ml-auto text-xs text-gray-400">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Type-check**

```bash
npm run type-check:frontend
```

Expected: 0 errors.

**Step 3: Commit**

```bash
git add frontend/src/components/datasets/DatasetTree.tsx
git commit -m "feat(frontend): add DatasetTree sidebar component"
```

---

### Task 10: CreateDatasetModal

**Files:**
- Create: `frontend/src/components/datasets/CreateDatasetModal.tsx`

**Step 1: Write component**

```tsx
// frontend/src/components/datasets/CreateDatasetModal.tsx
import { useState } from 'react';
import { X } from 'lucide-react';

interface CreateDatasetModalProps {
  onConfirm: (name: string, description?: string) => Promise<void>;
  onClose: () => void;
}

export function CreateDatasetModal({ onConfirm, onClose }: CreateDatasetModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugify = (v: string) =>
    v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      await onConfirm(name, description || undefined);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Nuevo dataset</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre (slug)</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(slugify(e.target.value))}
              placeholder="incendio-norte-v1"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
            <p className="mt-1 text-xs text-gray-400">Minúsculas, guiones, sin espacios.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción (opcional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !name}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {loading ? 'Creando…' : 'Crear dataset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/datasets/CreateDatasetModal.tsx
git commit -m "feat(frontend): add CreateDatasetModal component"
```

---

### Task 11: DatasetGallery component

**Files:**
- Create: `frontend/src/components/datasets/DatasetGallery.tsx`

This component reuses `ImageModal` for the zoom/bounding box view but builds its own card grid. The images come from the `/datasets/:name/:split/image/:id` endpoint, not the regular execution image endpoints.

**Step 1: Write component**

```tsx
// frontend/src/components/datasets/DatasetGallery.tsx
import { useState } from 'react';
import { DatasetImage, DatasetSplitName } from '@/types/dataset';
import { ImageModal } from '@/components/ImageModal';
import { useTranslation } from '@/contexts/LanguageContext';
import { ScanEye, ImageOff } from 'lucide-react';
import { cn } from '@/utils';

interface DatasetGalleryProps {
  datasetName: string;
  split: DatasetSplitName;
  items: DatasetImage[];
  total: number;
  page: number;
  onPageChange: (p: number) => void;
  loading: boolean;
}

const ALERT_COLORS: Record<string, string> = {
  critical: 'ring-2 ring-red-500',
  high:     'ring-2 ring-orange-400',
  medium:   'ring-2 ring-yellow-400',
  low:      'ring-1 ring-yellow-200',
};

export function DatasetGallery({
  datasetName, split, items, total, page, onPageChange, loading,
}: DatasetGalleryProps) {
  const [selected, setSelected] = useState<DatasetImage | null>(null);
  const { t } = useTranslation();

  const totalPages = Math.ceil(total / 50);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <span className="text-sm">Cargando imágenes…</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
        <ImageOff className="h-10 w-10" />
        <span className="text-sm">Este split no tiene imágenes todavía.</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {items.map(item => (
          <button
            key={item.executionId}
            onClick={() => setSelected(item)}
            className={cn(
              'relative aspect-video bg-gray-100 rounded-lg overflow-hidden group cursor-pointer transition-all',
              'hover:shadow-md hover:scale-[1.02]',
              item.alertLevel ? (ALERT_COLORS[item.alertLevel] ?? '') : ''
            )}
          >
            <img
              src={item.imagePath}
              alt={`Execution ${item.executionId}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {item.hasSmoke && (
              <div className="absolute top-1 right-1 bg-orange-500/90 text-white rounded p-0.5">
                <ScanEye className="h-3 w-3" />
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-white text-xs truncate block">{item.executionId}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Footer: count + pagination */}
      <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
        <span>{total} imágenes · {split}</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              ‹
            </button>
            <span>{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              ›
            </button>
          </div>
        )}
      </div>

      {/* Image modal — reuses existing ImageModal with a synthetic execution object */}
      {selected && (
        <ImageModal
          execution={{
            id: selected.executionId,
            hasImage: true,
            detections: selected.detections,
            alertLevel: selected.alertLevel as any,
            hasSmoke: selected.hasSmoke,
            // Override image URLs to point to dataset endpoint
            imageUrl: selected.imagePath,
            thumbnailUrl: selected.thumbnailPath,
            // Fill required fields with nulls
            workflowId: '', executionTimestamp: '', status: 'success', mode: '',
            deviceId: null, nodeId: null, cameraId: selected.cameraId,
            location: selected.location, cameraType: null,
            captureTimestamp: selected.captureTimestamp,
            requestId: null, yoloModelVersion: null, detectionCount: 0,
            detectionMode: null, activeClasses: null, confidenceSmoke: null,
            confidenceScore: null, imagePath: selected.imagePath,
            thumbnailPath: selected.thumbnailPath, cachedPath: null,
            imageSizeBytes: null, imageFormat: null,
            imageWidth: null, imageHeight: null,
            telegramSent: false, telegramMessageId: null, telegramSentAt: null,
            yoloProcessingTimeMs: null, processingTimeMs: null,
            extractedAt: null, completionTimestamp: null, durationMs: null,
            isFalsePositive: false, falsePositiveReason: null,
            markedFalsePositiveAt: null,
          } as any}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
```

> **Note:** The `ImageModal` component expects an `Execution`-shaped object. The cast to `any` is intentional — the modal only reads `detections`, `alertLevel`, `hasSmoke`, and the image URLs from it. If `ImageModal` props change, update this accordingly.

**Step 2: Commit**

```bash
git add frontend/src/components/datasets/DatasetGallery.tsx
git commit -m "feat(frontend): add DatasetGallery component reusing ImageModal"
```

---

### Task 12: Datasets page + routing

**Files:**
- Create: `frontend/src/pages/Datasets.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`

**Step 1: Create Datasets page**

```tsx
// frontend/src/pages/Datasets.tsx
import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { DatasetTree } from '@/components/datasets/DatasetTree';
import { DatasetGallery } from '@/components/datasets/DatasetGallery';
import { CreateDatasetModal } from '@/components/datasets/CreateDatasetModal';
import { useDatasets, useDatasetImages } from '@/hooks/useDatasets';
import { DatasetSplitName } from '@/types/dataset';

export function Datasets() {
  const { datasets, loading, createDataset, reload } = useDatasets();
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [selectedSplit, setSelectedSplit] = useState<DatasetSplitName | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { items, total, page, setPage, loading: imagesLoading } = useDatasetImages(
    selectedDataset,
    selectedSplit,
  );

  const handleSelect = (dataset: string, split: DatasetSplitName) => {
    setSelectedDataset(dataset);
    setSelectedSplit(split);
    setPage(1);
  };

  const handleCreate = async (name: string, description?: string) => {
    await createDataset(name, description);
    setShowCreate(false);
    await reload();
  };

  return (
    <Layout>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        <DatasetTree
          datasets={datasets}
          selectedDataset={selectedDataset}
          selectedSplit={selectedSplit}
          onSelect={handleSelect}
          onCreateClick={() => setShowCreate(true)}
          loading={loading}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedDataset ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2">
              <span className="text-sm">Seleccioná un dataset del árbol para explorar sus imágenes.</span>
            </div>
          ) : (
            <DatasetGallery
              datasetName={selectedDataset}
              split={selectedSplit!}
              items={items}
              total={total}
              page={page}
              onPageChange={setPage}
              loading={imagesLoading}
            />
          )}
        </div>
      </div>

      {showCreate && (
        <CreateDatasetModal
          onConfirm={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </Layout>
  );
}
```

**Step 2: Add route in App.tsx**

In `frontend/src/App.tsx`, add the import:
```typescript
import { Datasets } from '@/pages/Datasets';
```

Inside the protected Routes block (after the `/stats` route):
```tsx
<Route path="/datasets" element={<Datasets />} />
```

**Step 3: Add nav tab in Layout.tsx**

In `frontend/src/components/Layout.tsx`, find the navLinks array (lines 41-44):
```typescript
const navLinks = [
  { to: '/', labelKey: 'nav.gallery', icon: Home },
  { to: '/stats', labelKey: 'nav.statistics', icon: BarChart3 },
];
```

This is static — but Datasets tab should only show for SAI_RESEARCHER and SAI_ADMIN. Change to:

```typescript
import { useAuth } from '@/hooks/useAuth';  // already imported
// ...
const { logout, isLoading: authLoading, user } = useAuth();  // add user
// ...
const canAccessDatasets = user?.role === 'SAI_RESEARCHER' || user?.role === 'SAI_ADMIN';

const navLinks = [
  { to: '/', labelKey: 'nav.gallery', icon: Home },
  { to: '/stats', labelKey: 'nav.statistics', icon: BarChart3 },
  ...(canAccessDatasets ? [{ to: '/datasets', labelKey: 'nav.datasets', icon: Database }] : []),
];
```

Also add `Database` to the lucide-react import at the top of Layout.tsx:
```typescript
import { ..., Database } from 'lucide-react';
```

Add the translation key — in `frontend/src/contexts/LanguageContext.tsx` (or wherever translations are defined), find `nav.gallery` and `nav.statistics` and add:
```
'nav.datasets': 'Datasets',
```

**Step 4: Type-check**

```bash
npm run type-check:frontend
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add frontend/src/pages/Datasets.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat(frontend): add Datasets page, route, and nav tab (role-gated)"
```

---

## Phase 3: BatchActionBar integration

### Task 13: AddToDatasetModal

**Files:**
- Create: `frontend/src/components/datasets/AddToDatasetModal.tsx`

**Step 1: Write component**

```tsx
// frontend/src/components/datasets/AddToDatasetModal.tsx
import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Dataset, DatasetSplitName } from '@/types/dataset';
import { useAuth } from '@/hooks/useAuth';
import { createDatasetJob } from '@/hooks/useDatasets';
import toast from 'react-hot-toast';

interface AddToDatasetModalProps {
  executionIds: number[];
  datasets: Dataset[];
  onClose: () => void;
  onJobStarted: (jobId: string) => void;
}

export function AddToDatasetModal({
  executionIds, datasets, onClose, onJobStarted,
}: AddToDatasetModalProps) {
  const { token } = useAuth();
  const [selectedDataset, setSelectedDataset] = useState<string>(datasets[0]?.name ?? '');
  const [split, setSplit] = useState<DatasetSplitName>('train');
  const [newName, setNewName] = useState('');
  const [mode, setMode] = useState<'existing' | 'new'>(datasets.length > 0 ? 'existing' : 'new');
  const [loading, setLoading] = useState(false);

  const slugify = (v: string) =>
    v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');

  const handleConfirm = async () => {
    if (!token) return;
    const datasetName = mode === 'new' ? newName : selectedDataset;
    if (!datasetName) { toast.error('Elegí o creá un dataset'); return; }

    setLoading(true);
    try {
      const jobId = await createDatasetJob(
        token, datasetName, split, executionIds, mode === 'new'
      );
      onJobStarted(jobId);
      toast.success(`${executionIds.length} imágenes agregadas a ${datasetName}/${split}`);
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Agregar {executionIds.length} imagen{executionIds.length !== 1 ? 's' : ''} a dataset
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('existing')}
              disabled={datasets.length === 0}
              className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                mode === 'existing'
                  ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              } disabled:opacity-40`}
            >
              Dataset existente
            </button>
            <button
              onClick={() => setMode('new')}
              className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                mode === 'new'
                  ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Plus className="h-3.5 w-3.5 inline mr-1" />
              Nuevo
            </button>
          </div>

          {/* Dataset selector or name input */}
          {mode === 'existing' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dataset</label>
              <select
                value={selectedDataset}
                onChange={e => setSelectedDataset(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {datasets.map(ds => (
                  <option key={ds.name} value={ds.name}>{ds.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del nuevo dataset</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(slugify(e.target.value))}
                placeholder="mi-dataset-v1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}

          {/* Split selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Split</label>
            <div className="flex gap-2">
              {(['train', 'val'] as DatasetSplitName[]).map(s => (
                <button
                  key={s}
                  onClick={() => setSplit(s)}
                  className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                    split === s
                      ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || (mode === 'new' && !newName)}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg transition-colors"
          >
            {loading ? 'Enviando…' : `Agregar al dataset`}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/datasets/AddToDatasetModal.tsx
git commit -m "feat(frontend): add AddToDatasetModal for batch add-to-dataset flow"
```

---

### Task 14: Extend BatchActionBar with "Agregar a Dataset" button

**Files:**
- Modify: `frontend/src/components/BatchActionBar.tsx`

**Step 1: Update props interface**

In `BatchActionBar.tsx`, update the interface:

```typescript
interface BatchActionBarProps {
  selectedCount: number;
  onMarkFalsePositive: () => Promise<void>;
  onExportCsv: () => void;
  onDownloadImages: () => Promise<void>;
  onClearSelection: () => void;
  onAddToDataset?: () => void;  // optional: only shown for researcher/admin
}
```

**Step 2: Add import and button**

Add import:
```typescript
import { ..., FolderInput } from 'lucide-react';
```

In the component, destructure the new prop:
```typescript
export function BatchActionBar({
  ...,
  onAddToDataset,
}: BatchActionBarProps) {
```

Add button after the Export CSV button (before the divider before X):
```tsx
{onAddToDataset && (
  <button
    onClick={onAddToDataset}
    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-green-700 hover:bg-green-600 rounded-lg transition-colors"
  >
    <FolderInput className="h-4 w-4" />
    Agregar a Dataset
  </button>
)}
```

**Step 3: Wire up in Dashboard.tsx**

In `frontend/src/pages/Dashboard.tsx`, find where `BatchActionBar` is rendered. Add:

```typescript
import { useAuth } from '@/hooks/useAuth';
import { AddToDatasetModal } from '@/components/datasets/AddToDatasetModal';
import { useDatasets } from '@/hooks/useDatasets';

// Inside Dashboard component:
const { user } = useAuth();
const { datasets } = useDatasets();
const [showAddToDataset, setShowAddToDataset] = useState(false);

const canAddToDataset = user?.role === 'SAI_RESEARCHER' || user?.role === 'SAI_ADMIN';
```

Pass to BatchActionBar:
```tsx
<BatchActionBar
  ...existing props...
  onAddToDataset={canAddToDataset ? () => setShowAddToDataset(true) : undefined}
/>
```

Add modal rendering (inside Dashboard return, after BatchActionBar):
```tsx
{showAddToDataset && (
  <AddToDatasetModal
    executionIds={Array.from(selectedIds)}
    datasets={datasets}
    onClose={() => setShowAddToDataset(false)}
    onJobStarted={(jobId) => {
      // Optional: could show a progress toast here
      console.log('Dataset job started:', jobId);
    }}
  />
)}
```

**Step 4: Type-check**

```bash
npm run type-check:frontend
```

Expected: 0 errors.

**Step 5: Full type-check**

```bash
npm run type-check
```

Expected: 0 errors on both backend and frontend.

**Step 6: Commit**

```bash
git add frontend/src/components/BatchActionBar.tsx frontend/src/pages/Dashboard.tsx
git commit -m "feat(frontend): add 'Agregar a Dataset' button to BatchActionBar for researcher/admin"
```

---

## Phase 4 (optional): Re-inference

> Implement only if YOLO_INFERENCE_URL env var is available. Skip if not needed immediately.

### Task 15: Re-inference backend endpoint

**Files:**
- Modify: `backend/src/services/dataset-service.ts`
- Modify: `backend/src/routes/datasets.ts`

**Step 1: Add re-inference config**

In `backend/src/config/index.ts`, add to `datasetsConfig`:
```typescript
export const datasetsConfig = {
  basePath: resolvedDatasetsBasePath,
  scanCacheTtlMs: 30_000,
  yoloInferenceUrl: process.env.YOLO_INFERENCE_URL ?? null,
};
```

**Step 2: Add reInferDataset() to dataset-service.ts**

```typescript
export async function reInferDataset(
  datasetName: string,
  split: 'train' | 'val',
): Promise<void> {
  const { yoloInferenceUrl } = datasetsConfig;
  if (!yoloInferenceUrl) throw new Error('YOLO_INFERENCE_URL not configured');

  const imagesDir = path.join(datasetsConfig.basePath, datasetName, split, 'images');
  const labelsDir = path.join(datasetsConfig.basePath, datasetName, split, 'labels');
  const files = await fs.readdir(imagesDir);

  for (const file of files.filter(f => /\.(jpg|jpeg|png)$/.test(f))) {
    const imgPath = path.join(imagesDir, file);
    const imgBytes = await fs.readFile(imgPath);

    const response = await fetch(yoloInferenceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: imgBytes,
    });

    if (!response.ok) continue;
    const result = await response.json();

    // Parse YOLO Inference service response format
    const detections: Detection[] = (result.detections ?? []).map((d: any) => ({
      class: d.class ?? 'smoke',
      confidence: d.confidence ?? 0,
      bounding_box: d.bounding_box ?? { x: 0, y: 0, width: 0, height: 0 },
    }));

    // Get image dimensions
    const { width, height } = await import('sharp').then(s => s.default(imgPath).metadata());
    const txt = generateYoloTxt(detections, width ?? 1920, height ?? 1080);
    await fs.writeFile(path.join(labelsDir, file.replace(/\.[^.]+$/, '.txt')), txt);
  }
}
```

**Step 3: Add endpoint to datasets router**

In `backend/src/routes/datasets.ts`:
```typescript
router.post('/:name/:split/reinfer', asyncHandler(async (req: Request, res: Response) => {
  const { name, split } = req.params;
  if (split !== 'train' && split !== 'val') {
    return res.status(400).json({ error: 'split must be train or val' });
  }
  // Fire and forget — client polls via a separate mechanism
  reInferDataset(name, split as 'train' | 'val')
    .catch(err => logger.error('reinfer background error', { err }));
  res.status(202).json({ message: 'Re-inference job started' });
}));
```

**Step 4: Commit**

```bash
git add backend/src/services/dataset-service.ts backend/src/routes/datasets.ts backend/src/config/index.ts
git commit -m "feat(dataset): add optional re-inference endpoint (YOLO_INFERENCE_URL)"
```

---

## Final checklist before PR

```bash
# Full type-check
npm run type-check

# Lint
npm run lint

# Build backend
npm run build:backend

# Build frontend
npm run build:frontend
```

Expected: 0 errors, 0 warnings that didn't exist before.

```bash
# Create PR
git push origin feat/dataset-manager
gh pr create \
  --title "feat: Dataset Manager epic (Phase 1-3)" \
  --base main \
  --body "Adds /datasets page with filesystem-first YOLO dataset management. See docs/plans/2026-02-22-dataset-manager-design.md"
```

---

## Zitadel: create SAI_RESEARCHER role

After deploying, create the role in Zitadel console:
1. Project → Roles → Add `SAI_RESEARCHER`
2. Assign to researcher user accounts
3. Verify login — `Datasets` tab should appear in nav
