/**
 * NEW Execution Service - Single Source of Truth
 * Uses ONLY sai_dashboard database (no more legacy system queries)
 * Simplified, clean, and focused on the new architecture
 */

import { dualDb } from '@/database/dual-pool';
import { 
  ExecutionWithImage, 
  ExecutionFilters, 
  DailySummary
} from '@/types';
import { logger } from '@/utils/logger';

export class NewExecutionService {

  /**
   * Get executions with comprehensive filtering
   * SINGLE SOURCE: sai_dashboard.executions table
   */
  async getExecutions(filters: ExecutionFilters = {}): Promise<{
    executions: ExecutionWithImage[];
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    const {
      page = 1,
      pageSize = 50,
      status,
      riskLevel,
      nodeId,
      cameraId,
      searchQuery,
      startDate,
      endDate,
      hasImage,
      telegramSent
    } = filters;

    let whereConditions = ['1=1'];
    const queryParams: any[] = [];
    let paramCount = 0;

    // Status filter
    if (status) {
      paramCount++;
      whereConditions.push(`e.status = $${paramCount}`);
      queryParams.push(status);
    }

    // Risk level filter
    if (riskLevel) {
      paramCount++;
      whereConditions.push(`ea.risk_level = $${paramCount}`);
      queryParams.push(riskLevel);
    }

    // Node-based filtering
    if (nodeId) {
      paramCount++;
      whereConditions.push(`e.node_id = $${paramCount}`);
      queryParams.push(nodeId);
    }

    // Camera filtering
    if (cameraId) {
      paramCount++;
      whereConditions.push(`e.camera_id = $${paramCount}`);
      queryParams.push(cameraId);
    }

    // Date range filtering
    if (startDate) {
      paramCount++;
      whereConditions.push(`e.execution_timestamp >= $${paramCount}`);
      queryParams.push(startDate);
    }

    if (endDate) {
      paramCount++;
      whereConditions.push(`e.execution_timestamp <= $${paramCount}`);
      queryParams.push(endDate);
    }

    // Search query (analysis text)
    if (searchQuery) {
      paramCount++;
      whereConditions.push(`ea.overall_assessment ILIKE $${paramCount}`);
      queryParams.push(`%${searchQuery}%`);
    }

    // Has image filter
    if (hasImage !== undefined) {
      paramCount++;
      if (hasImage) {
        whereConditions.push(`ei.original_path IS NOT NULL`);
      } else {
        whereConditions.push(`ei.original_path IS NULL`);
      }
    }

    // Telegram sent filter
    if (telegramSent !== undefined) {
      paramCount++;
      whereConditions.push(`en.telegram_sent = $${paramCount}`);
      queryParams.push(telegramSent);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT e.id) as total
      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
      LEFT JOIN execution_notifications en ON e.id = en.execution_id
      WHERE ${whereClause}
    `;

    const countResult = await dualDb.query(countQuery, queryParams);
    const total = parseInt(countResult[0].total);
    const totalPages = Math.ceil(total / pageSize);

    // Get executions with all related data
    // Handle both 0-based and 1-based page indexing from frontend
    const normalizedPage = page < 1 ? 1 : page;
    const offset = (normalizedPage - 1) * pageSize;
    const executionsQuery = `
      SELECT 
        e.id,
        e.workflow_id,
        e.execution_timestamp,
        e.completion_timestamp,
        e.duration_ms,
        e.status,
        e.mode,
        e.node_id,
        e.camera_id,
        
        -- Analysis data
        ea.risk_level,
        ea.confidence_score,
        ea.overall_assessment,
        ea.smoke_detected,
        ea.flame_detected,
        ea.heat_signature_detected,
        ea.alert_priority,
        ea.response_required,
        
        -- Image data
        ei.original_path,
        ei.size_bytes,
        ei.format,
        
        -- Notification data  
        en.telegram_sent,
        en.telegram_message_id,
        en.telegram_sent_at

      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
      LEFT JOIN execution_notifications en ON e.id = en.execution_id
      WHERE ${whereClause}
      ORDER BY e.execution_timestamp DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    queryParams.push(pageSize, offset);

    const executions = await dualDb.query(executionsQuery, queryParams);

    return {
      executions: executions.map(this.transformExecution),
      pagination: {
        total,
        page: normalizedPage,
        pageSize,
        totalPages
      }
    };
  }

