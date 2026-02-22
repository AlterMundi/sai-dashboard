/**
 * Stage 2 ETL Service: Deep Async Processing for YOLO Fire Detection
 *
 * PHILOSOPHY: Extract all available data from execution_data JSON blob.
 * Try multiple extraction paths, return NULL if unavailable.
 *
 * CRITICAL: This service understands n8n's compact reference-based data format
 * where data is stored as an array with string-indexed references that must be
 * recursively resolved to access actual values.
 *
 * Processes:
 * - Uses LISTEN/NOTIFY for immediate response + polling as fallback
 * - Claims batches atomically with SKIP LOCKED (no race conditions)
 * - Fetches and parses execution_data JSON from n8n
 * - Resolves n8n's compact reference format
 * - Extracts YOLO inference results (detections, confidences, alert levels)
 * - Extracts camera metadata (device_id, location, camera_id)
 * - Stores image hash/path references (YOLO handles image storage)
 * - Updates executions, execution_analysis tables in atomic transactions
 * - Cleans up stale workers periodically
 *
 * Image Storage:
 * - YOLO service stores raw images and returns hash/path reference
 * - ETL only stores the reference, never handles image bytes
 * - Enables future IPFS migration (hash-based addressing)
 *
 * Data Integrity:
 * - ALL extracted fields are nullable (honest about missing data)
 * - Never uses fake defaults (NULL = "not available")
 * - Try multiple extraction strategies before giving up
 * - Log extraction failures for improvement
 *
 * See: docs/TWO_STAGE_ETL_ARCHITECTURE.md
 * See: docs/DATA_INTEGRITY_PRINCIPLES.md
 * See: docs/IMAGE_STORAGE_IMPLEMENTATION.md
 */

import { Pool, PoolClient } from 'pg';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { logger } from '@/utils/logger';
import { randomUUID } from 'crypto';
import { dualDb } from '@/database/dual-pool';
import { cacheConfig } from '@/config';

/**
 * YOLO detection object (from detections array)
 */
interface YoloDetection {
  class: string;
  confidence: number;
  bounding_box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Stage 2 extraction result for YOLO-based system
 * ALL fields nullable except execution_id (following data integrity principles)
 */
interface Stage2ExtractionResult {
  // YOLO Inference results
  request_id: string | null;
  yolo_model_version: string | null;
  detection_count: number;
  has_smoke: boolean;
  alert_level: string | null;  // none/low/medium/high/critical
  detection_mode: string | null;
  active_classes: string[] | null;
  detections: YoloDetection[] | null;

  // Confidence scores
  confidence_smoke: number | null;
  confidence_score: number | null;  // Max confidence

  // Image reference (YOLO stores image, returns hash/path)
  image_hash: string | null;   // SHA256 hash (64 chars)
  image_path: string | null;   // Storage path on inference server
  image_width: number | null;
  image_height: number | null;

  // Processing metrics
  yolo_processing_time_ms: number | null;

  // Camera/device metadata (from Metadata node)
  device_id: string | null;
  camera_id: string | null;
  location: string | null;
  camera_type: string | null;
  capture_timestamp: string | null;

  // Telegram notification (if present)
  telegram_sent: boolean;
  telegram_message_id: number | null;
}

/**
 * Stage 2 ETL Service
 * Async deep processing with retry logic, LISTEN/NOTIFY, and SKIP LOCKED
 */
export class Stage2ETLService extends EventEmitter {
  private n8nPool: Pool;
  private saiPool: Pool;
  private listenerClient: PoolClient | null = null;
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private workerId: string;

  // Configuration
  private readonly BATCH_SIZE = parseInt(process.env.ETL_BATCH_SIZE || '10', 10);
  private readonly POLL_INTERVAL_MS = parseInt(process.env.ETL_POLL_INTERVAL_MS || '30000', 10);
  private readonly CLEANUP_INTERVAL_MS = 60000;  // Cleanup stale workers every 60s
  private readonly STALE_THRESHOLD_MINUTES = 5;
  private readonly STATEMENT_TIMEOUT_MS = 30000;  // 30 second query timeout

