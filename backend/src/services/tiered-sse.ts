/**
 * Tiered SSE Update System
 * Implements granular update frequencies for different types of data
 * Integrates with ETL service and existing SSE infrastructure
 */

import { SSEMessage, SSEClient } from '@/types';
import { logger } from '@/utils/logger';
import { EventEmitter } from 'events';

export interface TieredSSEConfig {
  updateIntervals: {
    critical: number;      // Immediate (0ms)
    executions: number;    // New executions batch (10s)
    statistics: number;    // System stats (30s) 
    health: number;        // System health (60s)
    incidents: number;     // Incident updates (15s)
    expertReviews: number; // Expert review updates (45s)
  };
  batchSizes: {
    executions: number;    // Max executions per batch
    notifications: number; // Max notifications per batch
  };
  priorities: {
    critical: number;      // 1 = highest priority
    high: number;          // 2
    normal: number;        // 3
    low: number;           // 4
    maintenance: number;   // 5 = lowest priority
  };
}

export interface PriorityMessage extends SSEMessage {
  priority: number;
  scheduledFor?: number; // Unix timestamp
  batchGroup?: string;   // For batching similar messages
}

export interface UpdateSchedule {
  type: string;
  interval: number;
  lastUpdate: number;
  isActive: boolean;
  callback: () => Promise<any>;
}

export interface MessageBatch {
  type: string;
  messages: PriorityMessage[];
  maxSize: number;
  flushInterval: number;
  lastFlush: number;
}

export class TieredSSEManager extends EventEmitter {
  private config: TieredSSEConfig;
  private clients: Map<string, SSEClient> = new Map();
  private messageQueue: Map<number, PriorityMessage[]> = new Map(); // Priority -> Messages
  private updateSchedules: Map<string, UpdateSchedule> = new Map();
  private messageBatches: Map<string, MessageBatch> = new Map();
  private processingTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(config: TieredSSEConfig) {
    super();
    this.config = config;
    this.initializeMessageQueue();
    this.initializeUpdateSchedules();
    this.initializeMessageBatches();
  }

  /**
   * Initialize priority-based message queues
   */
  private initializeMessageQueue(): void {
    // Initialize queues for each priority level
    Object.values(this.config.priorities).forEach(priority => {
      this.messageQueue.set(priority, []);
    });
  }

  /**
   * Initialize update schedules for different data types
   */
  private initializeUpdateSchedules(): void {
    const schedules: Record<string, Omit<UpdateSchedule, 'lastUpdate'>> = {
      statistics: {
        type: 'statistics',
        interval: this.config.updateIntervals.statistics,
        isActive: true,
        callback: this.updateStatistics.bind(this)
      },
      health: {
        type: 'health',
        interval: this.config.updateIntervals.health,
        isActive: true,
        callback: this.updateSystemHealth.bind(this)
      },
      incidents: {
        type: 'incidents',
        interval: this.config.updateIntervals.incidents,
        isActive: true,
        callback: this.updateIncidents.bind(this)
      },
      expertReviews: {
        type: 'expertReviews',
        interval: this.config.updateIntervals.expertReviews,
        isActive: true,
        callback: this.updateExpertReviews.bind(this)
      }
    };

    Object.entries(schedules).forEach(([key, schedule]) => {
      this.updateSchedules.set(key, {
        ...schedule,
        lastUpdate: 0
      });
    });
  }

  /**
   * Initialize message batching for similar message types
   */
  private initializeMessageBatches(): void {
    this.messageBatches.set('executions', {
      type: 'execution:batch',
      messages: [],
      maxSize: this.config.batchSizes.executions,
      flushInterval: this.config.updateIntervals.executions,
      lastFlush: 0
    });

    this.messageBatches.set('notifications', {
      type: 'notification:batch',
      messages: [],
      maxSize: this.config.batchSizes.notifications,
      flushInterval: 5000, // 5 seconds for notifications
      lastFlush: 0
    });
  }

  /**
   * Start the tiered SSE system
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Tiered SSE Manager already running');
      return;
    }

    this.isRunning = true;
    
    // Start main processing loop (runs every second)
    this.processingTimer = setInterval(() => {
      this.processMessageQueue();
      this.processScheduledUpdates();
      this.processMessageBatches();
    }, 1000);

    logger.info('Tiered SSE Manager started', {
      updateIntervals: this.config.updateIntervals,
      batchSizes: this.config.batchSizes
    });
  }

  /**
   * Stop the tiered SSE system
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    // Flush remaining batches
    this.messageBatches.forEach((batch, key) => {
      if (batch.messages.length > 0) {
        this.flushMessageBatch(key);
      }
    });

    logger.info('Tiered SSE Manager stopped');
  }

  /**
   * Add a client to receive updates
   */
  addClient(clientId: string, client: SSEClient): void {
    this.clients.set(clientId, client);
    logger.debug('Client added to Tiered SSE', { clientId, totalClients: this.clients.size });
  }

