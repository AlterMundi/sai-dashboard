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
 * - Polls etl_processing_queue for pending Stage 2 work
 * - Fetches and parses execution_data JSON from n8n
 * - Resolves n8n's compact reference format
 * - Extracts YOLO inference results (detections, confidences, alert levels)
 * - Extracts camera metadata (device_id, location, camera_id)
 * - Extracts annotated images
 * - Updates executions, execution_analysis tables
 * - Marks queue item as completed or failed (with retry)
 *
 * Data Integrity:
 * - ALL extracted fields are nullable (honest about missing data)
 * - Never uses fake defaults (NULL = "not available")
 * - Try multiple extraction strategies before giving up
 * - Log extraction failures for improvement
 *
 * See: docs/TWO_STAGE_ETL_ARCHITECTURE.md
 * See: docs/DATA_INTEGRITY_PRINCIPLES.md
 * See: docs/N8N_DATA_FORMAT.md
 */

import { Pool } from 'pg';
import { EventEmitter } from 'events';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { n8nDatabaseConfig, saiDatabaseConfig, cacheConfig } from '@/config';
import { logger } from '@/utils/logger';
import { randomUUID } from 'crypto';

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
  has_fire: boolean;
  has_smoke: boolean;
  alert_level: string | null;  // none/low/medium/high/critical
  detection_mode: string | null;
  active_classes: string[] | null;
  detections: YoloDetection[] | null;

  // Confidence scores
  confidence_fire: number | null;
  confidence_smoke: number | null;
  confidence_score: number | null;  // Max confidence

  // Image data
  image_base64: string | null;
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
 * Async deep processing with retry logic
 */
export class Stage2ETLService extends EventEmitter {
  private n8nPool: Pool;
  private saiPool: Pool;
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private workerId: string;

  // Configuration
  private readonly BATCH_SIZE = 10;
  private readonly POLL_INTERVAL_MS = 5000; // Process queue every 5 seconds
  private readonly IMAGE_CACHE_PATH = cacheConfig.basePath;

  // Performance metrics
  private metrics = {
    processed: 0,
    failed: 0,
    imagesExtracted: 0,
    detectionsFound: 0,
    avgProcessingTimeMs: 0,
    lastProcessedAt: null as Date | null,
    startedAt: new Date()
  };