  /**
   * Get single execution by ID
   * SINGLE SOURCE: sai_dashboard database only
   */
  async getExecutionById(id: number): Promise<ExecutionWithImage | null> {
    const query = `
      SELECT 
        e.id,
        e.workflow_id,
        e.execution_timestamp,
        e.completion_timestamp,
        e.duration_ms,
        e.status,
        e.mode,
        e.node_id,
        e.camera_id,
        
        -- Analysis data
        ea.risk_level,
        ea.confidence_score,
        ea.overall_assessment,
        ea.smoke_detected,
        ea.flame_detected,
        ea.heat_signature_detected,
        ea.model_version,
        ea.processing_time_ms,
        ea.alert_priority,
        ea.response_required,
        
        -- Image data
        ei.original_path,
        ei.size_bytes,
        ei.format,
        ei.extracted_at,
        
        -- Notification data
        en.telegram_sent,
        en.telegram_message_id,
        en.telegram_sent_at

      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
      LEFT JOIN execution_notifications en ON e.id = en.execution_id
      WHERE e.id = $1
    `;

    const results = await dualDb.query(query, [id]);
    
    if (results.length === 0) {
      return null;
    }

    return this.transformExecution(results[0]);
  }

  /**
   * Get daily summary statistics
   * SINGLE SOURCE: sai_dashboard database only
   */
  async getDailySummary(days: number = 7): Promise<DailySummary[]> {
    const query = `
      SELECT 
        DATE(e.execution_timestamp) as date,
        COUNT(*) as total_executions,
        COUNT(CASE WHEN e.status = 'success' THEN 1 END) as successful_executions,
        COUNT(CASE WHEN ea.risk_level = 'high' THEN 1 END) as high_risk_detections,
        COUNT(CASE WHEN ea.risk_level = 'critical' THEN 1 END) as critical_detections,
        COUNT(CASE WHEN ei.execution_id IS NOT NULL THEN 1 END) as executions_with_images,
        COUNT(CASE WHEN en.telegram_sent = true THEN 1 END) as telegram_notifications_sent,
        AVG(e.duration_ms) as avg_processing_time_ms,
        AVG(ea.confidence_score) as avg_confidence_score

      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
      LEFT JOIN execution_notifications en ON e.id = en.execution_id
      WHERE e.execution_timestamp >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(e.execution_timestamp)
      ORDER BY date DESC
    `;

    const results = await dualDb.query(query);

    return results.map((row: any) => {
      const totalExecutions = parseInt(row.total_executions);
      const successfulExecutions = parseInt(row.successful_executions);
      const failedExecutions = totalExecutions - successfulExecutions;
      
      return {
        date: row.date,
        totalExecutions,
        successfulExecutions,
        failedExecutions,
        successRate: totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0,
        avgExecutionTime: parseFloat(row.avg_processing_time_ms) / 1000 || null, // Convert to seconds
        highRiskDetections: parseInt(row.high_risk_detections),
        criticalDetections: parseInt(row.critical_detections),
        executionsWithImages: parseInt(row.executions_with_images),
        telegramNotificationsSent: parseInt(row.telegram_notifications_sent),
        avgProcessingTimeMs: parseFloat(row.avg_processing_time_ms) || 0,
        avgConfidenceScore: parseFloat(row.avg_confidence_score) || 0
      };
    });
  }

