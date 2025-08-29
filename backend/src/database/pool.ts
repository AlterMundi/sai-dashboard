import { Pool, PoolClient } from 'pg';
import { databaseConfig } from '@/config';
import { logger } from '@/utils/logger';

class DatabasePool {
  private pool: Pool;
  private static instance: DatabasePool;

  private constructor() {
    this.pool = new Pool({
      host: databaseConfig.host,
      port: databaseConfig.port,
      database: databaseConfig.database,
      user: databaseConfig.username,
      password: databaseConfig.password,
      max: databaseConfig.maxConnections,
      idleTimeoutMillis: databaseConfig.idleTimeout,
      connectionTimeoutMillis: databaseConfig.connectionTimeout,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    this.pool.on('connect', () => {
      logger.info('Database pool connected');
    });

    this.pool.on('error', (err) => {
      logger.error('Database pool error:', err);
    });

    this.pool.on('remove', () => {
      logger.debug('Database client removed from pool');
    });
  }

  public static getInstance(): DatabasePool {
    if (!DatabasePool.instance) {
      DatabasePool.instance = new DatabasePool();
    }
    return DatabasePool.instance;
  }

  public async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    
    try {
      logger.debug('Executing query:', { text, params });
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Query completed:', { 
        duration, 
        rows: result.rowCount,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : '')
      });
      
      return result.rows;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Query failed:', { text, params, duration, error });
      throw error;
    }
  }

  public async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  public async testConnection(): Promise<boolean> {
    try {
      const result = await this.query('SELECT NOW() as current_time');
      logger.info('Database connection test successful:', result[0]);
      return true;
    } catch (error) {
      logger.error('Database connection test failed:', error);
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database pool closed');
  }

  public getPoolStats(): { total: number; idle: number; waiting: number } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount
    };
  }
}

export const db = DatabasePool.getInstance();