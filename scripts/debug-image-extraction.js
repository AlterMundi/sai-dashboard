#!/usr/bin/env node

/**
 * Debug Image Extraction - Parallel Analysis
 * Compare new vs historical execution data structures to validate convergence
 */

const { Pool } = require('pg');

class ImageExtractionDebugger {
  constructor() {
    this.n8nPool = new Pool({
      host: process.env.N8N_DB_HOST || 'localhost',
      port: parseInt(process.env.N8N_DB_PORT || '5432'),
      database: process.env.N8N_DB_NAME || 'n8n',
      user: process.env.N8N_DB_USER || 'n8n_user',
      password: process.env.N8N_DB_PASSWORD || 'REDACTED',
      max: 3,
    });
  }

  async debugBothExtractionPaths() {
    console.log('🔍 Parallel Image Extraction Debugging\n');
    
    // Get recent execution (new ETL path)
    console.log('=== RECENT EXECUTION (NEW ETL) ===');
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
      await this.analyzeExecutionData('RECENT', recentResult.rows[0]);
    } else {
      console.log('❌ No recent executions found');
    }

    console.log('\n=== HISTORICAL EXECUTION ===');
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
      await this.analyzeExecutionData('HISTORICAL', historicalResult.rows[0]);
    } else {
      console.log('❌ No historical executions found');
    }
  }

  async analyzeExecutionData(type, row) {
    const { id, startedAt, data } = row;
    console.log(`📊 Execution ${id} (${startedAt})`);
    console.log(`📦 Data size: ${JSON.stringify(data).length} characters`);
    
    try {
      const parsed = JSON.parse(data);
      console.log(`🔑 Top-level keys: ${Object.keys(parsed).join(', ')}`);
      
      // Debug current extraction paths
      console.log('\n🛠️ Testing Current Extraction Logic:');
      
      // Path 1: Webhook image
      const webhookImage = parsed?.nodeInputData?.Webhook?.[0]?.json?.body?.image;
      console.log(`📷 Webhook image path: ${webhookImage ? `Found (${webhookImage.length} chars)` : 'Not found'}`);
      
      // Path 2: Ollama image
      const ollamaImage = parsed?.nodeInputData?.Ollama?.[0]?.json?.image;
      console.log(`📷 Ollama image path: ${ollamaImage ? `Found (${ollamaImage.length} chars)` : 'Not found'}`);
      
      // Path 3: Analysis response
      const analysis = parsed?.nodeOutputData?.Ollama?.[0]?.json?.response;
      console.log(`🤖 Analysis response: ${analysis ? `Found (${analysis.length} chars)` : 'Not found'}`);
      
      // Path 4: Telegram status
      const telegramStatus = parsed?.nodeOutputData?.Telegram?.[0]?.json?.success;
      console.log(`📱 Telegram status: ${telegramStatus || 'Not found'}`);

      // Deep structure exploration
      console.log('\n🔬 Deep Structure Analysis:');
      
      if (parsed.nodeInputData) {
        console.log(`📥 NodeInputData keys: ${Object.keys(parsed.nodeInputData).join(', ')}`);
        
        if (parsed.nodeInputData.Webhook) {
          console.log(`📥 Webhook entries: ${parsed.nodeInputData.Webhook.length}`);
          if (parsed.nodeInputData.Webhook[0]?.json) {
            const webhookKeys = Object.keys(parsed.nodeInputData.Webhook[0].json);
            console.log(`📥 Webhook json keys: ${webhookKeys.join(', ')}`);
            
            if (parsed.nodeInputData.Webhook[0].json.body) {
              const bodyKeys = Object.keys(parsed.nodeInputData.Webhook[0].json.body);
              console.log(`📥 Webhook body keys: ${bodyKeys.join(', ')}`);
            }
          }
        }
      }
      
      if (parsed.nodeOutputData) {
        console.log(`📤 NodeOutputData keys: ${Object.keys(parsed.nodeOutputData).join(', ')}`);
        
        if (parsed.nodeOutputData.Ollama) {
          console.log(`📤 Ollama entries: ${parsed.nodeOutputData.Ollama.length}`);
          if (parsed.nodeOutputData.Ollama[0]?.json) {
            const ollamaKeys = Object.keys(parsed.nodeOutputData.Ollama[0].json);
            console.log(`📤 Ollama json keys: ${ollamaKeys.join(', ')}`);
          }
        }

        if (parsed.nodeOutputData.Telegram) {
          console.log(`📤 Telegram entries: ${parsed.nodeOutputData.Telegram.length}`);
          if (parsed.nodeOutputData.Telegram[0]?.json) {
            const telegramKeys = Object.keys(parsed.nodeOutputData.Telegram[0].json);
            console.log(`📤 Telegram json keys: ${telegramKeys.join(', ')}`);
          }
        }
      }

      // Look for alternative image paths
      console.log('\n🔍 Alternative Image Path Search:');
      this.searchForBase64Images(parsed, '', 0, 3);

    } catch (error) {
      console.error(`❌ Failed to parse JSON for ${type} execution ${id}:`, error.message);
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
  }

  searchForBase64Images(obj, path = '', depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return;
    
    if (typeof obj === 'string' && obj.length > 1000 && this.looksLikeBase64Image(obj)) {
      console.log(`🖼️ Found potential image at: ${path} (${obj.length} chars)`);
      console.log(`🖼️ Image header: ${obj.substring(0, 50)}...`);
      return;
    }
    
    if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        const newPath = path ? `${path}.${key}` : key;
        this.searchForBase64Images(value, newPath, depth + 1, maxDepth);
      }
    }
    
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        const newPath = `${path}[${index}]`;
        this.searchForBase64Images(item, newPath, depth + 1, maxDepth);
      });
    }
  }

  looksLikeBase64Image(str) {
    // Check if it looks like base64 encoded image data
    return /^[A-Za-z0-9+/]{1000,}={0,2}$/.test(str) || 
           str.startsWith('/9j/') || // JPEG header in base64
           str.startsWith('iVBORw0KGgo'); // PNG header in base64
  }

  async close() {
    await this.n8nPool.end();
  }
}

async function main() {
  const analyzer = new ImageExtractionDebugger();
  
  try {
    await analyzer.debugBothExtractionPaths();
  } catch (error) {
    console.error('💥 Debug failed:', error);
  } finally {
    await analyzer.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}