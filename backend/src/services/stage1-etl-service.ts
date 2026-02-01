/**
 * Stage 1 ETL Service: Fast Trigger-Based Extraction
 *
 * PHILOSOPHY: Extract only what's available in execution_entity (lightweight metadata).
 * NO JSON parsing, NO deep queries, NO blocking operations.
 *
 * Processes:
 * - Listens to PostgreSQL NOTIFY from n8n database triggers
 * - Extracts immediate execution metadata (< 100ms)
 * - Inserts minimal record into sai_dashboard.executions
 * - Queues execution for Stage 2 deep processing
 *
 * Data Integrity:
 * - All fields from execution_entity are NOT NULL (guaranteed available)
 * - Fields requiring JSON parsing are set to NULL (honest about missing data)
 * - Stage 2 will fill in missing data asynchronously
 *
 * See: docs/TWO_STAGE_ETL_ARCHITECTURE.md
 * See: docs/DATA_INTEGRITY_PRINCIPLES.md
 */

import { Client, Pool } from 'pg';
import { EventEmitter } from 'events';
import { n8nDatabaseConfig, saiDatabaseConfig, appConfig } from '@/config';
import { logger } from '@/utils/logger';
import { dualDb } from '@/database/dual-pool';

/**
 * Stage 1 notification payload from n8n trigger
 * Contains ONLY data from execution_entity table (no JSON parsing)
 */
interface Stage1NotificationPayload {
  execution_id: number;
  workflow_id: string;
  started_at: string;
  stopped_at: string | null;
  status: string;
  mode: string;
}

/**
 * Stage 1 ETL Service
 * Fast, trigger-based extraction with minimal processing
 */
export class Stage1ETLService extends EventEmitter {
  private n8nPool: Pool;
  private saiPool: Pool;
  private notifyClient: Client | null = null;
  private isRunning = false;

  // Performance metrics
  private metrics = {
    processed: 0,
    failed: 0,
    skipped: 0,
    avgProcessingTimeMs: 0,
    lastProcessedAt: null as Date | null,
    startedAt: new Date()
  };

  constructor() {
    super();

    // Use shared pools from dual-pool singleton
    this.n8nPool = dualDb.getN8nPool();
    this.saiPool = dualDb.getSaiPool();
  }

