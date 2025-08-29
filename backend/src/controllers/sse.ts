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
        client.response.end();
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
      client.response.write(sseMessage);
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

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': req.get('origin') || '*',
    'Access-Control-Allow-Credentials': 'true',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });

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

// Graceful shutdown handler
process.on('SIGTERM', () => {
  sseManager.shutdown();
});

process.on('SIGINT', () => {
  sseManager.shutdown();
});

export { sseManager };