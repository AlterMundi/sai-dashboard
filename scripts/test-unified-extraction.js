#!/usr/bin/env node

/**
 * Test Unified Image Extraction
 * Fix the extraction logic to work with the actual n8n data structure
 */

const { Pool } = require('pg');

class UnifiedExtractionTester {
  constructor() {
    this.n8nPool = new Pool({
      host: process.env.N8N_DB_HOST || 'localhost',
      port: parseInt(process.env.N8N_DB_PORT || '5432'),
      database: process.env.N8N_DB_NAME || 'n8n',
      user: process.env.N8N_DB_USER || 'n8n_user',
      password: process.env.N8N_DB_PASSWORD || 'a5sd87akdVDS5',
      max: 3,
    });
  }

  async testUnifiedExtraction() {
    console.log('🔄 Testing Unified Image Extraction Logic\n');
    
    // Test recent execution
    console.log('=== RECENT EXECUTION TEST ===');
    const recentResult = await this.n8nPool.query(`
      SELECT ee.id, ee."startedAt", ed.data
      FROM execution_entity ee 
      JOIN execution_data ed ON ee.id = ed."executionId"
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC' 
        AND ee."startedAt" > NOW() - INTERVAL '2 hours'
      ORDER BY ee."startedAt" DESC 
      LIMIT 1
    `);

    if (recentResult.rows.length > 0) {
      await this.testExtractionLogic('RECENT', recentResult.rows[0]);
    }

    // Test historical execution
    console.log('\n=== HISTORICAL EXECUTION TEST ===');
    const historicalResult = await this.n8nPool.query(`
      SELECT ee.id, ee."startedAt", ed.data
      FROM execution_entity ee 
      JOIN execution_data ed ON ee.id = ed."executionId"
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC' 
        AND ee."startedAt" < '2025-09-01'
      ORDER BY ee."startedAt" DESC 
      LIMIT 1
    `);

    if (historicalResult.rows.length > 0) {
      await this.testExtractionLogic('HISTORICAL', historicalResult.rows[0]);
    }
  }

  async testExtractionLogic(type, row) {
    const { id, data } = row;
    console.log(`📊 Testing extraction for ${type} execution ${id}`);
    
    try {
      const parsed = JSON.parse(data);
      
      // NEW UNIFIED EXTRACTION LOGIC
      const extractedData = this.extractExecutionData(parsed);
      
      console.log(`📷 Image found: ${extractedData.imageBase64 ? 'YES' : 'NO'}`);
      if (extractedData.imageBase64) {
        console.log(`📏 Image size: ${extractedData.imageBase64.length} characters`);
        console.log(`📋 Image header: ${extractedData.imageBase64.substring(0, 30)}...`);
      }
      
      console.log(`🤖 Analysis found: ${extractedData.analysis ? 'YES' : 'NO'}`);
      if (extractedData.analysis) {
        console.log(`📏 Analysis length: ${extractedData.analysis.length} characters`);
        console.log(`📋 Analysis preview: ${extractedData.analysis.substring(0, 100)}...`);
      }
      
      console.log(`📱 Telegram status: ${extractedData.telegramStatus ? 'SUCCESS' : 'NOT FOUND'}`);
      
    } catch (error) {
      console.error(`❌ Failed to test extraction for ${type}:`, error.message);
    }
    
    console.log('\n' + '='.repeat(50));
  }

  /**
   * UNIFIED extraction logic that works with actual n8n data structure
   */
  extractExecutionData(data) {
    let imageBase64 = null;
    let analysis = null;
    let telegramStatus = false;

    // The data is stored as a flat array with numeric keys
    // We need to search through all entries to find the data we need
    
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
          // This might be analysis text
          if (entry.includes('risk') || entry.includes('fire') || entry.includes('smoke')) {
            analysis = entry;
          }
        } else if (typeof entry === 'object' && entry !== null) {
          // Recursively search nested objects
          const nested = this.extractExecutionData(entry);
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
      telegramStatus,
      rawData: data
    };
  }

  async close() {
    await this.n8nPool.end();
  }
}

async function main() {
  const tester = new UnifiedExtractionTester();
  
  try {
    await tester.testUnifiedExtraction();
  } catch (error) {
    console.error('💥 Test failed:', error);
  } finally {
    await tester.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}