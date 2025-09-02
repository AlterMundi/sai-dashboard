#!/usr/bin/env node

/**
 * SAI Dashboard Data Population Script
 * Migrates existing data from n8n database to sai_dashboard database
 * Processes all historical SAI workflow executions
 * Handles image extraction and caching
 */

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Configuration
const config = {
  n8nDatabase: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'n8n',
    user: process.env.DB_USER || 'n8n_user',
    password: process.env.DB_PASSWORD || '',
  },
  saiDatabase: {
    host: process.env.SAI_DB_HOST || 'localhost', 
    port: parseInt(process.env.SAI_DB_PORT || '5432'),
    database: 'sai_dashboard',
    user: process.env.SAI_DB_USER || 'sai_dashboard_user',
    password: process.env.SAI_DB_PASSWORD || '',
  },
  imageCache: {
    basePath: '/mnt/raid1/n8n/backup/images/',
    extractImages: true,
    createThumbnails: false, // Disable for bulk migration
  },
  processing: {
    batchSize: 50,         // Process 50 executions at a time
    maxConcurrent: 5,      // Max 5 concurrent image processing
    delayMs: 100,          // Delay between batches
    skipExisting: true,    // Skip already processed executions
  }
};

const SAI_WORKFLOW_ID = 'yDbfhooKemfhMIkC';

class DataPopulator {
  constructor() {
    this.n8nPool = new Pool({
      ...config.n8nDatabase,
      max: 5,
      idleTimeoutMillis: 30000,
    });

    this.saiPool = new Pool({
      ...config.saiDatabase, 
      max: 10,
      idleTimeoutMillis: 30000,
    });

    this.stats = {
      totalExecutions: 0,
      processedExecutions: 0,
      skippedExecutions: 0,
      extractedImages: 0,
      errors: 0,
      startTime: Date.now(),
    };

    this.imageQueue = [];
    this.currentlyProcessing = new Set();
  }

