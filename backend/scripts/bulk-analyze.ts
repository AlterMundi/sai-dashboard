#!/usr/bin/env tsx
/**
 * Bulk Analysis Processing Script
 * Processes all pending analyses in the database
 */

import { db } from '../src/database/pool';
import { enhancedAnalysisService } from '../src/services/enhanced-analysis';
import { logger } from '../src/utils/logger';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function bulkAnalyze() {
  logger.info('Starting bulk analysis processing...');
  
  try {
    // Get all executions without analysis
    const query = `
      SELECT e.id::text as execution_id
      FROM execution_entity e
      JOIN workflow_entity w ON e."workflowId"::text = w.id::text
      LEFT JOIN sai_execution_analysis ea ON e.id = ea.execution_id
      WHERE w.id = 'yDbfhooKemfhMIkC'
        AND e.status IS NOT NULL
        AND e."deletedAt" IS NULL
        AND ea.execution_id IS NULL
      ORDER BY e."startedAt" DESC
    `;
    
    const results = await db.query(query);
    const pendingIds = results.map((r: any) => r.execution_id);
    
    logger.info(`Found ${pendingIds.length} executions pending analysis`);
    
    if (pendingIds.length === 0) {
      logger.info('No pending analyses found. All executions are analyzed!');
      process.exit(0);
    }
    
    let processed = 0;
    let failed = 0;
    const batchSize = 10; // Process in batches to avoid overload
    
    for (let i = 0; i < pendingIds.length; i += batchSize) {
      const batch = pendingIds.slice(i, i + batchSize);
      
      logger.info(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(pendingIds.length/batchSize)}...`);
      
      await Promise.all(
        batch.map(async (executionId: string) => {
          try {
            await enhancedAnalysisService.extractAndStoreAnalysis(executionId);
            processed++;
            
            if (processed % 100 === 0) {
              logger.info(`Progress: ${processed}/${pendingIds.length} (${Math.round(processed/pendingIds.length * 100)}%)`);
            }
          } catch (error) {
            failed++;
            logger.warn(`Failed to analyze execution ${executionId}:`, error);
          }
        })
      );
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.info('Bulk analysis completed!', {
      total: pendingIds.length,
      processed,
      failed,
      successRate: `${Math.round(processed/pendingIds.length * 100)}%`
    });
    
    // Final summary
    const summaryQuery = `
      SELECT 
        COUNT(DISTINCT e.id) as total_executions,
        COUNT(DISTINCT ea.execution_id) as analyzed,
        COUNT(DISTINCT e.id) - COUNT(DISTINCT ea.execution_id) as remaining
      FROM execution_entity e
      JOIN workflow_entity w ON e."workflowId"::text = w.id::text
      LEFT JOIN sai_execution_analysis ea ON e.id = ea.execution_id
      WHERE w.id = 'yDbfhooKemfhMIkC'
        AND e.status IS NOT NULL
        AND e."deletedAt" IS NULL
    `;
    
    const summary = await db.query(summaryQuery);
    logger.info('Final database status:', summary[0]);
    
  } catch (error) {
    logger.error('Bulk analysis failed:', error);
    process.exit(1);
  } finally {
    await db.end();
    process.exit(0);
  }
}

// Run the script
bulkAnalyze().catch(error => {
  logger.error('Script error:', error);
  process.exit(1);
});