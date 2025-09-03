#!/usr/bin/env node

/**
 * Historical Data Migration Tool - Pure N8N Data Only
 * 
 * Migrates data using ONLY pure n8n execution data, following the exact same
 * ETL transformation pipeline as live executions.
 * 
 * SOURCE: execution_entity + execution_data (pure n8n data)
 * PROCESS: Same transformation as SimpleETLService.processExecution()
 * OUTPUT: executions + execution_images + execution_analysis + execution_notifications
 */

const { Pool, Client } = require('pg');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');

class PureHistoricalMigrator {
  constructor() {
    // N8N Database (source - read-only)
    this.n8nPool = new Pool({
      host: process.env.N8N_DB_HOST || 'localhost',
      port: parseInt(process.env.N8N_DB_PORT || '5432'),
      database: process.env.N8N_DB_NAME || 'n8n',
      user: process.env.N8N_DB_USER || 'n8n_user',
      password: process.env.N8N_DB_PASSWORD || 'REDACTED',
      max: 5,
    });

    // SAI Dashboard Database (target - read/write)
    this.dashboardPool = new Pool({
      host: process.env.SAI_DB_HOST || 'localhost',
      port: parseInt(process.env.SAI_DB_PORT || '5432'),
      database: process.env.SAI_DB_NAME || 'sai_dashboard',
      user: process.env.SAI_DB_USER || 'n8n_user',
      password: process.env.SAI_DB_PASSWORD || 'REDACTED',
      max: 10,
    });

    this.imageCachePath = '/mnt/raid1/n8n/backup/images/by-execution';

    this.stats = {
      total: 0,
      migrated: 0,
      skipped: 0,
      errors: 0,
      startTime: Date.now()
    };

    this.batchSize = parseInt(process.env.MIGRATION_BATCH_SIZE || '50');
    this.dryRun = process.env.DRY_RUN === 'true';
  }

