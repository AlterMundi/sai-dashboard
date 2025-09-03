/**
 * Simple ETL Service
 * Listens for PostgreSQL NOTIFY events from n8n triggers
 * Processes SAI executions into sai_dashboard database
 */

import { Pool, Client } from 'pg';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

interface NotificationPayload {
  execution_id: number;
  workflow_id: string;
  status: string;
  started_at: string;
  stopped_at: string;
  processing_time_ms: number;
}

export class SimpleETLService extends EventEmitter {
  private n8nPool: Pool;
  private dashboardPool: Pool;
  private notifyClient: Client | null = null;
  private isListening: boolean = false;
  private imageCachePath: string;
  
  // Processing metrics
  private metrics = {
    processed: 0,
    failed: 0,
    skipped: 0,
    lastProcessedAt: null as Date | null,
    startedAt: new Date()
  };

  constructor() {
    super();
    this.imageCachePath = '/mnt/raid1/n8n-backup/images/by-execution';
    
    // Initialize database pools
    this.n8nPool = new Pool({
      host: process.env.N8N_DB_HOST || 'localhost',
      port: parseInt(process.env.N8N_DB_PORT || '5432'),
      database: process.env.N8N_DB_NAME || 'n8n',
      user: process.env.N8N_DB_USER || 'n8n_user',
      password: process.env.N8N_DB_PASSWORD || 'a5sd87akdVDS5',
      max: 3, // Limited connections for read-only
      idleTimeoutMillis: 30000
    });
    
    this.dashboardPool = new Pool({
      host: process.env.SAI_DB_HOST || 'localhost',
      port: parseInt(process.env.SAI_DB_PORT || '5432'),
      database: process.env.SAI_DB_NAME || 'sai_dashboard',
      user: process.env.SAI_DB_USER || 'n8n_user',
      password: process.env.SAI_DB_PASSWORD || 'a5sd87akdVDS5',
      max: 5,
      idleTimeoutMillis: 30000
    });
  }

  /**
   * Start the ETL service and begin listening for notifications
   */
  async start(): Promise<void> {
    console.log('🚀 Starting Simple ETL Service...');
    
    try {
      // Test database connections
      await this.testConnections();
      
      // Set up notification listener
      await this.startNotificationListener();
      
      console.log('✅ Simple ETL Service started successfully');
      console.log(`📂 Image cache path: ${this.imageCachePath}`);
      
      this.emit('started');
    } catch (error) {
      console.error('❌ Failed to start Simple ETL Service:', error);
      throw error;
    }
  }

  /**
   * Stop the ETL service
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping Simple ETL Service...');
    
    this.isListening = false;
    
    if (this.notifyClient) {
      await this.notifyClient.end();
      this.notifyClient = null;
    }
    
    await this.n8nPool.end();
    await this.dashboardPool.end();
    
    console.log('✅ Simple ETL Service stopped');
    this.emit('stopped');
  }

  /**
   * Test database connections
   */
  private async testConnections(): Promise<void> {
    console.log('🔍 Testing database connections...');
    
    // Test n8n database connection
    const n8nClient = await this.n8nPool.connect();
    try {
      const result = await n8nClient.query('SELECT COUNT(*) as count FROM execution_entity WHERE "workflowId"::text = $1', ['yDbfhooKemfhMIkC']);
      console.log(`✅ N8N Database: Connected (${result.rows[0].count} SAI executions found)`);
    } finally {
      n8nClient.release();
    }
    
    // Test sai_dashboard database connection
    const dashboardClient = await this.dashboardPool.connect();
    try {
      await dashboardClient.query('SELECT 1');
      console.log('✅ SAI Dashboard Database: Connected');
    } finally {
      dashboardClient.release();
    }
  }

