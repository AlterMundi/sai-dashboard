/**
 * Stage 2 ETL Service: Deep Async Processing
 *
 * PHILOSOPHY: Extract all available data from execution_data JSON blob.
 * Try multiple extraction paths, return NULL if unavailable.
 *
 * Processes:
 * - Polls etl_processing_queue for pending Stage 2 work
 * - Fetches and parses execution_data JSON from n8n
 * - Extracts images, analysis, model info, node assignment
 * - Updates executions, execution_analysis, execution_images tables
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
 * Stage 2 extraction result
 * ALL fields nullable except execution_id (following data integrity principles)
 */
interface Stage2ExtractionResult {
  // Image data
  image_base64: string | null;

  // Analysis data
  analysis_text: string | null;
  model_version: string | null;
  risk_level: string | null;
  confidence_score: number | null;

  // Detection flags
  smoke_detected: boolean;
  flame_detected: boolean;
  heat_detected: boolean;

  // Node assignment
  node_id: string | null;
  camera_id: string | null;

  // Telegram notification
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

    logger.info('🚀 Starting Stage 2 ETL Service (Deep Async Processing)...');

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
        imageCachePath: this.IMAGE_CACHE_PATH
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

      logger.info(`🔍 Stage 2: Processing execution ${executionId} (deep extraction)`);

      // 1. Fetch execution_data JSON from n8n
      const executionData = await this.fetchExecutionData(executionId);
      if (!executionData) {
        throw new Error('execution_data not found in n8n database');
      }

      // 2. Extract all available information
      const extracted = this.extractFromExecutionData(executionData);

      // 3. Update executions table (node assignment)
      if (extracted.node_id || extracted.camera_id) {
        await this.updateExecution(executionId, extracted);
      }

      // 4. Insert/update execution_analysis
      await this.upsertAnalysis(executionId, extracted);

      // 5. Process and cache image (if present)
      if (extracted.image_base64) {
        await this.processImage(executionId, extracted.image_base64);
        this.metrics.imagesExtracted++;
      }