  /**
   * Remove a client
   */
  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    logger.debug('Client removed from Tiered SSE', { clientId, totalClients: this.clients.size });
  }

  /**
   * Queue a message with priority
   */
  queueMessage(message: PriorityMessage): void {
    if (!this.isRunning) return;

    const priority = message.priority || this.config.priorities.normal;
    const queue = this.messageQueue.get(priority);
    
    if (!queue) {
      logger.warn('Invalid priority level', { priority });
      return;
    }

    // Add timestamp if not provided
    if (!message.scheduledFor) {
      message.scheduledFor = Date.now();
    }

    // Handle batching for specific message types
    if (message.batchGroup) {
      this.addToBatch(message.batchGroup, message);
      return;
    }

    queue.push(message);
    
    logger.debug('Message queued', { 
      type: message.type, 
      priority, 
      queueSize: queue.length,
      immediate: priority === this.config.priorities.critical
    });

    // Process critical messages immediately
    if (priority === this.config.priorities.critical) {
      setImmediate(() => this.processCriticalMessages());
    }
  }

  /**
   * Add message to batch for later processing
   */
  private addToBatch(batchGroup: string, message: PriorityMessage): void {
    const batch = this.messageBatches.get(batchGroup);
    
    if (!batch) {
      logger.warn('Unknown batch group', { batchGroup });
      return;
    }

    batch.messages.push(message);

    // Flush batch if it reaches max size
    if (batch.messages.length >= batch.maxSize) {
      this.flushMessageBatch(batchGroup);
    }
  }

  /**
   * Process the message queue by priority
   */
  private processMessageQueue(): void {
    const now = Date.now();

    // Process messages in priority order
    const priorities = Array.from(this.messageQueue.keys()).sort((a, b) => a - b);

    for (const priority of priorities) {
      const queue = this.messageQueue.get(priority)!;
      
      // Process messages that are due
      const dueMessages = queue.filter(msg => (msg.scheduledFor || 0) <= now);
      
      if (dueMessages.length > 0) {
        // Remove due messages from queue
        this.messageQueue.set(priority, queue.filter(msg => (msg.scheduledFor || 0) > now));
        
        // Send messages
        dueMessages.forEach(message => this.broadcastMessage(message));
      }

      // Limit processing per cycle to prevent blocking
      if (dueMessages.length >= 50) break;
    }
  }

  /**
   * Process critical messages immediately
   */
  private processCriticalMessages(): void {
    const criticalQueue = this.messageQueue.get(this.config.priorities.critical)!;
    const messages = criticalQueue.splice(0); // Take all critical messages

    messages.forEach(message => this.broadcastMessage(message));
  }

  /**
   * Process scheduled updates
   */
  private processScheduledUpdates(): void {
    const now = Date.now();

    this.updateSchedules.forEach((schedule, key) => {
      if (!schedule.isActive) return;

      const timeSinceLastUpdate = now - schedule.lastUpdate;
      
      if (timeSinceLastUpdate >= schedule.interval) {
        // Run the update callback
        schedule.callback()
          .then(result => {
            if (result) {
              this.queueMessage({
                type: `system:${schedule.type}`,
                data: result,
                priority: this.config.priorities.normal,
                scheduledFor: now
              });
            }
          })
          .catch(error => {
            logger.error(`Scheduled update failed for ${key}:`, error);
          });

        schedule.lastUpdate = now;
      }
    });
  }

  /**
   * Process message batches
   */
  private processMessageBatches(): void {
    const now = Date.now();

    this.messageBatches.forEach((batch, key) => {
      const timeSinceFlush = now - batch.lastFlush;
      
      if (batch.messages.length > 0 && timeSinceFlush >= batch.flushInterval) {
        this.flushMessageBatch(key);
      }
    });
  }

  /**
   * Flush a message batch
   */
  private flushMessageBatch(batchKey: string): void {
    const batch = this.messageBatches.get(batchKey);
    
    if (!batch || batch.messages.length === 0) return;

    const batchMessage: PriorityMessage = {
      type: batch.type,
      data: {
        batch: batchKey,
        count: batch.messages.length,
        messages: batch.messages.map(msg => msg.data),
        timestamp: new Date().toISOString()
      },
      priority: this.config.priorities.normal
    };

    // Clear the batch
    batch.messages = [];
    batch.lastFlush = Date.now();

    // Send the batched message
    this.broadcastMessage(batchMessage);

    logger.debug('Message batch flushed', { 
      batchKey, 
      count: batchMessage.data?.count || 0
    });
  }

  /**
   * Broadcast a message to all connected clients
   */
  private broadcastMessage(message: SSEMessage): void {
    if (this.clients.size === 0) return;

    let successCount = 0;
    const deadClients: string[] = [];

    for (const [clientId, client] of this.clients) {
      try {
        const sseFormatted = this.formatSSEMessage(message);
        (client.response as any).write(sseFormatted);
        successCount++;
      } catch (error) {
        logger.warn('Failed to send to SSE client', { clientId, error: (error as Error).message });
        deadClients.push(clientId);
      }
    }

    // Clean up dead clients
    deadClients.forEach(clientId => this.removeClient(clientId));

    if (successCount > 0) {
      logger.debug('Message broadcasted', { 
        type: message.type, 
        successCount,
        totalClients: this.clients.size
      });
    }
  }

  /**
   * Format message for SSE
   */
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

  /**
   * Scheduled update callbacks
   */
  private async updateStatistics(): Promise<any> {
    try {
      // This will be integrated with ETL service
      // For now, return placeholder data
      return {
        totalExecutions: 4893,
        successRate: 99.96,
        avgProcessingTime: 4.2,
        highRiskToday: 3,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to update statistics:', error);
      return null;
    }
  }

  private async updateSystemHealth(): Promise<any> {
    try {
      // System health check implementation
      return {
        cpu: 25,
        memory: 45,
        diskSpace: 67,
        databaseConnections: 8,
        status: 'healthy',
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to update system health:', error);
      return null;
    }
  }

  private async updateIncidents(): Promise<any> {
    try {
      // Check for active incidents
      return {
        activeIncidents: 0,
        resolvedToday: 2,
        pendingInvestigation: 1,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to update incidents:', error);
      return null;
    }
  }

  private async updateExpertReviews(): Promise<any> {
    try {
      // Check expert review status
      return {
        pendingReviews: 5,
        completedToday: 12,
        overdueReviews: 1,
        expertsOnline: 3,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to update expert reviews:', error);
      return null;
    }
  }

  /**
   * Public methods for external integration
   */

  // Immediate critical alerts
  sendCriticalAlert(data: any): void {
    this.queueMessage({
      type: 'alert:critical',
      data,
      priority: this.config.priorities.critical
    });
  }

  // High-priority execution updates
  sendExecutionUpdate(execution: any, priority: 'high' | 'normal' = 'normal'): void {
    const messagePriority = priority === 'high' 
      ? this.config.priorities.high 
      : this.config.priorities.normal;

    this.queueMessage({
      type: 'execution:new',
      data: execution,
      priority: messagePriority,
      batchGroup: 'executions'
    });
  }

  // Incident notifications
  sendIncidentUpdate(incident: any): void {
    this.queueMessage({
      type: 'incident:update',
      data: incident,
      priority: this.config.priorities.high
    });
  }

  // Expert review notifications
  sendExpertReviewUpdate(review: any): void {
    this.queueMessage({
      type: 'expert:review',
      data: review,
      priority: this.config.priorities.normal
    });
  }

  // System notifications
  sendSystemNotification(notification: any, priority: 'high' | 'normal' | 'low' = 'normal'): void {
    const messagePriority = this.config.priorities[priority];

    this.queueMessage({
      type: 'system:notification',
      data: notification,
      priority: messagePriority,
      batchGroup: 'notifications'
    });
  }

  /**
   * Get system status
   */
  getStatus(): any {
    return {
      isRunning: this.isRunning,
      connectedClients: this.clients.size,
      queueSizes: Object.fromEntries(
        Array.from(this.messageQueue.entries()).map(([priority, queue]) => [priority, queue.length])
      ),
      batchSizes: Object.fromEntries(
        Array.from(this.messageBatches.entries()).map(([key, batch]) => [key, batch.messages.length])
      ),
      scheduleStatus: Object.fromEntries(
        Array.from(this.updateSchedules.entries()).map(([key, schedule]) => [
          key, 
          { 
            isActive: schedule.isActive, 
            lastUpdate: schedule.lastUpdate,
            nextUpdate: schedule.lastUpdate + schedule.interval
          }
        ])
      )
    };
  }
}

// Default configuration
export const defaultTieredSSEConfig: TieredSSEConfig = {
  updateIntervals: {
    critical: 0,      // Immediate
    executions: 10000, // 10 seconds
    statistics: 30000, // 30 seconds
    health: 60000,    // 60 seconds
    incidents: 15000, // 15 seconds
    expertReviews: 45000, // 45 seconds
  },
  batchSizes: {
    executions: 6,     // Max 6 executions per batch (for live strip)
    notifications: 10, // Max 10 notifications per batch
  },
  priorities: {
    critical: 1,       // Immediate processing
    high: 2,          // Process within 1 second
    normal: 3,        // Process within 5 seconds
    low: 4,           // Process within 30 seconds
    maintenance: 5,   // Process when idle
  },
};

// Export factory function
export function createTieredSSEManager(config?: Partial<TieredSSEConfig>): TieredSSEManager {
  const fullConfig = { ...defaultTieredSSEConfig, ...config };
  return new TieredSSEManager(fullConfig);
}