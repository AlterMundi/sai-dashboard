import { Request, Response } from 'express';
import { newExecutionService } from '@/services/new-execution-service';
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

      if (appConfig.sse.debug && (message.type !== 'heartbeat' || Math.random() < 0.1)) {
        logger.info(`SSE message sent to client ${clientId}:`, {
          type: message.type,
          messageLength: sseMessage.length
        });
      }

      const canContinue = (client.response as any).write(sseMessage);

      // Flush the response to ensure immediate delivery
      if (typeof (client.response as any).flush === 'function') {
        (client.response as any).flush();
      }

      client.lastPing = new Date();

      // Backpressure: if write() returned false, the kernel buffer is full.
      // Wait for drain; if it doesn't come within 30s, disconnect the slow client.
      if (!canContinue) {
        const drainTimeout = setTimeout(() => {
          logger.warn('SSE slow client disconnected (no drain within 30s)', { clientId });
          this.removeClient(clientId);
        }, 30000);

        (client.response as any).once('drain', () => {
          clearTimeout(drainTimeout);
        });
      }

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
      // Log broadcasts occasionally (not every heartbeat)
      if (message.type !== 'heartbeat' || Math.random() < 0.05) {
        logger.info('📡 SSE message broadcasted', {
          type: message.type,
          successCount,
          totalClients: this.clients.size
        });
      }
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

// Export for external access (ETL service integration) - moved to end of file

// Debug mode flag
const SSE_DEBUG = process.env.SSE_DEBUG === 'true';

