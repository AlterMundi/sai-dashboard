import { Request, Response } from 'express';
import { executionService } from '@/services/execution';
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';
import { SSEClient, SSEMessage } from '@/types';
import { generateId, asyncHandler } from '@/utils';

class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  addClient(response: Response, userId?: string): string {
    const clientId = generateId();
    
    const client: SSEClient = {
      id: clientId,
      response: response as any,
      lastPing: new Date()
    };

    this.clients.set(clientId, client);

    logger.info('SSE client connected', {
      clientId,
      userId,
      totalClients: this.clients.size
    });

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'connection',
      data: {
        clientId,
        timestamp: new Date().toISOString(),
        message: 'Connected to SAI Dashboard real-time updates'
      }
    });

    return clientId;
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        (client.response as any).end();
      } catch (error) {
        // Client might already be disconnected
      }
      
      this.clients.delete(clientId);
      logger.info('SSE client disconnected', {
        clientId,
        totalClients: this.clients.size
      });
    }
  }

  sendToClient(clientId: string, message: SSEMessage): boolean {
    const client = this.clients.get(clientId);
    
    if (!client) {
      return false;
    }

    try {
      const sseMessage = this.formatSSEMessage(message);
      (client.response as any).write(sseMessage);
      client.lastPing = new Date();
      return true;

    } catch (error) {
      logger.warn('Failed to send message to SSE client', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      this.removeClient(clientId);
      return false;
    }
  }

  broadcast(message: SSEMessage): number {
    let successCount = 0;
    const deadClients: string[] = [];

    for (const [clientId] of this.clients) {
      const sent = this.sendToClient(clientId, message);
      if (sent) {
        successCount++;
      } else {
        deadClients.push(clientId);
      }
    }

    // Clean up dead clients
    deadClients.forEach(clientId => this.removeClient(clientId));

    if (successCount > 0) {
      logger.debug('SSE message broadcasted', {
        type: message.type,
        successCount,
        totalClients: this.clients.size
      });
    }

    return successCount;
  }

  private formatSSEMessage(message: SSEMessage): string {
    let sseMessage = '';

    if (message.id) {
      sseMessage += `id: ${message.id}\n`;
    }

    if (message.type) {
      sseMessage += `event: ${message.type}\n`;
    }

    if (message.data) {
      const dataStr = typeof message.data === 'string' 
        ? message.data 
        : JSON.stringify(message.data);
      
      // Handle multiline data
      const lines = dataStr.split('\n');
      for (const line of lines) {
        sseMessage += `data: ${line}\n`;
      }
    } else {
      sseMessage += 'data: \n';
    }

    if (message.retry) {
      sseMessage += `retry: ${message.retry}\n`;
    }

    sseMessage += '\n';
    return sseMessage;
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.clients.size === 0) return;

      const heartbeatMessage: SSEMessage = {
        type: 'heartbeat',
        data: {
          timestamp: new Date().toISOString(),
          clients: this.clients.size
        }
      };

      this.broadcast(heartbeatMessage);

      // Clean up stale clients (no activity for 5+ minutes)
      const staleTimeout = 5 * 60 * 1000; // 5 minutes
      const now = new Date();
      const staleClients: string[] = [];

      for (const [clientId, client] of this.clients) {
        if (now.getTime() - client.lastPing.getTime() > staleTimeout) {
          staleClients.push(clientId);
        }
      }

      staleClients.forEach(clientId => {
        logger.info('Removing stale SSE client', { clientId });
        this.removeClient(clientId);
      });

    }, appConfig.sse.heartbeatInterval);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClientStats(): { total: number; oldest: Date | null; newest: Date | null } {
    if (this.clients.size === 0) {
      return { total: 0, oldest: null, newest: null };
    }

    let oldest = new Date();
    let newest = new Date(0);

    for (const client of this.clients.values()) {
      if (client.lastPing < oldest) oldest = client.lastPing;
      if (client.lastPing > newest) newest = client.lastPing;
    }

    return { total: this.clients.size, oldest, newest };
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Notify all clients of shutdown
    this.broadcast({
      type: 'connection',
      data: {
        message: 'Server is shutting down',
        timestamp: new Date().toISOString()
      }
    });

    // Close all connections
    for (const [clientId] of this.clients) {
      this.removeClient(clientId);
    }

    logger.info('SSE manager shutdown complete');
  }
}

