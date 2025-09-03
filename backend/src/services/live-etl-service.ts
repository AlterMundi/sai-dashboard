/**
 * Live ETL Service
 * Real-time data pipeline from n8n to sai_dashboard database
 * Handles validation, transformation, and quality gates
 */

import { Pool } from 'pg';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';

interface ETLConfig {
  n8nDb: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  dashboardDb: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  imageCachePath: string;
  validation: {
    requiredFields: string[];
    maxImageSize: number;
    allowedFormats: string[];
  };
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata: Record<string, any>;
}

interface ExecutionData {
  id: number;
  workflowId: string;
  startedAt: Date;
  finishedAt?: Date;
  status: string;
  mode: string;
  data: any;
}

export class LiveETLService extends EventEmitter {
  private n8nPool: Pool;
  private dashboardPool: Pool;
  private config: ETLConfig;
  private isListening: boolean = false;
  private processingQueue: Map<number, Promise<void>> = new Map();
  
  // Metrics
  private metrics = {
    processed: 0,
    failed: 0,
    skipped: 0,
    validationErrors: 0,
    lastProcessedAt: null as Date | null
  };

  constructor(config: ETLConfig) {
    super();
    this.config = config;
    
    // Initialize database pools
    this.n8nPool = new Pool({
      ...config.n8nDb,
      max: 2, // Limited connections for read-only
      idleTimeoutMillis: 30000
    });
    
    this.dashboardPool = new Pool({
      ...config.dashboardDb,
      max: 5,
      idleTimeoutMillis: 30000
    });
  }

  /**
   * Initialize and start the ETL pipeline
   */
  async start(): Promise<void> {
    console.log('🚀 Starting Live ETL Service...');
    
    // Verify database connections
    await this.verifyConnections();
    
    // Set up PostgreSQL triggers if not exists
    await this.setupTriggers();
    
    // Start listening for notifications
    await this.startListening();
    
    console.log('✅ Live ETL Service started successfully');
    this.emit('started');
  }

  /**
   * Verify both database connections
   */
  private async verifyConnections(): Promise<void> {
    try {
      // Test n8n connection
      const n8nTest = await this.n8nPool.query('SELECT NOW()');
      console.log('✅ Connected to n8n database');
      
      // Test dashboard connection
      const dashTest = await this.dashboardPool.query('SELECT NOW()');
      console.log('✅ Connected to sai_dashboard database');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw new Error('Failed to connect to databases');
    }
  }

  /**
   * Set up PostgreSQL triggers for live notifications
   */
  private async setupTriggers(): Promise<void> {
    const triggerSQL = `
      -- Create notification function if not exists
      CREATE OR REPLACE FUNCTION notify_sai_execution() RETURNS trigger AS $$
      DECLARE
        payload JSON;
      BEGIN
        -- Only notify for SAI workflow executions
        IF EXISTS (
          SELECT 1 FROM workflow_entity 
          WHERE id = NEW."workflowId" 
          AND name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
        ) THEN
          payload = json_build_object(
            'id', NEW.id,
            'workflowId', NEW."workflowId",
            'status', NEW.status,
            'startedAt', NEW."startedAt",
            'stoppedAt', NEW."stoppedAt"
          );
          PERFORM pg_notify('sai_execution', payload::text);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      -- Create trigger if not exists
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger 
          WHERE tgname = 'sai_execution_notify'
        ) THEN
          CREATE TRIGGER sai_execution_notify
          AFTER INSERT OR UPDATE ON execution_entity
          FOR EACH ROW EXECUTE FUNCTION notify_sai_execution();
        END IF;
      END $$;
    `;

    try {
      await this.n8nPool.query(triggerSQL);
      console.log('✅ PostgreSQL triggers configured');
    } catch (error) {
      console.error('⚠️ Warning: Could not create triggers (may need elevated permissions)');
      // Continue anyway - triggers might already exist
    }
  }

  /**
   * Start listening for PostgreSQL notifications
   */
  private async startListening(): Promise<void> {
    const client = await this.n8nPool.connect();
    
    client.on('notification', async (msg) => {
      if (msg.channel === 'sai_execution') {
        try {
          const payload = JSON.parse(msg.payload || '{}');
          console.log(`📨 New execution notification: ${payload.id}`);
          
          // Process in background to not block listener
          this.processExecution(payload.id).catch(err => {
            console.error(`Failed to process execution ${payload.id}:`, err);
            this.metrics.failed++;
          });
        } catch (error) {
          console.error('Failed to parse notification:', error);
        }
      }
    });

    await client.query('LISTEN sai_execution');
    this.isListening = true;
    console.log('👂 Listening for execution notifications...');
  }