  async initialize() {
    console.log('🔄 Initializing Pure N8N Historical Data Migrator...');
    
    // Test database connections
    try {
      await this.n8nPool.query('SELECT NOW() as current_time');
      console.log('✅ N8N database connection successful');
      
      await this.dashboardPool.query('SELECT NOW() as current_time');
      console.log('✅ SAI Dashboard database connection successful');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      throw error;
    }

    // Get total count - PURE N8N DATA ONLY
    const totalQuery = `
      SELECT COUNT(*) as total
      FROM execution_entity ee
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC'
        AND ee.status = 'success'
    `;

    const result = await this.n8nPool.query(totalQuery);
    this.stats.total = parseInt(result.rows[0].total);

    console.log(`📊 Found ${this.stats.total} pure n8n executions to migrate`);
    console.log(`🚫 NOT using sai_execution_analysis (external processed data)`);
    console.log(`✅ Using ONLY pure n8n execution_entity + execution_data`);

    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - No data will be written');
    }
  }

  async migrateHistoricalData() {
    console.log('\n🚀 Starting pure n8n historical data migration...\n');

    let offset = 0;
    let currentBatch = 1;
    
    while (true) {
      console.log(`📦 Processing batch ${currentBatch} (records ${offset + 1}-${offset + this.batchSize})`);
      
      const batch = await this.fetchPureN8nBatch(offset, this.batchSize);
      
      if (batch.length === 0) {
        console.log('✅ No more records to process');
        break;
      }

      await this.processBatch(batch, currentBatch);
      
      // Progress update
      const progress = ((this.stats.migrated + this.stats.skipped + this.stats.errors) / this.stats.total * 100).toFixed(1);
      console.log(`📈 Progress: ${progress}% (${this.stats.migrated} migrated, ${this.stats.skipped} skipped, ${this.stats.errors} errors)\n`);
      
      offset += this.batchSize;
      currentBatch++;
      
      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Exit after 3 batches in development to prevent runaway
      if (process.env.NODE_ENV === 'development' && currentBatch > 3) {
        console.log('🛑 Development mode: stopping after 3 batches');
        break;
      }
    }

    await this.generateReport();
  }

  /**
   * Fetch pure n8n execution data (same as live ETL)
   */
  async fetchPureN8nBatch(offset, limit) {
    const query = `
      SELECT 
        ee.id as execution_id,
        ee."workflowId" as workflow_id,
        ee."startedAt" as execution_timestamp,
        ee."stoppedAt" as completion_timestamp,
        (EXTRACT(EPOCH FROM (ee."stoppedAt" - ee."startedAt")) * 1000)::INTEGER as duration_ms,
        ee.status,
        ee.mode,
        ed.data as execution_data
        
      FROM execution_entity ee
      LEFT JOIN execution_data ed ON ee.id = ed."executionId"
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC'
        AND ee.status = 'success'
      ORDER BY ee."startedAt" ASC
      LIMIT $1 OFFSET $2
    `;

    const result = await this.n8nPool.query(query, [limit, offset]);
    return result.rows;
  }

  async processBatch(records, batchNumber) {
    const client = await this.dashboardPool.connect();
    
    try {
      if (!this.dryRun) {
        await client.query('BEGIN');
      }

      for (const record of records) {
        try {
          await this.processExecutionLikeETL(record, client);
          this.stats.migrated++;
        } catch (error) {
          console.error(`❌ Error migrating execution ${record.execution_id}:`, error.message);
          this.stats.errors++;
          continue;
        }
      }

      if (!this.dryRun) {
        await client.query('COMMIT');
        console.log(`✅ Batch ${batchNumber} committed successfully`);
      } else {
        console.log(`🔍 Batch ${batchNumber} validated (dry run)`);
      }

    } catch (error) {
      if (!this.dryRun) {
        await client.query('ROLLBACK');
      }
      console.error(`❌ Batch ${batchNumber} failed:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Process execution using EXACT SAME logic as SimpleETLService.processExecution()
   */
  async processExecutionLikeETL(record, client) {
    const { execution_id, workflow_id, execution_timestamp, completion_timestamp, 
            duration_ms, status, mode, execution_data } = record;

    // Check if already processed (same as live ETL)
    if (!this.dryRun) {
      const existing = await client.query('SELECT id FROM executions WHERE id = $1', [execution_id]);
      if (existing.rows.length > 0) {
        console.log(`⏭️ Execution ${execution_id} already processed, skipping`);
        this.stats.skipped++;
        return;
      }
    }

    // Parse execution data (same as getExecutionData())
    let parsedData = null;
    let imageBase64 = null;
    let analysis = null;
    let telegramStatus = false;

    if (execution_data) {
      try {
        parsedData = JSON.parse(execution_data);
        
        // Extract image (same logic as live ETL)
        imageBase64 = parsedData?.nodeInputData?.Webhook?.[0]?.json?.body?.image ||
                      parsedData?.nodeInputData?.Ollama?.[0]?.json?.image;
        
        // Extract analysis (same logic as live ETL)
        analysis = parsedData?.nodeOutputData?.Ollama?.[0]?.json?.response;
        
        // Extract telegram status (same logic as live ETL)
        telegramStatus = parsedData?.nodeOutputData?.Telegram?.[0]?.json?.success || false;
        
      } catch (error) {
        console.warn(`⚠️ Failed to parse execution data for ${execution_id}`);
      }
    }

    if (!this.dryRun) {
      // Insert basic execution record (same as live ETL)
      await client.query(`
        INSERT INTO executions (
          id, workflow_id, execution_timestamp, completion_timestamp, 
          duration_ms, status, mode, node_id, camera_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        execution_id,
        workflow_id,
        execution_timestamp,
        completion_timestamp,
        duration_ms,
        status,
        mode || 'webhook',
        null, // Node assignment will be added later
        null  // Camera assignment will be added later
      ]);

      // Process image if present (same as live ETL)
      let imageProcessed = false;
      if (imageBase64) {
        await this.processImageLikeETL(execution_id, imageBase64, client);
        imageProcessed = true;
      }

      // Insert analysis if available (same as live ETL)
      if (analysis) {
        await this.insertAnalysisLikeETL(execution_id, analysis, client);
      }

      // Insert notification status (same as live ETL)
      await this.insertNotificationStatusLikeETL(execution_id, telegramStatus, client);
    }
  }

  /**
   * Process image using EXACT SAME logic as SimpleETLService.processImage()
   */
  async processImageLikeETL(executionId, imageBase64, client) {
    try {
      // Ensure directory exists (same as live ETL)
      const executionDir = path.join(this.imageCachePath, executionId.toString());
      if (!this.dryRun) {
        await fs.mkdir(executionDir, { recursive: true });
      }
      
      // Decode base64 image (same as live ETL)
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      
      if (!this.dryRun) {
        // Save original JPEG (same as live ETL)
        const originalPath = path.join(executionDir, 'original.jpg');
        await sharp(imageBuffer)
          .jpeg({ quality: 95 })
          .toFile(originalPath);
        
        // Create WebP variants (same as live ETL)
        const highWebPPath = path.join(executionDir, 'high.webp');
        await sharp(imageBuffer)
          .webp({ quality: 85 })
          .toFile(highWebPPath);
        
        // Create thumbnail (same as live ETL)
        const thumbPath = path.join(executionDir, 'thumb.webp');
        await sharp(imageBuffer)
          .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(thumbPath);
        
        // Insert image metadata (same as live ETL)
        await client.query(`
          INSERT INTO execution_images (
            execution_id, original_path, size_bytes, format, extracted_at
          ) VALUES ($1, $2, $3, 'jpeg', NOW())
        `, [
          executionId,
          originalPath,
          imageBuffer.length
        ]);
      }
      
    } catch (error) {
      console.error(`❌ Failed to process image for execution ${executionId}:`, error);
      throw error;
    }
  }

  /**
   * Insert analysis using EXACT SAME logic as SimpleETLService.insertAnalysis()
   */
  async insertAnalysisLikeETL(executionId, analysisText, client) {
    // Simple risk level extraction (same logic as live ETL)
    let riskLevel = 'none';
    if (analysisText.toLowerCase().includes('high risk') || analysisText.toLowerCase().includes('critical')) {
      riskLevel = 'high';
    } else if (analysisText.toLowerCase().includes('medium risk')) {
      riskLevel = 'medium';
    } else if (analysisText.toLowerCase().includes('low risk')) {
      riskLevel = 'low';
    }

    await client.query(`
      INSERT INTO execution_analysis (
        execution_id, risk_level, overall_assessment, alert_priority, response_required
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      executionId,
      riskLevel,
      analysisText.substring(0, 1000), // Truncate for safety
      riskLevel === 'high' ? 'high' : 'normal',
      riskLevel === 'high'
    ]);
  }

  /**
   * Insert notification status using EXACT SAME logic as live ETL
   */
  async insertNotificationStatusLikeETL(executionId, telegramSuccess, client) {
    await client.query(`
      INSERT INTO execution_notifications (
        execution_id, telegram_sent, telegram_sent_at
      ) VALUES ($1, $2, $3)
    `, [
      executionId,
      telegramSuccess,
      telegramSuccess ? new Date() : null
    ]);
  }

  async generateReport() {
    const duration = (Date.now() - this.stats.startTime) / 1000;
    
    console.log('\n📊 Pure N8N Migration Report');
    console.log('===============================');
    console.log(`Source: Pure n8n execution data only`);
    console.log(`Process: Same ETL transformation as live system`);
    console.log(`Total records: ${this.stats.total}`);
    console.log(`Migrated: ${this.stats.migrated}`);
    console.log(`Skipped: ${this.stats.skipped}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Rate: ${(this.stats.migrated / duration).toFixed(2)} records/sec`);
    
    if (this.stats.errors > 0) {
      console.log(`\n⚠️ Migration completed with ${this.stats.errors} errors`);
    } else {
      console.log('\n✅ Migration completed successfully!');
    }

    // Verify final counts
    if (!this.dryRun) {
      const finalCountQuery = 'SELECT COUNT(*) as count FROM executions';
      const finalCount = await this.dashboardPool.query(finalCountQuery);
      
      console.log(`\n📈 Final database count: ${finalCount.rows[0].count} records`);
    }
  }

  async close() {
    await this.n8nPool.end();
    await this.dashboardPool.end();
    console.log('🔚 Database connections closed');
  }
}

// Main execution
async function main() {
  const migrator = new PureHistoricalMigrator();
  
  try {
    await migrator.initialize();
    await migrator.migrateHistoricalData();
  } catch (error) {
    console.error('💥 Pure N8N migration failed:', error);
    process.exit(1);
  } finally {
    await migrator.close();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { PureHistoricalMigrator };