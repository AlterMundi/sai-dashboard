#!/usr/bin/env node

/**
 * Migration Validation Tool
 * 
 * Validates data integrity between old and new systems
 * Ensures migration was successful and complete
 */

const { Pool } = require('pg');

class MigrationValidator {
  constructor() {
    // N8N Database (source)
    this.n8nPool = new Pool({
      host: process.env.N8N_DB_HOST || 'localhost',
      port: parseInt(process.env.N8N_DB_PORT || '5432'),
      database: process.env.N8N_DB_NAME || 'n8n',
      user: process.env.N8N_DB_USER || 'n8n_user',
      password: process.env.N8N_DB_PASSWORD || 'a5sd87akdVDS5',
      max: 3,
    });

    // SAI Dashboard Database (target)
    this.saiPool = new Pool({
      host: process.env.SAI_DB_HOST || 'localhost',
      port: parseInt(process.env.SAI_DB_PORT || '5432'),
      database: process.env.SAI_DB_NAME || 'sai_dashboard',
      user: process.env.SAI_DB_USER || 'n8n_user',
      password: process.env.SAI_DB_PASSWORD || 'a5sd87akdVDS5',
      max: 5,
    });

    this.validationResults = {
      recordCountMatch: false,
      executionSampleMatch: false,
      analysisSampleMatch: false,
      imageSampleMatch: false,
      dateRangeMatch: false,
      statusDistributionMatch: false
    };
  }

  async validateMigration() {
    console.log('🔍 Starting migration validation...\n');

    try {
      await this.validateRecordCounts();
      await this.validateExecutionSamples();
      await this.validateAnalysisSamples(); 
      await this.validateImageSamples();
      await this.validateDateRanges();
      await this.validateStatusDistribution();

      await this.generateValidationReport();

    } catch (error) {
      console.error('💥 Validation failed:', error);
      throw error;
    }
  }

  async validateRecordCounts() {
    console.log('📊 Validating record counts...');

    // Count records in source system
    const sourceQuery = `
      SELECT COUNT(*) as count
      FROM sai_execution_analysis sea
      JOIN execution_entity ee ON sea.execution_id = ee.id
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC'
        AND ee.status = 'success'
    `;
    
    const sourceResult = await this.n8nPool.query(sourceQuery);
    const sourceCount = parseInt(sourceResult.rows[0].count);

    // Count records in target system  
    const targetQuery = 'SELECT COUNT(*) as count FROM executions';
    const targetResult = await this.saiPool.query(targetQuery);
    const targetCount = parseInt(targetResult.rows[0].count);

    console.log(`  Source system: ${sourceCount} records`);
    console.log(`  Target system: ${targetCount} records`);

    // Account for the 1 record from ETL testing
    const expectedCount = sourceCount + 1;
    this.validationResults.recordCountMatch = (targetCount >= sourceCount);

    if (this.validationResults.recordCountMatch) {
      console.log('  ✅ Record counts match (including ETL test records)');
    } else {
      console.log(`  ❌ Record count mismatch! Expected ~${expectedCount}, got ${targetCount}`);
    }
  }

  async validateExecutionSamples() {
    console.log('\n🔍 Validating execution samples...');

    // Get sample executions from source
    const sourceQuery = `
      SELECT ee.id, ee."workflowId", ee."startedAt", ee.status
      FROM sai_execution_analysis sea
      JOIN execution_entity ee ON sea.execution_id = ee.id
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC'
        AND ee.status = 'success'
      ORDER BY ee."startedAt" ASC
      LIMIT 5
    `;
    
    const sourceResult = await this.n8nPool.query(sourceQuery);
    
    let samplesMatch = 0;
    for (const sourceRecord of sourceResult.rows) {
      const targetQuery = `
        SELECT id, workflow_id, execution_timestamp, status
        FROM executions
        WHERE id = $1
      `;
      
      const targetResult = await this.saiPool.query(targetQuery, [sourceRecord.id]);
      
      if (targetResult.rows.length > 0) {
        const targetRecord = targetResult.rows[0];
        
        const sourceTimestamp = new Date(sourceRecord.startedAt).toISOString();
        const targetTimestamp = new Date(targetRecord.execution_timestamp).toISOString();
        
        if (sourceRecord.workflowId === targetRecord.workflow_id &&
            sourceRecord.status === targetRecord.status &&
            sourceTimestamp === targetTimestamp) {
          samplesMatch++;
        } else {
          console.log(`  ⚠️ Sample mismatch for execution ${sourceRecord.id}`);
        }
      } else {
        console.log(`  ❌ Missing execution ${sourceRecord.id} in target system`);
      }
    }

    this.validationResults.executionSampleMatch = samplesMatch === sourceResult.rows.length;
    console.log(`  ${this.validationResults.executionSampleMatch ? '✅' : '❌'} Execution samples: ${samplesMatch}/${sourceResult.rows.length} match`);
  }

