/**
 * Dual Database Pool System
 * Single source of truth: sai_dashboard database
 * Legacy support: n8n database (read-only for migration only)
 */

import { Pool, PoolClient } from 'pg';
import { logger } from '@/utils/logger';

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections: number;
  idleTimeout: number;
  connectionTimeout: number;
}

class DualDatabasePool {
  private saiPool: Pool;      // PRIMARY: sai_dashboard database
  private n8nPool: Pool;      // LEGACY: n8n database (read-only)
  private static instance: DualDatabasePool;

  private constructor() {
    // PRIMARY DATABASE: sai_dashboard (single source of truth)
    this.saiPool = new Pool({
      host: process.env.SAI_DB_HOST || 'localhost',
      port: parseInt(process.env.SAI_DB_PORT || '5432'),
      database: process.env.SAI_DB_NAME || 'sai_dashboard',
      user: process.env.SAI_DB_USER || 'n8n_user',
      password: process.env.SAI_DB_PASSWORD || '',
      max: 15, // Primary database gets more connections (serves API + ETL)
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      options: '-c timezone=UTC', // Force UTC on every connection at the protocol level
    });

    // LEGACY DATABASE: n8n (read-only access for migration)
    this.n8nPool = new Pool({
      host: process.env.N8N_DB_HOST || 'localhost',
      port: parseInt(process.env.N8N_DB_PORT || '5432'),
      database: process.env.N8N_DB_NAME || 'n8n',
      user: process.env.N8N_DB_USER || 'n8n_user',
      password: process.env.N8N_DB_PASSWORD || '',
      max: 5, // Read-only access for ETL pipeline
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    // Event handlers for primary database
    this.saiPool.on('connect', () => {
      logger.info('SAI Dashboard database pool connected');
    });

    this.saiPool.on('error', (err) => {
      logger.error('SAI Dashboard database pool error:', err);
    });

    // Event handlers for legacy database
    this.n8nPool.on('connect', () => {
      logger.debug('N8N legacy database pool connected');
    });

    this.n8nPool.on('error', (err) => {
      logger.error('N8N legacy database pool error:', err);
    });
  }

  public static getInstance(): DualDatabasePool {
    if (!DualDatabasePool.instance) {
      DualDatabasePool.instance = new DualDatabasePool();
    }
    return DualDatabasePool.instance;
  }

  /**
   * PRIMARY DATABASE QUERY - Use for all new operations
   * Queries the sai_dashboard database (single source of truth)
   */
  public async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    
    try {
      logger.debug('Executing SAI dashboard query:', { text: text.substring(0, 100), params });
      const result = await this.saiPool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('SAI dashboard query completed:', { 
        duration, 
        rows: result.rowCount,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : '')
      });
      
      return result.rows;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('SAI dashboard query failed:', { text, params, duration, error });
      throw error;
    }
  }

  /**
   * LEGACY DATABASE QUERY - Use only for migration purposes
   * Queries the n8n database (read-only)
   */
  public async legacyQuery<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    
    try {
      logger.debug('Executing N8N legacy query:', { text: text.substring(0, 100), params });
      const result = await this.n8nPool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('N8N legacy query completed:', { 
        duration, 
        rows: result.rowCount,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : '')
      });
      
      return result.rows;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('N8N legacy query failed:', { text, params, duration, error });
      throw error;
    }
  }

  /**
   * Get client from primary database
   */
  public async getClient(): Promise<PoolClient> {
    return await this.saiPool.connect();
  }

  /**
   * Get client from legacy database (migration only)
   */
  public async getLegacyClient(): Promise<PoolClient> {
    return await this.n8nPool.connect();
  }

  /**
   * Execute transaction on primary database
   */
  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('SAI dashboard transaction failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Test both database connections
   */
  public async testConnections(): Promise<{ sai: boolean; n8n: boolean }> {
    const results = { sai: false, n8n: false };
    
    try {
      const saiResult = await this.query('SELECT NOW() as current_time, COUNT(*) as execution_count FROM executions');
      logger.info('SAI Dashboard database test successful:', saiResult[0]);
      results.sai = true;
    } catch (error) {
      logger.error('SAI Dashboard database test failed:', error);
    }
    
    try {
      const n8nResult = await this.legacyQuery('SELECT NOW() as current_time');
      logger.info('N8N legacy database test successful:', n8nResult[0]);
      results.n8n = true;
    } catch (error) {
      logger.error('N8N legacy database test failed:', error);
    }
    
    return results;
  }

  /**
   * Close both database pools
   */
  public async close(): Promise<void> {
    await Promise.all([
      this.saiPool.end(),
      this.n8nPool.end()
    ]);
    logger.info('All database pools closed');
  }

  /**
   * Get raw SAI pool (for ETL services that need direct pool access)
   */
  public getSaiPool(): Pool {
    return this.saiPool;
  }

  /**
   * Get raw N8N pool (for ETL services that need direct pool access)
   */
  public getN8nPool(): Pool {
    return this.n8nPool;
  }

  /**
   * Get pool statistics for both databases
   */
  public getPoolStats(): { 
    sai: { total: number; idle: number; waiting: number };
    n8n: { total: number; idle: number; waiting: number };
  } {
    return {
      sai: {
        total: this.saiPool.totalCount,
        idle: this.saiPool.idleCount,
        waiting: this.saiPool.waitingCount
      },
      n8n: {
        total: this.n8nPool.totalCount,
        idle: this.n8nPool.idleCount,
        waiting: this.n8nPool.waitingCount
      }
    };
  }
}

// Export singleton instance
export const dualDb = DualDatabasePool.getInstance();