  /**
   * Start Stage 1 ETL service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Stage 1 ETL Service already running');
      return;
    }

    logger.info('🚀 Starting Stage 1 ETL Service (Fast Trigger-Based)...');

    try {
      // Test database connections
      await this.testConnections();

      // Set up PostgreSQL LISTEN for notifications
      await this.setupNotificationListener();

      this.isRunning = true;
      logger.info('✅ Stage 1 ETL Service started successfully', {
        service: 'stage1-etl',
        n8nDatabase: n8nDatabaseConfig.database,
        saiDatabase: saiDatabaseConfig.database,
        workflowId: appConfig.sai.workflowId
      });

      this.emit('started');
    } catch (error) {
      logger.error('❌ Failed to start Stage 1 ETL Service:', error);
      throw error;
    }
  }

  /**
   * Stop Stage 1 ETL service gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('🛑 Stopping Stage 1 ETL Service...');
    this.isRunning = false;

    if (this.notifyClient) {
      await this.notifyClient.end();
      this.notifyClient = null;
    }

    // Note: pools are shared via dualDb, do not end them here

    logger.info('✅ Stage 1 ETL Service stopped', {
      totalProcessed: this.metrics.processed,
      totalFailed: this.metrics.failed,
      avgTimeMs: this.metrics.avgProcessingTimeMs
    });

    this.emit('stopped');
  }

  /**
   * Test database connections
   */
  private async testConnections(): Promise<void> {
    logger.info('🔍 Testing database connections...');

    // Test n8n database (source)
    const n8nClient = await this.n8nPool.connect();
    try {
      const result = await n8nClient.query(
        'SELECT COUNT(*) as count FROM execution_entity WHERE "workflowId"::text = $1',
        [appConfig.sai.workflowId]
      );
      logger.info('✅ N8N Database connected', {
        database: n8nDatabaseConfig.database,
        saiExecutions: result.rows[0].count
      });
    } finally {
      n8nClient.release();
    }

    // Test sai_dashboard database (destination)
    const saiClient = await this.saiPool.connect();
    try {
      const result = await saiClient.query('SELECT COUNT(*) as count FROM executions');
      logger.info('✅ SAI Dashboard Database connected', {
        database: saiDatabaseConfig.database,
        existingRecords: result.rows[0].count
      });

      // Verify queue table exists
      const queueCheck = await saiClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'etl_processing_queue'
        ) as exists
      `);

      if (!queueCheck.rows[0].exists) {
        throw new Error('etl_processing_queue table not found. Run migration 002_two_stage_etl_queue.sql first.');
      }

      logger.info('✅ ETL queue table verified');
    } finally {
      saiClient.release();
    }
  }

  /**
   * Set up PostgreSQL LISTEN for real-time notifications
   */
  private async setupNotificationListener(): Promise<void> {
    logger.info('📡 Setting up PostgreSQL LISTEN for Stage 1 notifications...');

    this.notifyClient = new Client({
      host: n8nDatabaseConfig.host,
      port: n8nDatabaseConfig.port,
      database: n8nDatabaseConfig.database,
      user: n8nDatabaseConfig.username,
      password: n8nDatabaseConfig.password
    });

    await this.notifyClient.connect();

    // Listen for Stage 1 notifications (from n8n trigger)
    await this.notifyClient.query('LISTEN sai_execution_stage1');

    this.notifyClient.on('notification', async (msg) => {
      if (msg.channel === 'sai_execution_stage1' && msg.payload) {
        const startTime = Date.now();

        try {
          const payload: Stage1NotificationPayload = JSON.parse(msg.payload);
          logger.debug('📬 Stage 1 notification received', {
            executionId: payload.execution_id,
            status: payload.status
          });

          await this.processStage1(payload);

          // Track performance
          const processingTime = Date.now() - startTime;
          this.updateMetrics(processingTime);

        } catch (error) {
          logger.error('❌ Error processing Stage 1 notification:', error);
          this.metrics.failed++;
        }
      }
    });

    this.notifyClient.on('error', (error) => {
      logger.error('❌ PostgreSQL notification client error:', error);
      // Attempt reconnection after 5 seconds
      setTimeout(() => {
        if (this.isRunning) {
          this.setupNotificationListener().catch(err =>
            logger.error('Failed to reconnect notification listener:', err)
          );
        }
      }, 5000);
    });

    logger.info('✅ Listening for sai_execution_stage1 notifications');
  }

  /**
   * Process Stage 1: Fast extraction from execution_entity metadata
   *
   * CRITICAL: This must complete in < 100ms
   * - NO JSON parsing (that's Stage 2)
   * - NO deep queries (lightweight only)
   * - NO external API calls
   * - NO image processing
   */
  private async processStage1(payload: Stage1NotificationPayload): Promise<void> {
    const { execution_id, workflow_id, started_at, stopped_at, status, mode } = payload;

    logger.info(`⚡ Stage 1: Processing execution ${execution_id} (fast path)`);

    try {
      // Check if already processed (idempotent)
      const existing = await this.saiPool.query(
        'SELECT id FROM executions WHERE id = $1',
        [execution_id]
      );

      if (existing.rows.length > 0) {
        logger.debug(`⏭️  Execution ${execution_id} already exists in sai_dashboard, skipping`);
        this.metrics.skipped++;
        return;
      }

      // Calculate duration (safe - no null issues here)
      const duration_ms = stopped_at
        ? new Date(stopped_at).getTime() - new Date(started_at).getTime()
        : null;

      // Insert minimal execution record
      // All these fields are guaranteed to be available from execution_entity
      await this.saiPool.query(`
        INSERT INTO executions (
          id,
          workflow_id,
          execution_timestamp,
          completion_timestamp,
          duration_ms,
          status,
          mode,
          -- Stage 2 fields (NULL until deep extraction)
          node_id,
          camera_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
      `, [
        execution_id,
        workflow_id,
        started_at,
        stopped_at,
        duration_ms,
        status,
        mode
      ]);

      logger.info(`✅ Stage 1: Inserted execution ${execution_id}`, {
        executionId: execution_id,
        status,
        mode,
        durationMs: duration_ms
      });

      // The trigger on executions table will automatically queue this for Stage 2
      // (via queue_stage2_processing() function from migration)

      this.metrics.processed++;
      this.metrics.lastProcessedAt = new Date();

      // Emit event for monitoring
      this.emit('execution_processed', {
        execution_id,
        status,
        stage: 'stage1',
        duration_ms
      });

    } catch (error) {
      logger.error(`❌ Stage 1: Failed to process execution ${execution_id}:`, error);
      this.metrics.failed++;
      throw error;
    }
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(processingTimeMs: number): void {
    const total = this.metrics.processed + this.metrics.failed;
    this.metrics.avgProcessingTimeMs =
      (this.metrics.avgProcessingTimeMs * (total - 1) + processingTimeMs) / total;
  }

  /**
   * Get current service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      uptime_seconds: Math.floor((Date.now() - this.metrics.startedAt.getTime()) / 1000),
      is_running: this.isRunning
    };
  }

  /**
   * Get queue health (how many executions waiting for Stage 2)
   */
  async getQueueHealth() {
    try {
      const result = await this.saiPool.query('SELECT * FROM etl_queue_health');
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get queue health:', error);
      return null;
    }
  }
}

// Export singleton instance
export const stage1ETLService = new Stage1ETLService();
