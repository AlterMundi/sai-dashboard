// backend/src/services/dataset-service.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { Pool } from 'pg';
import { datasetsConfig, cacheConfig } from '@/config';
import { dualDb } from '@/database/dual-pool';
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

  // Check if directory already exists
  try {
    await fs.access(datasetPath);
    throw Object.assign(new Error(`Dataset "${name}" already exists`), { code: 'ALREADY_EXISTS' });
  } catch (err: any) {
    if (err.code === 'ALREADY_EXISTS') throw err;
    // ENOENT means directory doesn't exist — that's what we want
  }

  await fs.mkdir(datasetPath, { recursive: true });

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

// =========================================================================
// Label generation + job processing (Task 5)
// =========================================================================

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

export async function processJob(jobId: string): Promise<void> {
  const db: Pool = dualDb.getSaiPool();

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

// =========================================================================
// List images in a dataset split
// =========================================================================

export interface DatasetImage {
  executionId: number;
  imagePath: string;
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
  const pageFiles = imageFiles.slice(offset, offset + limit);

  if (pageFiles.length === 0) {
    return { items: [], total };
  }

  const executionIds = pageFiles.map(f => parseInt(f.replace(/\.[^.]+$/, ''), 10));

  const db: Pool = dualDb.getSaiPool();
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