// Global SSE manager instance
const sseManager = new SSEManager();

export const connectSSE = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // Check client limit
  if (sseManager.getClientCount() >= appConfig.sse.maxClients) {
    res.status(503).json({
      error: {
        message: 'Too many concurrent SSE connections',
        code: 'SSE_LIMIT_EXCEEDED'
      }
    });
    return;
  }

  // Set SSE headers - CRITICAL: Connection header must match nginx proxy settings
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    // DON'T set Connection header - let nginx proxy handle it with Connection: ''
    'Access-Control-Allow-Origin': req.get('origin') || '*',
    'Access-Control-Allow-Credentials': 'true',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });

  // Send initial data to trigger browser onopen event
  res.write('data: \n\n');
  res.flush?.(); // Force immediate response flush
  
  const userId = req.user?.id;
  const clientId = sseManager.addClient(res, userId);

  // Handle client disconnect
  req.on('close', () => {
    sseManager.removeClient(clientId);
  });

  req.on('aborted', () => {
    sseManager.removeClient(clientId);
  });

  res.on('close', () => {
    sseManager.removeClient(clientId);
  });

  // Set timeout for connection
  const timeout = setTimeout(() => {
    logger.info('SSE connection timeout', { clientId });
    sseManager.removeClient(clientId);
  }, appConfig.sse.timeout);

  req.on('close', () => {
    clearTimeout(timeout);
  });
});

export const getSSEStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const stats = sseManager.getClientStats();
  
  res.json({
    data: {
      enabled: true,
      clients: stats.total,
      maxClients: appConfig.sse.maxClients,
      heartbeatInterval: appConfig.sse.heartbeatInterval,
      timeout: appConfig.sse.timeout,
      oldestConnection: stats.oldest?.toISOString() || null,
      newestConnection: stats.newest?.toISOString() || null
    }
  });
});

// Function to notify SSE clients of new executions
export const notifyNewExecution = async (executionId: string): Promise<void> => {
  try {
    const execution = await executionService.getExecutionById(executionId);
    
    if (execution && execution.status === 'success') {
      const message: SSEMessage = {
        type: 'execution:new',
        id: executionId,
        data: {
          execution: {
            id: execution.id,
            status: execution.status,
            startedAt: execution.startedAt.toISOString(),
            hasImage: !!execution.imageUrl,
            imageUrl: execution.imageUrl,
            thumbnailUrl: execution.thumbnailUrl,
            analysis: execution.analysis
          },
          timestamp: new Date().toISOString()
        }
      };

      const clientCount = sseManager.broadcast(message);
      
      logger.info('New execution notification sent', {
        executionId,
        clientCount
      });
    }
  } catch (error) {
    logger.error('Failed to notify SSE clients of new execution', {
      executionId,
      error
    });
  }
};

export const notifyExecutionError = async (executionId: string, error: string): Promise<void> => {
  try {
    const message: SSEMessage = {
      type: 'execution:error',
      id: executionId,
      data: {
        executionId,
        error,
        timestamp: new Date().toISOString()
      }
    };

    const clientCount = sseManager.broadcast(message);
    
    logger.info('Execution error notification sent', {
      executionId,
      clientCount
    });
  } catch (broadcastError) {
    logger.error('Failed to notify SSE clients of execution error', {
      executionId,
      error: broadcastError
    });
  }
};

// Notify SSE clients of system statistics updates
export const notifySystemStats = async (stats: {
  totalExecutions: number;
  successRate: number;
  queueSize: number;
  avgProcessingTime?: number;
}): Promise<void> => {
  try {
    const message: SSEMessage = {
      type: 'system:stats',
      data: {
        ...stats,
        timestamp: new Date().toISOString()
      }
    };

    const clientCount = sseManager.broadcast(message);
    
    logger.debug('System stats notification sent', {
      stats,
      clientCount
    });
  } catch (error) {
    logger.error('Failed to notify SSE clients of system stats', { error });
  }
};

// Notify SSE clients of batch completion
export const notifyBatchComplete = async (batchData: {
  count: number;
  successful: number;
  highRisk: number;
  batchId?: string;
}): Promise<void> => {
  try {
    const message: SSEMessage = {
      type: 'execution:batch',
      data: {
        ...batchData,
        timestamp: new Date().toISOString()
      }
    };

    const clientCount = sseManager.broadcast(message);
    
    logger.info('Batch completion notification sent', {
      batchData,
      clientCount
    });
  } catch (error) {
    logger.error('Failed to notify SSE clients of batch completion', { error });
  }
};

