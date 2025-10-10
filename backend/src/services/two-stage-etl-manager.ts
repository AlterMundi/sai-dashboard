/**
 * Two-Stage ETL Manager
 *
 * Coordinates Stage 1 (fast trigger-based) and Stage 2 (async deep processing)
 * ETL services for the SAI Dashboard.
 *
 * Architecture:
 * - Stage 1: Immediate extraction from execution_entity (< 100ms)
 * - Stage 2: Deep extraction from execution_data JSON (1-5 seconds)
 *
 * See: docs/TWO_STAGE_ETL_ARCHITECTURE.md
 * See: docs/DATA_INTEGRITY_PRINCIPLES.md
 */

import { EventEmitter } from 'events';
import { stage1ETLService } from './stage1-etl-service';
import { stage2ETLService } from './stage2-etl-service';
import { logger } from '@/utils/logger';

export class TwoStageETLManager extends EventEmitter {
  private isRunning = false;

  /**
   * Start both ETL stages
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Two-Stage ETL Manager already running');
      return;
    }

    logger.info('🚀 Starting Two-Stage ETL Manager...');

    try {
      // Start Stage 1 (fast trigger-based)
      await stage1ETLService.start();

      // Start Stage 2 (async deep processing)
      await stage2ETLService.start();

      this.isRunning = true;

      logger.info('✅ Two-Stage ETL Manager started successfully', {
        stage1: 'listening for PostgreSQL notifications',
        stage2: 'polling processing queue'
      });

      // Forward events from both stages
      this.setupEventForwarding();

      this.emit('started');
    } catch (error) {
      logger.error('❌ Failed to start Two-Stage ETL Manager:', error);
      throw error;
    }
  }

  /**
   * Stop both ETL stages gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('🛑 Stopping Two-Stage ETL Manager...');

    try {
      // Stop Stage 2 first (finish processing current batch)
      await stage2ETLService.stop();

      // Then stop Stage 1 (stop receiving new notifications)
      await stage1ETLService.stop();

      this.isRunning = false;

      logger.info('✅ Two-Stage ETL Manager stopped successfully');

      this.emit('stopped');
    } catch (error) {
      logger.error('❌ Error stopping Two-Stage ETL Manager:', error);
      throw error;
    }
  }

  /**
   * Forward events from both stages for monitoring
   */
  private setupEventForwarding(): void {
    // Stage 1 events
    stage1ETLService.on('execution_processed', (data) => {
      this.emit('stage1:execution_processed', data);
    });

    // Stage 2 events
    stage2ETLService.on('execution_processed', (data) => {
      this.emit('stage2:execution_processed', data);
    });
  }

  /**
   * Get combined metrics from both stages
   */
  getMetrics() {
    const stage1Metrics = stage1ETLService.getMetrics();
    const stage2Metrics = stage2ETLService.getMetrics();

    return {
      is_running: this.isRunning,
      stage1: {
        ...stage1Metrics,
        description: 'Fast trigger-based extraction'
      },
      stage2: {
        ...stage2Metrics,
        description: 'Deep async processing'
      },
      pipeline: {
        total_processed: stage1Metrics.processed,
        fully_processed: stage2Metrics.processed,
        pending_deep_extraction: stage1Metrics.processed - stage2Metrics.processed,
        total_failed: stage1Metrics.failed + stage2Metrics.failed
      }
    };
  }

  /**
   * Get queue health
   */
  async getQueueHealth() {
    return await stage1ETLService.getQueueHealth();
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      services: {
        stage1: stage1ETLService.getMetrics().is_running,
        stage2: stage2ETLService.getMetrics().is_running
      }
    };
  }
}

// Export singleton instance
export const twoStageETLManager = new TwoStageETLManager();