  // Performance metrics
  private metrics = {
    processed: 0,
    failed: 0,
    imagesExtracted: 0,
    detectionsFound: 0,
    avgProcessingTimeMs: 0,
    lastProcessedAt: null as Date | null,
    notifyEventsReceived: 0,
    staleWorkersRecovered: 0,
    startedAt: new Date()
  };

  constructor() {
    super();
    this.workerId = `stage2-${randomUUID().slice(0, 8)}`;

    // Use shared pools from dual-pool singleton
    this.n8nPool = dualDb.getN8nPool();
    this.saiPool = dualDb.getSaiPool();
  }

  /**
   * Start Stage 2 ETL service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Stage 2 ETL Service already running');
      return;
    }

    logger.info('🚀 Starting Stage 2 ETL Service (YOLO Deep Processing)...');

    try {
      // Test database connections
      await this.testConnections();

      // Setup LISTEN for immediate notification
      await this.setupNotifyListener();

      // Start polling loop (fallback for missed notifications)
      this.startProcessingLoop();

      // Start stale worker cleanup loop
      this.startCleanupLoop();

      this.isRunning = true;
      logger.info('✅ Stage 2 ETL Service started successfully', {
        service: 'stage2-etl',
        workerId: this.workerId,
        batchSize: this.BATCH_SIZE,
        pollInterval: this.POLL_INTERVAL_MS,
        cleanupInterval: this.CLEANUP_INTERVAL_MS,
        mode: 'YOLO Fire Detection (hash-based image refs)'
      });

      this.emit('started');
    } catch (error) {
      logger.error('❌ Failed to start Stage 2 ETL Service:', error);
      throw error;
    }
  }

  /**
   * Stop Stage 2 ETL service gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('🛑 Stopping Stage 2 ETL Service...');
    this.isRunning = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Release listener client
    if (this.listenerClient) {
      try {
        await this.listenerClient.query('UNLISTEN stage2_queue');
        this.listenerClient.release();
        this.listenerClient = null;
      } catch (error) {
        logger.warn('Error releasing listener client:', error);
      }
    }

    // Note: pools are shared via dualDb, do not end them here

    logger.info('✅ Stage 2 ETL Service stopped', {
      totalProcessed: this.metrics.processed,
      totalFailed: this.metrics.failed,
      imagesExtracted: this.metrics.imagesExtracted,
      detectionsFound: this.metrics.detectionsFound,
      notifyEventsReceived: this.metrics.notifyEventsReceived,
      staleWorkersRecovered: this.metrics.staleWorkersRecovered,
      avgTimeMs: this.metrics.avgProcessingTimeMs
    });

    this.emit('stopped');
  }

  /**
   * Test database connections
   */
  private async testConnections(): Promise<void> {
    // Test n8n database
    const n8nClient = await this.n8nPool.connect();
    try {
      await n8nClient.query('SELECT 1 FROM execution_data LIMIT 1');
      logger.info('✅ N8N Database connected (execution_data accessible)');
    } finally {
      n8nClient.release();
    }

    // Test sai_dashboard database
    const saiClient = await this.saiPool.connect();
    try {
      const result = await saiClient.query('SELECT * FROM etl_queue_health');
      logger.info('✅ SAI Dashboard Database connected', {
        queueHealth: result.rows[0]
      });
    } finally {
      saiClient.release();
    }
  }

  /**
   * Setup LISTEN for pg_notify events
   * Allows immediate processing when new items are queued
   */
  private async setupNotifyListener(): Promise<void> {
    this.listenerClient = await this.saiPool.connect();

    // Setup notification handler
    this.listenerClient.on('notification', async (msg) => {
      if (msg.channel === 'stage2_queue' && this.isRunning) {
        this.metrics.notifyEventsReceived++;
        logger.debug(`📬 Received stage2_queue notification for execution ${msg.payload}`);

        // Process immediately (don't wait for polling interval)
        setImmediate(() => this.processBatch());
      }
    });

    // Subscribe to channel
    await this.listenerClient.query('LISTEN stage2_queue');
    logger.info('📡 LISTEN configured for stage2_queue channel');
  }