  /**
   * Set up PostgreSQL LISTEN for notifications
   */
  private async startNotificationListener(): Promise<void> {
    console.log('📡 Setting up notification listener...');
    
    this.notifyClient = new Client({
      host: process.env.N8N_DB_HOST || 'localhost',
      port: parseInt(process.env.N8N_DB_PORT || '5432'),
      database: process.env.N8N_DB_NAME || 'n8n',
      user: process.env.N8N_DB_USER || 'n8n_user',
      password: process.env.N8N_DB_PASSWORD || 'a5sd87akdVDS5'
    });
    
    await this.notifyClient.connect();
    
    // Listen for notifications
    await this.notifyClient.query('LISTEN sai_execution_ready');
    
    this.notifyClient.on('notification', async (msg) => {
      if (msg.channel === 'sai_execution_ready' && msg.payload) {
        try {
          const payload: NotificationPayload = JSON.parse(msg.payload);
          console.log(`📬 Received notification for execution ${payload.execution_id}`);
          await this.processExecution(payload);
        } catch (error) {
          console.error('❌ Error processing notification:', error);
          this.metrics.failed++;
        }
      }
    });
    
    this.notifyClient.on('error', (error) => {
      console.error('❌ Notification client error:', error);
    });
    
    this.isListening = true;
    console.log('✅ Listening for sai_execution_ready notifications');
  }