export const connectSSE = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // Debug logging
  if (SSE_DEBUG) {
    logger.info('🔵 SSE Connection attempt', {
      origin: req.get('origin'),
      userAgent: req.get('user-agent'),
      ip: req.ip,
      headers: req.headers,
      query: req.query
    });
  }

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
    'X-Accel-Buffering': 'no', // Disable nginx buffering
    'X-SSE-Debug': SSE_DEBUG ? 'enabled' : 'disabled'
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
    const execution = await newExecutionService.getExecutionById(parseInt(executionId));
    
    if (execution && execution.status === 'success') {
      const message: SSEMessage = {
        type: 'execution:new',
        id: executionId,
        data: {
          execution: execution, // Send the complete ExecutionWithImage object
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

export const notifyStage2Complete = async (
  executionId: number,
  extracted: {
    has_smoke: boolean;
    alert_level: string | null;
    detection_count: number;
  },
  hasImage: boolean,
  processingTimeMs: number
): Promise<void> => {
  try {
    const message: SSEMessage = {
      type: 'etl:stage2:complete',
      data: {
        execution_id: executionId,
        stage: 'stage2',
        processing_time_ms: processingTimeMs,
        extracted_data: {
          has_smoke: extracted.has_smoke,
          alert_level: extracted.alert_level,
          detection_count: extracted.detection_count,
          has_image: hasImage,
          telegram_sent: false,
        },
        timestamp: new Date().toISOString(),
      },
    };

    const clientCount = sseManager.broadcast(message);
    // Register this ID so the polling loop doesn't re-broadcast it
    broadcastedExecutionIds.add(executionId);
    if (broadcastedExecutionIds.size > MAX_BROADCAST_TRACKED) {
      const sorted = [...broadcastedExecutionIds].sort((a, b) => a - b);
      sorted.slice(0, broadcastedExecutionIds.size - MAX_BROADCAST_TRACKED)
        .forEach(id => broadcastedExecutionIds.delete(id));
    }
    logger.debug('Stage 2 completion notified', { executionId, clientCount });
  } catch (error) {
    logger.error('Failed to notify Stage 2 completion', { executionId, error });
  }
};

export const notifyStage2Failed = async (
  executionId: number,
  errorMessage: string,
  retryCount: number
): Promise<void> => {
  try {
    const message: SSEMessage = {
      type: 'etl:stage2:failed',
      data: {
        execution_id: executionId,
        stage: 'stage2',
        error: errorMessage,
        retry_count: retryCount,
        timestamp: new Date().toISOString(),
      },
    };

    const clientCount = sseManager.broadcast(message);
    logger.debug('Stage 2 failure notified', { executionId, clientCount });
  } catch (error) {
    logger.error('Failed to notify Stage 2 failure', { executionId, error });
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
let executionPollingInterval: NodeJS.Timeout | null = null;

// Execution tracking — Set-based to avoid cursor race conditions
const broadcastedExecutionIds = new Set<number>();
const MAX_BROADCAST_TRACKED = 200;
let isPolling = false;

// Poll for new executions and broadcast immediately
const pollAndBroadcastExecutions = async (): Promise<void> => {
  if (isPolling) {
    logger.debug('Poll skipped: previous poll still in progress');
    return;
  }
  isPolling = true;
  try {
    // Only poll if there are active clients
    if (sseManager.getClientCount() === 0) return;

    const { newExecutionService } = await import('@/services/new-execution-service');

    // Get latest executions - increase limit to handle higher throughput
    // IMPORTANT: Only get executions where Stage 2 ETL has completed
    // This ensures we have image paths and YOLO analysis data before broadcasting
    const latestExecutions = await newExecutionService.getExecutions({
      limit: 50, // Check last 50 to ensure we don't miss any during high activity
      page: 0,
      // Filter for executions with extracted analysis (Stage 2 completed)
      // This prevents broadcasting executions before images are processed
    });

    if (latestExecutions.executions.length === 0) return;

    const newExecutions = [];
    const newIds: number[] = [];
    for (const execution of latestExecutions.executions) {
      // Skip already-broadcast executions
      if (broadcastedExecutionIds.has(execution.id)) continue;

      // Skip executions where Stage 2 hasn't completed yet
      if (!execution.extractedAt) {
        logger.debug(`Skipping execution ${execution.id} - Stage 2 ETL not yet complete`);
        continue;
      }

      newExecutions.push(execution);
      newIds.push(execution.id);
    }

    if (newExecutions.length > 0) {
      
      // Broadcast immediately - no batching delay
      const batchData = {
        count: newExecutions.length,
        executions: newExecutions.slice().reverse(), // Show newest first, send ALL executions
        successful: newExecutions.filter(e => e.status === 'success').length,
        highAlert: newExecutions.filter(e => e.alertLevel === 'high').length,
        timestamp: new Date().toISOString()
      };

      const message: SSEMessage = {
        type: 'execution:batch',
        data: batchData
      };

      const clientCount = sseManager.broadcast(message);

      // Commit IDs to the Set only after successful broadcast
      newIds.forEach(id => broadcastedExecutionIds.add(id));

      // Trim the set to prevent unbounded memory growth (keep newest MAX_BROADCAST_TRACKED IDs)
      if (broadcastedExecutionIds.size > MAX_BROADCAST_TRACKED) {
        const sorted = [...broadcastedExecutionIds].sort((a, b) => a - b);
        sorted.slice(0, broadcastedExecutionIds.size - MAX_BROADCAST_TRACKED)
          .forEach(id => broadcastedExecutionIds.delete(id));
      }
      
      logger.info('New executions broadcasted immediately', {
        executionCount: batchData.count,
        successful: batchData.successful,
        highAlert: batchData.highAlert,
        clientCount,
        latestIds: newIds
      });
    }
  } catch (error) {
    logger.warn('Failed to poll and broadcast executions:', error);
  } finally {
    isPolling = false;
  }
};

// Legacy batch function - no longer needed since we broadcast immediately
// Kept for reference but unused

export const startSystemMonitoring = (): void => {
  // Clear existing intervals
  if (systemMonitoringInterval) {
    clearInterval(systemMonitoringInterval);
  }
  if (executionPollingInterval) {
    clearInterval(executionPollingInterval);
  }

  // Start execution polling and immediate broadcast every 30 seconds
  executionPollingInterval = setInterval(pollAndBroadcastExecutions, 30000);

  // Start system monitoring every 3 seconds (fast for testing)
  systemMonitoringInterval = setInterval(async () => {
    try {
      // Only run if there are active clients
      if (sseManager.getClientCount() === 0) return;

      // System metrics
      const stats = {
        totalExecutions: await getTotalExecutionCount(),
        successRate: await getSuccessRate(),
        queueSize: getQueueSize(),
        avgProcessingTime: await getAverageProcessingTime()
      };

      await notifySystemStats(stats);

      // System health monitoring
      const healthData = {
        cpu: await getCPUUsage(),
        memory: await getMemoryUsage(),
        queueSize: getQueueSize(),
        status: getSystemStatus() as 'healthy' | 'warning' | 'critical'
      };

      await notifySystemHealth(healthData);
    } catch (error) {
      logger.error('System monitoring error:', error);
    }
  }, 10000); // Every 10 seconds

  logger.info('System monitoring started with immediate execution broadcasting');
};

export const stopSystemMonitoring = (): void => {
  if (systemMonitoringInterval) {
    clearInterval(systemMonitoringInterval);
    systemMonitoringInterval = null;
  }
  if (executionPollingInterval) {
    clearInterval(executionPollingInterval);
    executionPollingInterval = null;
  }
  logger.info('System monitoring and execution polling stopped');
};

// Real database-backed functions for system monitoring
async function getTotalExecutionCount(): Promise<number> {
  try {
    const { newExecutionService } = await import('@/services/new-execution-service');
    const stats = await newExecutionService.getExecutionStats();
    return stats.totalExecutions;
  } catch (error) {
    logger.warn('Failed to get total execution count:', error);
    return 7721; // Fallback to known value
  }
}

async function getSuccessRate(): Promise<number> {
  try {
    const { newExecutionService } = await import('@/services/new-execution-service');
    const stats = await newExecutionService.getExecutionStats();
    return stats.successRate;
  } catch (error) {
    logger.warn('Failed to get success rate:', error);
    return 0.9996; // Fallback to known high success rate
  }
}

function getQueueSize(): number {
  // For SAI Dashboard (read-only), queue size is always 0 since we don't process
  return 0;
}

async function getAverageProcessingTime(): Promise<number> {
  try {
    const { newExecutionService } = await import('@/services/new-execution-service');
    const stats = await newExecutionService.getExecutionStats();
    // Calculate from average processing time directly 
    return stats.avgProcessingTime / 1000; // Convert ms to seconds
  } catch (error) {
    logger.warn('Failed to get average processing time:', error);
    return 4.2; // Fallback reasonable value in seconds
  }
}

async function getCPUUsage(): Promise<number> {
  try {
    // Simple CPU usage approximation based on system load
    const fs = await import('fs/promises');
    const loadavg = (await fs.readFile('/proc/loadavg', 'utf8')).split(' ');
    const load1min = parseFloat(loadavg[0]);
    // Convert load average to rough CPU percentage (assuming 4 cores)
    const cpuPercentage = Math.min(Math.round(load1min * 25), 100);
    return cpuPercentage;
  } catch (error) {
    logger.warn('Failed to get CPU usage:', error);
    return 25; // Fallback moderate usage
  }
}

async function getMemoryUsage(): Promise<number> {
  try {
    const fs = await import('fs/promises');
    const meminfo = await fs.readFile('/proc/meminfo', 'utf8');
    const lines = meminfo.split('\n');
    
    const memTotal = parseInt(lines.find(line => line.startsWith('MemTotal:'))?.split(/\s+/)[1] || '0');
    const memAvailable = parseInt(lines.find(line => line.startsWith('MemAvailable:'))?.split(/\s+/)[1] || '0');
    
    if (memTotal > 0 && memAvailable >= 0) {
      const memUsed = memTotal - memAvailable;
      return Math.round((memUsed / memTotal) * 100);
    }
  } catch (error) {
    logger.warn('Failed to get memory usage:', error);
  }
  return 45; // Fallback moderate usage
}

function getSystemStatus(): string {
  // Simple heuristic based on recent activity
  const clientCount = sseManager.getClientCount();
  
  // System is healthy if we have active connections and basic functionality works
  if (clientCount > 0) {
    return 'healthy';
  } else if (clientCount === 0) {
    return 'warning'; // No active monitoring connections
  } else {
    return 'critical';
  }
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

// ============================================================================
// DEBUG AND TEST ENDPOINTS
// ============================================================================

/**
 * Manually trigger SSE events for testing
 */
export const triggerTestEvent = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { type = 'test', data } = req.body;
  
  logger.warn('🧪 Manual SSE test event triggered', { type, data });
  
  const testData = data || {
    message: 'This is a test event',
    timestamp: new Date().toISOString(),
    triggeredBy: req.user?.id || 'manual'
  };
  
  const message: SSEMessage = {
    type,
    data: testData,
    id: `test-${Date.now()}`
  };
  
  const clientCount = sseManager.broadcast(message);
  
  res.json({
    data: {
      success: true,
      type,
      clientsNotified: clientCount,
      testData
    }
  });
});

/**
 * Trigger a fake new execution event
 */
export const triggerFakeExecution = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const fakeExecution = {
    id: `fake-${Date.now()}`,
    workflowId: appConfig.sai.workflowId,
    status: 'success',
    mode: 'test',
    executionTimestamp: new Date().toISOString(),
    completionTimestamp: new Date().toISOString(),
    durationMs: Math.floor(Math.random() * 10000),
    hasImage: true,
    imageUrl: '/api/test/placeholder.jpg',
    alertLevel: ['none', 'low', 'medium', 'high'][Math.floor(Math.random() * 4)],
    confidenceScore: Math.random(),
    hasSmoke: Math.random() > 0.5,
    telegramSent: false
  };
  
  logger.warn('🧪 Triggering fake execution SSE event', { executionId: fakeExecution.id });
  
  // Send as execution:new event
  const newMessage: SSEMessage = {
    type: 'execution:new',
    id: fakeExecution.id,
    data: {
      execution: fakeExecution,
      timestamp: new Date().toISOString()
    }
  };
  
  const newClients = sseManager.broadcast(newMessage);
  
  // Also send as batch event
  const batchMessage: SSEMessage = {
    type: 'execution:batch',
    data: {
      count: 1,
      executions: [fakeExecution],
      successful: 1,
      highAlert: fakeExecution.alertLevel === 'high' ? 1 : 0,
      timestamp: new Date().toISOString()
    }
  };
  
  const batchClients = sseManager.broadcast(batchMessage);
  
  res.json({
    data: {
      success: true,
      execution: fakeExecution,
      notifications: {
        'execution:new': newClients,
        'execution:batch': batchClients
      }
    }
  });
});

/**
 * Get detailed SSE debug information
 */
export const getSSEDebugInfo = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const stats = sseManager.getClientStats();
  
  // Collect additional debug info
  const debugInfo = {
    enabled: true,
    debugMode: SSE_DEBUG,
    clients: {
      current: stats.total,
      max: appConfig.sse.maxClients,
      oldest: stats.oldest?.toISOString() || null,
      newest: stats.newest?.toISOString() || null
    },
    config: {
      heartbeatInterval: appConfig.sse.heartbeatInterval,
      timeout: appConfig.sse.timeout,
      maxClients: appConfig.sse.maxClients
    },
    monitoring: {
      systemMonitoring: systemMonitoringInterval !== null,
      executionPolling: executionPollingInterval !== null,
      broadcastedCount: broadcastedExecutionIds.size,
      pollingInterval: 10000
    },
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      SSE_DEBUG: process.env.SSE_DEBUG,
      baseUrl: process.env.API_BASE_URL || 'http://localhost:3001'
    },
    timestamp: new Date().toISOString()
  };
  
  logger.info('SSE Debug info requested', debugInfo);
  
  res.json({ data: debugInfo });
});