// Notify SSE clients of system health status
export const notifySystemHealth = async (healthData: {
  cpu: number;
  memory: number;
  queueSize: number;
  status: 'healthy' | 'warning' | 'critical';
}): Promise<void> => {
  try {
    const message: SSEMessage = {
      type: 'system:health',
      data: {
        ...healthData,
        timestamp: new Date().toISOString()
      }
    };

    const clientCount = sseManager.broadcast(message);
    
    logger.debug('System health notification sent', {
      healthData,
      clientCount
    });
  } catch (error) {
    logger.error('Failed to notify SSE clients of system health', { error });
  }
};

// Notify SSE clients of execution progress
export const notifyExecutionProgress = async (executionId: string, progress: {
  step: string;
  progress: number;
  message?: string;
}): Promise<void> => {
  try {
    const message: SSEMessage = {
      type: 'execution:progress',
      id: executionId,
      data: {
        executionId,
        ...progress,
        timestamp: new Date().toISOString()
      }
    };

    const clientCount = sseManager.broadcast(message);
    
    logger.debug('Execution progress notification sent', {
      executionId,
      progress,
      clientCount
    });
  } catch (error) {
    logger.error('Failed to notify SSE clients of execution progress', { error });
  }
};

// Periodic system monitoring for real-time stats
let systemMonitoringInterval: NodeJS.Timeout | null = null;

export const startSystemMonitoring = (): void => {
  if (systemMonitoringInterval) {
    clearInterval(systemMonitoringInterval);
  }

  systemMonitoringInterval = setInterval(async () => {
    try {
      // Only broadcast if there are active clients
      if (sseManager.getClientCount() === 0) return;

      // Get system metrics (you can enhance this with actual system monitoring)
      const stats = {
        totalExecutions: await getTotalExecutionCount(), // Implement this function
        successRate: await getSuccessRate(), // Implement this function  
        queueSize: getQueueSize(), // Implement this function
        avgProcessingTime: await getAverageProcessingTime() // Implement this function
      };

      await notifySystemStats(stats);

      // System health monitoring
      const healthData = {
        cpu: await getCPUUsage(), // Implement this function
        memory: await getMemoryUsage(), // Implement this function
        queueSize: getQueueSize(),
        status: getSystemStatus() as 'healthy' | 'warning' | 'critical'
      };

      await notifySystemHealth(healthData);
    } catch (error) {
      logger.error('System monitoring error:', error);
    }
  }, 30000); // Every 30 seconds

  logger.info('System monitoring started');
};

export const stopSystemMonitoring = (): void => {
  if (systemMonitoringInterval) {
    clearInterval(systemMonitoringInterval);
    systemMonitoringInterval = null;
    logger.info('System monitoring stopped');
  }
};

// Placeholder functions - implement based on your actual data sources
async function getTotalExecutionCount(): Promise<number> {
  // TODO: Implement actual database query
  return Math.floor(Math.random() * 10000);
}

async function getSuccessRate(): Promise<number> {
  // TODO: Implement actual calculation
  return 0.95 + Math.random() * 0.04;
}

function getQueueSize(): number {
  // TODO: Implement actual queue monitoring
  return Math.floor(Math.random() * 10);
}

async function getAverageProcessingTime(): Promise<number> {
  // TODO: Implement actual calculation
  return 3 + Math.random() * 2;
}

async function getCPUUsage(): Promise<number> {
  // TODO: Implement actual system monitoring
  return Math.floor(Math.random() * 80);
}

async function getMemoryUsage(): Promise<number> {
  // TODO: Implement actual system monitoring
  return Math.floor(Math.random() * 70);
}

function getSystemStatus(): string {
  // TODO: Implement actual system health logic
  const random = Math.random();
  if (random > 0.9) return 'warning';
  if (random > 0.98) return 'critical';
  return 'healthy';
}

// Graceful shutdown handler
process.on('SIGTERM', () => {
  stopSystemMonitoring();
  sseManager.shutdown();
});

process.on('SIGINT', () => {
  stopSystemMonitoring();
  sseManager.shutdown();
});

export { sseManager };

// Start system monitoring when module loads
startSystemMonitoring();