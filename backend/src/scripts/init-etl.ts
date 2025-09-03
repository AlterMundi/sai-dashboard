#!/usr/bin/env tsx

/**
 * Initialize Live ETL Pipeline
 * Sets up database, starts ETL service, and monitors incoming data
 */

import { createLiveETLService } from '../services/live-etl-service';
import { Pool } from 'pg';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// Configuration
const config = {
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
    user: process.env.SAI_DB_USER || 'postgres',
    password: process.env.SAI_DB_PASSWORD || 'postgres'
  }
};

/**
 * Create sai_dashboard database if it doesn't exist
 */
async function createDatabaseIfNotExists() {
  const adminPool = new Pool({
    host: config.dashboardDb.host,
    port: config.dashboardDb.port,
    database: 'postgres', // Connect to postgres database to create new database
    user: config.dashboardDb.user,
    password: config.dashboardDb.password
  });

  try {
    // Check if database exists
    const result = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = 'sai_dashboard'"
    );

    if (result.rows.length === 0) {
      console.log('📦 Creating sai_dashboard database...');
      await adminPool.query('CREATE DATABASE sai_dashboard');
      console.log('✅ Database created successfully');
    } else {
      console.log('✅ Database sai_dashboard already exists');
    }
  } catch (error) {
    console.error('❌ Failed to create database:', error);
    throw error;
  } finally {
    await adminPool.end();
  }
}

/**
 * Initialize database schema
 */
async function initializeSchema() {
  const pool = new Pool(config.dashboardDb);

  try {
    console.log('🔧 Initializing database schema...');
    
    // Read schema file
    const schemaPath = path.join(__dirname, '../../../database/sai_dashboard_schema.sql');
    let schemaSql = await fs.readFile(schemaPath, 'utf-8');
    
    // Remove CREATE DATABASE statements as we've already created it
    schemaSql = schemaSql
      .replace(/CREATE DATABASE.*?;/gi, '')
      .replace(/USE.*?;/gi, '');

    // Split by semicolon and execute each statement
    const statements = schemaSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      try {
        await pool.query(statement + ';');
      } catch (error: any) {
        // Ignore "already exists" errors
        if (!error.message.includes('already exists')) {
          console.error('Failed to execute statement:', statement.substring(0, 50) + '...');
          console.error(error.message);
        }
      }
    }

    // Create data quality log table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS data_quality_logs (
        id SERIAL PRIMARY KEY,
        execution_id BIGINT,
        errors JSONB,
        warnings JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ Database schema initialized');
  } catch (error) {
    console.error('❌ Failed to initialize schema:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Test database connections
 */
async function testConnections() {
  console.log('\n🔍 Testing database connections...');

  // Test n8n connection
  const n8nPool = new Pool(config.n8nDb);
  try {
    const result = await n8nPool.query(`
      SELECT COUNT(*) as count 
      FROM execution_entity ee
      JOIN workflow_entity we ON ee."workflowId" = we.id
      WHERE we.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
      AND ee."startedAt" > NOW() - INTERVAL '30 days'
    `);
    console.log(`✅ n8n database connected - Found ${result.rows[0].count} SAI executions in last 30 days`);
  } catch (error) {
    console.error('❌ Failed to connect to n8n database:', error);
    throw error;
  } finally {
    await n8nPool.end();
  }

  // Test dashboard connection
  const dashboardPool = new Pool(config.dashboardDb);
  try {
    const result = await dashboardPool.query('SELECT COUNT(*) as count FROM executions');
    console.log(`✅ sai_dashboard database connected - Currently ${result.rows[0].count} executions stored`);
  } catch (error) {
    console.error('❌ Failed to connect to sai_dashboard database:', error);
    throw error;
  } finally {
    await dashboardPool.end();
  }
}

/**
 * Start the ETL service
 */
async function startETLService() {
  console.log('\n🚀 Starting Live ETL Service...\n');

  const etlService = createLiveETLService({
    n8nDb: config.n8nDb,
    dashboardDb: config.dashboardDb
  });

  // Set up event listeners
  etlService.on('processed', ({ executionId, timestamp }) => {
    console.log(`✅ [${timestamp.toISOString()}] Processed execution ${executionId}`);
  });

  etlService.on('validationError', ({ executionId, errors }) => {
    console.warn(`⚠️ Validation errors for execution ${executionId}:`, errors);
  });

  etlService.on('error', ({ executionId, error }) => {
    console.error(`❌ Error processing execution ${executionId}:`, error);
  });

  // Start the service
  await etlService.start();

  // Print metrics every 30 seconds
  setInterval(() => {
    const metrics = etlService.getMetrics();
    console.log('\n📊 ETL Metrics:', {
      processed: metrics.processed,
      failed: metrics.failed,
      skipped: metrics.skipped,
      validationErrors: metrics.validationErrors,
      lastProcessed: metrics.lastProcessedAt?.toISOString() || 'None'
    });
  }, 30000);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down ETL service...');
    await etlService.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down ETL service...');
    await etlService.stop();
    process.exit(0);
  });

  console.log('\n✨ ETL Service is running. Press Ctrl+C to stop.\n');
  console.log('Waiting for new executions from n8n...\n');
}

/**
 * Main initialization function
 */
async function main() {
  console.log('============================================');
  console.log('   SAI Dashboard - Live ETL Initialization');
  console.log('============================================\n');

  try {
    // Step 1: Create database if needed
    await createDatabaseIfNotExists();

    // Step 2: Initialize schema
    await initializeSchema();

    // Step 3: Test connections
    await testConnections();

    // Step 4: Start ETL service
    await startETLService();

  } catch (error) {
    console.error('\n❌ Initialization failed:', error);
    process.exit(1);
  }
}

// Run initialization
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});