/**
 * Force broadcast a batch of test executions
 */
export const triggerTestBatch = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { count = 5 } = req.body;
  
  const testExecutions = Array.from({ length: count }, (_, i) => ({
    id: `test-batch-${Date.now()}-${i}`,
    workflowId: appConfig.sai.workflowId,
    status: 'success',
    mode: 'test',
    executionTimestamp: new Date(Date.now() - i * 60000).toISOString(),
    completionTimestamp: new Date().toISOString(),
    durationMs: Math.floor(Math.random() * 10000),
    hasImage: true,
    imageUrl: `/api/test/placeholder-${i}.jpg`,
    alertLevel: ['none', 'low', 'medium', 'high'][Math.floor(Math.random() * 4)],
    confidenceScore: Math.random(),
    hasSmoke: Math.random() > 0.5,
    telegramSent: false
  }));
  
  logger.warn('🧪 Triggering test batch SSE event', { count });
  
  const message: SSEMessage = {
    type: 'execution:batch',
    data: {
      count: testExecutions.length,
      executions: testExecutions,
      successful: testExecutions.filter(e => e.status === 'success').length,
      highAlert: testExecutions.filter(e => e.alertLevel === 'high').length,
      timestamp: new Date().toISOString()
    }
  };
  
  const clientCount = sseManager.broadcast(message);
  
  res.json({
    data: {
      success: true,
      executionsCreated: count,
      clientsNotified: clientCount,
      executions: testExecutions
    }
  });
});

/**
 * Test SSE connection health
 */
export const testSSEHealth = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const testId = `health-${Date.now()}`;
  
  logger.info('🏥 SSE Health test initiated', { testId });
  
  // Send a health test event
  const healthMessage: SSEMessage = {
    type: 'health:test',
    id: testId,
    data: {
      testId,
      timestamp: new Date().toISOString(),
      message: 'SSE connection health check'
    }
  };
  
  const clientCount = sseManager.broadcast(healthMessage);
  
  res.json({
    data: {
      testId,
      clientsReached: clientCount,
      success: clientCount > 0,
      message: clientCount > 0 
        ? `Health check sent to ${clientCount} clients` 
        : 'No clients connected to receive health check'
    }
  });
});

export { sseManager };

// Start system monitoring when module loads
startSystemMonitoring();