      // 6. Insert notification status
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
        hasAnalysis: !!extracted.analysis_text,
        riskLevel: extracted.risk_level
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
  private async fetchExecutionData(executionId: number): Promise<any> {
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
   * Extract all available data from execution_data JSON
   * Implements multiple extraction strategies
   * Returns NULL for unavailable fields (honest approach)
   */
  private extractFromExecutionData(data: any): Stage2ExtractionResult {
    return {
      image_base64: this.extractImage(data),
      analysis_text: this.extractAnalysis(data),
      model_version: this.extractModelVersion(data),
      risk_level: this.extractRiskLevel(data),
      confidence_score: this.extractConfidence(data),
      smoke_detected: this.detectSmoke(data),
      flame_detected: this.detectFlame(data),
      heat_detected: this.detectHeat(data),
      node_id: this.extractNodeId(data),
      camera_id: this.extractCameraId(data),
      telegram_sent: this.extractTelegramStatus(data),
      telegram_message_id: this.extractTelegramMessageId(data)
    };
  }

  /**
   * Extract image from multiple possible locations
   */
  private extractImage(data: any): string | null {
    try {
      const paths = [
        data?.nodeInputData?.Webhook?.[0]?.json?.body?.image,
        data?.nodeInputData?.Webhook?.[0]?.json?.image,
        data?.nodeOutputData?.Webhook?.[0]?.json?.image,
        data?.nodeInputData?.Ollama?.[0]?.json?.image
      ];

      for (const imagePath of paths) {
        if (imagePath && typeof imagePath === 'string' && imagePath.length > 1000) {
          // Remove data URL prefix if present
          return imagePath.replace(/^data:image\/[a-z]+;base64,/, '');
        }
      }

      return null; // No image found - that's OK
    } catch (error) {
      logger.debug('Image extraction failed:', error);
      return null;
    }
  }

  /**
   * Extract analysis text
   */
  private extractAnalysis(data: any): string | null {
    try {
      return data?.nodeOutputData?.Ollama?.[0]?.json?.response || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract model version from Ollama node metadata
   * CRITICAL: Never use defaults - return NULL if unavailable
   */
  private extractModelVersion(data: any): string | null {
    try {
      // Strategy 1: Direct from Ollama output
      const model = data?.nodeOutputData?.Ollama?.[0]?.json?.model;
      if (model) return model;

      // Strategy 2: From Ollama metadata
      const metadata = data?.nodeMetadata?.Ollama?.model;
      if (metadata) return metadata;

      // Strategy 3: Parse from analysis text
      const analysis = this.extractAnalysis(data);
      if (analysis) {
        const modelMatch = analysis.match(/model[:\s]+([^\n\r,]+)/i);
        if (modelMatch) return modelMatch[1].trim();
      }

      return null; // Unknown - that's OK!
    } catch (error) {
      logger.debug('Model version extraction failed:', error);
      return null;
    }
  }

  /**
   * Extract risk level from analysis text
   */
  private extractRiskLevel(data: any): string | null {
    const analysis = this.extractAnalysis(data);
    if (!analysis) return null;

    const lower = analysis.toLowerCase();

    if (lower.includes('critical')) return 'critical';
    if (lower.includes('high risk')) return 'high';
    if (lower.includes('medium risk')) return 'medium';
    if (lower.includes('low risk')) return 'low';
    if (lower.includes('no risk') || lower.includes('none')) return 'none';

    return null; // Unable to determine
  }

  /**
   * Extract confidence score
   */
  private extractConfidence(data: any): number | null {
    const analysis = this.extractAnalysis(data);
    if (!analysis) return null;

    const match = analysis.match(/confidence[:\s]+([0-9]*\.?[0-9]+)/i);
    if (match) {
      let confidence = parseFloat(match[1]);
      if (confidence > 1) confidence = confidence / 100; // Convert percentage
      return confidence;
    }

    return null;
  }

  /**
   * Detect smoke mention
   */
  private detectSmoke(data: any): boolean {
    const analysis = this.extractAnalysis(data);
    return analysis ? analysis.toLowerCase().includes('smoke') : false;
  }

  /**
   * Detect flame mention
   */
  private detectFlame(data: any): boolean {
    const analysis = this.extractAnalysis(data);
    if (!analysis) return false;
    const lower = analysis.toLowerCase();
    return lower.includes('flame') || lower.includes('fire');
  }

  /**
   * Detect heat signature mention
   */
  private detectHeat(data: any): boolean {
    const analysis = this.extractAnalysis(data);
    return analysis ? analysis.toLowerCase().includes('heat') : false;
  }

  /**
   * Extract node ID (multiple strategies)
   */
  private extractNodeId(data: any): string | null {
    try {
      // Strategy 1: Direct from webhook payload
      const webhookData = data?.nodeInputData?.Webhook?.[0]?.json?.body;
      if (webhookData?.nodeId) return webhookData.nodeId;

      // Strategy 2: From headers
      const headers = data?.nodeInputData?.Webhook?.[0]?.json?.headers;
      const userAgent = headers?.['user-agent'] || headers?.['User-Agent'];
      if (userAgent) {
        const nodeMatch = userAgent.match(/Node[_-]?(\w+)/i);
        if (nodeMatch) return `NODE_${nodeMatch[1].toUpperCase()}`;
      }

      return null; // Unknown
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract camera ID
   */
  private extractCameraId(data: any): string | null {
    try {
      const webhookData = data?.nodeInputData?.Webhook?.[0]?.json?.body;
      return webhookData?.cameraId || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract Telegram notification status
   */
  private extractTelegramStatus(data: any): boolean {
    try {
      return data?.nodeOutputData?.Telegram?.[0]?.json?.success || false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract Telegram message ID
   */
  private extractTelegramMessageId(data: any): number | null {
    try {
      const messageId = data?.nodeOutputData?.Telegram?.[0]?.json?.message_id;
      return messageId ? parseInt(messageId) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Update executions table with node assignment
   */
  private async updateExecution(
    executionId: number,
    extracted: Stage2ExtractionResult
  ): Promise<void> {
    await this.saiPool.query(`
      UPDATE executions
      SET
        node_id = COALESCE($2, node_id),
        camera_id = COALESCE($3, camera_id),
        updated_at = NOW()
      WHERE id = $1
    `, [executionId, extracted.node_id, extracted.camera_id]);
  }

  /**
   * Insert/update execution_analysis
   * ALL fields nullable (data integrity principle)
   */
  private async upsertAnalysis(
    executionId: number,
    extracted: Stage2ExtractionResult
  ): Promise<void> {
    await this.saiPool.query(`
      INSERT INTO execution_analysis (
        execution_id,
        risk_level,
        confidence_score,
        overall_assessment,
        model_version,
        smoke_detected,
        flame_detected,
        heat_signature_detected,
        alert_priority,
        response_required,
        node_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (execution_id) DO UPDATE SET
        risk_level = EXCLUDED.risk_level,
        confidence_score = EXCLUDED.confidence_score,
        overall_assessment = EXCLUDED.overall_assessment,
        model_version = EXCLUDED.model_version,
        smoke_detected = EXCLUDED.smoke_detected,
        flame_detected = EXCLUDED.flame_detected,
        heat_signature_detected = EXCLUDED.heat_signature_detected,
        alert_priority = EXCLUDED.alert_priority,
        response_required = EXCLUDED.response_required,
        node_id = EXCLUDED.node_id,
        updated_at = NOW()
    `, [
      executionId,
      extracted.risk_level,
      extracted.confidence_score,
      extracted.analysis_text,
      extracted.model_version, // NULL if not available - HONEST!
      extracted.smoke_detected,
      extracted.flame_detected,
      extracted.heat_detected,
      extracted.risk_level === 'high' || extracted.risk_level === 'critical' ? 'high' : 'normal',
      extracted.risk_level === 'critical' && (extracted.confidence_score || 0) >= 0.8,
      extracted.node_id
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

      // Insert image metadata
      await this.saiPool.query(`
        INSERT INTO execution_images (
          execution_id, original_path, size_bytes, format, extracted_at
        ) VALUES ($1, $2, $3, 'jpeg', NOW())
        ON CONFLICT (execution_id) DO NOTHING
      `, [executionId, originalPath, imageBuffer.length]);

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
   * Queue management functions
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
