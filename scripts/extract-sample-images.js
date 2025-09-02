#!/usr/bin/env node

/**
 * Script to extract sample base64 images from n8n database
 * and analyze their actual sizes
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000
});

async function extractSampleImages() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Fetching sample executions from SAI workflow...\n');
    
    // Query for recent successful executions
    const executionsQuery = `
      SELECT 
        e.id,
        e."startedAt",
        e.status,
        ed.data
      FROM execution_entity e
      JOIN execution_data ed ON e.id = ed."executionId"
      JOIN workflow_entity w ON e."workflowId" = w.id
      WHERE w.id = 'yDbfhooKemfhMIkC'
        AND e.status = 'success'
        AND e."deletedAt" IS NULL
        AND e."startedAt" > NOW() - INTERVAL '7 days'
      ORDER BY e."startedAt" DESC
      LIMIT 10
    `;
    
    console.log('Executing query for last 10 successful executions...');
    const result = await client.query(executionsQuery);
    
    if (result.rows.length === 0) {
      console.log('❌ No recent executions found');
      return;
    }
    
    console.log(`✅ Found ${result.rows.length} executions\n`);
    
    // Create output directory
    const outputDir = path.join(__dirname, '../data/sample-images');
    await fs.mkdir(outputDir, { recursive: true });
    
    const imageStats = [];
    let successCount = 0;
    
    for (const row of result.rows) {
      try {
        console.log(`\n📊 Processing execution ${row.id} (${new Date(row.startedAt).toISOString()})`);
        
        // Parse execution data
        const executionData = JSON.parse(row.data);
        
        // Look for base64 images in multiple possible locations
        let base64Image = null;
        let imageSource = null;
        
        // Check webhook input
        if (executionData.nodeInputData?.Webhook?.[0]?.json?.body?.image) {
          base64Image = executionData.nodeInputData.Webhook[0].json.body.image;
          imageSource = 'Webhook input body';
        }
        // Check direct webhook data
        else if (executionData.nodeInputData?.Webhook?.[0]?.json?.image) {
          base64Image = executionData.nodeInputData.Webhook[0].json.image;
          imageSource = 'Webhook input direct';
        }
        // Check Ollama input
        else if (executionData.nodeInputData?.Ollama?.[0]?.json?.image) {
          base64Image = executionData.nodeInputData.Ollama[0].json.image;
          imageSource = 'Ollama input';
        }
        // Check for base64 in any node output
        else {
          const dataStr = JSON.stringify(executionData);
          const base64Match = dataStr.match(/data:image\/(jpeg|png|jpg);base64,([A-Za-z0-9+/=]+)/);
          if (base64Match) {
            base64Image = base64Match[2];
            imageSource = 'Extracted from data URL';
          }
        }
        
        if (!base64Image) {
          console.log('  ⚠️  No image found in execution data');
          
          // Log available node data for debugging
          console.log('  Available nodes:', Object.keys(executionData.nodeInputData || {}));
          continue;
        }
        
        // Clean base64 string (remove data URL prefix if present)
        base64Image = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
        
        // Calculate sizes
        const base64Size = base64Image.length;
        const estimatedBinarySize = Math.floor(base64Size * 0.75); // Base64 is ~33% larger
        
        // Convert to buffer
        const imageBuffer = Buffer.from(base64Image, 'base64');
        const actualBinarySize = imageBuffer.length;
        
        // Get image metadata using sharp
        let imageMetadata = {};
        try {
          imageMetadata = await sharp(imageBuffer).metadata();
        } catch (err) {
          console.log('  ⚠️  Could not extract image metadata:', err.message);
        }
        
        // Save sample image
        const imagePath = path.join(outputDir, `execution_${row.id}.jpg`);
        await fs.writeFile(imagePath, imageBuffer);
        
        // Collect statistics
        const stats = {
          executionId: row.id,
          timestamp: row.startedAt,
          source: imageSource,
          base64Length: base64Size,
          base64SizeKB: Math.round(base64Size / 1024),
          binarySize: actualBinarySize,
          binarySizeKB: Math.round(actualBinarySize / 1024),
          format: imageMetadata.format || 'unknown',
          width: imageMetadata.width || 0,
          height: imageMetadata.height || 0,
          channels: imageMetadata.channels || 0,
          density: imageMetadata.density || 0,
          compressionRatio: base64Size / actualBinarySize,
          totalPayloadSize: row.data.length,
          totalPayloadKB: Math.round(row.data.length / 1024)
        };
        
        imageStats.push(stats);
        successCount++;
        
        console.log(`  ✅ Image extracted from: ${imageSource}`);
        console.log(`  📏 Base64 size: ${stats.base64SizeKB} KB (${base64Size.toLocaleString()} chars)`);
        console.log(`  📦 Binary size: ${stats.binarySizeKB} KB (${actualBinarySize.toLocaleString()} bytes)`);
        console.log(`  🖼️  Dimensions: ${stats.width}x${stats.height} (${stats.format})`);
        console.log(`  💾 Total payload: ${stats.totalPayloadKB} KB`);
        console.log(`  📁 Saved to: ${path.basename(imagePath)}`);
        
      } catch (error) {
        console.error(`  ❌ Error processing execution ${row.id}:`, error.message);
      }
    }
    
    // Calculate summary statistics
    if (imageStats.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('📊 SUMMARY STATISTICS');
      console.log('='.repeat(80));
      
      const avgBase64KB = Math.round(imageStats.reduce((sum, s) => sum + s.base64SizeKB, 0) / imageStats.length);
      const avgBinaryKB = Math.round(imageStats.reduce((sum, s) => sum + s.binarySizeKB, 0) / imageStats.length);
      const avgPayloadKB = Math.round(imageStats.reduce((sum, s) => sum + s.totalPayloadKB, 0) / imageStats.length);
      
      const minBase64KB = Math.min(...imageStats.map(s => s.base64SizeKB));
      const maxBase64KB = Math.max(...imageStats.map(s => s.base64SizeKB));
      
      const minBinaryKB = Math.min(...imageStats.map(s => s.binarySizeKB));
      const maxBinaryKB = Math.max(...imageStats.map(s => s.binarySizeKB));
      
      console.log(`\n✅ Successfully extracted ${successCount} images from ${result.rows.length} executions`);
      console.log(`\n📏 Base64 Image Sizes:`);
      console.log(`  • Average: ${avgBase64KB} KB`);
      console.log(`  • Range: ${minBase64KB} KB - ${maxBase64KB} KB`);
      
      console.log(`\n📦 Binary Image Sizes:`);
      console.log(`  • Average: ${avgBinaryKB} KB`);
      console.log(`  • Range: ${minBinaryKB} KB - ${maxBinaryKB} KB`);
      
      console.log(`\n💾 Total Payload Sizes:`);
      console.log(`  • Average: ${avgPayloadKB} KB per execution`);
      console.log(`  • Image portion: ${Math.round((avgBase64KB / avgPayloadKB) * 100)}% of payload`);
      
      console.log(`\n🖼️  Image Formats:`);
      const formats = {};
      imageStats.forEach(s => {
        formats[s.format] = (formats[s.format] || 0) + 1;
      });
      Object.entries(formats).forEach(([format, count]) => {
        console.log(`  • ${format}: ${count} images`);
      });
      
      console.log(`\n📐 Image Dimensions:`);
      const avgWidth = Math.round(imageStats.reduce((sum, s) => sum + s.width, 0) / imageStats.length);
      const avgHeight = Math.round(imageStats.reduce((sum, s) => sum + s.height, 0) / imageStats.length);
      console.log(`  • Average: ${avgWidth}x${avgHeight} pixels`);
      
      // Save detailed stats to JSON
      const statsPath = path.join(outputDir, 'image-stats.json');
      await fs.writeFile(statsPath, JSON.stringify(imageStats, null, 2));
      console.log(`\n📄 Detailed stats saved to: ${statsPath}`);
      
      // Memory impact analysis
      console.log('\n' + '='.repeat(80));
      console.log('💭 MEMORY IMPACT ANALYSIS');
      console.log('='.repeat(80));
      
      console.log('\nPer-image memory usage (without optimization):');
      console.log(`  • Base64 string in memory: ~${avgBase64KB} KB`);
      console.log(`  • JSON parsing overhead: ~${Math.round(avgPayloadKB * 1.5)} KB`);
      console.log(`  • Buffer conversion: ~${avgBinaryKB} KB`);
      console.log(`  • Total per request: ~${avgBase64KB + avgPayloadKB + avgBinaryKB} KB`);
      
      console.log('\nWith 50 concurrent users viewing images:');
      const concurrentMemory = (avgBase64KB + avgPayloadKB + avgBinaryKB) * 50;
      console.log(`  • Memory usage: ~${Math.round(concurrentMemory / 1024)} MB`);
      
      console.log('\nOptimization potential:');
      console.log(`  • Direct filesystem serving: ${avgBinaryKB} KB (${Math.round((1 - avgBinaryKB/avgBase64KB) * 100)}% reduction)`);
      console.log(`  • Thumbnail generation (200x200): ~15-25 KB (95% reduction)`);
      console.log(`  • WebP conversion: ~${Math.round(avgBinaryKB * 0.7)} KB (30% further reduction)`);
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the extraction
extractSampleImages().catch(console.error);