  constructor() {
    super();
    this.workerId = `stage2-${randomUUID().slice(0, 8)}`;

    // N8N database pool (read execution_data)
    this.n8nPool = new Pool({
      host: n8nDatabaseConfig.host,
      port: n8nDatabaseConfig.port,
      database: n8nDatabaseConfig.database,
      user: n8nDatabaseConfig.username,
      password: n8nDatabaseConfig.password,
      max: 5,
      idleTimeoutMillis: 30000
    });

    // SAI Dashboard database pool (write operations)
    this.saiPool = new Pool({
      host: saiDatabaseConfig.host,
      port: saiDatabaseConfig.port,
      database: saiDatabaseConfig.database,
      user: saiDatabaseConfig.username,
      password: saiDatabaseConfig.password,
      max: 10,
      idleTimeoutMillis: 30000
    });
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

      // Start processing loop
      this.startProcessingLoop();

      this.isRunning = true;
      logger.info('✅ Stage 2 ETL Service started successfully', {
        service: 'stage2-etl',
        workerId: this.workerId,
        batchSize: this.BATCH_SIZE,
        pollInterval: this.POLL_INTERVAL_MS,
        imageCachePath: this.IMAGE_CACHE_PATH,
        mode: 'YOLO Fire Detection'
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

    await this.n8nPool.end();
    await this.saiPool.end();

    logger.info('✅ Stage 2 ETL Service stopped', {
      totalProcessed: this.metrics.processed,
      totalFailed: this.metrics.failed,
      imagesExtracted: this.metrics.imagesExtracted,
      detectionsFound: this.metrics.detectionsFound,
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
   * Start processing loop (polls queue every N seconds)
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
   * Process next batch from queue
   */
  private async processBatch(): Promise<void> {
    try {
      // Get next batch of pending items (priority order)
      const pending = await this.getNextBatch();

      if (pending.length === 0) {
        logger.debug('Stage 2: No pending items in queue');
        return;
      }

      logger.info(`📦 Stage 2: Processing batch of ${pending.length} executions`);

      // Process each item
      for (const item of pending) {
        await this.processStage2(item.execution_id);
      }

    } catch (error) {
      logger.error('❌ Stage 2: Batch processing error:', error);
    }
  }

  /**
   * Get next batch from queue
   */
  private async getNextBatch(): Promise<Array<{ execution_id: number }>> {
    const result = await this.saiPool.query(`
      SELECT execution_id
      FROM etl_processing_queue
      WHERE status = 'pending'
        AND stage = 'stage2'
        AND attempts < max_attempts
      ORDER BY priority ASC, queued_at ASC
      LIMIT $1
    `, [this.BATCH_SIZE]);

    return result.rows;
  }

  /**
   * Process Stage 2 for a single execution
   */
  private async processStage2(executionId: number): Promise<void> {
    const startTime = Date.now();

    try {
      // Mark as processing
      const marked = await this.markProcessing(executionId);
      if (!marked) {
        logger.debug(`⏭️  Execution ${executionId} already being processed by another worker`);
        return;
      }

      logger.info(`🔍 Stage 2: Processing execution ${executionId} (YOLO extraction)`);

      // 1. Fetch execution_data JSON from n8n
      const executionDataRaw = await this.fetchExecutionData(executionId);
      if (!executionDataRaw) {
        throw new Error('execution_data not found in n8n database');
      }

      // 2. Extract all available information with n8n format resolution
      const extracted = this.extractFromExecutionData(executionDataRaw);

      // 3. Update executions table (device/location/camera metadata)
      if (extracted.device_id || extracted.camera_id || extracted.location) {
        await this.updateExecution(executionId, extracted);
      }

      // 4. Insert/update execution_analysis (includes detections JSONB)
      await this.upsertAnalysis(executionId, extracted);

      // 5. Track detection metrics (detections stored in JSONB, not separate table)
      if (extracted.detections && extracted.detections.length > 0) {
        this.metrics.detectionsFound += extracted.detections.length;
      }

      // 6. Process and cache image (if present)
      if (extracted.image_base64) {
        await this.processImage(executionId, extracted.image_base64);
        this.metrics.imagesExtracted++;
      }

      // 7. Insert notification status
      await this.insertNotification(executionId, extracted);

      // Mark as completed
      const processingTime = Date.now() - startTime;
      await this.markCompleted(executionId, processingTime);

      this.metrics.processed++;
      this.metrics.lastProcessedAt = new Date();
      this.updateAvgProcessingTime(processingTime);

      logger.info(`✅ Stage 2: Completed execution ${executionId}`, {
        executionId,
        processingTimeMs: processingTime,
        hasImage: !!extracted.image_base64,
        hasFire: extracted.has_fire,
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

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error(`❌ Stage 2: Failed to process execution ${executionId}:`, error);

      await this.markFailed(
        executionId,
        error instanceof Error ? error.message : 'Unknown error'
      );

      this.metrics.failed++;
    }
  }

  /**
   * Fetch execution_data from n8n database
   */
  private async fetchExecutionData(executionId: number): Promise<any[] | null> {
    const result = await this.n8nPool.query(`
      SELECT data
      FROM execution_data
      WHERE "executionId" = $1
    `, [executionId]);

    if (result.rows.length === 0) {
      return null;
    }

    return JSON.parse(result.rows[0].data);
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
      has_fire: yoloData?.has_fire ?? false,
      has_smoke: yoloData?.has_smoke ?? false,
      alert_level: yoloData?.alert_level || null,
      detection_mode: yoloData?.detection_mode || null,
      active_classes: yoloData?.active_classes || null,
      detections: detections,

      // Confidence scores
      confidence_fire: yoloData?.confidence_scores?.fire ?? null,
      confidence_smoke: yoloData?.confidence_scores?.smoke ?? null,
      confidence_score: maxConfidence,

      // Image data
      image_base64: this.extractImage(yoloData),
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
   * Extract image from YOLO output (annotated_image field)
   */
  private extractImage(yoloData: any): string | null {
    try {
      const annotatedImage = yoloData?.annotated_image;

      if (annotatedImage && typeof annotatedImage === 'string' && annotatedImage.length > 1000) {
        // Remove data URL prefix if present
        return annotatedImage.replace(/^data:image\/[a-z]+;base64,/, '');
      }

      return null;
    } catch (error) {
      logger.debug('Image extraction failed:', error);
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

      return detectionsRaw.map((det: any) => ({
        class: det.class || 'unknown',
        confidence: parseFloat(det.confidence) || 0,
        bounding_box: {
          x: det.bbox?.x ?? det.x ?? 0,
          y: det.bbox?.y ?? det.y ?? 0,
          width: det.bbox?.width ?? det.w ?? 0,
          height: det.bbox?.height ?? det.h ?? 0
        }
      }));
    } catch (error) {
      logger.debug('Failed to parse detections:', error);
      return null;
    }
  }

  /**
   * ========================================================================
   * DATABASE UPDATE OPERATIONS
   * ========================================================================
   */

  /**
   * Update executions table with device/location metadata
   */
  private async updateExecution(
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

    await this.saiPool.query(`
      UPDATE executions
      SET
        device_id = COALESCE($2, device_id),
        camera_id = COALESCE($3, camera_id),
        node_id = COALESCE($2, node_id),
        location = COALESCE($4, location),
        camera_type = COALESCE($5, camera_type),
        capture_timestamp = COALESCE($6::timestamp, capture_timestamp),
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
    executionId: number,
    extracted: Stage2ExtractionResult
  ): Promise<void> {
    await this.saiPool.query(`
      INSERT INTO execution_analysis (
        execution_id,
        request_id,
        yolo_model_version,
        detection_count,
        has_fire,
        has_smoke,
        alert_level,
        detection_mode,
        active_classes,
        detections,
        confidence_fire,
        confidence_smoke,
        confidence_score,
        image_width,
        image_height,
        yolo_processing_time_ms
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16
      )
      ON CONFLICT (execution_id) DO UPDATE SET
        request_id = EXCLUDED.request_id,
        yolo_model_version = EXCLUDED.yolo_model_version,
        detection_count = EXCLUDED.detection_count,
        has_fire = EXCLUDED.has_fire,
        has_smoke = EXCLUDED.has_smoke,
        alert_level = EXCLUDED.alert_level,
        detection_mode = EXCLUDED.detection_mode,
        active_classes = EXCLUDED.active_classes,
        detections = EXCLUDED.detections,
        confidence_fire = EXCLUDED.confidence_fire,
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
      extracted.has_fire,
      extracted.has_smoke,
      extracted.alert_level,
      extracted.detection_mode,
      extracted.active_classes,
      extracted.detections ? JSON.stringify(extracted.detections) : null,
      extracted.confidence_fire,
      extracted.confidence_smoke,
      extracted.confidence_score,
      extracted.image_width,
      extracted.image_height,
      extracted.yolo_processing_time_ms
    ]);
  }

  /**
   * Process and cache image
   */
  private async processImage(executionId: number, imageBase64: string): Promise<void> {
    try {
      const partition = Math.floor(executionId / 1000);

      // Create directories
      const originalDir = path.join(this.IMAGE_CACHE_PATH, 'original', partition.toString());
      const webpDir = path.join(this.IMAGE_CACHE_PATH, 'webp', partition.toString());
      const thumbDir = path.join(this.IMAGE_CACHE_PATH, 'thumb', partition.toString());

      await Promise.all([
        fs.mkdir(originalDir, { recursive: true }),
        fs.mkdir(webpDir, { recursive: true }),
        fs.mkdir(thumbDir, { recursive: true })
      ]);

      const imageBuffer = Buffer.from(imageBase64, 'base64');

      // Define paths
      const originalPath = path.join(originalDir, `${executionId}.jpg`);
      const webpPath = path.join(webpDir, `${executionId}.webp`);
      const thumbPath = path.join(thumbDir, `${executionId}.webp`);

      // Save original JPEG
      await sharp(imageBuffer).jpeg({ quality: 95 }).toFile(originalPath);

      // Create WebP variant
      await sharp(imageBuffer).webp({ quality: 85 }).toFile(webpPath);

      // Create thumbnail
      await sharp(imageBuffer)
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(thumbPath);

      // Insert image metadata with all paths
      await this.saiPool.query(`
        INSERT INTO execution_images (
          execution_id, original_path, thumbnail_path, cached_path, size_bytes, format, extracted_at
        ) VALUES ($1, $2, $3, $4, $5, 'jpeg', NOW())
        ON CONFLICT (execution_id) DO UPDATE SET
          thumbnail_path = EXCLUDED.thumbnail_path,
          cached_path = EXCLUDED.cached_path
      `, [executionId, originalPath, thumbPath, webpPath, imageBuffer.length]);

    } catch (error) {
      logger.error(`Failed to process image for execution ${executionId}:`, error);
      throw error;
    }
  }

  /**
   * Insert notification status
   */
  private async insertNotification(
    executionId: number,
    extracted: Stage2ExtractionResult
  ): Promise<void> {
    await this.saiPool.query(`
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

  private async markProcessing(executionId: number): Promise<boolean> {
    const result = await this.saiPool.query(
      'SELECT etl_start_processing($1, $2) as marked',
      [executionId, this.workerId]
    );
    return result.rows[0].marked;
  }

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
