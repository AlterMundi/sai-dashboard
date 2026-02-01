import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import { dualDb } from '@/database/dual-pool';
import { cacheConfig, appConfig } from '@/config';
import { HealthStatus } from '@/types';
import { logger } from '@/utils/logger';
import { asyncHandler } from '@/utils';

export const healthCheck = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  const healthStatus: HealthStatus = {
    status: 'healthy',
    timestamp,
    version: '1.0.0',
    uptime: process.uptime(),
    services: {
      database: 'disconnected',
      cache: 'unavailable',
      filesystem: 'error'
    }
  };

  try {
    // Database connectivity check
    try {
      const dbTest = await Promise.race([
        dualDb.testConnections().then(r => r.sai),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Database timeout')), appConfig.health.timeout)
        )
      ]);

      healthStatus.services.database = dbTest ? 'connected' : 'error';

      // Additional database stats if enabled
      if (appConfig.health.enableMetrics && dbTest) {
        const poolStats = dualDb.getPoolStats().sai;
        (healthStatus as any).databaseStats = poolStats;
      }
    } catch (error) {
      logger.error('Database health check failed:', error);
      healthStatus.services.database = 'error';
    }

    // Cache directory accessibility check
    try {
      await fs.access(cacheConfig.path, fs.constants.W_OK | fs.constants.R_OK);
      
      // Test write capability
      const testFile = `${cacheConfig.path}/.health-test-${Date.now()}`;
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      
      healthStatus.services.cache = 'available';
      
      // Cache statistics if enabled
      if (appConfig.health.enableMetrics) {
        const stats = await fs.stat(cacheConfig.path);
        (healthStatus as any).cacheStats = {
          accessible: true,
          lastModified: stats.mtime
        };
      }
    } catch (error) {
      logger.error('Cache health check failed:', error);
      healthStatus.services.cache = 'unavailable';
    }

    // Filesystem check
    try {
      const testPath = '/tmp/.sai-dashboard-health-test';
      await fs.writeFile(testPath, 'health-check');
      await fs.unlink(testPath);
      healthStatus.services.filesystem = 'writable';
    } catch (error) {
      logger.error('Filesystem health check failed:', error);
      healthStatus.services.filesystem = 'readonly';
    }

    // Determine overall status
    const { database, cache, filesystem } = healthStatus.services;
    
    if (database === 'error') {
      healthStatus.status = 'unhealthy';
    } else if ((database as any) === 'disconnected' || cache === 'unavailable' || (filesystem as any) === 'error') {
      healthStatus.status = 'degraded';
    } else {
      healthStatus.status = 'healthy';
    }

    // Add response time if metrics enabled
    if (appConfig.health.enableMetrics) {
      (healthStatus as any).responseTime = Date.now() - startTime;
      (healthStatus as any).memory = {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
        external: process.memoryUsage().external
      };
    }

    // Log health check results
    logger.debug('Health check completed:', {
      status: healthStatus.status,
      services: healthStatus.services,
      responseTime: Date.now() - startTime
    });

    // Set appropriate HTTP status code
    const statusCode = healthStatus.status === 'healthy' ? 200 :
                      healthStatus.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json({
      data: healthStatus
    });

  } catch (error) {
    logger.error('Health check failed:', error);
    
    res.status(503).json({
      data: {
        status: 'unhealthy',
        timestamp,
        version: '1.0.0',
        uptime: process.uptime(),
        services: {
          database: 'error',
          cache: 'unavailable',
          filesystem: 'error'
        }
      },
      error: {
        message: 'Health check failed',
        code: 'HEALTH_CHECK_ERROR'
      }
    });
  }
});

export const readiness = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    // Basic readiness checks - faster than full health check
    const dbConnected = await dualDb.testConnections().then(r => r.sai);
    
    if (!dbConnected) {
      res.status(503).json({
        data: { ready: false, reason: 'Database not ready' }
      });
      return;
    }

    res.json({
      data: { ready: true }
    });
    
  } catch (error) {
    logger.error('Readiness check failed:', error);
    
    res.status(503).json({
      data: { ready: false, reason: 'Service not ready' },
      error: {
        message: 'Readiness check failed',
        code: 'NOT_READY'
      }
    });
  }
});

export const liveness = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // Simple liveness probe - just confirm the process is running
  res.json({
    data: { 
      alive: true, 
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }
  });
});