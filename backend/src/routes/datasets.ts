// backend/src/routes/datasets.ts
import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { asyncHandler } from '@/utils';
import { requireRole } from '@/middleware/auth';
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

// All dataset routes require researcher or admin role
router.use(requireRole('SAI_RESEARCHER', 'SAI_ADMIN'));

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
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const createdBy = req.user?.email ?? 'unknown';

  try {
    await createDataset(name, description, createdBy);
    res.status(201).json({ message: 'Dataset created', name });
  } catch (err: any) {
    if (err.code === 'INVALID_NAME') { res.status(400).json({ error: err.message }); return; }
    if (err.code === 'ALREADY_EXISTS') { res.status(409).json({ error: err.message }); return; }
    throw err;
  }
}));

// =================================================================
// POST /datasets/jobs — create add-to-dataset job
// (Must come before /:name routes to avoid param conflict)
// =================================================================
router.post('/jobs', asyncHandler(async (req: Request, res: Response) => {
  const { dataset_name, split, execution_ids, create_if_missing } = req.body as {
    dataset_name: string;
    split: 'train' | 'val';
    execution_ids: number[];
    create_if_missing?: boolean;
  };

  if (!dataset_name || !split || !execution_ids?.length) {
    res.status(400).json({ error: 'dataset_name, split, and execution_ids are required' });
    return;
  }
  if (split !== 'train' && split !== 'val') {
    res.status(400).json({ error: 'split must be train or val' });
    return;
  }

  // Optionally create dataset if missing
  if (create_if_missing) {
    try {
      await createDataset(dataset_name, undefined, req.user?.email ?? 'unknown');
    } catch (err: any) {
      if (err.code !== 'ALREADY_EXISTS') throw err;
    }
  }

  const db = dualDb.getSaiPool();
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
  const db = dualDb.getSaiPool();
  const result = await db.query(
    'SELECT id, status, progress, total, completed_at, error FROM dataset_jobs WHERE id = $1',
    [jobId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json(result.rows[0]);
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
    res.status(400).json({ error: 'Invalid dataset name' });
    return;
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
    res.status(400).json({ error: 'split must be train or val' });
    return;
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
    res.status(400).json({ error: 'Invalid path' });
    return;
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
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  res.setHeader('Content-Type', 'text/plain');
  res.sendFile(resolved, err => {
    if (err) res.status(404).json({ error: 'Label not found' });
  });
});

export default router;