  /**
   * Start processing loop (polling fallback)
   */
  private startProcessingLoop(): void {
    this.processingInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.processBatch();
      }
    }, this.POLL_INTERVAL_MS);

    // Also process immediately on start
    this.processBatch();
  }

  /**
   * Start cleanup loop for stale workers
   */
  private startCleanupLoop(): void {
    this.cleanupInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.cleanupStaleWorkers();
      }
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Cleanup stale workers that got stuck
   */
  private async cleanupStaleWorkers(): Promise<void> {
    try {
      const result = await this.saiPool.query(
        "SELECT etl_cleanup_stale_workers($1::interval) as recovered",
        [`${this.STALE_THRESHOLD_MINUTES} minutes`]
      );

      const recovered = result.rows[0]?.recovered || 0;
      if (recovered > 0) {
        this.metrics.staleWorkersRecovered += recovered;
        logger.warn(`🔧 Recovered ${recovered} stale queue items`, {
          threshold: `${this.STALE_THRESHOLD_MINUTES} minutes`
        });
      }
    } catch (error) {
      logger.error('❌ Error cleaning up stale workers:', error);
    }
  }

  /**
   * Process next batch from queue using atomic SKIP LOCKED claim
   */
  private async processBatch(): Promise<void> {
    try {
      // Atomically claim a batch (SKIP LOCKED prevents race conditions)
      const claimed = await this.claimBatch();

      if (claimed.length === 0) {
        logger.debug('Stage 2: No pending items in queue');
        return;
      }

      logger.info(`📦 Stage 2: Processing batch of ${claimed.length} executions`);

      // Batch fetch all execution_data in one query
      const executionDataMap = await this.batchFetchExecutionData(claimed);

      // Process each item
      for (const executionId of claimed) {
        await this.processStage2(executionId, executionDataMap.get(executionId));
      }

    } catch (error) {
      logger.error('❌ Stage 2: Batch processing error:', error);
    }
  }

  /**
   * Atomically claim a batch of items using SKIP LOCKED
   * This prevents race conditions between multiple workers
   */
  private async claimBatch(): Promise<number[]> {
    const result = await this.saiPool.query(
      'SELECT execution_id FROM etl_claim_batch($1, $2)',
      [this.workerId, this.BATCH_SIZE]
    );

    return result.rows.map(row => Number(row.execution_id));
  }

  /**
   * Batch fetch execution_data for multiple executions
   * Much more efficient than N individual queries
   */
  private async batchFetchExecutionData(executionIds: number[]): Promise<Map<number, any[]>> {
    const result = await this.n8nPool.query(`
      SELECT "executionId", data
      FROM execution_data
      WHERE "executionId" = ANY($1::bigint[])
    `, [executionIds]);

    const dataMap = new Map<number, any[]>();
    for (const row of result.rows) {
      try {
        dataMap.set(row.executionId, JSON.parse(row.data));
      } catch (error) {
        logger.warn(`Failed to parse execution_data for ${row.executionId}:`, error);
      }
    }

    return dataMap;
  }

  /**
   * Process Stage 2 for a single execution
   */
  private async processStage2(executionId: number, executionDataRaw?: any[]): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info(`🔍 Stage 2: Processing execution ${executionId} (YOLO extraction)`);

      // Check if we have execution data
      if (!executionDataRaw) {
        throw new Error('execution_data not found in n8n database');
      }

      // 1. Extract all available information with n8n format resolution
      const extracted = this.extractFromExecutionData(executionDataRaw);

      // 2. Extract and save original camera image from Webhook node
      const imageResult = await this.extractAndSaveOriginalImage(executionId, executionDataRaw);

      // 3. Perform all database updates in a single transaction
      await this.performAtomicUpdates(executionId, extracted, imageResult);

      // 4. Track metrics
      if (extracted.detections && extracted.detections.length > 0) {
        this.metrics.detectionsFound += extracted.detections.length;
      }
      if (imageResult) {
        this.metrics.imagesExtracted++;
      }

      // 5. Mark as completed
      const processingTime = Date.now() - startTime;
      await this.markCompleted(executionId, processingTime);

      this.metrics.processed++;
      this.metrics.lastProcessedAt = new Date();
      this.updateAvgProcessingTime(processingTime);

      logger.info(`✅ Stage 2: Completed execution ${executionId}`, {
        executionId,
        processingTimeMs: processingTime,
        hasOriginalImage: !!imageResult,
        hasImageRef: !!extracted.image_hash,
        hasSmoke: extracted.has_smoke,
        detectionCount: extracted.detection_count,
        alertLevel: extracted.alert_level
      });

      this.emit('execution_processed', {
        execution_id: executionId,
        stage: 'stage2',
        processing_time_ms: processingTime,
        extracted
      });

      // Notify SSE clients that Stage 2 is complete for this execution
      try {
        const { notifyStage2Complete } = await import('@/controllers/sse');
        await notifyStage2Complete(
          executionId,
          {
            has_smoke: extracted.has_smoke,
            alert_level: extracted.alert_level,
            detection_count: extracted.detection_count,
          },
          !!imageResult,
          processingTime
        );
      } catch (sseError) {
        // SSE notify failure must never crash the ETL pipeline
        logger.warn('Failed to send Stage 2 SSE notification', { executionId, sseError });
      }

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error(`❌ Stage 2: Failed to process execution ${executionId}:`, error);

      await this.markFailed(
        executionId,
        error instanceof Error ? error.message : 'Unknown error'
      );

      this.metrics.failed++;

      // Notify SSE clients of Stage 2 failure
      try {
        const { notifyStage2Failed } = await import('@/controllers/sse');
        await notifyStage2Failed(
          executionId,
          error instanceof Error ? error.message : 'Unknown error',
          0  // retry_count: 0 for the current attempt
        );
      } catch (sseError) {
        logger.warn('Failed to send Stage 2 failure SSE notification', { executionId, sseError });
      }
    }
  }

  /**
   * Perform all database updates atomically in a single transaction
   * This ensures data consistency - either all updates succeed or none
   */
  private async performAtomicUpdates(
    executionId: number,
    extracted: Stage2ExtractionResult,
    imageResult: {
      originalPath: string;
      thumbnailPath: string;
      cachedPath: string;
      sizeBytes: number;
      width: number;
      height: number;
    } | null
  ): Promise<void> {
    const client = await this.saiPool.connect();

    try {
      await client.query('BEGIN');

      // 1. Update executions table (device/location/camera metadata)
      if (extracted.device_id || extracted.camera_id || extracted.location) {
        await this.updateExecution(client, executionId, extracted);
      }

      // 2. Insert/update execution_analysis (includes detections JSONB)
      await this.upsertAnalysis(client, executionId, extracted);

      // 3. Insert notification status
      await this.insertNotification(client, executionId, extracted);

      // 4. Insert image paths (only when we have real local files)
      // YOLO image_hash/image_path are remote references stored in execution_analysis,
      // not local files — don't insert them into execution_images.
      if (imageResult) {
        await client.query(`
          INSERT INTO execution_images (
            execution_id, original_path, thumbnail_path, cached_path,
            size_bytes, width, height, format, extracted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'jpeg', NOW())
          ON CONFLICT (execution_id) DO UPDATE SET
            original_path = EXCLUDED.original_path,
            thumbnail_path = EXCLUDED.thumbnail_path,
            cached_path = EXCLUDED.cached_path,
            size_bytes = EXCLUDED.size_bytes,
            width = EXCLUDED.width,
            height = EXCLUDED.height
        `, [
          executionId,
          imageResult.originalPath,
          imageResult.thumbnailPath,
          imageResult.cachedPath,
          imageResult.sizeBytes,
          imageResult.width,
          imageResult.height
        ]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * ========================================================================
   * N8N DATA RESOLUTION: Handle compact reference-based format
   * ========================================================================
   *
   * n8n stores data as an array where string values like "69" are references
   * to indices in the same array. We must recursively resolve these.
   */

  /**
   * Recursively resolve n8n references
   * Converts string-indexed references to actual values
   */
  private deepResolve(obj: any, data: any[], depth = 0, maxDepth = 10): any {
    if (depth > maxDepth) {
      return obj; // Prevent infinite recursion
    }

    // Resolve string references to array indices
    if (typeof obj === 'string' && obj.match(/^\d+$/) && parseInt(obj) < data.length) {
      return this.deepResolve(data[parseInt(obj)], data, depth + 1, maxDepth);
    }

    // Recursively resolve objects
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const resolved: any = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.deepResolve(value, data, depth + 1, maxDepth);
      }
      return resolved;
    }

    // Recursively resolve arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepResolve(item, data, depth + 1, maxDepth));
    }

    return obj;
  }

  /**
   * Find runData (node name to reference mapping)
   */
  private findRunData(data: any[]): any | null {
    return data.find(item =>
      item &&
      typeof item === 'object' &&
      ('YOLO Inference' in item || 'Webhook' in item || 'Metadata' in item)
    );
  }

  /**
   * Extract node output by node name
   */
  private extractNodeOutput(data: any[], nodeName: string): any | null {
    const runData = this.findRunData(data);

    if (!runData || !(nodeName in runData)) {
      return null;
    }

    const nodeRef = runData[nodeName];
    const nodeOutputArray = this.deepResolve(nodeRef, data);

    if (!Array.isArray(nodeOutputArray) || nodeOutputArray.length === 0) {
      return null;
    }

    // Get first execution (nodeOutputArray[0] is execution metadata)
    const execution = nodeOutputArray[0];

    // Navigate to output items: execution.data.main[0] is the output array
    const outputItems = execution?.data?.main?.[0];
    if (!Array.isArray(outputItems) || outputItems.length === 0) {
      return null;
    }

    // Get first output item (contains {json: "75", pairedItem: "76"})
    const firstOutputItem = outputItems[0];

    if (!firstOutputItem || !firstOutputItem.json) {
      return null;
    }

    // Resolve the json reference (e.g., "75" -> data[75])
    return this.deepResolve(firstOutputItem.json, data);
  }

  /**
   * Extract binary field from a node's output (e.g. Webhook binary.image)
   * Returns the resolved binary object with {mimeType, data, id, fileName, ...}
   */
  private extractNodeBinary(data: any[], nodeName: string, binaryKey: string): any | null {
    const runData = this.findRunData(data);
    if (!runData || !(nodeName in runData)) return null;

    const nodeOutputArray = this.deepResolve(runData[nodeName], data);
    if (!Array.isArray(nodeOutputArray) || nodeOutputArray.length === 0) return null;

    const execution = nodeOutputArray[0];
    const outputItems = execution?.data?.main?.[0];
    if (!Array.isArray(outputItems) || outputItems.length === 0) return null;

    const firstOutputItem = outputItems[0];
    if (!firstOutputItem?.binary) return null;

    const binaryObj = this.deepResolve(firstOutputItem.binary, data);
    if (!binaryObj || !(binaryKey in binaryObj)) return null;

    return this.deepResolve(binaryObj[binaryKey], data);
  }

  /**
   * ========================================================================
   * EXTRACTION LOGIC: Extract YOLO and metadata from n8n data
   * ========================================================================
   */

  /**
   * Extract all available data from execution_data array
   * Implements multiple extraction strategies
   * Returns NULL for unavailable fields (honest approach)
   */
  private extractFromExecutionData(data: any[]): Stage2ExtractionResult {
    // Extract YOLO Inference node output
    const yoloData = this.extractNodeOutput(data, 'YOLO Inference');

    // Extract Metadata node output
    const metadataData = this.extractNodeOutput(data, 'Metadata');

    // Extract metadata object from Metadata node
    const metadata = metadataData?.metadata || null;

    // Parse detections array
    const detections: YoloDetection[] | null = yoloData?.detections
      ? this.parseDetections(yoloData.detections)
      : null;

    // Calculate max confidence from all detections
    const maxConfidence = detections && detections.length > 0
      ? Math.max(...detections.map(d => d.confidence))
      : null;

    return {
      // YOLO inference results
      request_id: yoloData?.request_id || null,
      yolo_model_version: yoloData?.version || null,
      detection_count: yoloData?.detection_count ?? 0,
      has_smoke: yoloData?.has_smoke ?? false,
      alert_level: yoloData?.alert_level || null,
      detection_mode: yoloData?.detection_mode || null,
      active_classes: yoloData?.active_classes || null,
      detections: detections,

      // Confidence scores
      confidence_smoke: yoloData?.confidence_scores?.smoke ?? null,
      confidence_score: maxConfidence,

      // Image reference (YOLO stores image, returns hash/path)
      ...this.extractImageRef(yoloData),
      image_width: yoloData?.image_size?.width ?? null,
      image_height: yoloData?.image_size?.height ?? null,

      // Processing metrics
      yolo_processing_time_ms: yoloData?.processing_time_ms ?? null,

      // Camera/device metadata
      device_id: metadata?.device_id || yoloData?.camera_id?.split(':')[0] || null,
      camera_id: metadata?.camera_id || yoloData?.camera_id || null,
      location: metadata?.location || null,
      camera_type: metadata?.camera_type || null,
      capture_timestamp: metadata?.timestamp || null,

      // Telegram (if exists in workflow)
      telegram_sent: false,  // TODO: Extract from Telegram node if present
      telegram_message_id: null
    };
  }

  /**
   * Extract image reference from YOLO output
   *
   * YOLO stores images and returns hash/path reference.
   * ETL only stores the reference, never handles image bytes.
   */
  private extractImageRef(yoloData: any): {
    image_hash: string | null;
    image_path: string | null;
  } {
    const imageHash = yoloData?.image_hash;
    const imagePath = yoloData?.image_path;

    if (imageHash && typeof imageHash === 'string' && imageHash.length === 64) {
      logger.debug(`Image reference: hash=${imageHash.substring(0, 16)}...`);
      return {
        image_hash: imageHash,
        image_path: imagePath || null
      };
    }

    return {
      image_hash: null,
      image_path: null
    };
  }

  /**
   * Extract original camera image from Webhook node and save to disk
   *
   * The Webhook node stores the full-resolution camera frame in n8n's
   * filesystem-v2 binary storage. We read it directly from disk.
   * This is higher resolution (1920x1080) than the YOLO-processed
   * image (which is resized to 768x432).
   *
   * Saves three variants:
   * - original/{partition}/{executionId}.jpg  (full-res JPEG)
   * - webp/{partition}/{executionId}.webp     (high-quality WebP 80%)
   * - thumb/{partition}/{executionId}.webp    (thumbnail 200px WebP 70%)
   */
  private async extractAndSaveOriginalImage(
    executionId: number,
    data: any[]
  ): Promise<{
    originalPath: string;
    thumbnailPath: string;
    cachedPath: string;
    sizeBytes: number;
    width: number;
    height: number;
  } | null> {
    try {
      // 1. Extract Webhook node binary image reference
      const binaryImage = this.extractNodeBinary(data, 'Webhook', 'image');
      if (!binaryImage || !binaryImage.id) {
        logger.debug(`Stage 2: No Webhook binary image for execution ${executionId}`);
        return null;
      }

      // 2. Resolve filesystem-v2 path from binary id
      // id format: "filesystem-v2:workflows/xxx/executions/temp/binary_data/{uuid}"
      const binaryId: string = binaryImage.id;
      const fsPrefix = 'filesystem-v2:';
      if (!binaryId.startsWith(fsPrefix)) {
        logger.debug(`Stage 2: Unsupported binary storage type for execution ${executionId}: ${binaryId.substring(0, 30)}`);
        return null;
      }

      const relativePath = binaryId.slice(fsPrefix.length);
      const n8nFilePath = path.join(cacheConfig.n8nBinaryDataPath, relativePath);

      // 3. Read image from n8n binary storage
      let imageBuffer: Buffer;
      try {
        imageBuffer = await fs.readFile(n8nFilePath);
      } catch (err) {
        logger.warn(`Stage 2: Cannot read n8n binary file for execution ${executionId}: ${n8nFilePath}`);
        return null;
      }

      // 4. Get image metadata with Sharp
      const metadata = await sharp(imageBuffer).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;

      // 5. Build paths using partition scheme
      const partition = Math.floor(executionId / 1000);
      const originalRelative = `original/${partition}/${executionId}.jpg`;
      const webpRelative = `webp/${partition}/${executionId}.webp`;
      const thumbRelative = `thumb/${partition}/${executionId}.webp`;

      const basePath = cacheConfig.basePath;
      const originalAbsolute = path.join(basePath, originalRelative);
      const webpAbsolute = path.join(basePath, webpRelative);
      const thumbAbsolute = path.join(basePath, thumbRelative);

      // 6. Create directories
      await fs.mkdir(path.dirname(originalAbsolute), { recursive: true });
      await fs.mkdir(path.dirname(webpAbsolute), { recursive: true });
      await fs.mkdir(path.dirname(thumbAbsolute), { recursive: true });

      // 7. Save original JPEG
      await fs.writeFile(originalAbsolute, imageBuffer);

      // 8. Generate high-quality WebP variant
      await sharp(imageBuffer)
        .webp({ quality: 80 })
        .toFile(webpAbsolute);

      // 9. Generate thumbnail WebP
      await sharp(imageBuffer)
        .resize({ width: cacheConfig.thumbnailSize, withoutEnlargement: true })
        .webp({ quality: cacheConfig.thumbnailQuality })
        .toFile(thumbAbsolute);

      logger.info(`📸 Stage 2: Saved original camera image for execution ${executionId}`, {
        executionId,
        source: n8nFilePath,
        dimensions: `${width}x${height}`,
        sizeBytes: imageBuffer.length,
        paths: { original: originalRelative, webp: webpRelative, thumb: thumbRelative }
      });

      return {
        originalPath: originalRelative,
        thumbnailPath: thumbRelative,
        cachedPath: webpRelative,
        sizeBytes: imageBuffer.length,
        width,
        height
      };

    } catch (error) {
      logger.warn(`Stage 2: Failed to extract/save original image for execution ${executionId}:`, error);
      return null;
    }
  }

  /**
   * Parse detections array into structured format
   */
  private parseDetections(detectionsRaw: any[]): YoloDetection[] | null {
    try {
      if (!Array.isArray(detectionsRaw) || detectionsRaw.length === 0) {
        return null;
      }

      return detectionsRaw.map((det: any) => {
        // YOLO service returns xyxy format: {x1, y1, x2, y2}
        // Convert to xywh for storage/rendering
        const bbox = det.bbox ?? {};
        let x: number, y: number, width: number, height: number;
        if (bbox.x1 !== undefined) {
          x = bbox.x1;
          y = bbox.y1;
          width = bbox.x2 - bbox.x1;
          height = bbox.y2 - bbox.y1;
        } else {
          // Fallback: legacy xywh format
          x = bbox.x ?? det.x ?? 0;
          y = bbox.y ?? det.y ?? 0;
          width = bbox.width ?? det.w ?? 0;
          height = bbox.height ?? det.h ?? 0;
        }
        return {
          class: det.class_name || det.class || 'unknown',
          confidence: parseFloat(det.confidence) || 0,
          bounding_box: { x, y, width, height }
        };
      });
    } catch (error) {
      logger.debug('Failed to parse detections:', error);
      return null;
    }
  }

  /**
   * ========================================================================
   * DATABASE UPDATE OPERATIONS (use client for transactions)
   * ========================================================================
   */

  /**
   * Update executions table with device/location metadata
   */
  private async updateExecution(
    client: PoolClient,
    executionId: number,
    extracted: Stage2ExtractionResult
  ): Promise<void> {
    // Parse capture_timestamp if it's in non-standard format
    let parsedTimestamp = extracted.capture_timestamp;
    if (parsedTimestamp) {
      try {
        // Convert "2025-10-10_04-33-52" format to ISO8601
        parsedTimestamp = parsedTimestamp.replace(/_/g, 'T').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
      } catch (error) {
        logger.debug('Failed to parse capture_timestamp, setting to null', { timestamp: extracted.capture_timestamp });
        parsedTimestamp = null;
      }
    }

    await client.query(`
      UPDATE executions
      SET
        device_id = COALESCE($2, device_id),
        camera_id = COALESCE($3, camera_id),
        node_id = COALESCE($2, node_id),
        location = COALESCE($4, location),
        camera_type = COALESCE($5, camera_type),
        capture_timestamp = COALESCE($6::timestamptz, capture_timestamp),
        updated_at = NOW()
      WHERE id = $1
    `, [
      executionId,
      extracted.device_id,
      extracted.camera_id,
      extracted.location,
      extracted.camera_type,
      parsedTimestamp
    ]);
  }

  /**
   * Insert/update execution_analysis with YOLO data
   * ALL fields nullable (data integrity principle)
   */
  private async upsertAnalysis(
    client: PoolClient,
    executionId: number,
    extracted: Stage2ExtractionResult
  ): Promise<void> {
    await client.query(`
      INSERT INTO execution_analysis (
        execution_id,
        request_id,
        yolo_model_version,
        detection_count,
        has_smoke,
        alert_level,
        detection_mode,
        active_classes,
        detections,
        confidence_smoke,
        confidence_score,
        image_width,
        image_height,
        yolo_processing_time_ms
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14
      )
      ON CONFLICT (execution_id) DO UPDATE SET
        request_id = EXCLUDED.request_id,
        yolo_model_version = EXCLUDED.yolo_model_version,
        detection_count = EXCLUDED.detection_count,
        has_smoke = EXCLUDED.has_smoke,
        alert_level = EXCLUDED.alert_level,
        detection_mode = EXCLUDED.detection_mode,
        active_classes = EXCLUDED.active_classes,
        detections = EXCLUDED.detections,
        confidence_smoke = EXCLUDED.confidence_smoke,
        confidence_score = EXCLUDED.confidence_score,
        image_width = EXCLUDED.image_width,
        image_height = EXCLUDED.image_height,
        yolo_processing_time_ms = EXCLUDED.yolo_processing_time_ms,
        updated_at = NOW()
    `, [
      executionId,
      extracted.request_id,
      extracted.yolo_model_version,
      extracted.detection_count,
      extracted.has_smoke,
      extracted.alert_level,
      extracted.detection_mode,
      extracted.active_classes,
      extracted.detections ? JSON.stringify(extracted.detections) : null,
      extracted.confidence_smoke,
      extracted.confidence_score,
      extracted.image_width,
      extracted.image_height,
      extracted.yolo_processing_time_ms
    ]);
  }

  /**
   * Insert notification status
   */
  private async insertNotification(
    client: PoolClient,
    executionId: number,
    extracted: Stage2ExtractionResult
  ): Promise<void> {
    await client.query(`
      INSERT INTO execution_notifications (
        execution_id, telegram_sent, telegram_message_id, telegram_sent_at
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (execution_id) DO NOTHING
    `, [
      executionId,
      extracted.telegram_sent,
      extracted.telegram_message_id,
      extracted.telegram_sent ? new Date() : null
    ]);
  }

  /**
   * ========================================================================
   * QUEUE MANAGEMENT
   * ========================================================================
   */

  private async markCompleted(executionId: number, processingTimeMs: number): Promise<void> {
    await this.saiPool.query('SELECT etl_mark_completed($1, $2)', [
      executionId,
      processingTimeMs
    ]);
  }

  private async markFailed(executionId: number, errorMessage: string): Promise<void> {
    await this.saiPool.query('SELECT etl_mark_failed($1, $2)', [
      executionId,
      errorMessage
    ]);
  }

  private updateAvgProcessingTime(processingTime: number): void {
    const total = this.metrics.processed + this.metrics.failed;
    this.metrics.avgProcessingTimeMs =
      (this.metrics.avgProcessingTimeMs * (total - 1) + processingTime) / total;
  }

  /**
   * Get current service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      uptime_seconds: Math.floor((Date.now() - this.metrics.startedAt.getTime()) / 1000),
      is_running: this.isRunning,
      worker_id: this.workerId
    };
  }
}

// Export singleton instance
export const stage2ETLService = new Stage2ETLService();
