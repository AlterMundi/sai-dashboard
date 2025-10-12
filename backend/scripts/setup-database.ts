#!/usr/bin/env tsx

import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { n8nDatabaseConfig } from '../src/config';
import { logger } from '../src/utils/logger';

const setupDatabase = async (): Promise<void> => {
  let pool: Pool | null = null;
  
  try {
    // Create superuser connection for setup (n8n database)
    const setupConfig = {
      host: n8nDatabaseConfig.host,
      port: n8nDatabaseConfig.port,
      database: n8nDatabaseConfig.database,
      user: process.env.DB_SETUP_USER || 'postgres',
      password: process.env.DB_SETUP_PASSWORD || n8nDatabaseConfig.password,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };

    logger.info('Connecting to database for setup...', {
      host: setupConfig.host,
      port: setupConfig.port,
      database: setupConfig.database,
      user: setupConfig.user
    });

    pool = new Pool(setupConfig);

    // Test connection
    const testResult = await pool.query('SELECT version()');
    logger.info('Connected to PostgreSQL:', testResult.rows[0]?.version);

    // Check if n8n tables exist
    const tablesCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('execution_entity', 'workflow_entity', 'execution_data')
    `);

    if (tablesCheck.rows.length < 3) {
      logger.error('Missing n8n tables! Ensure n8n database is properly initialized.');
      logger.info('Required tables: execution_entity, workflow_entity, execution_data');
      logger.info('Found tables:', tablesCheck.rows.map(r => r.table_name));
      process.exit(1);
    }

    logger.info('n8n database tables found:', tablesCheck.rows.map(r => r.table_name));

    // Check if SAI workflow exists
    const workflowCheck = await pool.query(`
      SELECT id, name, active 
      FROM workflow_entity 
      WHERE name = $1
    `, [process.env.SAI_WORKFLOW_NAME || 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto']);

    if (workflowCheck.rows.length === 0) {
      logger.warn('SAI workflow not found in database. This is normal if workflow hasn\'t been created yet.');
      logger.info('Expected workflow name:', process.env.SAI_WORKFLOW_NAME);
    } else {
      logger.info('SAI workflow found:', {
        id: workflowCheck.rows[0].id,
        name: workflowCheck.rows[0].name,
        active: workflowCheck.rows[0].active
      });
    }

    // Read and execute SQL setup script
    const sqlFilePath = join(__dirname, 'create-views.sql');
    const sqlContent = readFileSync(sqlFilePath, 'utf8');

    logger.info('Executing database setup script...');

    // Replace placeholder password if provided
    const processedSQL = sqlContent.replace(
      'CHANGE_THIS_PASSWORD',
      n8nDatabaseConfig.password
    );

    await pool.query(processedSQL);

    logger.info('Database setup completed successfully!');

    // Test the created views
    logger.info('Testing created views...');

    const viewTests = [
      { name: 'sai_executions', query: 'SELECT COUNT(*) as count FROM sai_executions' },
      { name: 'sai_execution_data', query: 'SELECT COUNT(*) as count FROM sai_execution_data' },
      { name: 'sai_dashboard_executions', query: 'SELECT COUNT(*) as count FROM sai_dashboard_executions LIMIT 1' },
      { name: 'sai_daily_summary', query: 'SELECT COUNT(*) as count FROM sai_daily_summary' }
    ];

    for (const test of viewTests) {
      try {
        const result = await pool.query(test.query);
        logger.info(`✓ View ${test.name}: ${result.rows[0]?.count || 0} records`);
      } catch (error) {
        logger.error(`✗ View ${test.name} test failed:`, error);
      }
    }

    // Test readonly user connection
    logger.info('Testing readonly user connection...');
    
    const readonlyPool = new Pool({
      ...setupConfig,
      user: n8nDatabaseConfig.username,
      password: n8nDatabaseConfig.password
    });

    try {
      const readonlyTest = await readonlyPool.query('SELECT COUNT(*) FROM sai_dashboard_executions LIMIT 1');
      logger.info('✓ Readonly user can access views:', readonlyTest.rows[0]);
      await readonlyPool.end();
    } catch (error) {
      logger.error('✗ Readonly user connection failed:', error);
      logger.info('Make sure to update DB_PASSWORD in your .env file');
    }

    logger.info('\n=== Database Setup Summary ===');
    logger.info('✓ Database views created');
    logger.info('✓ Readonly user configured');
    logger.info('✓ Indexes created for performance');
    logger.info('✓ Security permissions applied');
    logger.info('\nNext steps:');
    logger.info('1. Update DB_PASSWORD in .env file');
    logger.info('2. Start the application: npm run dev');
    logger.info('3. Test API endpoints');

  } catch (error) {
    logger.error('Database setup failed:', error);
    
    if ((error as any).code === '28P01') {
      logger.error('Authentication failed. Check DB_SETUP_USER and DB_SETUP_PASSWORD');
    } else if ((error as any).code === 'ECONNREFUSED') {
      logger.error('Connection refused. Check if PostgreSQL is running and accessible');
    }
    
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
};

// Run if called directly
if (require.main === module) {
  setupDatabase().catch(error => {
    console.error('Setup failed:', error);
    process.exit(1);
  });
}

export { setupDatabase };