  /**
   * Get execution statistics
   * SINGLE SOURCE: sai_dashboard database only
   */
  async getExecutionStats(): Promise<{
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;
    avgProcessingTime: number;
    totalWithImages: number;
    totalAnalyzed: number;
    riskLevelBreakdown: { [key: string]: number };
    recentActivity: { hour: string; count: number }[];
  }> {
    // Basic statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_executions,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_executions,
        COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_executions,
        AVG(duration_ms) as avg_processing_time,
        COUNT(CASE WHEN ei.execution_id IS NOT NULL THEN 1 END) as total_with_images,
        COUNT(CASE WHEN ea.execution_id IS NOT NULL THEN 1 END) as total_analyzed

      FROM executions e
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
    `;

    const statsResult = await dualDb.query(statsQuery);
    const stats = statsResult[0];

    // Risk level breakdown
    const riskQuery = `
      SELECT risk_level, COUNT(*) as count
      FROM execution_analysis
      GROUP BY risk_level
    `;

    const riskResults = await dualDb.query(riskQuery);
    const riskLevelBreakdown: { [key: string]: number } = {};
    riskResults.forEach((row: any) => {
      riskLevelBreakdown[row.risk_level] = parseInt(row.count);
    });

    // Recent activity (last 24 hours)
    const activityQuery = `
      SELECT 
        EXTRACT(HOUR FROM execution_timestamp) as hour,
        COUNT(*) as count
      FROM executions
      WHERE execution_timestamp >= NOW() - INTERVAL '24 hours'
      GROUP BY EXTRACT(HOUR FROM execution_timestamp)
      ORDER BY hour
    `;

    const activityResults = await dualDb.query(activityQuery);
    const recentActivity = activityResults.map((row: any) => ({
      hour: row.hour.toString().padStart(2, '0') + ':00',
      count: parseInt(row.count)
    }));

    const totalExecutions = parseInt(stats.total_executions);
    const successfulExecutions = parseInt(stats.successful_executions);

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions: parseInt(stats.failed_executions),
      successRate: totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0,
      avgProcessingTime: parseFloat(stats.avg_processing_time) || 0,
      totalWithImages: parseInt(stats.total_with_images),
      totalAnalyzed: parseInt(stats.total_analyzed),
      riskLevelBreakdown,
      recentActivity
    };
  }

  /**
   * Search executions by analysis content
   * SINGLE SOURCE: sai_dashboard database only
   */
  async searchExecutions(query: string, limit: number = 50): Promise<ExecutionWithImage[]> {
    const searchQuery = `
      SELECT 
        e.id,
        e.workflow_id,
        e.execution_timestamp,
        e.completion_timestamp,
        e.duration_ms,
        e.status,
        e.mode,
        e.node_id,
        e.camera_id,
        
        -- Analysis data
        ea.risk_level,
        ea.confidence_score,
        ea.overall_assessment,
        ea.smoke_detected,
        ea.flame_detected,
        ea.heat_signature_detected,
        ea.alert_priority,
        ea.response_required,
        
        -- Image data
        ei.original_path,
        ei.size_bytes,
        ei.format,
        
        -- Notification data
        en.telegram_sent,
        en.telegram_message_id,
        en.telegram_sent_at

      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
      LEFT JOIN execution_notifications en ON e.id = en.execution_id
      WHERE ea.overall_assessment ILIKE $1
      ORDER BY e.execution_timestamp DESC
      LIMIT $2
    `;

    const results = await dualDb.query(searchQuery, [`%${query}%`, limit]);
    return results.map(this.transformExecution);
  }

  /**
   * Transform database row to ExecutionWithImage interface
   */
  private transformExecution(row: any): ExecutionWithImage {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      executionTimestamp: row.execution_timestamp,
      completionTimestamp: row.completion_timestamp,
      durationMs: row.duration_ms,
      status: row.status,
      mode: row.mode || 'webhook',
      
      // Node and Camera data
      nodeId: row.node_id,
      cameraId: row.camera_id,

      // Analysis data
      riskLevel: row.risk_level || 'none',
      confidenceScore: parseFloat(row.confidence_score) || null,
      overallAssessment: row.overall_assessment || null,
      smokeDetected: row.smoke_detected || false,
      flameDetected: row.flame_detected || false,
      heatSignatureDetected: row.heat_signature_detected || false,
      alertPriority: row.alert_priority || 'low',
      responseRequired: row.response_required || false,

      // Image data
      hasImage: !!row.original_path,
      imagePath: row.original_path || null,
      imageSizeBytes: row.size_bytes || null,
      imageFormat: row.format || null,

      // Notification data
      telegramSent: row.telegram_sent || false,
      telegramMessageId: row.telegram_message_id || null,
      telegramSentAt: row.telegram_sent_at || null,

      // Metadata
      modelVersion: row.model_version || null,
      processingTimeMs: row.processing_time_ms || null,
      extractedAt: row.extracted_at || null
    };
  }

  /**
   * Get raw execution data (for debugging/analysis)
   * SINGLE SOURCE: sai_dashboard database only
   */
  async getExecutionData(id: number): Promise<any> {
    const query = `
      SELECT 
        e.*,
        ea.*,
        ei.*,
        en.*
      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
      LEFT JOIN execution_notifications en ON e.id = en.execution_id
      WHERE e.id = $1
    `;

    const results = await dualDb.query(query, [id]);
    
    if (results.length === 0) {
      return null;
    }

    return {
      execution: results[0],
      raw: results[0]
    };
  }

  /**
   * Get enhanced statistics with detailed breakdowns
   * SINGLE SOURCE: sai_dashboard database only
   */
  async getEnhancedStatistics(): Promise<{
    basicStats: any;
    riskAnalysis: any;
    timeAnalysis: any;
    nodeAnalysis: any;
    imageAnalysis: any;
  }> {
    // Basic statistics
    const basicStats = await this.getExecutionStats();

    // Risk analysis over time
    const riskQuery = `
      SELECT 
        DATE_TRUNC('day', e.execution_timestamp) as date,
        ea.risk_level,
        COUNT(*) as count,
        AVG(ea.confidence_score) as avg_confidence
      FROM executions e
      JOIN execution_analysis ea ON e.id = ea.execution_id
      WHERE e.execution_timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', e.execution_timestamp), ea.risk_level
      ORDER BY date DESC, ea.risk_level
    `;

    const riskResults = await dualDb.query(riskQuery);

    // Time analysis (hourly patterns)
    const timeQuery = `
      SELECT 
        EXTRACT(HOUR FROM execution_timestamp) as hour,
        COUNT(*) as total,
        COUNT(CASE WHEN ea.risk_level IN ('high', 'critical') THEN 1 END) as high_risk
      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      WHERE e.execution_timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY EXTRACT(HOUR FROM execution_timestamp)
      ORDER BY hour
    `;

    const timeResults = await dualDb.query(timeQuery);

    // Node analysis (if available)
    const nodeQuery = `
      SELECT 
        e.node_id,
        COUNT(*) as total_executions,
        COUNT(CASE WHEN ea.risk_level IN ('high', 'critical') THEN 1 END) as high_risk,
        AVG(ea.confidence_score) as avg_confidence
      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      WHERE e.node_id IS NOT NULL
      GROUP BY e.node_id
      ORDER BY high_risk DESC, total_executions DESC
    `;

    const nodeResults = await dualDb.query(nodeQuery);

    // Image analysis
    const imageQuery = `
      SELECT 
        COUNT(e.id) as total_executions,
        COUNT(ei.execution_id) as with_images,
        AVG(ei.size_bytes) as avg_image_size,
        COUNT(CASE WHEN ei.format = 'jpeg' THEN 1 END) as jpeg_count
      FROM executions e
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
    `;

    const imageResults = await dualDb.query(imageQuery);

    return {
      basicStats,
      riskAnalysis: riskResults,
      timeAnalysis: timeResults,
      nodeAnalysis: nodeResults,
      imageAnalysis: imageResults[0]
    };
  }

  /**
   * Check system health
   */
  async getSystemHealth(): Promise<{
    database: boolean;
    totalExecutions: number;
    recentExecutions: number;
    etlHealth: boolean;
  }> {
    try {
      // Test database connection
      const healthQuery = `
        SELECT 
          COUNT(*) as total_executions,
          COUNT(CASE WHEN execution_timestamp >= NOW() - INTERVAL '1 hour' THEN 1 END) as recent_executions
        FROM executions
      `;

      const result = await dualDb.query(healthQuery);
      const stats = result[0];

      return {
        database: true,
        totalExecutions: parseInt(stats.total_executions),
        recentExecutions: parseInt(stats.recent_executions),
        etlHealth: parseInt(stats.recent_executions) > 0 // ETL is healthy if processing recent data
      };

    } catch (error) {
      logger.error('System health check failed:', error);
      return {
        database: false,
        totalExecutions: 0,
        recentExecutions: 0,
        etlHealth: false
      };
    }
  }
}

// Export singleton instance
export const newExecutionService = new NewExecutionService();