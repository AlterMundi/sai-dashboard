#!/usr/bin/env tsx
/**
 * Batch Thumbnail Regeneration Script
 *
 * Re-generates all thumbnails at 400px wide / 80% WebP quality.
 * Run after updating Sharp config defaults (PROJ-7).
 *
 * Usage:
 *   npx tsx backend/scripts/regenerate-thumbnails.ts [--dry-run] [--concurrency=N]
 *
 * Flags:
 *   --dry-run          Log what would be done without writing any files
 *   --concurrency=N    Number of parallel Sharp workers (default: 4)
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { Pool } from 'pg';
import { saiDatabaseConfig } from '../src/config';
import { logger } from '../src/utils/logger';

// Constants
const THUMB_WIDTH = 400;
const THUMB_QUALITY = 80;
const DEFAULT_CONCURRENCY = 4;
const LOG_INTERVAL = 500;
const ERROR_RATE_THRESHOLD = 0.10;

const IMAGE_BASE_PATH = process.env.IMAGE_BASE_PATH || '/mnt/raid1/n8n-backup/images';

// Parse CLI flags
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const concurrencyArg = args.find(a => a.startsWith('--concurrency'));
let concurrency = DEFAULT_CONCURRENCY;
if (concurrencyArg) {
  const val = concurrencyArg.includes('=')
    ? concurrencyArg.split('=')[1]
    : args[args.indexOf(concurrencyArg) + 1];
  const parsed = parseInt(val, 10);
  concurrency = Math.max(1, isNaN(parsed) ? DEFAULT_CONCURRENCY : parsed);
}

interface ImageRow {
  execution_id: string;
  original_path: string;
  thumbnail_path: string;
}

async function processRow(row: ImageRow, isDryRun: boolean): Promise<void> {
  const originalAbsolute = path.isAbsolute(row.original_path)
    ? row.original_path
    : path.join(IMAGE_BASE_PATH, row.original_path);

  const thumbAbsolute = path.join(IMAGE_BASE_PATH, row.thumbnail_path);

  if (isDryRun) {
    logger.debug(`[dry-run] would regenerate ${row.execution_id}: ${thumbAbsolute}`);
    return;
  }

  await fs.mkdir(path.dirname(thumbAbsolute), { recursive: true });

  await sharp(originalAbsolute)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toFile(thumbAbsolute);
}

async function runWorkerPool(rows: ImageRow[], poolSize: number, isDryRun: boolean): Promise<number> {
  let index = 0;
  let processed = 0;
  let errors = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = index++;
      if (i >= rows.length) break;

      const row = rows[i];
      try {
        await processRow(row, isDryRun);
      } catch (err) {
        errors++;
        logger.error(`Error processing execution_id=${row.execution_id}: ${(err as Error).message}`);
      }

      processed++;
      if (processed % LOG_INTERVAL === 0) {
        logger.info(`Progress: ${processed}/${rows.length} processed, ${errors} errors`);
      }
    }
  }

  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);

  return errors;
}

async function main(): Promise<void> {
  logger.info(`Starting thumbnail regeneration (dry-run=${dryRun}, concurrency=${concurrency})`);
  logger.info(`IMAGE_BASE_PATH=${IMAGE_BASE_PATH}, target: ${THUMB_WIDTH}px wide, ${THUMB_QUALITY}% WebP`);

  const pool = new Pool(saiDatabaseConfig);

  try {
    const result = await pool.query<ImageRow>(
      `SELECT execution_id::text, original_path, thumbnail_path
       FROM execution_images
       WHERE thumbnail_path IS NOT NULL
         AND original_path IS NOT NULL`
    );

    const rows = result.rows;
    const total = rows.length;

    if (total === 0) {
      logger.info('No images to regenerate. Exiting.');
      return;
    }

    logger.info(`Found ${total} thumbnails to regenerate`);

    const errors = await runWorkerPool(rows, concurrency, dryRun);

    logger.info(`Done: ${total} total, ${total - errors} succeeded, ${errors} failed`);

    if (errors > total * ERROR_RATE_THRESHOLD) {
      logger.error(`Error rate ${((errors / total) * 100).toFixed(1)}% exceeds 10% threshold — exiting with code 1`);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
