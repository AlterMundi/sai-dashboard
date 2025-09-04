/**
 * SAI Dashboard ETL Service
 * Handles real-time data processing from n8n database to sai_dashboard database
 * Processes PostgreSQL notifications and manages image extraction/caching
 * Runs side-by-side with existing system for smooth transition
 */

import { Pool } from 'pg';
import { logger } from '@/utils/logger';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

interface ETLConfig {
  n8nDatabase: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };
  saiDatabase: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };
  imageCache: {
    basePath: string;
    maxSizeBytes: number;
    generateThumbnails: boolean;
  };
  processing: {
    batchSize: number;
    retryAttempts: number;
    timeoutMs: number;
  };
}

interface ProcessedExecution {
  id: number;
  workflowId: string;
  timestamp: Date;
  completionTimestamp: Date | null;
  duration: number | null;
  status: string;
  mode: string;
  retryOf: number | null;
}

interface ExtractedAnalysis {
  executionId: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none';
  confidenceScore: number | null;
  overallAssessment: string | null;
  smokeDetected: boolean;
  flameDetected: boolean;
  heatSignatureDetected: boolean;
  motionDetected: boolean;
  modelVersion: string | null;
  processingTimeMs: number | null;
  rawResponse: string | null;
  alertPriority: 'critical' | 'high' | 'normal' | 'low';
  responseRequired: boolean;
}

interface ExtractedImage {
  executionId: number;
  base64Data: string;
  sizeBytes: number;
  format: string;
  originalPath: string;
  thumbnailPath: string | null;
  nodeId?: string;
  cameraId?: string;
}

interface NotificationData {
  executionId: number;
  telegramSent: boolean;
  telegramMessageId: number | null;
  telegramSentAt: Date | null;
}

export class ETLService {
  private n8nPool: Pool;
  private saiPool: Pool;
  private config: ETLConfig;
  private isRunning = false;
  private processingQueue: Set<number> = new Set();
  private statsCache = new Map<string, any>();
  private lastStatsUpdate = 0;