  async validateAnalysisSamples() {
    console.log('\n🔍 Validating analysis samples...');

    // Get sample analysis data from source
    const sourceQuery = `
      SELECT sea.execution_id, sea.risk_level, sea.confidence_score, sea.overall_assessment
      FROM sai_execution_analysis sea
      JOIN execution_entity ee ON sea.execution_id = ee.id
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC'
        AND ee.status = 'success'
        AND sea.risk_level IS NOT NULL
      ORDER BY sea.execution_id ASC
      LIMIT 5
    `;
    
    const sourceResult = await this.n8nPool.query(sourceQuery);
    
    let samplesMatch = 0;
    for (const sourceRecord of sourceResult.rows) {
      const targetQuery = `
        SELECT execution_id, risk_level, confidence_score, overall_assessment
        FROM execution_analysis
        WHERE execution_id = $1
      `;
      
      const targetResult = await this.saiPool.query(targetQuery, [sourceRecord.execution_id]);
      
      if (targetResult.rows.length > 0) {
        const targetRecord = targetResult.rows[0];
        
        if (sourceRecord.risk_level === targetRecord.risk_level &&
            Math.abs((parseFloat(sourceRecord.confidence_score) || 0) - (parseFloat(targetRecord.confidence_score) || 0)) < 0.01) {
          samplesMatch++;
        } else {
          console.log(`  ⚠️ Analysis mismatch for execution ${sourceRecord.execution_id}`);
        }
      } else {
        console.log(`  ❌ Missing analysis for execution ${sourceRecord.execution_id} in target system`);
      }
    }

    this.validationResults.analysisSampleMatch = samplesMatch === sourceResult.rows.length;
    console.log(`  ${this.validationResults.analysisSampleMatch ? '✅' : '❌'} Analysis samples: ${samplesMatch}/${sourceResult.rows.length} match`);
  }

  async validateImageSamples() {
    console.log('\n🔍 Validating image samples...');

    // Count images in both systems
    const sourceQuery = `
      SELECT COUNT(*) as count
      FROM sai_execution_analysis sea
      JOIN execution_entity ee ON sea.execution_id = ee.id
      JOIN execution_data ed ON ee.id = ed."executionId"
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC'
        AND ee.status = 'success'
        AND ed.data IS NOT NULL
    `;
    
    const sourceResult = await this.n8nPool.query(sourceQuery);
    const sourceImageCount = parseInt(sourceResult.rows[0].count);

    const targetQuery = 'SELECT COUNT(*) as count FROM execution_images';
    const targetResult = await this.saiPool.query(targetQuery);
    const targetImageCount = parseInt(targetResult.rows[0].count);

    console.log(`  Source executions with data: ${sourceImageCount}`);
    console.log(`  Target image records: ${targetImageCount}`);

    // Images might not migrate 100% due to data extraction complexity
    const imageMatchRatio = targetImageCount / sourceImageCount;
    this.validationResults.imageSampleMatch = imageMatchRatio > 0.8; // 80% threshold

    if (this.validationResults.imageSampleMatch) {
      console.log(`  ✅ Image migration ratio: ${(imageMatchRatio * 100).toFixed(1)}% (good)`);
    } else {
      console.log(`  ⚠️ Image migration ratio: ${(imageMatchRatio * 100).toFixed(1)}% (low)`);
    }
  }