  /**
   * Main population process
   */
  async run() {
    console.log('🚀 Starting SAI Dashboard data population...');
    console.log('📊 Configuration:', {
      batchSize: config.processing.batchSize,
      maxConcurrent: config.processing.maxConcurrent,
      extractImages: config.imageCache.extractImages,
      skipExisting: config.processing.skipExisting
    });

    try {
      // Test database connections
      await this.testConnections();

      // Get total count for progress tracking
      await this.getExecutionCount();

      // Create image cache directories
      await this.createImageDirectories();

      // Process executions in batches
      await this.processExecutionsBatched();

      // Process remaining images
      await this.processRemainingImages();

      // Display final statistics
      this.displayFinalStats();

    } catch (error) {
      console.error('❌ Population failed:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Test database connections
   */
  async testConnections() {
    console.log('🔍 Testing database connections...');

    try {
      // Test n8n database
      const n8nResult = await this.n8nPool.query(
        'SELECT COUNT(*) as count FROM execution_entity WHERE "workflowId" = $1',
        [SAI_WORKFLOW_ID]
      );
      console.log(`✅ N8N Database: ${n8nResult.rows[0].count} SAI executions found`);

      // Test sai_dashboard database  
      await this.saiPool.query('SELECT COUNT(*) FROM executions');
      console.log('✅ SAI Dashboard Database: Connected');

    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Get total execution count for progress tracking
   */
  async getExecutionCount() {
    const result = await this.n8nPool.query(`
      SELECT COUNT(*) as total
      FROM execution_entity e
      WHERE e."workflowId" = $1 
        AND e."deletedAt" IS NULL
        AND e.status IS NOT NULL
    `, [SAI_WORKFLOW_ID]);

    this.stats.totalExecutions = parseInt(result.rows[0].total);
    console.log(`📈 Total executions to process: ${this.stats.totalExecutions}`);
  }

  /**
   * Create image cache directory structure
   */
  async createImageDirectories() {
    if (!config.imageCache.extractImages) {
      console.log('⏭️  Skipping image directory creation (extraction disabled)');
      return;
    }

    console.log('📁 Creating image cache directories...');

    const directories = [
      path.join(config.imageCache.basePath, 'by-execution'),
      path.join(config.imageCache.basePath, 'by-date'),
      path.join(config.imageCache.basePath, 'by-status', 'high'),
      path.join(config.imageCache.basePath, 'by-status', 'medium'),
      path.join(config.imageCache.basePath, 'by-status', 'low'),
      path.join(config.imageCache.basePath, 'by-status', 'critical'),
    ];

    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          console.error(`Failed to create directory ${dir}:`, error);
        }
      }
    }

    console.log('✅ Image directories created');
  }

  /**
   * Process executions in batches
   */
  async processExecutionsBatched() {
    console.log('\n🔄 Processing executions in batches...');

    let offset = 0;
    let batch = 1;

    while (offset < this.stats.totalExecutions) {
      console.log(`\n📦 Processing batch ${batch} (${offset + 1}-${Math.min(offset + config.processing.batchSize, this.stats.totalExecutions)} of ${this.stats.totalExecutions})`);

      // Get batch of executions
      const executions = await this.getExecutionBatch(offset, config.processing.batchSize);
      
      if (executions.length === 0) break;

      // Process batch
      await this.processBatch(executions);

      // Update progress
      offset += executions.length;
      batch++;

      // Display progress
      this.displayProgress();

      // Small delay to prevent overwhelming the system
      await this.delay(config.processing.delayMs);
    }
  }

  /**
   * Get a batch of executions to process
   */
  async getExecutionBatch(offset, limit) {
    const query = `
      SELECT 
        e.id,
        e."workflowId",
        e.status,
        e.mode,
        e."startedAt",
        e."stoppedAt",
        e."retryOf",
        ed.data
      FROM execution_entity e
      LEFT JOIN execution_data ed ON e.id = ed."executionId"
      WHERE e."workflowId" = $1 
        AND e."deletedAt" IS NULL
        AND e.status IS NOT NULL
        ${config.processing.skipExisting ? 
          'AND NOT EXISTS (SELECT 1 FROM executions WHERE id = e.id)' : ''}
      ORDER BY e."startedAt" ASC
      LIMIT $2 OFFSET $3
    `;

    const result = await this.n8nPool.query(query, [SAI_WORKFLOW_ID, limit, offset]);
    return result.rows;
  }

  /**
   * Process a batch of executions
   */
  async processBatch(executions) {
    const promises = executions.map(async (execution) => {
      try {
        await this.processExecution(execution);
        this.stats.processedExecutions++;
      } catch (error) {
        console.error(`❌ Error processing execution ${execution.id}:`, error.message);
        this.stats.errors++;
      }
    });

    await Promise.all(promises);
  }

  /**
   * Process a single execution
   */
  async processExecution(executionData) {
    const executionId = executionData.id;

    // Skip if already exists and skipExisting is enabled
    if (config.processing.skipExisting) {
      const exists = await this.executionExists(executionId);
      if (exists) {
        this.stats.skippedExecutions++;
        return;
      }
    }

    // Extract and transform data
    const processed = this.extractExecutionData(executionData);
    const analysis = this.extractAnalysisData(executionData);
    const notifications = this.extractNotificationData(executionData);
    const imageInfo = this.extractImageData(executionData);

    // Insert into sai_dashboard database
    await this.insertExecution(processed);
    await this.insertAnalysis(analysis);
    await this.insertNotifications(notifications);

    if (imageInfo && config.imageCache.extractImages) {
      await this.insertImageMetadata(imageInfo);
      // Queue for image processing (async)
      this.queueImageProcessing(imageInfo);
    }
  }

  /**
   * Check if execution already exists
   */
  async executionExists(executionId) {
    const result = await this.saiPool.query('SELECT 1 FROM executions WHERE id = $1', [executionId]);
    return result.rows.length > 0;
  }

  /**
   * Extract execution data from n8n format
   */
  extractExecutionData(data) {
    const duration = data.stoppedAt && data.startedAt 
      ? new Date(data.stoppedAt) - new Date(data.startedAt)
      : null;

    return {
      id: data.id,
      workflowId: data.workflowId,
      executionTimestamp: data.startedAt,
      completionTimestamp: data.stoppedAt,
      durationMs: duration,
      status: data.status,
      mode: data.mode || 'webhook',
      retryOf: data.retryOf || null,
    };
  }

  /**
   * Extract analysis data from execution payload
   */
  extractAnalysisData(data) {
    let analysisText = null;
    let riskLevel = 'none';
    let confidenceScore = null;
    let rawResponse = null;

    try {
      if (data.data) {
        const parsedData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        
        // Extract Ollama response
        analysisText = parsedData?.nodeOutputData?.Ollama?.[0]?.json?.response;
        rawResponse = JSON.stringify(parsedData?.nodeOutputData?.Ollama?.[0]?.json);

        if (analysisText) {
          // Parse risk level
          const lowerText = analysisText.toLowerCase();
          if (lowerText.includes('risk') && lowerText.includes('high')) {
            riskLevel = 'high';
          } else if (lowerText.includes('risk') && lowerText.includes('medium')) {
            riskLevel = 'medium';
          } else if (lowerText.includes('risk') && lowerText.includes('low')) {
            riskLevel = 'low';
          } else if (lowerText.includes('no') && lowerText.includes('risk')) {
            riskLevel = 'none';
          }

          // Parse confidence
          const confidenceMatch = analysisText.match(/confidence[:\s]+([0-9]*\.?[0-9]+)/i);
          if (confidenceMatch) {
            confidenceScore = parseFloat(confidenceMatch[1]);
            if (confidenceScore > 1) confidenceScore = confidenceScore / 100; // Convert percentage
          }
        }
      }
    } catch (error) {
      console.warn(`Warning: Failed to parse analysis for execution ${data.id}:`, error.message);
    }

    const processingTime = data.stoppedAt && data.startedAt 
      ? new Date(data.stoppedAt) - new Date(data.startedAt)
      : null;

    return {
      executionId: data.id,
      riskLevel,
      confidenceScore,
      overallAssessment: analysisText,
      smokeDetected: analysisText ? /smoke|haze|smog/i.test(analysisText) : false,
      flameDetected: analysisText ? /flame|fire|burn/i.test(analysisText) : false,
      heatSignatureDetected: analysisText ? /heat|thermal|hot/i.test(analysisText) : false,
      motionDetected: analysisText ? /motion|movement|moving/i.test(analysisText) : false,
      modelVersion: 'qwen2.5vl:7b', // Default for SAI
      processingTimeMs: processingTime,
      rawResponse: rawResponse,
      alertPriority: this.calculateAlertPriority(riskLevel, confidenceScore),
      responseRequired: riskLevel === 'high' && (confidenceScore || 0) >= 0.85,
    };
  }

  /**
   * Calculate alert priority from risk level and confidence
   */
  calculateAlertPriority(riskLevel, confidenceScore) {
    if (riskLevel === 'high' && (confidenceScore || 0) >= 0.9) return 'critical';
    if (riskLevel === 'high' && (confidenceScore || 0) >= 0.7) return 'high';
    if (riskLevel === 'medium' && (confidenceScore || 0) >= 0.8) return 'high';
    if (riskLevel === 'medium') return 'normal';
    return 'low';
  }

  /**
   * Extract notification data
   */
  extractNotificationData(data) {
    let telegramSent = false;
    let telegramMessageId = null;
    let telegramSentAt = null;

    try {
      if (data.data) {
        const parsedData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        
        const telegramResponse = parsedData?.nodeOutputData?.Telegram?.[0]?.json;
        if (telegramResponse) {
          telegramSent = !!telegramResponse.success;
          telegramMessageId = telegramResponse.message_id || null;
          telegramSentAt = telegramSent ? data.stoppedAt : null;
        }
      }
    } catch (error) {
      console.warn(`Warning: Failed to parse notifications for execution ${data.id}:`, error.message);
    }

    return {
      executionId: data.id,
      telegramSent,
      telegramMessageId,
      telegramSentAt,
    };
  }

  /**
   * Extract image data
   */
  extractImageData(data) {
    if (!config.imageCache.extractImages) return null;

    try {
      if (data.data) {
        const parsedData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        
        // Try multiple locations for image data
        let base64Data = parsedData?.nodeInputData?.Webhook?.[0]?.json?.body?.image ||
                         parsedData?.nodeInputData?.Ollama?.[0]?.json?.image;

        if (!base64Data) return null;

        // Remove data URL prefix if present
        base64Data = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');

        const sizeBytes = Buffer.byteLength(base64Data, 'base64');
        const executionId = data.id;

        return {
          executionId,
          base64Data,
          sizeBytes,
          format: 'jpeg',
          originalPath: path.join(config.imageCache.basePath, 'by-execution', executionId.toString(), 'original.jpg'),
        };
      }
    } catch (error) {
      console.warn(`Warning: Failed to extract image for execution ${data.id}:`, error.message);
    }

    return null;
  }

  /**
   * Insert execution into database
   */
  async insertExecution(execution) {
    await this.saiPool.query(`
      INSERT INTO executions (
        id, workflow_id, execution_timestamp, completion_timestamp,
        duration_ms, status, mode, retry_of
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        workflow_id = EXCLUDED.workflow_id,
        execution_timestamp = EXCLUDED.execution_timestamp,
        completion_timestamp = EXCLUDED.completion_timestamp,
        duration_ms = EXCLUDED.duration_ms,
        status = EXCLUDED.status,
        mode = EXCLUDED.mode,
        retry_of = EXCLUDED.retry_of,
        updated_at = NOW()
    `, [
      execution.id,
      execution.workflowId,
      execution.executionTimestamp,
      execution.completionTimestamp,
      execution.durationMs,
      execution.status,
      execution.mode,
      execution.retryOf,
    ]);
  }

  /**
   * Insert analysis data
   */
  async insertAnalysis(analysis) {
    await this.saiPool.query(`
      INSERT INTO execution_analysis (
        execution_id, risk_level, confidence_score, overall_assessment,
        smoke_detected, flame_detected, heat_signature_detected, motion_detected,
        model_version, processing_time_ms, raw_response, alert_priority, response_required
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (execution_id) DO UPDATE SET
        risk_level = EXCLUDED.risk_level,
        confidence_score = EXCLUDED.confidence_score,
        overall_assessment = EXCLUDED.overall_assessment,
        smoke_detected = EXCLUDED.smoke_detected,
        flame_detected = EXCLUDED.flame_detected,
        heat_signature_detected = EXCLUDED.heat_signature_detected,
        motion_detected = EXCLUDED.motion_detected,
        model_version = EXCLUDED.model_version,
        processing_time_ms = EXCLUDED.processing_time_ms,
        raw_response = EXCLUDED.raw_response,
        alert_priority = EXCLUDED.alert_priority,
        response_required = EXCLUDED.response_required
    `, [
      analysis.executionId,
      analysis.riskLevel,
      analysis.confidenceScore,
      analysis.overallAssessment,
      analysis.smokeDetected,
      analysis.flameDetected,
      analysis.heatSignatureDetected,
      analysis.motionDetected,
      analysis.modelVersion,
      analysis.processingTimeMs,
      analysis.rawResponse,
      analysis.alertPriority,
      analysis.responseRequired,
    ]);
  }

  /**
   * Insert notification data
   */
  async insertNotifications(notifications) {
    await this.saiPool.query(`
      INSERT INTO execution_notifications (
        execution_id, telegram_sent, telegram_message_id, telegram_sent_at
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (execution_id) DO UPDATE SET
        telegram_sent = EXCLUDED.telegram_sent,
        telegram_message_id = EXCLUDED.telegram_message_id,
        telegram_sent_at = EXCLUDED.telegram_sent_at
    `, [
      notifications.executionId,
      notifications.telegramSent,
      notifications.telegramMessageId,
      notifications.telegramSentAt,
    ]);
  }

  /**
   * Insert image metadata
   */
  async insertImageMetadata(imageInfo) {
    await this.saiPool.query(`
      INSERT INTO execution_images (
        execution_id, original_path, size_bytes, format
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (execution_id) DO UPDATE SET
        original_path = EXCLUDED.original_path,
        size_bytes = EXCLUDED.size_bytes,
        format = EXCLUDED.format
    `, [
      imageInfo.executionId,
      imageInfo.originalPath,
      imageInfo.sizeBytes,
      imageInfo.format,
    ]);
  }

  /**
   * Queue image for processing
   */
  queueImageProcessing(imageInfo) {
    if (this.currentlyProcessing.size < config.processing.maxConcurrent) {
      this.processImage(imageInfo);
    } else {
      this.imageQueue.push(imageInfo);
    }
  }

  /**
   * Process image file
   */
  async processImage(imageInfo) {
    this.currentlyProcessing.add(imageInfo.executionId);

    try {
      // Create directory
      await fs.mkdir(path.dirname(imageInfo.originalPath), { recursive: true });

      // Write image file
      const imageBuffer = Buffer.from(imageInfo.base64Data, 'base64');
      await fs.writeFile(imageInfo.originalPath, imageBuffer);

      this.stats.extractedImages++;

    } catch (error) {
      console.error(`❌ Failed to process image for execution ${imageInfo.executionId}:`, error.message);
      this.stats.errors++;
    } finally {
      this.currentlyProcessing.delete(imageInfo.executionId);
      
      // Process next image in queue
      if (this.imageQueue.length > 0) {
        const nextImage = this.imageQueue.shift();
        setImmediate(() => this.processImage(nextImage));
      }
    }
  }

  /**
   * Process remaining images in queue
   */
  async processRemainingImages() {
    if (!config.imageCache.extractImages || (this.imageQueue.length === 0 && this.currentlyProcessing.size === 0)) {
      return;
    }

    console.log(`\n🖼️  Processing remaining ${this.imageQueue.length} images...`);

    // Wait for current processing to complete
    while (this.currentlyProcessing.size > 0 || this.imageQueue.length > 0) {
      await this.delay(1000);
      
      // Process images from queue
      while (this.currentlyProcessing.size < config.processing.maxConcurrent && this.imageQueue.length > 0) {
        const imageInfo = this.imageQueue.shift();
        this.processImage(imageInfo);
      }
    }

    console.log('✅ All images processed');
  }

  /**
   * Display progress
   */
  displayProgress() {
    const processed = this.stats.processedExecutions + this.stats.skippedExecutions;
    const percentage = ((processed / this.stats.totalExecutions) * 100).toFixed(1);
    const elapsed = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);

    console.log(`📊 Progress: ${processed}/${this.stats.totalExecutions} (${percentage}%) | ` +
                `Processed: ${this.stats.processedExecutions} | ` +
                `Skipped: ${this.stats.skippedExecutions} | ` +
                `Images: ${this.stats.extractedImages} | ` +
                `Errors: ${this.stats.errors} | ` +
                `Time: ${elapsed}s`);
  }

  /**
   * Display final statistics
   */
  displayFinalStats() {
    const totalTime = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);
    const rate = (this.stats.processedExecutions / (totalTime / 60)).toFixed(1);

    console.log('\n🎉 Data population completed!');
    console.log('📊 Final Statistics:');
    console.log(`   Total Executions: ${this.stats.totalExecutions}`);
    console.log(`   Processed: ${this.stats.processedExecutions}`);
    console.log(`   Skipped: ${this.stats.skippedExecutions}`);
    console.log(`   Images Extracted: ${this.stats.extractedImages}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`   Total Time: ${totalTime} seconds`);
    console.log(`   Processing Rate: ${rate} executions/minute`);
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      await this.n8nPool.end();
      await this.saiPool.end();
      console.log('✅ Database connections closed');
    } catch (error) {
      console.error('⚠️  Error during cleanup:', error);
    }
  }

  /**
   * Helper: delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the population script
if (require.main === module) {
  const populator = new DataPopulator();
  
  // Handle process signals
  process.on('SIGINT', async () => {
    console.log('\n⚠️  Received SIGINT, gracefully shutting down...');
    await populator.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n⚠️  Received SIGTERM, gracefully shutting down...');
    await populator.cleanup();
    process.exit(0);
  });

  // Run the population
  populator.run().catch(console.error);
}

module.exports = { DataPopulator, config };