  constructor(config: ETLConfig) {
    this.config = config;
    
    // Initialize database connections
    this.n8nPool = new Pool({
      host: config.n8nDatabase.host,
      port: config.n8nDatabase.port,
      database: config.n8nDatabase.database,
      user: config.n8nDatabase.username,
      password: config.n8nDatabase.password,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.saiPool = new Pool({
      host: config.saiDatabase.host,
      port: config.saiDatabase.port,
      database: config.saiDatabase.database,
      user: config.saiDatabase.username,
      password: config.saiDatabase.password,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  /**
   * Start the ETL service with PostgreSQL LISTEN/NOTIFY
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('ETL Service already running');
      return;
    }

    try {
      // Test database connections
      await this.testConnections();
      
      // Setup PostgreSQL listeners for real-time processing
      await this.setupNotificationListeners();
      
      // Start periodic statistics updates
      this.startStatisticsUpdater();
      
      this.isRunning = true;
      logger.info('ETL Service started successfully', {
        n8nDatabase: this.config.n8nDatabase.database,
        saiDatabase: this.config.saiDatabase.database,
        imageCache: this.config.imageCache.basePath
      });

    } catch (error) {
      logger.error('Failed to start ETL Service:', error);
      throw error;
    }
  }

  /**
   * Stop the ETL service gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    
    // Wait for current processing to complete
    while (this.processingQueue.size > 0) {
      logger.info(`Waiting for ${this.processingQueue.size} executions to complete processing`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Close database connections
    await this.n8nPool.end();
    await this.saiPool.end();
    
    logger.info('ETL Service stopped gracefully');
  }

  /**
   * Test database connections
   */
  private async testConnections(): Promise<void> {
    try {
      // Test n8n database
      const n8nResult = await this.n8nPool.query('SELECT COUNT(*) as count FROM execution_entity WHERE "workflowId" = $1', ['yDbfhooKemfhMIkC']);
      logger.info('N8N Database connected', { saiExecutions: n8nResult.rows[0].count });

      // Test sai_dashboard database
      await this.saiPool.query('SELECT COUNT(*) as count FROM executions');
      logger.info('SAI Dashboard Database connected');

    } catch (error) {
      logger.error('Database connection test failed:', error);
      throw error;
    }
  }

  /**
   * Setup PostgreSQL notification listeners
   */
  private async setupNotificationListeners(): Promise<void> {
    const client = await this.n8nPool.connect();

    try {
      // Listen to notification channels from triggers
      await client.query('LISTEN new_execution');
      await client.query('LISTEN high_priority_execution');
      await client.query('LISTEN process_image');
      await client.query('LISTEN incident_update');
      await client.query('LISTEN stats_updated');
      await client.query('LISTEN etl_error');

      // Handle notifications
      client.on('notification', async (msg) => {
        try {
          const channel = msg.channel;
          const payload = JSON.parse(msg.payload || '{}');
          
          logger.debug('Received PostgreSQL notification', { channel, payload });

          switch (channel) {
            case 'new_execution':
              await this.handleNewExecution(payload);
              break;
            case 'high_priority_execution':
              await this.handleHighPriorityExecution(payload);
              break;
            case 'process_image':
              await this.handleImageProcessing(payload);
              break;
            case 'incident_update':
              await this.handleIncidentUpdate(payload);
              break;
            case 'stats_updated':
              await this.handleStatsUpdate(payload);
              break;
            case 'etl_error':
              await this.handleETLError(payload);
              break;
            default:
              logger.warn('Unknown notification channel', { channel });
          }

        } catch (error) {
          logger.error('Error handling PostgreSQL notification:', error);
        }
      });

      // Keep the connection alive for notifications
      client.on('error', (err) => {
        logger.error('PostgreSQL notification client error:', err);
        // Attempt to reconnect
        setTimeout(() => this.setupNotificationListeners(), 5000);
      });

      logger.info('PostgreSQL notification listeners established');

    } catch (error) {
      client.release();
      throw error;
    }
  }

  /**
   * Handle new execution notification
   */
  private async handleNewExecution(payload: any): Promise<void> {
    const executionId = payload.execution_id;
    
    if (!executionId || this.processingQueue.has(executionId)) {
      return;
    }

    this.processingQueue.add(executionId);

    try {
      logger.info('Processing new execution', { executionId });

      // The trigger already processed basic data, now handle additional processing
      await this.processImageExtraction(executionId);
      await this.updateDashboardCache(executionId);
      
      // Send SSE notification
      this.broadcastSSEUpdate('execution:new', {
        execution_id: executionId,
        status: payload.status,
        risk_level: payload.risk_level,
        has_image: payload.has_image,
        timestamp: payload.timestamp
      });

    } catch (error) {
      logger.error('Error processing new execution:', { executionId, error });
    } finally {
      this.processingQueue.delete(executionId);
    }
  }

  /**
   * Handle high-priority execution (immediate processing)
   */
  private async handleHighPriorityExecution(payload: any): Promise<void> {
    const { execution_id, risk_level, confidence } = payload;
    
    logger.warn('High-priority execution detected', { execution_id, risk_level, confidence });

    // Immediate SSE broadcast for critical events
    this.broadcastSSEUpdate('execution:critical', {
      execution_id,
      risk_level,
      confidence,
      timestamp: new Date().toISOString(),
      requires_attention: true
    });

    // Trigger expert review assignment if needed
    if (risk_level === 'critical' && confidence >= 0.9) {
      await this.assignExpertReview(execution_id, 1); // Priority 1 = Critical
    }
  }

  /**
   * Process image extraction and caching
   */
  private async processImageExtraction(executionId: number): Promise<void> {
    try {
      // Get execution data from n8n
      const executionData = await this.getN8NExecutionData(executionId);
      
      if (!executionData) {
        logger.debug('No execution data found for image processing', { executionId });
        return;
      }

      // Extract image from JSON payload
      const imageData = this.extractImageFromPayload(executionData);
      
      if (!imageData) {
        logger.debug('No image data found in execution', { executionId });
        return;
      }

      // Update execution with node assignment if available
      if (imageData.nodeId || imageData.cameraId) {
        await this.updateExecutionNodeAssignment(executionId, imageData.nodeId, imageData.cameraId);
      }

      // Process and cache image
      await this.cacheImage(imageData);
      
      // Update image metadata in database
      await this.updateImageMetadata(imageData);

      logger.info('Image processed and cached', {
        executionId,
        nodeId: imageData.nodeId,
        cameraId: imageData.cameraId,
        sizeBytes: imageData.sizeBytes,
        format: imageData.format
      });

    } catch (error) {
      logger.error('Image processing failed:', { executionId, error });
    }
  }

  /**
   * Update execution with node and camera assignment
   */
  private async updateExecutionNodeAssignment(executionId: number, nodeId?: string, cameraId?: string): Promise<void> {
    try {
      if (nodeId || cameraId) {
        await this.saiPool.query(`
          UPDATE executions 
          SET 
            node_id = COALESCE($2, node_id),
            camera_id = COALESCE($3, camera_id),
            updated_at = NOW()
          WHERE id = $1
        `, [executionId, nodeId, cameraId]);

        // Also update the analysis table if it exists
        await this.saiPool.query(`
          UPDATE execution_analysis 
          SET node_id = COALESCE($2, node_id)
          WHERE execution_id = $1
        `, [executionId, nodeId]);

        logger.debug('Updated execution node assignment', { 
          executionId, 
          nodeId, 
          cameraId 
        });
      }
    } catch (error) {
      logger.error('Failed to update execution node assignment:', { 
        executionId, 
        nodeId, 
        cameraId, 
        error 
      });
    }
  }

  /**
   * Extract image data from n8n execution payload
   */
  private extractImageFromPayload(executionData: any): ExtractedImage | null {
    try {
      const parsedData = typeof executionData.data === 'string' 
        ? JSON.parse(executionData.data) 
        : executionData.data;

      // Try multiple locations for image data
      let base64Data = parsedData?.nodeInputData?.Webhook?.[0]?.json?.body?.image ||
                       parsedData?.nodeInputData?.Ollama?.[0]?.json?.image ||
                       parsedData?.nodeOutputData?.Webhook?.[0]?.json?.image;

      if (!base64Data) {
        return null;
      }

      // Remove data URL prefix if present
      base64Data = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');

      const sizeBytes = Buffer.byteLength(base64Data, 'base64');
      const executionId = executionData.executionId;

      // Extract node and camera information for regional assignment
      const nodeAssignment = this.extractNodeAssignment(parsedData);

      return {
        executionId,
        base64Data,
        sizeBytes,
        format: 'jpeg', // Assume JPEG for SAI images
        originalPath: `/mnt/raid1/n8n/backup/images/by-execution/${executionId}/original.jpg`,
        thumbnailPath: `/mnt/raid1/n8n/backup/images/by-execution/${executionId}/thumb.jpg`,
        nodeId: nodeAssignment?.nodeId,
        cameraId: nodeAssignment?.cameraId
      };

    } catch (error) {
      logger.error('Failed to extract image from payload:', error);
      return null;
    }
  }

  /**
   * Extract node and camera assignment from execution data
   * Implements multiple detection strategies for robust node assignment
   */
  private extractNodeAssignment(parsedData: any): { nodeId?: string; cameraId?: string } | null {
    try {
      // Strategy 1: Direct node/camera IDs in webhook payload
      const webhookData = parsedData?.nodeInputData?.Webhook?.[0]?.json?.body;
      if (webhookData?.nodeId || webhookData?.cameraId) {
        return {
          nodeId: webhookData.nodeId,
          cameraId: webhookData.cameraId
        };
      }

      // Strategy 2: Extract from webhook URL or headers
      const webhookHeaders = parsedData?.nodeInputData?.Webhook?.[0]?.json?.headers;
      const userAgent = webhookHeaders?.['user-agent'] || webhookHeaders?.['User-Agent'];
      if (userAgent) {
        const nodeMatch = userAgent.match(/Node[_-]?(\w+)/i);
        const cameraMatch = userAgent.match(/Cam[_-]?(\w+)/i);
        
        if (nodeMatch || cameraMatch) {
          return {
            nodeId: nodeMatch ? `NODE_${nodeMatch[1].toUpperCase()}` : undefined,
            cameraId: cameraMatch ? `CAM_${cameraMatch[1].toUpperCase()}` : undefined
          };
        }
      }

      // Strategy 3: Location-based assignment using IP geolocation
      const clientIp = webhookHeaders?.['x-forwarded-for'] || 
                       webhookHeaders?.['X-Forwarded-For'] ||
                       webhookHeaders?.['x-real-ip'] ||
                       webhookHeaders?.['X-Real-IP'];
                       
      if (clientIp) {
        return this.assignNodeByIPLocation(clientIp);
      }

      // Strategy 4: Timestamp-based assignment for testing
      const timestamp = new Date();
      const hour = timestamp.getHours();
      
      // Simulate different nodes based on time (for development/testing)
      if (process.env.NODE_ENV === 'development') {
        const testNodes = ['NODE_001', 'NODE_002', 'NODE_003'];
        const testCameras = [
          'CAM_NODE001_01', 'CAM_NODE001_02', 
          'CAM_NODE002_01', 'CAM_NODE003_01'
        ];
        
        const nodeIndex = hour % testNodes.length;
        const cameraIndex = hour % testCameras.length;
        
        return {
          nodeId: testNodes[nodeIndex],
          cameraId: testCameras[cameraIndex]
        };
      }

      logger.debug('No node assignment strategy matched, using default');
      return {
        nodeId: 'NODE_001', // Default fallback node
        cameraId: 'CAM_NODE001_01' // Default fallback camera
      };

    } catch (error) {
      logger.error('Failed to extract node assignment:', error);
      return null;
    }
  }

  /**
   * Assign node based on IP geolocation (placeholder implementation)
   * In production, this would use a geolocation service
   */
  private assignNodeByIPLocation(clientIp: string): { nodeId?: string; cameraId?: string } {
    // Remove IPv6 prefix if present
    const cleanIp = clientIp.replace(/^::ffff:/, '');
    
    // Simple IP-based assignment logic (placeholder)
    // In production, you would use a geolocation service like MaxMind
    if (cleanIp.startsWith('192.168.')) {
      // Local network - development
      return { nodeId: 'NODE_001', cameraId: 'CAM_NODE001_01' };
    }
    
    // Hash IP to deterministically assign nodes
    const ipHash = this.hashString(cleanIp);
    const nodeNumbers = ['001', '002', '003', '004', '005', '006', '007'];
    const nodeIndex = ipHash % nodeNumbers.length;
    
    const selectedNode = `NODE_${nodeNumbers[nodeIndex]}`;
    const selectedCamera = `CAM_${selectedNode}_01`; // Default to first camera
    
    logger.debug('IP-based node assignment', { 
      clientIp: cleanIp, 
      nodeId: selectedNode, 
      cameraId: selectedCamera 
    });
    
    return { nodeId: selectedNode, cameraId: selectedCamera };
  }

  /**
   * Simple string hash function for deterministic node assignment
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Cache image to filesystem with hybrid JPEG+WebP optimization
   * Implements hybrid approach: JPEG originals + WebP variants for optimal performance
   */
  private async cacheImage(imageData: ExtractedImage): Promise<void> {
    try {
      const imageBuffer = Buffer.from(imageData.base64Data, 'base64');
      const executionId = imageData.executionId;
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      
      // Create hybrid directory structure
      const baseImagePath = this.config.imageCache.basePath;
      const originalsDir = path.join(baseImagePath, 'originals', timestamp.slice(0, 4), timestamp.slice(4, 6), timestamp.slice(6, 8));
      const webpDir = path.join(baseImagePath, 'webp', timestamp.slice(0, 4), timestamp.slice(4, 6), timestamp.slice(6, 8));
      const thumbsDir150 = path.join(baseImagePath, 'thumbnails', '150px');
      const thumbsDir300 = path.join(baseImagePath, 'thumbnails', '300px');
      
      // Ensure all directories exist
      await fs.mkdir(originalsDir, { recursive: true });
      await fs.mkdir(webpDir, { recursive: true });
      await fs.mkdir(thumbsDir150, { recursive: true });
      await fs.mkdir(thumbsDir300, { recursive: true });
      
      const fileBaseName = `${executionId}_${Date.now()}`;
      
      // 1. Save JPEG original (preserve quality for expert review)
      const jpegPath = path.join(originalsDir, `${fileBaseName}.jpg`);
      await sharp(imageBuffer)
        .jpeg({ quality: 95, progressive: true })
        .toFile(jpegPath);
      
      // 2. Generate WebP variant (optimized for web display)
      const webpPath = path.join(webpDir, `${fileBaseName}.webp`);
      await sharp(imageBuffer)
        .webp({ quality: 85, effort: 6 })
        .toFile(webpPath);
      
      // 3. Generate WebP thumbnails if enabled
      if (this.config.imageCache.generateThumbnails) {
        // 150px thumbnail (small)
        const thumb150Path = path.join(thumbsDir150, `${fileBaseName}.webp`);
        await sharp(imageBuffer)
          .resize(150, 150, { fit: 'cover', position: 'center' })
          .webp({ quality: 75, effort: 4 })
          .toFile(thumb150Path);
        
        // 300px thumbnail (medium)
        const thumb300Path = path.join(thumbsDir300, `${fileBaseName}.webp`);
        await sharp(imageBuffer)
          .resize(300, 300, { fit: 'cover', position: 'center' })
          .webp({ quality: 80, effort: 4 })
          .toFile(thumb300Path);
      }
      
      // Update image data paths for database storage
      imageData.originalPath = jpegPath;
      imageData.thumbnailPath = path.join(thumbsDir300, `${fileBaseName}.webp`);
      
      // Create symlinks for fast access patterns (legacy compatibility)
      await this.createImageSymlinks(imageData);

    } catch (error) {
      logger.error('Failed to cache image:', { executionId: imageData.executionId, error });
      throw error;
    }
  }

  /**
   * Create symbolic links for different access patterns
   */
  private async createImageSymlinks(imageData: ExtractedImage): Promise<void> {
    try {
      const baseDir = '/mnt/raid1/n8n/backup/images';
      const executionId = imageData.executionId;
      const timestamp = new Date();
      
      // By-date symlink: /by-date/2025/09/01/123456_original.jpg
      const dateDir = path.join(baseDir, 'by-date', 
        timestamp.getFullYear().toString(),
        (timestamp.getMonth() + 1).toString().padStart(2, '0'),
        timestamp.getDate().toString().padStart(2, '0')
      );
      
      await fs.mkdir(dateDir, { recursive: true });
      const dateLink = path.join(dateDir, `${executionId}_original.jpg`);
      
      // Create relative symlink
      const relativePath = path.relative(dateDir, imageData.originalPath);
      await fs.symlink(relativePath, dateLink).catch(() => {}); // Ignore if exists

      // By-status symlinks for quick filtering
      const analysis = await this.getAnalysisForExecution(executionId);
      if (analysis?.riskLevel && analysis.riskLevel !== 'none') {
        const statusDir = path.join(baseDir, 'by-status', analysis.riskLevel);
        await fs.mkdir(statusDir, { recursive: true });
        const statusLink = path.join(statusDir, `${executionId}.jpg`);
        const relativePathFromStatus = path.relative(statusDir, imageData.originalPath);
        await fs.symlink(relativePathFromStatus, statusLink).catch(() => {});
      }

    } catch (error) {
      // Don't fail the main process if symlink creation fails
      logger.warn('Failed to create image symlinks:', { executionId: imageData.executionId, error: (error as Error).message });
    }
  }

  /**
   * Update image metadata in sai_dashboard database
   */
  private async updateImageMetadata(imageData: ExtractedImage): Promise<void> {
    try {
      // Get image dimensions using Sharp
      const imageBuffer = Buffer.from(imageData.base64Data, 'base64');
      const metadata = await sharp(imageBuffer).metadata();

      await this.saiPool.query(`
        INSERT INTO execution_images (
          execution_id, original_path, thumbnail_path, size_bytes, 
          width, height, format, extracted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (execution_id) DO UPDATE SET
          original_path = EXCLUDED.original_path,
          thumbnail_path = EXCLUDED.thumbnail_path,
          size_bytes = EXCLUDED.size_bytes,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          format = EXCLUDED.format,
          extracted_at = EXCLUDED.extracted_at
      `, [
        imageData.executionId,
        imageData.originalPath,
        imageData.thumbnailPath,
        imageData.sizeBytes,
        metadata.width,
        metadata.height,
        imageData.format
      ]);

    } catch (error) {
      logger.error('Failed to update image metadata:', { executionId: imageData.executionId, error });
    }
  }

  /**
   * Get n8n execution data
   */
  private async getN8NExecutionData(executionId: number): Promise<any> {
    try {
      const result = await this.n8nPool.query(`
        SELECT "executionId", data 
        FROM execution_data 
        WHERE "executionId" = $1
      `, [executionId]);

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to get n8n execution data:', { executionId, error });
      return null;
    }
  }

  /**
   * Get analysis data for an execution
   */
  private async getAnalysisForExecution(executionId: number): Promise<any> {
    try {
      const result = await this.saiPool.query(`
        SELECT risk_level, confidence_score, alert_priority
        FROM execution_analysis 
        WHERE execution_id = $1
      `, [executionId]);

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to get analysis for execution:', { executionId, error });
      return null;
    }
  }

  /**
   * Assign expert review for high-priority executions
   */
  private async assignExpertReview(executionId: number, priority: number): Promise<void> {
    try {
      // Find available expert (simple round-robin for now)
      const result = await this.saiPool.query(`
        SELECT id FROM users 
        WHERE role = 'expert' AND is_active = true
        ORDER BY last_login ASC NULLS LAST
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        logger.warn('No available experts for review assignment', { executionId });
        return;
      }

      const expertId = result.rows[0].id;
      const deadline = new Date();
      deadline.setHours(deadline.getHours() + (priority === 1 ? 4 : 24)); // 4h for critical, 24h for others

      await this.saiPool.query(`
        INSERT INTO expert_reviews (
          execution_id, expert_id, priority, deadline, 
          assigned_at, assigned_by, status
        ) VALUES ($1, $2, $3, $4, NOW(), $5, 'pending')
      `, [executionId, expertId, priority, deadline, null]); // assigned_by = system

      logger.info('Expert review assigned', { executionId, expertId, priority });

      // Notify about assignment
      this.broadcastSSEUpdate('expert:assignment', {
        execution_id: executionId,
        expert_id: expertId,
        priority,
        deadline: deadline.toISOString()
      });

    } catch (error) {
      logger.error('Failed to assign expert review:', { executionId, error });
    }
  }

  /**
   * Update dashboard cache and statistics
   */
  private async updateDashboardCache(executionId: number): Promise<void> {
    // Invalidate relevant cache entries
    this.statsCache.clear();
    
    // Update real-time statistics if needed
    const now = Date.now();
    if (now - this.lastStatsUpdate > 3000) { // Update every 3 seconds (fast for testing)
      await this.updateStatistics();
      this.lastStatsUpdate = now;
    }
  }

  /**
   * Update dashboard statistics
   */
  private async updateStatistics(): Promise<void> {
    try {
      const stats = await this.calculateStatistics();
      
      // Store in cache
      this.statsCache.set('current_stats', stats);
      
      // Broadcast via SSE
      this.broadcastSSEUpdate('system:stats', stats);
      
      logger.debug('Dashboard statistics updated', stats);

    } catch (error) {
      logger.error('Failed to update statistics:', error);
    }
  }

  /**
   * Calculate current statistics
   */
  private async calculateStatistics(): Promise<any> {
    try {
      const statsResult = await this.saiPool.query(`
        SELECT 
          COUNT(*) as total_executions,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_executions,
          AVG(duration_ms) / 1000.0 as avg_processing_time,
          COUNT(CASE WHEN DATE(execution_timestamp) = CURRENT_DATE THEN 1 END) as executions_today,
          MAX(execution_timestamp) as last_execution
        FROM executions
      `);

      const riskResult = await this.saiPool.query(`
        SELECT 
          COUNT(CASE WHEN risk_level = 'high' THEN 1 END) as high_risk_today,
          COUNT(CASE WHEN risk_level = 'critical' THEN 1 END) as critical_risk_today
        FROM execution_analysis ea
        JOIN executions e ON ea.execution_id = e.id
        WHERE DATE(e.execution_timestamp) = CURRENT_DATE
      `);

      const reviewResult = await this.saiPool.query(`
        SELECT COUNT(*) as pending_reviews
        FROM expert_reviews 
        WHERE status = 'pending'
      `);

      const stats = statsResult.rows[0];
      const risk = riskResult.rows[0];
      const review = reviewResult.rows[0];

      return {
        totalExecutions: parseInt(stats.total_executions),
        successRate: stats.total_executions > 0 
          ? (parseInt(stats.successful_executions) / parseInt(stats.total_executions)) * 100 
          : 0,
        avgProcessingTime: parseFloat(stats.avg_processing_time) || 0,
        executionsToday: parseInt(stats.executions_today),
        highRiskToday: parseInt(risk.high_risk_today),
        criticalRiskToday: parseInt(risk.critical_risk_today),
        pendingReviews: parseInt(review.pending_reviews),
        lastExecution: stats.last_execution,
        updatedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Failed to calculate statistics:', error);
      return {};
    }
  }

  /**
   * Start periodic statistics updater
   */
  private startStatisticsUpdater(): void {
    // Update statistics every 3 seconds (fast for testing)
    setInterval(async () => {
      if (this.isRunning) {
        await this.updateStatistics();
      }
    }, 3000);
  }

  /**
   * Handle various notification types
   */
  private async handleImageProcessing(payload: any): Promise<void> {
    const { execution_id } = payload;
    await this.processImageExtraction(execution_id);
  }

  private async handleIncidentUpdate(payload: any): Promise<void> {
    logger.info('Incident update received', payload);
    this.broadcastSSEUpdate('incident:update', payload);
  }

  private async handleStatsUpdate(payload: any): Promise<void> {
    this.broadcastSSEUpdate('system:stats', payload);
  }

  private async handleETLError(payload: any): Promise<void> {
    logger.error('ETL processing error reported:', payload);
    this.broadcastSSEUpdate('system:error', payload);
  }

  /**
   * Broadcast SSE updates using the actual SSE manager
   */
  private broadcastSSEUpdate(type: string, data: any): void {
    try {
      // Import the SSE manager from the controllers
      const { sseManager } = require('@/controllers/sse');
      
      if (!sseManager) {
        logger.warn('SSE Manager not available for broadcast', { type });
        return;
      }
      
      const message = {
        type,
        data: {
          ...data,
          source: 'etl-service',
          timestamp: new Date().toISOString()
        }
      };
      
      const clientCount = sseManager.broadcast(message);
      
      logger.info('📢 ETL → SSE Broadcast', { 
        type, 
        clientsNotified: clientCount,
        dataKeys: Object.keys(data)
      });
      
    } catch (error) {
      logger.error('Failed to broadcast SSE update from ETL service:', { 
        type, 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get service status and statistics
   */
  getStatus(): any {
    return {
      isRunning: this.isRunning,
      processingQueue: this.processingQueue.size,
      connectionsActive: {
        n8n: this.n8nPool.totalCount,
        sai: this.saiPool.totalCount
      },
      lastStatsUpdate: new Date(this.lastStatsUpdate).toISOString(),
      cacheSize: this.statsCache.size
    };
  }
}

// Export factory function for configuration
export function createETLService(config: ETLConfig): ETLService {
  return new ETLService(config);
}

// Default configuration for production use
export const defaultETLConfig: ETLConfig = {
  n8nDatabase: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'n8n',
    username: process.env.DB_USER || 'n8n_user',
    password: process.env.DB_PASSWORD || '',
  },
  saiDatabase: {
    host: process.env.SAI_DB_HOST || 'localhost',
    port: parseInt(process.env.SAI_DB_PORT || '5432'),
    database: 'sai_dashboard',
    username: process.env.SAI_DB_USER || 'sai_dashboard_user',
    password: process.env.SAI_DB_PASSWORD || '',
  },
  imageCache: {
    basePath: '/mnt/raid1/n8n/backup/images/',
    maxSizeBytes: 50 * 1024 * 1024, // 50MB max per image
    generateThumbnails: true,
  },
  processing: {
    batchSize: 10,
    retryAttempts: 3,
    timeoutMs: 30000,
  },
};