  /**
   * Process a single execution from notification
   */
  private async processExecution(payload: NotificationPayload): Promise<void> {
    const { execution_id, workflow_id, status, started_at, stopped_at, processing_time_ms } = payload;
    
    try {
      // Check if already processed
      const existing = await this.dashboardPool.query('SELECT id FROM executions WHERE id = $1', [execution_id]);
      if (existing.rows.length > 0) {
        console.log(`⏭️ Execution ${execution_id} already processed, skipping`);
        this.metrics.skipped++;
        return;
      }
      
      console.log(`🔄 Processing execution ${execution_id}...`);
      
      // Get execution data from n8n database
      const executionData = await this.getExecutionData(execution_id);
      if (!executionData) {
        console.log(`⚠️ No data found for execution ${execution_id}`);
        this.metrics.failed++;
        return;
      }
      
      // Insert basic execution record FIRST (required for foreign key constraints)
      await this.dashboardPool.query(`
        INSERT INTO executions (
          id, workflow_id, execution_timestamp, completion_timestamp, 
          duration_ms, status, mode, node_id, camera_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        execution_id,
        workflow_id,
        started_at,
        stopped_at,
        processing_time_ms,
        status,
        'webhook',
        null, // Node assignment will be added later
        null  // Camera assignment will be added later
      ]);
      
      // Extract and process image if present (AFTER execution record exists)
      let imageProcessed = false;
      if (executionData.image_base64) {
        await this.processImage(execution_id, executionData.image_base64);
        imageProcessed = true;
      }
      
      // Insert analysis if available
      if (executionData.analysis) {
        await this.insertAnalysis(execution_id, executionData.analysis);
      }
      
      // Insert notification status
      await this.insertNotificationStatus(execution_id, executionData.telegram_status);
      
      this.metrics.processed++;
      this.metrics.lastProcessedAt = new Date();
      
      console.log(`✅ Successfully processed execution ${execution_id} (image: ${imageProcessed ? 'yes' : 'no'})`);
      this.emit('execution_processed', { execution_id, status, imageProcessed });
      
    } catch (error) {
      console.error(`❌ Error processing execution ${execution_id}:`, error);
      this.metrics.failed++;
      
      // Insert error record to prevent reprocessing
      try {
        await this.dashboardPool.query(`
          INSERT INTO executions (id, workflow_id, execution_timestamp, status, node_id, camera_id)
          VALUES ($1, $2, $3, 'error', NULL, NULL)
          ON CONFLICT (id) DO NOTHING
        `, [execution_id, workflow_id, started_at]);
      } catch (insertError) {
        console.error('Failed to insert error record:', insertError);
      }
      
      throw error;
    }
  }

  /**
   * Get execution data from n8n database - UNIFIED EXTRACTION LOGIC
   */
  private async getExecutionData(executionId: number): Promise<any> {
    const client = await this.n8nPool.connect();
    try {
      const result = await client.query(`
        SELECT ed.data 
        FROM execution_data ed 
        WHERE ed."executionId" = $1
      `, [executionId]);
      
      if (result.rows.length === 0) return null;
      
      const data = JSON.parse(result.rows[0].data);
      
      // UNIFIED extraction that works for both new and historical executions
      const extracted = this.extractExecutionDataUnified(data);
      
      return {
        image_base64: extracted.imageBase64,
        analysis: extracted.analysis,
        telegram_status: extracted.telegramStatus,
        raw_data: data
      };
      
    } finally {
      client.release();
    }
  }

  /**
   * UNIFIED extraction logic that works with actual n8n data structure
   */
  private extractExecutionDataUnified(data: any): any {
    let imageBase64: string | null = null;
    let analysis: string | null = null;
    let telegramStatus = false;

    // N8N stores data as a flat array/object with numeric keys
    // Search through all entries to find the data we need
    
    if (Array.isArray(data) || typeof data === 'object') {
      // Convert to array if it's an object with numeric keys
      const entries = Array.isArray(data) ? data : Object.values(data);
      
      for (const entry of entries) {
        if (typeof entry === 'string' && entry.length > 100000) {
          // This looks like a base64 image
          if (entry.startsWith('/9j/') || entry.startsWith('iVBORw0K')) {
            imageBase64 = entry;
          }
        } else if (typeof entry === 'string' && entry.length > 50 && entry.length < 10000) {
          // This might be analysis text (JSON or plain text)
          if (entry.includes('risk') || entry.includes('fire') || entry.includes('smoke') || 
              entry.includes('detected') || entry.includes('{')) {
            analysis = entry;
          }
        } else if (typeof entry === 'object' && entry !== null) {
          // Recursively search nested objects
          const nested = this.extractExecutionDataUnified(entry);
          if (nested.imageBase64 && !imageBase64) imageBase64 = nested.imageBase64;
          if (nested.analysis && !analysis) analysis = nested.analysis;
          if (nested.telegramStatus && !telegramStatus) telegramStatus = nested.telegramStatus;
        } else if (entry === true || entry === 'success') {
          // Possible telegram success indicator
          telegramStatus = true;
        }
      }
    }

    // Also try the original extraction paths as fallback
    if (!imageBase64) {
      imageBase64 = data?.nodeInputData?.Webhook?.[0]?.json?.body?.image ||
                   data?.nodeInputData?.Ollama?.[0]?.json?.image;
    }
    
    if (!analysis) {
      analysis = data?.nodeOutputData?.Ollama?.[0]?.json?.response;
    }
    
    if (!telegramStatus) {
      telegramStatus = data?.nodeOutputData?.Telegram?.[0]?.json?.success || false;
    }

    return {
      imageBase64,
      analysis, 
      telegramStatus
    };
  }

  /**
   * Process and save image from base64 data
   */
  private async processImage(executionId: number, imageBase64: string): Promise<void> {
    try {
      // Ensure directory exists
      const executionDir = path.join(this.imageCachePath, executionId.toString());
      await fs.mkdir(executionDir, { recursive: true });
      
      // Decode base64 image
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      
      // Save original JPEG
      const originalPath = path.join(executionDir, 'original.jpg');
      await sharp(imageBuffer)
        .jpeg({ quality: 95 })
        .toFile(originalPath);
      
      // Create WebP variants
      const highWebPPath = path.join(executionDir, 'high.webp');
      await sharp(imageBuffer)
        .webp({ quality: 85 })
        .toFile(highWebPPath);
      
      // Create thumbnail
      const thumbPath = path.join(executionDir, 'thumb.webp');
      await sharp(imageBuffer)
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(thumbPath);
      
      // Insert image metadata
      await this.dashboardPool.query(`
        INSERT INTO execution_images (
          execution_id, original_path, size_bytes, format, extracted_at
        ) VALUES ($1, $2, $3, 'jpeg', NOW())
      `, [
        executionId,
        originalPath,
        imageBuffer.length
      ]);
      
      console.log(`📸 Image processed for execution ${executionId}`);
      
    } catch (error) {
      console.error(`❌ Failed to process image for execution ${executionId}:`, error);
      throw error;
    }
  }

  /**
   * Insert analysis data
   */
  private async insertAnalysis(executionId: number, analysisText: string): Promise<void> {
    // Simple risk level extraction
    let riskLevel = 'none';
    if (analysisText.toLowerCase().includes('high risk') || analysisText.toLowerCase().includes('critical')) {
      riskLevel = 'high';
    } else if (analysisText.toLowerCase().includes('medium risk')) {
      riskLevel = 'medium';
    } else if (analysisText.toLowerCase().includes('low risk')) {
      riskLevel = 'low';
    }
    
    // Extract confidence if present
    let confidence: number | null = null;
    const confMatch = analysisText.match(/confidence[:\s]+([0-9]*\.?[0-9]+)/i);
    if (confMatch) {
      confidence = parseFloat(confMatch[1]);
      if (confidence > 1) confidence = confidence / 100; // Convert percentage to decimal
    }
    
    await this.dashboardPool.query(`
      INSERT INTO execution_analysis (
        execution_id, risk_level, confidence_score, overall_assessment,
        model_version, processing_time_ms, analysis_timestamp,
        smoke_detected, flame_detected, heat_signature_detected,
        alert_priority, response_required, node_id
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, NULL)
    `, [
      executionId,
      riskLevel,
      confidence,
      analysisText,
      'qwen2.5vl:7b',
      null, // Will be updated later
      analysisText.toLowerCase().includes('smoke'),
      analysisText.toLowerCase().includes('flame') || analysisText.toLowerCase().includes('fire'),
      analysisText.toLowerCase().includes('heat'),
      riskLevel === 'high' ? 'high' : 'normal',
      riskLevel === 'high' && (confidence || 0) >= 0.8
    ]);
  }

  /**
   * Insert notification status
   */
  private async insertNotificationStatus(executionId: number, telegramSent: boolean): Promise<void> {
    await this.dashboardPool.query(`
      INSERT INTO execution_notifications (
        execution_id, telegram_sent, telegram_sent_at
      ) VALUES ($1, $2, $3)
    `, [
      executionId,
      telegramSent,
      telegramSent ? new Date() : null
    ]);
  }

  /**
   * Get processing metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      uptime_seconds: Math.floor((Date.now() - this.metrics.startedAt.getTime()) / 1000),
      is_listening: this.isListening
    };
  }

  /**
   * Test the ETL pipeline manually
   */
  async testWithLatestExecution(): Promise<void> {
    console.log('🧪 Testing ETL pipeline with latest execution...');
    
    const client = await this.n8nPool.connect();
    try {
      // Get latest SAI execution
      const result = await client.query(`
        SELECT id, "workflowId", "startedAt", "stoppedAt", status
        FROM execution_entity
        WHERE "workflowId"::text = 'yDbfhooKemfhMIkC' AND status = 'success'
        ORDER BY "startedAt" DESC
        LIMIT 1
      `);
      
      if (result.rows.length === 0) {
        console.log('⚠️ No successful SAI executions found for testing');
        return;
      }
      
      const execution = result.rows[0];
      console.log(`🔍 Testing with execution ${execution.id} from ${execution.startedAt}`);
      
      // Simulate notification payload
      const payload: NotificationPayload = {
        execution_id: execution.id,
        workflow_id: execution.workflowId,
        status: execution.status,
        started_at: execution.startedAt,
        stopped_at: execution.stoppedAt,
        processing_time_ms: Math.floor((new Date(execution.stoppedAt).getTime() - new Date(execution.startedAt).getTime()))
      };
      
      await this.processExecution(payload);
      console.log('✅ Manual test completed successfully');
      
    } finally {
      client.release();
    }
  }
}

// Export singleton instance
export const simpleETLService = new SimpleETLService();