  /**
   * Process a single execution
   */
  private async processExecution(executionId: number): Promise<void> {
    // Prevent duplicate processing
    if (this.processingQueue.has(executionId)) {
      console.log(`⏭️ Execution ${executionId} already in queue`);
      return;
    }

    const processingPromise = this.processExecutionInternal(executionId);
    this.processingQueue.set(executionId, processingPromise);
    
    try {
      await processingPromise;
    } finally {
      this.processingQueue.delete(executionId);
    }
  }

  /**
   * Internal execution processing logic
   */
  private async processExecutionInternal(executionId: number): Promise<void> {
    console.log(`⚙️ Processing execution ${executionId}...`);
    
    try {
      // 1. Fetch execution data from n8n
      const executionData = await this.fetchExecutionData(executionId);
      if (!executionData) {
        console.log(`⏭️ Execution ${executionId} not found or not SAI workflow`);
        this.metrics.skipped++;
        return;
      }

      // 2. Validate data quality
      const validation = await this.validateExecution(executionData);
      if (!validation.isValid) {
        console.error(`❌ Validation failed for execution ${executionId}:`, validation.errors);
        this.metrics.validationErrors++;
        this.emit('validationError', { executionId, errors: validation.errors });
        
        // Store with quality flag
        await this.storeWithQualityFlag(executionData, validation);
        return;
      }

      // 3. Extract and process images
      const imageData = await this.processImages(executionData);

      // 4. Transform data for dashboard schema
      const transformedData = this.transformData(executionData, imageData, validation.metadata);

      // 5. Store in dashboard database
      await this.storeToDashboard(transformedData);

      // 6. Emit success event
      this.metrics.processed++;
      this.metrics.lastProcessedAt = new Date();
      this.emit('processed', { executionId, timestamp: new Date() });
      
      console.log(`✅ Successfully processed execution ${executionId}`);
    } catch (error) {
      console.error(`❌ Failed to process execution ${executionId}:`, error);
      this.metrics.failed++;
      this.emit('error', { executionId, error });
      throw error;
    }
  }

  /**
   * Fetch execution data from n8n database
   */
  private async fetchExecutionData(executionId: number): Promise<ExecutionData | null> {
    const query = `
      SELECT 
        ee.id,
        ee."workflowId",
        ee."startedAt",
        ee."stoppedAt" as "finishedAt",
        ee.status,
        ee.mode,
        ed.data,
        we.name as workflow_name
      FROM execution_entity ee
      JOIN execution_data ed ON ee.id = ed."executionId"
      JOIN workflow_entity we ON ee."workflowId" = we.id
      WHERE ee.id = $1
      AND we.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
    `;

    const result = await this.n8nPool.query(query, [executionId]);
    if (result.rows.length === 0) return null;

    return result.rows[0];
  }

  /**
   * Validate execution data quality
   */
  private async validateExecution(data: ExecutionData): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const metadata: Record<string, any> = {};

    // Parse execution data
    let parsedData: any;
    try {
      parsedData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
    } catch (error) {
      errors.push('Invalid JSON in execution data');
      return { isValid: false, errors, warnings, metadata };
    }

    // Check for required fields (webhook data)
    const webhookData = parsedData?.nodeInputData?.Webhook?.[0]?.json;
    if (!webhookData) {
      errors.push('Missing webhook data');
    } else {
      // Check for image data
      if (!webhookData.image && !webhookData.body?.image) {
        errors.push('Missing image data');
      }
      
      // Check for optional but important fields
      if (!webhookData.camera_id && !webhookData.body?.camera_id) {
        warnings.push('Missing camera_id - cannot determine node');
      }
      
      if (!webhookData.timestamp && !webhookData.body?.timestamp) {
        warnings.push('Missing timestamp - using execution time');
      }

      // Extract metadata
      metadata.hasOllamaAnalysis = !!parsedData?.nodeOutputData?.Ollama;
      metadata.hasTelegramConfirmation = !!parsedData?.nodeOutputData?.Telegram;
      metadata.nodeId = this.extractNodeId(webhookData);
    }