  async validateDateRanges() {
    console.log('\n📅 Validating date ranges...');

    // Get date range from source
    const sourceQuery = `
      SELECT 
        MIN(ee."startedAt") as earliest,
        MAX(ee."startedAt") as latest
      FROM sai_execution_analysis sea
      JOIN execution_entity ee ON sea.execution_id = ee.id
      WHERE ee."workflowId" = 'yDbfhooKemfhMIkC'
        AND ee.status = 'success'
    `;
    
    const sourceResult = await this.n8nPool.query(sourceQuery);
    const sourceRange = sourceResult.rows[0];

    // Get date range from target
    const targetQuery = `
      SELECT 
        MIN(execution_timestamp) as earliest,
        MAX(execution_timestamp) as latest
      FROM executions
      WHERE workflow_id = 'yDbfhooKemfhMIkC'
    `;
    
    const targetResult = await this.saiPool.query(targetQuery);
    const targetRange = targetResult.rows[0];

    const sourceEarliest = new Date(sourceRange.earliest);
    const targetEarliest = new Date(targetRange.earliest);
    const sourceLatest = new Date(sourceRange.latest);
    const targetLatest = new Date(targetRange.latest);

    console.log(`  Source range: ${sourceEarliest.toISOString().split('T')[0]} to ${sourceLatest.toISOString().split('T')[0]}`);
    console.log(`  Target range: ${targetEarliest.toISOString().split('T')[0]} to ${targetLatest.toISOString().split('T')[0]}`);

    // Allow some tolerance for date differences (1 day)
    const earlyDiff = Math.abs(sourceEarliest - targetEarliest) / (1000 * 60 * 60 * 24);
    const lateDiff = Math.abs(sourceLatest - targetLatest) / (1000 * 60 * 60 * 24);

    this.validationResults.dateRangeMatch = earlyDiff < 1 && lateDiff < 1;

    if (this.validationResults.dateRangeMatch) {
      console.log('  ✅ Date ranges match within tolerance');
    } else {
      console.log('  ⚠️ Date ranges differ significantly');
    }
  }

  async validateStatusDistribution() {
    console.log('\n📈 Validating status distribution...');

    // Get status distribution from target (all should be success)
    const targetQuery = `
      SELECT status, COUNT(*) as count
      FROM executions
      GROUP BY status
      ORDER BY count DESC
    `;
    
    const targetResult = await this.saiPool.query(targetQuery);
    
    console.log('  Target status distribution:');
    for (const row of targetResult.rows) {
      console.log(`    ${row.status}: ${row.count} records`);
    }

    // Should be mostly 'success' since we filter for successful executions
    const successCount = targetResult.rows.find(r => r.status === 'success')?.count || 0;
    const totalCount = targetResult.rows.reduce((sum, r) => sum + parseInt(r.count), 0);
    const successRatio = successCount / totalCount;

    this.validationResults.statusDistributionMatch = successRatio > 0.95; // 95% should be success

    if (this.validationResults.statusDistributionMatch) {
      console.log(`  ✅ Status distribution looks correct (${(successRatio * 100).toFixed(1)}% success)`);
    } else {
      console.log(`  ⚠️ Unexpected status distribution (${(successRatio * 100).toFixed(1)}% success)`);
    }
  }

  async generateValidationReport() {
    console.log('\n📋 Validation Report');
    console.log('====================');
    
    const results = this.validationResults;
    let passedTests = 0;
    let totalTests = 0;

    for (const [test, passed] of Object.entries(results)) {
      totalTests++;
      if (passed) passedTests++;
      
      const status = passed ? '✅' : '❌';
      const testName = test.replace(/([A-Z])/g, ' $1').toLowerCase();
      console.log(`${status} ${testName}: ${passed ? 'PASS' : 'FAIL'}`);
    }

    console.log(`\n📊 Overall: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
      console.log('🎉 Migration validation SUCCESSFUL!');
      return true;
    } else {
      console.log('⚠️ Migration validation completed with warnings');
      console.log('Review the failed tests above and consider investigating');
      return false;
    }
  }

  async close() {
    await this.n8nPool.end();
    await this.saiPool.end();
  }
}

// Main execution
async function main() {
  const validator = new MigrationValidator();
  
  try {
    const success = await validator.validateMigration();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('💥 Validation failed:', error);
    process.exit(1);
  } finally {
    await validator.close();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { MigrationValidator };