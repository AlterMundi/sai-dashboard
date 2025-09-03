#!/usr/bin/env tsx

/**
 * Test ETL Service Connection and Setup
 * Quick validation without running the full service
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../../.env') });

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

async function testN8NConnection() {
  console.log('🔍 Testing n8n database connection...');
  const pool = new Pool(config.n8nDb);

  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ n8n database connection successful');

    // Check for SAI workflow
    const workflowCheck = await pool.query(`
      SELECT id, name, active 
      FROM workflow_entity 
      WHERE name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
    `);

    if (workflowCheck.rows.length > 0) {
      const workflow = workflowCheck.rows[0];
      console.log(`✅ SAI workflow found: ${workflow.id} (active: ${workflow.active})`);

      // Count recent executions
      const executionCount = await pool.query(`
        SELECT COUNT(*) as count 
        FROM execution_entity ee
        WHERE ee."workflowId" = $1
        AND ee."startedAt" > NOW() - INTERVAL '7 days'
      `, [workflow.id]);

      console.log(`📊 Recent executions (last 7 days): ${executionCount.rows[0].count}`);
    } else {
      console.warn('⚠️ SAI workflow not found');
    }

  } catch (error) {
    console.error('❌ n8n database connection failed:', error);
    return false;
  } finally {
    await pool.end();
  }

  return true;
}

async function testDashboardConnection() {
  console.log('\n🔍 Testing sai_dashboard database connection...');
  
  // First try to connect to postgres database to check if sai_dashboard exists
  const adminPool = new Pool({
    ...config.dashboardDb,
    database: 'postgres'
  });

  try {
    const dbCheck = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = 'sai_dashboard'"
    );

    if (dbCheck.rows.length === 0) {
      console.log('ℹ️ sai_dashboard database does not exist, will be created during initialization');
      return true;
    }

    console.log('✅ sai_dashboard database exists');
  } catch (error) {
    console.error('❌ Failed to check database existence:', error);
    return false;
  } finally {
    await adminPool.end();
  }

  // Test connection to sai_dashboard
  const dashboardPool = new Pool(config.dashboardDb);
  
  try {
    await dashboardPool.query('SELECT NOW()');
    console.log('✅ sai_dashboard database connection successful');

    // Check if tables exist
    const tableCheck = await dashboardPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('executions', 'execution_images', 'execution_analysis')
      ORDER BY table_name
    `);

    console.log(`📋 Found tables: ${tableCheck.rows.map(r => r.table_name).join(', ')}`);

    if (tableCheck.rows.length > 0) {
      // Count existing data
      const dataCount = await dashboardPool.query('SELECT COUNT(*) as count FROM executions');
      console.log(`📊 Existing executions in dashboard: ${dataCount.rows[0].count}`);
    }

  } catch (error) {
    console.log('ℹ️ sai_dashboard tables not yet created (will be initialized)');
  } finally {
    await dashboardPool.end();
  }

  return true;
}

async function testImageDirectory() {
  console.log('\n🔍 Testing image cache directory...');
  
  const imagePath = process.env.CACHE_PATH || '/mnt/raid1/n8n/backup/images';
  
  try {
    const fs = await import('fs/promises');
    const stats = await fs.stat(imagePath);
    
    if (stats.isDirectory()) {
      console.log(`✅ Image cache directory exists: ${imagePath}`);
      
      // Check if writable
      const testDir = path.join(imagePath, 'test-write');
      try {
        await fs.mkdir(testDir, { recursive: true });
        await fs.rmdir(testDir);
        console.log('✅ Image cache directory is writable');
      } catch (error) {
        console.warn('⚠️ Image cache directory may not be writable:', error);
      }
      
      return true;
    }
  } catch (error) {
    console.error(`❌ Image cache directory issue: ${imagePath}`, error);
    return false;
  }

  return false;
}

async function main() {
  console.log('============================================');
  console.log('   SAI Dashboard - ETL Service Test');
  console.log('============================================\n');

  console.log('Configuration:');
  console.log(`📝 n8n DB: ${config.n8nDb.host}:${config.n8nDb.port}/${config.n8nDb.database}`);
  console.log(`📝 Dashboard DB: ${config.dashboardDb.host}:${config.dashboardDb.port}/${config.dashboardDb.database}`);
  console.log(`📁 Image Cache: ${process.env.CACHE_PATH || '/mnt/raid1/n8n/backup/images'}\n`);

  let allTestsPassed = true;

  // Test connections
  if (!await testN8NConnection()) {
    allTestsPassed = false;
  }

  if (!await testDashboardConnection()) {
    allTestsPassed = false;
  }

  if (!await testImageDirectory()) {
    allTestsPassed = false;
  }

  console.log('\n============================================');
  if (allTestsPassed) {
    console.log('✅ All tests passed! ETL service is ready to initialize.');
    console.log('\nNext steps:');
    console.log('1. Run: npm run etl:init');
    console.log('2. Or start with API: ENABLE_ETL_SERVICE=true npm run dev');
  } else {
    console.log('❌ Some tests failed. Check the issues above before initializing ETL service.');
  }
  console.log('============================================');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});