    // Check execution status
    if (data.status === 'error' || data.status === 'crashed') {
      warnings.push(`Execution has status: ${data.status}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      metadata
    };
  }

  /**
   * Extract node ID from webhook data
   */
  private extractNodeId(webhookData: any): string | null {
    // Try multiple extraction strategies
    const nodeId = webhookData.node_id || 
                   webhookData.body?.node_id ||
                   webhookData.metadata?.node_id;
    
    if (nodeId) return nodeId;

    // Try to extract from camera_id pattern
    const cameraId = webhookData.camera_id || webhookData.body?.camera_id;
    if (cameraId && cameraId.match(/CAM_(\d+)/)) {
      const match = cameraId.match(/CAM_(\d+)/);
      return `NODE_${match![1].padStart(3, '0')}`;
    }

    return null;
  }

  /**
   * Process and store images
   */
  private async processImages(executionData: ExecutionData): Promise<any> {
    const parsedData = typeof executionData.data === 'string' 
      ? JSON.parse(executionData.data) 
      : executionData.data;
      
    const webhookData = parsedData?.nodeInputData?.Webhook?.[0]?.json;
    const imageBase64 = webhookData?.image || webhookData?.body?.image;
    
    if (!imageBase64) return null;

    const executionId = executionData.id;
    const basePath = path.join(this.config.imageCachePath, 'by-execution', String(executionId));
    
    // Create directory
    await fs.mkdir(basePath, { recursive: true });

    // Process image
    const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    
    // Save original
    const originalPath = path.join(basePath, 'original.jpg');
    await sharp(imageBuffer)
      .jpeg({ quality: 95 })
      .toFile(originalPath);

    // Generate thumbnails
    const thumbPath = path.join(basePath, 'thumb.jpg');
    await sharp(imageBuffer)
      .resize(300, 300, { fit: 'inside' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);

    // Generate WebP variants
    const webpPath = path.join(basePath, 'optimized.webp');
    await sharp(imageBuffer)
      .webp({ quality: 85 })
      .toFile(webpPath);

    const stats = await fs.stat(originalPath);
    const metadata = await sharp(imageBuffer).metadata();

    return {
      originalPath,
      thumbPath,
      webpPath,
      sizeBytes: stats.size,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format
    };
  }

  /**
   * Transform data for dashboard schema
   */
  private transformData(executionData: ExecutionData, imageData: any, metadata: any): any {
    const parsedData = typeof executionData.data === 'string' 
      ? JSON.parse(executionData.data) 
      : executionData.data;

    // Extract Ollama analysis
    const ollamaOutput = parsedData?.nodeOutputData?.Ollama?.[0]?.json;
    
    return {
      execution: {
        id: executionData.id,
        workflowId: executionData.workflowId,
        executionTimestamp: executionData.startedAt,
        completionTimestamp: executionData.finishedAt,
        durationMs: executionData.finishedAt 
          ? new Date(executionData.finishedAt).getTime() - new Date(executionData.startedAt).getTime()
          : null,
        status: executionData.status,
        mode: executionData.mode
      },
      image: imageData,
      analysis: {
        nodeId: metadata.nodeId,
        hasOllamaAnalysis: metadata.hasOllamaAnalysis,
        hasTelegramConfirmation: metadata.hasTelegramConfirmation,
        ollamaResponse: ollamaOutput?.response || null,
        riskLevel: this.extractRiskLevel(ollamaOutput),
        confidenceScore: this.extractConfidenceScore(ollamaOutput)
      }
    };
  }

  /**
   * Extract risk level from Ollama response
   */
  private extractRiskLevel(ollamaOutput: any): string {
    if (!ollamaOutput?.response) return 'unknown';
    
    const response = ollamaOutput.response.toLowerCase();
    if (response.includes('alto riesgo') || response.includes('fuego')) return 'high';
    if (response.includes('medio riesgo')) return 'medium';
    if (response.includes('bajo riesgo') || response.includes('no se detecta')) return 'low';
    
    return 'unknown';
  }

  /**
   * Extract confidence score from Ollama response
   */
  private extractConfidenceScore(ollamaOutput: any): number | null {
    if (!ollamaOutput?.response) return null;
    
    const match = ollamaOutput.response.match(/(\d+)%/);
    if (match) {
      return parseInt(match[1]) / 100;
    }
    
    return null;
  }

  /**
   * Store transformed data in dashboard database
   */
  private async storeToDashboard(data: any): Promise<void> {
    const client = await this.dashboardPool.connect();
    
    try {
      await client.query('BEGIN');

      // Insert execution
      await client.query(`
        INSERT INTO executions (
          id, workflow_id, execution_timestamp, completion_timestamp,
          duration_ms, status, mode
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          completion_timestamp = EXCLUDED.completion_timestamp,
          duration_ms = EXCLUDED.duration_ms,
          status = EXCLUDED.status,
          updated_at = NOW()
      `, [
        data.execution.id,
        data.execution.workflowId,
        data.execution.executionTimestamp,
        data.execution.completionTimestamp,
        data.execution.durationMs,
        data.execution.status,
        data.execution.mode
      ]);

      // Insert image data if available
      if (data.image) {
        await client.query(`
          INSERT INTO execution_images (
            execution_id, original_path, thumbnail_path,
            size_bytes, width, height, format
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (execution_id) DO UPDATE SET
            thumbnail_path = EXCLUDED.thumbnail_path,
            size_bytes = EXCLUDED.size_bytes
        `, [
          data.execution.id,
          data.image.originalPath,
          data.image.thumbPath,
          data.image.sizeBytes,
          data.image.width,
          data.image.height,
          data.image.format
        ]);
      }

      // Insert analysis data
      await client.query(`
        INSERT INTO execution_analysis (
          execution_id, node_id, risk_level, confidence_score,
          ollama_response, has_ollama_analysis, has_telegram_confirmation
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (execution_id) DO UPDATE SET
          risk_level = EXCLUDED.risk_level,
          confidence_score = EXCLUDED.confidence_score,
          updated_at = NOW()
      `, [
        data.execution.id,
        data.analysis.nodeId,
        data.analysis.riskLevel,
        data.analysis.confidenceScore,
        data.analysis.ollamaResponse,
        data.analysis.hasOllamaAnalysis,
        data.analysis.hasTelegramConfirmation
      ]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Store execution with quality flag for manual review
   */
  private async storeWithQualityFlag(executionData: ExecutionData, validation: ValidationResult): Promise<void> {
    // Store basic execution data even if validation failed
    await this.dashboardPool.query(`
      INSERT INTO executions (
        id, workflow_id, execution_timestamp, status, mode
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO NOTHING
    `, [
      executionData.id,
      executionData.workflowId,
      executionData.startedAt,
      'validation_failed',
      executionData.mode
    ]);

    // Log quality issues
    await this.dashboardPool.query(`
      INSERT INTO data_quality_logs (
        execution_id, errors, warnings, created_at
      ) VALUES ($1, $2, $3, NOW())
    `, [
      executionData.id,
      JSON.stringify(validation.errors),
      JSON.stringify(validation.warnings)
    ]);
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Stop the ETL service
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping Live ETL Service...');
    
    // Wait for processing queue to empty
    if (this.processingQueue.size > 0) {
      console.log(`⏳ Waiting for ${this.processingQueue.size} executions to finish processing...`);
      await Promise.all(this.processingQueue.values());
    }

    // Close database connections
    await this.n8nPool.end();
    await this.dashboardPool.end();
    
    this.isListening = false;
    console.log('✅ Live ETL Service stopped');
    this.emit('stopped');
  }
}

// Export factory function
export function createLiveETLService(config: Partial<ETLConfig> = {}): LiveETLService {
  const defaultConfig: ETLConfig = {
    n8nDb: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'n8n',
      user: process.env.DB_USER || 'sai_dashboard_readonly',
      password: process.env.DB_PASSWORD || ''
    },
    dashboardDb: {
      host: process.env.SAI_DB_HOST || 'localhost',
      port: parseInt(process.env.SAI_DB_PORT || '5432'),
      database: process.env.SAI_DB_NAME || 'sai_dashboard',
      user: process.env.SAI_DB_USER || 'sai_dashboard',
      password: process.env.SAI_DB_PASSWORD || ''
    },
    imageCachePath: process.env.CACHE_PATH || '/mnt/raid1/n8n/backup/images',
    validation: {
      requiredFields: ['image'],
      maxImageSize: parseInt(process.env.MAX_IMAGE_SIZE || '5242880'),
      allowedFormats: (process.env.SUPPORTED_IMAGE_FORMATS || 'jpeg,png,webp').split(',')
    }
  };

  return new LiveETLService({ ...defaultConfig, ...config });
}