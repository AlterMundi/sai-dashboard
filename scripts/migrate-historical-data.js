#!/usr/bin/env node

/**
 * Historical Data Migration Tool
 * 
 * Migrates data from legacy n8n system to new sai_dashboard system
 * with comprehensive validation and error handling.
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;

class HistoricalDataMigrator {
  constructor() {
    // N8N Database (source - read-only)
    this.n8nPool = new Pool({
      host: process.env.N8N_DB_HOST || 'localhost',
      port: parseInt(process.env.N8N_DB_PORT || '5432'),
      database: process.env.N8N_DB_NAME || 'n8n',
      user: process.env.N8N_DB_USER || 'n8n_user',
      password: process.env.N8N_DB_PASSWORD || 'a5sd87akdVDS5',
      max: 5,
    });

    // SAI Dashboard Database (target - read/write)
    this.saiPool = new Pool({
      host: process.env.SAI_DB_HOST || 'localhost',
      port: parseInt(process.env.SAI_DB_PORT || '5432'),
      database: process.env.SAI_DB_NAME || 'sai_dashboard',
      user: process.env.SAI_DB_USER || 'n8n_user',
      password: process.env.SAI_DB_PASSWORD || 'a5sd87akdVDS5',
      max: 10,
    });

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
    console.log('🔄 Initializing Historical Data Migrator...');
    
    // Test database connections
    try {
      await this.n8nPool.query('SELECT NOW() as current_time');
      console.log('✅ N8N database connection successful');
      
      await this.saiPool.query('SELECT NOW() as current_time');
      console.log('✅ SAI Dashboard database connection successful');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      throw error;
    }

    // Get migration statistics
    const totalQuery = `
      SELECT COUNT(*) as total
      FROM sai_execution_analysis sea
      JOIN execution_entity ee ON sea.execution_id = ee.id
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC'
        AND ee.status = 'success'
    `;

    const result = await this.n8nPool.query(totalQuery);
    this.stats.total = parseInt(result.rows[0].total);

    console.log(`📊 Found ${this.stats.total} records to migrate`);

    if (this.dryRun) {
      console.log('🔍 DRY RUN MODE - No data will be written');
    }
  }

  async migrateHistoricalData() {
    console.log('\n🚀 Starting historical data migration...\n');

    let offset = 0;
    let currentBatch = 1;
    
    while (true) {
      console.log(`📦 Processing batch ${currentBatch} (records ${offset + 1}-${offset + this.batchSize})`);
      
      const batch = await this.fetchBatch(offset, this.batchSize);
      
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
      
      // Exit after first batch in development to prevent runaway
      if (process.env.NODE_ENV === 'development' && currentBatch > 3) {
        console.log('🛑 Development mode: stopping after 3 batches');
        break;
      }
    }

    await this.generateReport();
  }

  async fetchBatch(offset, limit) {
    const query = `
      SELECT 
        ee.id as execution_id,
        ee."workflowId" as workflow_id,
        ee."startedAt" as execution_timestamp,
        ee."stoppedAt" as completion_timestamp,
        (EXTRACT(EPOCH FROM (ee."stoppedAt" - ee."startedAt")) * 1000)::INTEGER as duration_ms,
        ee.status,
        ee.mode,
        
        -- Analysis data from sai_execution_analysis
        sea.ollama_analysis_text as overall_assessment,
        sea.risk_level,
        sea.confidence_score,
        sea.smoke_detected,
        sea.flame_detected,
        sea.heat_signature_detected,
        sea.model_version,
        sea.processing_time_ms,
        sea.response_required,
        
        -- Extract image data from execution_data
        ed.data as execution_data
        
      FROM sai_execution_analysis sea
      JOIN execution_entity ee ON sea.execution_id = ee.id
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
    const client = await this.saiPool.connect();
    
    try {
      if (!this.dryRun) {
        await client.query('BEGIN');
      }

      for (const record of records) {
        try {
          await this.migrateRecord(record, client);
          this.stats.migrated++;
        } catch (error) {
          console.error(`❌ Error migrating record ${record.execution_id}:`, error.message);
          this.stats.errors++;
          
          // Continue with other records
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

  async migrateRecord(record, client) {
    // Check if record already exists
    const existsQuery = 'SELECT id FROM executions WHERE id = $1';
    const existsResult = await client.query(existsQuery, [record.execution_id]);
    
    if (existsResult.rows.length > 0) {
      this.stats.skipped++;
      return; // Skip existing records
    }

    // Extract image data and metadata
    const imageInfo = await this.extractImageInfo(record);
    
    // Insert execution record
    if (!this.dryRun) {
      await this.insertExecution(record, client);
      
      if (imageInfo.hasImage) {
        await this.insertExecutionImage(record, imageInfo, client);
      }
      
      await this.insertExecutionAnalysis(record, client);
    }
  }

  async extractImageInfo(record) {
    const imageInfo = {
      hasImage: false,
      imagePath: null,
      sizeBytes: null,
      format: null
    };

    if (!record.execution_data) {
      return imageInfo;
    }

    try {
      const data = JSON.parse(record.execution_data);
      
      // Look for base64 image data in various locations
      const imageLocations = [
        data?.nodeExecutionData?.[0]?.node_data?.outputData?.main?.[0]?.[0]?.binary?.image?.data,
        data?.nodeExecutionData?.[1]?.node_data?.outputData?.main?.[0]?.[0]?.binary?.image?.data,
        data?.nodeExecutionData?.[2]?.node_data?.outputData?.main?.[0]?.[0]?.binary?.image?.data
      ];

      for (const imageData of imageLocations) {
        if (imageData && typeof imageData === 'string') {
          imageInfo.hasImage = true;
          imageInfo.sizeBytes = Math.floor(imageData.length * 0.75); // Base64 size estimation
          imageInfo.format = 'jpeg';
          
          // Create image path
          const timestamp = new Date(record.execution_timestamp);
          const dateStr = timestamp.toISOString().split('T')[0].replace(/-/g, '/');
          const timeStr = timestamp.toISOString().replace(/[T:-]/g, '').split('.')[0];
          
          imageInfo.imagePath = `/mnt/raid1/n8n/backup/images/by-execution/${record.execution_id}/original.jpg`;
          
          break;
        }
      }
    } catch (error) {
      console.warn(`⚠️ Failed to extract image info for execution ${record.execution_id}:`, error.message);
    }

    return imageInfo;
  }

  async insertExecution(record, client) {
    const query = `
      INSERT INTO executions (
        id, workflow_id, execution_timestamp, completion_timestamp,
        duration_ms, status, mode, node_id, camera_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
    `;

    await client.query(query, [
      record.execution_id,
      record.workflow_id,
      record.execution_timestamp,
      record.completion_timestamp,
      record.duration_ms || null,
      record.status,
      record.mode || 'webhook',
      this.extractNodeId(record),
      this.extractCameraId(record)
    ]);
  }

  async insertExecutionImage(record, imageInfo, client) {
    const query = `
      INSERT INTO execution_images (
        execution_id, original_path, size_bytes, format, extracted_at
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (execution_id) DO NOTHING
    `;

    await client.query(query, [
      record.execution_id,
      imageInfo.imagePath,
      imageInfo.sizeBytes,
      imageInfo.format,
      new Date()
    ]);
  }

  async insertExecutionAnalysis(record, client) {
    const query = `
      INSERT INTO execution_analysis (
        execution_id, risk_level, confidence_score, overall_assessment,
        smoke_detected, flame_detected, heat_signature_detected,
        model_version, processing_time_ms, alert_priority, response_required
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (execution_id) DO NOTHING
    `;

    await client.query(query, [
      record.execution_id,
      record.risk_level || 'none',
      parseFloat(record.confidence_score) || null,
      record.overall_assessment || null,
      record.smoke_detected || false,
      record.flame_detected || false,
      record.heat_signature_detected || false,
      record.model_version || null,
      parseInt(record.processing_time_ms) || null,
      this.mapAlertPriority(record.risk_level),
      record.response_required || false
    ]);
  }

  extractNodeId(record) {
    // Try to extract node information from execution data
    try {
      if (!record.execution_data) return null;
      
      const data = JSON.parse(record.execution_data);
      
      // Look for node_id in webhook data
      const nodeId = data?.nodeInputData?.Webhook?.[0]?.json?.node_id ||
                   data?.nodeInputData?.Webhook?.[0]?.json?.body?.node_id ||
                   null;
                   
      return nodeId;
    } catch (error) {
      return null;
    }
  }

  extractCameraId(record) {
    // Try to extract camera information from execution data
    try {
      if (!record.execution_data) return null;
      
      const data = JSON.parse(record.execution_data);
      
      // Look for camera_id in webhook data
      const cameraId = data?.nodeInputData?.Webhook?.[0]?.json?.camera_id ||
                      data?.nodeInputData?.Webhook?.[0]?.json?.body?.camera_id ||
                      null;
                      
      return cameraId;
    } catch (error) {
      return null;
    }
  }

  mapAlertPriority(riskLevel) {
    switch (riskLevel) {
      case 'critical': return 'critical';
      case 'high': return 'high';
      case 'medium': return 'medium';
      case 'low': return 'low';
      default: return 'normal';
    }
  }

  async generateReport() {
    const duration = (Date.now() - this.stats.startTime) / 1000;
    
    console.log('\n📊 Migration Report');
    console.log('==================');
    console.log(`Total records: ${this.stats.total}`);
    console.log(`Migrated: ${this.stats.migrated}`);
    console.log(`Skipped: ${this.stats.skipped}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Rate: ${(this.stats.migrated / duration).toFixed(2)} records/sec`);
    
    if (this.stats.errors > 0) {
      console.log(`\n⚠️ Migration completed with ${this.stats.errors} errors`);
      console.log('Check the logs above for error details');
    } else {
      console.log('\n✅ Migration completed successfully!');
    }

    // Verify final counts
    const finalCountQuery = 'SELECT COUNT(*) as count FROM executions';
    const finalCount = await this.saiPool.query(finalCountQuery);
    
    console.log(`\n📈 Final database count: ${finalCount.rows[0].count} records`);
  }

  async close() {
    await this.n8nPool.end();
    await this.saiPool.end();
    console.log('🔚 Database connections closed');
  }
}

// Main execution
async function main() {
  const migrator = new HistoricalDataMigrator();
  
  try {
    await migrator.initialize();
    await migrator.migrateHistoricalData();
  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  } finally {
    await migrator.close();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { HistoricalDataMigrator };