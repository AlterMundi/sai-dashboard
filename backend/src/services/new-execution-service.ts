/**
 * NEW Execution Service - Single Source of Truth
 * Uses ONLY sai_dashboard database (no more legacy system queries)
 * Simplified, clean, and focused on the new architecture
 */

import { dualDb } from '@/database/dual-pool';
import {
  ExecutionWithImage,
  ExecutionFilters,
  DailySummary,
  FilterOptions,
  StatsRanking
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
      alertLevel,
      alertLevels,
      nodeId,
      cameraId,
      cameraType,
      cameraTypes,
      deviceId,
      location,
      searchQuery,
      search,
      startDate: startDateRaw,
      endDate: endDateRaw,
      datePreset,
      hasImage,
      telegramSent,
      hasSmoke,
      detectionCount,
      confidenceSmoke,
      detectionMode,
      yoloModelVersion,
      detectionClasses,
      minDetectionConfidence
    } = filters;

    // Handle search/searchQuery alias
    const searchTerm = search || searchQuery;

    // Resolve datePreset to startDate/endDate (if no explicit dates given)
    let startDate = startDateRaw;
    let endDate = endDateRaw;
    if (datePreset && !startDate && !endDate) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      switch (datePreset) {
        case 'today':
          startDate = today.toISOString();
          break;
        case 'yesterday': {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          startDate = yesterday.toISOString();
          endDate = today.toISOString();
          break;
        }
        case 'last7days': {
          const d = new Date(today);
          d.setDate(d.getDate() - 7);
          startDate = d.toISOString();
          break;
        }
        case 'last30days': {
          const d = new Date(today);
          d.setDate(d.getDate() - 30);
          startDate = d.toISOString();
          break;
        }
        case 'thisMonth':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
          break;
        case 'lastMonth': {
          const firstOfLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const firstOfThis = new Date(now.getFullYear(), now.getMonth(), 1);
          startDate = firstOfLast.toISOString();
          endDate = firstOfThis.toISOString();
          break;
        }
      }
    }

    let whereConditions = ['1=1'];
    const queryParams: any[] = [];
    let paramCount = 0;

    // Status filter
    if (status) {
      paramCount++;
      whereConditions.push(`e.status = $${paramCount}`);
      queryParams.push(status);
    }

    // Alert level filter (single or multi-select)
    if (alertLevels && alertLevels.length > 0) {
      // Multi-select: alert_level IN ('critical', 'high')
      paramCount++;
      whereConditions.push(`ea.alert_level = ANY($${paramCount})`);
      queryParams.push(alertLevels);
    } else if (alertLevel) {
      // Legacy single selection
      paramCount++;
      whereConditions.push(`ea.alert_level = $${paramCount}`);
      queryParams.push(alertLevel);
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

    // Camera type filtering (single or multi-select)
    if (cameraTypes && cameraTypes.length > 0) {
      // Multi-select: camera_type IN ('onvif', 'rtsp')
      paramCount++;
      whereConditions.push(`e.camera_type = ANY($${paramCount})`);
      queryParams.push(cameraTypes);
    } else if (cameraType) {
      // Legacy single selection
      paramCount++;
      whereConditions.push(`e.camera_type = $${paramCount}`);
      queryParams.push(cameraType);
    }

    // Device ID filtering (NEW - was missing!)
    if (deviceId) {
      paramCount++;
      whereConditions.push(`e.device_id ILIKE $${paramCount}`);
      queryParams.push(`%${deviceId}%`);
    }

    // Location filtering (NEW - direct match)
    if (location) {
      paramCount++;
      whereConditions.push(`e.location ILIKE $${paramCount}`);
      queryParams.push(`%${location}%`);
    }

    // Date range filtering
    // With TIMESTAMPTZ columns, PostgreSQL correctly handles ISO strings with Z suffix
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

    // Search query (location, device, camera) - only if not already filtered by specific fields
    if (searchTerm && !location && !deviceId && !cameraId) {
      paramCount++;
      whereConditions.push(`(
        e.location ILIKE $${paramCount} OR
        e.device_id ILIKE $${paramCount} OR
        e.camera_id ILIKE $${paramCount}
      )`);
      queryParams.push(`%${searchTerm}%`);
    }

    // YOLO-specific filters (execution_analysis table)

    // Smoke detection filter (NEW - was missing!)
    if (hasSmoke !== undefined) {
      paramCount++;
      whereConditions.push(`ea.has_smoke = $${paramCount}`);
      queryParams.push(hasSmoke);
    }

    // Detection count filter (NEW)
    if (detectionCount !== undefined) {
      paramCount++;
      whereConditions.push(`ea.detection_count >= $${paramCount}`);
      queryParams.push(detectionCount);
    }

    // Smoke confidence filter (NEW)
    if (confidenceSmoke !== undefined) {
      paramCount++;
      whereConditions.push(`ea.confidence_smoke >= $${paramCount}`);
      queryParams.push(confidenceSmoke);
    }

    // Detection mode filter (NEW)
    if (detectionMode) {
      paramCount++;
      whereConditions.push(`ea.detection_mode = $${paramCount}`);
      queryParams.push(detectionMode);
    }

    // YOLO model version filter
    if (yoloModelVersion) {
      paramCount++;
      whereConditions.push(`ea.yolo_model_version ILIKE $${paramCount}`);
      queryParams.push(`%${yoloModelVersion}%`);
    }

    // Advanced detection filters (JSONB)
    if (detectionClasses && detectionClasses.length > 0) {
      // Filter by specific detection classes in the JSONB array
      paramCount++;
      whereConditions.push(`ea.active_classes && $${paramCount}`);
      queryParams.push(detectionClasses);
    }

    if (minDetectionConfidence !== undefined) {
      // Filter by minimum confidence in any detection
      paramCount++;
      whereConditions.push(`ea.confidence_score >= $${paramCount}`);
      queryParams.push(minDetectionConfidence);
    }

    // JSONB detection queries (advanced)
    // Example: Find executions with fire detections above 0.8 confidence
    // WHERE detections @> '[{"class": "fire"}]'::jsonb
    //   AND detections @@ '$[*] ? (@.class == "fire" && @.confidence > 0.8)'

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
        e.device_id,
        e.location,
        e.camera_type,
        e.capture_timestamp,

        -- YOLO Analysis data
        ea.request_id,
        ea.yolo_model_version,
        ea.detection_count,
        ea.has_smoke,
        ea.alert_level,
        ea.detection_mode,
        ea.active_classes,
        ea.detections,
        ea.confidence_smoke,
        ea.yolo_processing_time_ms,

        -- General confidence score
        ea.confidence_score,

        -- Image dimensions (from YOLO analysis)
        ea.image_width,
        ea.image_height,

        -- Image data
        ei.original_path,
        ei.thumbnail_path,
        ei.cached_path,
        ei.size_bytes,
        ei.format,
        ei.extracted_at,

        -- Notification data
        en.telegram_sent,
        en.telegram_message_id,
        en.telegram_sent_at,

        -- False positive tracking
        COALESCE(ea.is_false_positive, false) as is_false_positive,
        ea.false_positive_reason,
        ea.marked_false_positive_at

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
        e.device_id,
        e.location,
        e.camera_type,
        e.capture_timestamp,

        -- YOLO Analysis data
        ea.request_id,
        ea.yolo_model_version,
        ea.detection_count,
        ea.has_smoke,
        ea.alert_level,
        ea.detection_mode,
        ea.active_classes,
        ea.detections,
        ea.confidence_smoke,
        ea.yolo_processing_time_ms,

        -- General confidence score
        ea.confidence_score,

        -- Image dimensions (from YOLO analysis)
        ea.image_width,
        ea.image_height,

        -- Image data
        ei.original_path,
        ei.thumbnail_path,
        ei.cached_path,
        ei.size_bytes,
        ei.format,
        ei.extracted_at,

        -- Notification data
        en.telegram_sent,
        en.telegram_message_id,
        en.telegram_sent_at,

        -- False positive tracking
        COALESCE(ea.is_false_positive, false) as is_false_positive,
        ea.false_positive_reason,
        ea.marked_false_positive_at

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
   * Get daily/weekly/monthly summary statistics
   * SINGLE SOURCE: sai_dashboard database only
   */
  async getDailySummary(params: {
    days?: number;
    startDate?: string;
    endDate?: string;
    granularity?: 'day' | 'week' | 'month';
    cameraId?: string;
    location?: string;
    nodeId?: string;
    yoloModelVersion?: string;
  } | number = 7): Promise<DailySummary[]> {
    // Normalize params (backward compat: accept plain number)
    const p = typeof params === 'number' ? { days: params } : params;
    const granularity = p.granularity ?? 'day';
    // Granularity whitelist — invariant: only these three values ever reach SQL interpolation
    const safeGranularity = ['day', 'week', 'month'].includes(granularity) ? granularity : 'day';
    // Clamp days at service boundary (controller also clamps, but belt-and-suspenders)
    const safeDays = p.days !== undefined ? Math.min(Math.max(p.days, 1), 365) : undefined;

    const queryParams: (string | number)[] = [];
    const conditions: string[] = [];
    let paramCount = 0;

    if (p.startDate) {
      paramCount++;
      conditions.push(`e.execution_timestamp >= $${paramCount}::date`);
      queryParams.push(p.startDate);
    } else if (safeDays !== undefined) {
      paramCount++;
      conditions.push(`e.execution_timestamp >= CURRENT_DATE - make_interval(days => $${paramCount})`);
      queryParams.push(safeDays);
    }

    if (p.endDate) {
      paramCount++;
      conditions.push(`e.execution_timestamp < ($${paramCount}::date + INTERVAL '1 day')`);
      queryParams.push(p.endDate);
    }

    if (p.cameraId) {
      paramCount++;
      conditions.push(`e.camera_id = $${paramCount}`);
      queryParams.push(p.cameraId);
    }

    if (p.location) {
      paramCount++;
      conditions.push(`e.location = $${paramCount}`);
      queryParams.push(p.location);
    }

    if (p.nodeId) {
      paramCount++;
      conditions.push(`e.node_id = $${paramCount}`);
      queryParams.push(p.nodeId);
    }

    if (p.yoloModelVersion) {
      paramCount++;
      conditions.push(`ea.yolo_model_version = $${paramCount}`);
      queryParams.push(p.yoloModelVersion);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT
        DATE_TRUNC('${safeGranularity}', e.execution_timestamp)::date as date,
        COUNT(*) as total_executions,
        COUNT(CASE WHEN e.status = 'success' THEN 1 END) as successful_executions,
        COUNT(CASE WHEN ea.alert_level = 'high' THEN 1 END) as high_alert_detections,
        COUNT(CASE WHEN ea.alert_level = 'critical' THEN 1 END) as critical_detections,
        COUNT(CASE WHEN ea.alert_level = 'low' THEN 1 END) as low_alert_detections,
        COUNT(CASE WHEN ea.has_smoke = true THEN 1 END) as smoke_detections,
        COUNT(CASE WHEN ei.execution_id IS NOT NULL THEN 1 END) as executions_with_images,
        COUNT(CASE WHEN en.telegram_sent = true THEN 1 END) as telegram_notifications_sent,
        AVG(e.duration_ms) as avg_processing_time_ms,
        AVG(ea.confidence_score) as avg_confidence_score

      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
      LEFT JOIN execution_notifications en ON e.id = en.execution_id
      ${whereClause}
      GROUP BY DATE_TRUNC('${safeGranularity}', e.execution_timestamp)
      ORDER BY date DESC
    `;

    const results = await dualDb.query(query, queryParams);

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
        highRiskDetections: parseInt(row.high_alert_detections),
        criticalDetections: parseInt(row.critical_detections),
        lowAlertDetections: parseInt(row.low_alert_detections) || 0,
        smokeDetections: parseInt(row.smoke_detections) || 0,
        executionsWithImages: parseInt(row.executions_with_images),
        telegramNotificationsSent: parseInt(row.telegram_notifications_sent),
        avgProcessingTimeMs: parseFloat(row.avg_processing_time_ms) || 0,
        avgConfidenceScore: parseFloat(row.avg_confidence_score) || 0
      };
    });
  }

  /**
   * Get top cameras, locations, and nodes by detection metrics for a period
   */
  async getTopByDimension(params: {
    startDate: string;
    endDate: string;
    limit?: number;
  }): Promise<StatsRanking> {
    const { startDate, endDate } = params;
    // Clamp limit at service boundary (controller also clamps)
    const limit = Math.min(Math.max(params.limit ?? 5, 1), 50);

    // Granularity whitelist prevents SQL injection; dimension columns are hardcoded below
    const buildQuery = (dimensionCol: string) => `
      SELECT ${dimensionCol}::text as id,
        COUNT(CASE WHEN ea.has_smoke = true THEN 1 END)::int as smoke_detections,
        COUNT(CASE WHEN ea.alert_level = 'critical' THEN 1 END)::int as critical_alerts,
        COUNT(*)::int as total_executions
      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      WHERE e.execution_timestamp >= $1::date
        AND e.execution_timestamp < ($2::date + INTERVAL '1 day')
        AND ${dimensionCol} IS NOT NULL
      GROUP BY ${dimensionCol}
      ORDER BY smoke_detections DESC, critical_alerts DESC, total_executions DESC, ${dimensionCol}
      LIMIT $3
    `;

    const [cameraRows, locationRows, nodeRows] = await Promise.all([
      dualDb.query(buildQuery('e.camera_id'), [startDate, endDate, limit]),
      dualDb.query(buildQuery('e.location'), [startDate, endDate, limit]),
      dualDb.query(buildQuery('e.node_id'), [startDate, endDate, limit]),
    ]);

    const mapRows = (rows: any[]) => rows.map((r: any) => ({
      id: r.id,
      smokeDetections: parseInt(r.smoke_detections) || 0,
      criticalAlerts: parseInt(r.critical_alerts) || 0,
      totalExecutions: parseInt(r.total_executions) || 0,
    }));

    return {
      cameras: mapRows(cameraRows),
      locations: mapRows(locationRows),
      nodes: mapRows(nodeRows),
    };
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
    alertLevelBreakdown: { [key: string]: number };
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

    // Alert level breakdown
    const alertQuery = `
      SELECT alert_level, COUNT(*) as count
      FROM execution_analysis
      WHERE alert_level IS NOT NULL
      GROUP BY alert_level
    `;

    const alertResults = await dualDb.query(alertQuery);
    const alertLevelBreakdown: { [key: string]: number } = {};
    alertResults.forEach((row: any) => {
      alertLevelBreakdown[row.alert_level] = parseInt(row.count);
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
      alertLevelBreakdown,
      recentActivity
    };
  }

  /**
   * Search executions by analysis content
   * SINGLE SOURCE: sai_dashboard database only
   * OPTIMIZED: Uses GIN indexes on JSONB fields for fast text search
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
        e.device_id,
        e.location,
        e.camera_type,
        e.capture_timestamp,

        -- YOLO Analysis data
        ea.request_id,
        ea.yolo_model_version,
        ea.detection_count,
        ea.has_smoke,
        ea.alert_level,
        ea.detection_mode,
        ea.active_classes,
        ea.detections,
        ea.confidence_smoke,
        ea.yolo_processing_time_ms,

        -- General confidence score
        ea.confidence_score,

        -- Image dimensions (from YOLO analysis)
        ea.image_width,
        ea.image_height,

        -- Image data
        ei.original_path,
        ei.thumbnail_path,
        ei.cached_path,
        ei.size_bytes,
        ei.format,
        ei.extracted_at,

        -- Notification data
        en.telegram_sent,
        en.telegram_message_id,
        en.telegram_sent_at,

        -- False positive tracking
        COALESCE(ea.is_false_positive, false) as is_false_positive,
        ea.false_positive_reason,
        ea.marked_false_positive_at

      FROM executions e
      LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
      LEFT JOIN execution_images ei ON e.id = ei.execution_id
      LEFT JOIN execution_notifications en ON e.id = en.execution_id
      WHERE (
        e.location ILIKE $1 OR
        e.device_id ILIKE $1 OR
        e.camera_id ILIKE $1 OR
        -- JSONB text search in detections (uses GIN index)
        ea.detections::text ILIKE $1 OR
        -- Array search in active_classes
        EXISTS (SELECT 1 FROM unnest(ea.active_classes) AS class WHERE class ILIKE $1)
      )
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

      // YOLO Analysis data
      requestId: row.request_id || null,
      yoloModelVersion: row.yolo_model_version || null,
      detectionCount: row.detection_count || 0,
      hasSmoke: row.has_smoke || false,
      alertLevel: row.alert_level || null,
      detectionMode: row.detection_mode || null,
      activeClasses: row.active_classes || null,
      detections: row.detections
        ? (typeof row.detections === 'string' ? JSON.parse(row.detections) : row.detections)
        : null,

      // Confidence scores
      confidenceSmoke: parseFloat(row.confidence_smoke) || null,
      confidenceScore: parseFloat(row.confidence_score) || null,

      // Device and camera data
      deviceId: row.device_id || null,
      location: row.location || null,
      cameraType: row.camera_type || null,
      captureTimestamp: row.capture_timestamp || null,

      // Image data
      hasImage: !!row.original_path,
      imagePath: row.original_path || null,
      thumbnailPath: row.thumbnail_path || null,
      cachedPath: row.cached_path || null,
      imageSizeBytes: row.size_bytes || null,
      imageFormat: row.format || null,
      imageWidth: row.image_width || null,
      imageHeight: row.image_height || null,

      // Notification data
      telegramSent: row.telegram_sent || false,
      telegramMessageId: row.telegram_message_id || null,
      telegramSentAt: row.telegram_sent_at || null,

      // Processing metadata
      yoloProcessingTimeMs: parseFloat(row.yolo_processing_time_ms) || null,
      processingTimeMs: parseFloat(row.yolo_processing_time_ms) || null,
      extractedAt: row.extracted_at || null,

      // False positive tracking
      isFalsePositive: row.is_false_positive || false,
      falsePositiveReason: row.false_positive_reason || null,
      markedFalsePositiveAt: row.marked_false_positive_at || null
    };
  }

  /**
   * Mark an execution as a false positive
   */
  async markFalsePositive(
    executionId: number,
    isFalsePositive: boolean,
    reason?: string
  ): Promise<{ success: boolean; execution?: ExecutionWithImage; error?: string }> {
    try {
      // First check if execution exists
      const exists = await dualDb.query(
        'SELECT 1 FROM executions WHERE id = $1',
        [executionId]
      );

      if (exists.length === 0) {
        return { success: false, error: 'Execution not found' };
      }

      // Check if execution_analysis row exists
      const analysisExists = await dualDb.query(
        'SELECT 1 FROM execution_analysis WHERE execution_id = $1',
        [executionId]
      );

      if (analysisExists.length === 0) {
        // Create execution_analysis row if it doesn't exist
        await dualDb.query(
          `INSERT INTO execution_analysis (execution_id, is_false_positive, false_positive_reason, marked_false_positive_at)
           VALUES ($1, $2, $3, $4)`,
          [executionId, isFalsePositive, reason || null, isFalsePositive ? new Date() : null]
        );
      } else {
        // Update existing row
        await dualDb.query(
          `UPDATE execution_analysis
           SET is_false_positive = $2,
               false_positive_reason = $3,
               marked_false_positive_at = $4
           WHERE execution_id = $1`,
          [executionId, isFalsePositive, reason || null, isFalsePositive ? new Date() : null]
        );
      }

      logger.info(`Marked execution ${executionId} as ${isFalsePositive ? 'false positive' : 'valid detection'}${reason ? `: ${reason}` : ''}`);

      // Return updated execution
      const execution = await this.getExecutionById(executionId);
      return { success: true, execution: execution || undefined };

    } catch (error) {
      logger.error(`Failed to mark execution ${executionId} as false positive:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Bulk mark executions as false positives (or undo)
   */
  async bulkMarkFalsePositive(
    executionIds: number[],
    isFalsePositive: boolean,
    reason?: string
  ): Promise<{ success: boolean; updatedCount: number; error?: string }> {
    try {
      if (executionIds.length === 0) {
        return { success: true, updatedCount: 0 };
      }

      // Upsert: insert if no analysis row exists, update if it does
      const query = `
        INSERT INTO execution_analysis (execution_id, is_false_positive, false_positive_reason, marked_false_positive_at)
        SELECT unnest($1::int[]), $2, $3, $4
        ON CONFLICT (execution_id) DO UPDATE SET
          is_false_positive = EXCLUDED.is_false_positive,
          false_positive_reason = EXCLUDED.false_positive_reason,
          marked_false_positive_at = EXCLUDED.marked_false_positive_at
      `;

      const result = await dualDb.query(query, [
        executionIds,
        isFalsePositive,
        reason || null,
        isFalsePositive ? new Date() : null
      ]);

      const updatedCount = executionIds.length;
      logger.info(`Bulk marked ${updatedCount} executions as ${isFalsePositive ? 'false positive' : 'valid detection'}${reason ? `: ${reason}` : ''}`);

      return { success: true, updatedCount };
    } catch (error) {
      logger.error('Failed to bulk mark false positives:', error);
      return { success: false, updatedCount: 0, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get image paths for an execution
   * Returns relative paths from execution_images table
   */
  async getImagePaths(executionId: number): Promise<{
    originalPath: string | null;
    thumbnailPath: string | null;
    cachedPath: string | null;
  } | null> {
    const query = `
      SELECT original_path, thumbnail_path, cached_path
      FROM execution_images
      WHERE execution_id = $1
    `;

    const results = await dualDb.query(query, [executionId]);

    if (results.length === 0) {
      return null;
    }

    return {
      originalPath: results[0].original_path,
      thumbnailPath: results[0].thumbnail_path,
      cachedPath: results[0].cached_path
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
   * Returns data in the format expected by the StatsDashboard component
   * SINGLE SOURCE: sai_dashboard database only
   */
  async getEnhancedStatistics(): Promise<{
    overview: {
      totalExecutions: number;
      successRate: number;
      errorRate: number;
      averageExecutionTime: number;
      activeToday: number;
    };
    statusBreakdown: {
      success: number;
      error: number;
      running: number;
      waiting: number;
      canceled: number;
    };
    recentActivity: {
      lastHour: number;
      last24Hours: number;
      last7Days: number;
      last30Days: number;
    };
    performanceMetrics: {
      avgResponseTime: number;
      minResponseTime: number;
      maxResponseTime: number;
      medianResponseTime: number;
      p95ResponseTime: number;
      p99ResponseTime: number;
    };
    hourlyDistribution: Array<{ hour: number; count: number }>;
    errorTrend: Array<{ date: string; errors: number; total: number; errorRate: number }>;
  }> {
    // Overview stats
    const overviewQuery = `
      SELECT
        COUNT(*) as total_executions,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as successful,
        COUNT(CASE WHEN status = 'error' THEN 1 END) as failed,
        AVG(duration_ms) as avg_duration,
        COUNT(CASE WHEN execution_timestamp >= CURRENT_DATE THEN 1 END) as active_today
      FROM executions
    `;
    const overviewResult = await dualDb.query(overviewQuery);
    const overview = overviewResult[0];
    const totalExecutions = parseInt(overview.total_executions) || 0;
    const successful = parseInt(overview.successful) || 0;
    const failed = parseInt(overview.failed) || 0;

    // Recent activity counts
    const activityQuery = `
      SELECT
        COUNT(CASE WHEN execution_timestamp >= NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour,
        COUNT(CASE WHEN execution_timestamp >= NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h,
        COUNT(CASE WHEN execution_timestamp >= NOW() - INTERVAL '7 days' THEN 1 END) as last_7d,
        COUNT(CASE WHEN execution_timestamp >= NOW() - INTERVAL '30 days' THEN 1 END) as last_30d
      FROM executions
    `;
    const activityResult = await dualDb.query(activityQuery);
    const activity = activityResult[0];

    // Performance metrics (using duration_ms)
    const perfQuery = `
      SELECT
        AVG(duration_ms) as avg_time,
        MIN(duration_ms) as min_time,
        MAX(duration_ms) as max_time,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) as median_time,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_time,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99_time
      FROM executions
      WHERE duration_ms IS NOT NULL
        AND execution_timestamp >= NOW() - INTERVAL '7 days'
    `;
    const perfResult = await dualDb.query(perfQuery);
    const perf = perfResult[0];

    // Hourly distribution (last 24 hours)
    const hourlyQuery = `
      SELECT
        EXTRACT(HOUR FROM execution_timestamp)::int as hour,
        COUNT(*) as count
      FROM executions
      WHERE execution_timestamp >= NOW() - INTERVAL '24 hours'
      GROUP BY EXTRACT(HOUR FROM execution_timestamp)
      ORDER BY hour
    `;
    const hourlyResult = await dualDb.query(hourlyQuery);

    // Error trend (last 7 days)
    const errorTrendQuery = `
      SELECT
        DATE(execution_timestamp) as date,
        COUNT(CASE WHEN status = 'error' THEN 1 END) as errors,
        COUNT(*) as total
      FROM executions
      WHERE execution_timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(execution_timestamp)
      ORDER BY date DESC
    `;
    const errorTrendResult = await dualDb.query(errorTrendQuery);

    // Convert ms to seconds for display
    const msToSeconds = (ms: number | null) => ms ? ms / 1000 : 0;

    return {
      overview: {
        totalExecutions,
        successRate: totalExecutions > 0 ? (successful / totalExecutions) * 100 : 0,
        errorRate: totalExecutions > 0 ? (failed / totalExecutions) * 100 : 0,
        averageExecutionTime: msToSeconds(parseFloat(overview.avg_duration)),
        activeToday: parseInt(overview.active_today) || 0
      },
      statusBreakdown: {
        success: successful,
        error: failed,
        running: 0,  // YOLO workflow doesn't have running state
        waiting: 0,  // YOLO workflow doesn't have waiting state
        canceled: 0  // YOLO workflow doesn't have canceled state
      },
      recentActivity: {
        lastHour: parseInt(activity.last_hour) || 0,
        last24Hours: parseInt(activity.last_24h) || 0,
        last7Days: parseInt(activity.last_7d) || 0,
        last30Days: parseInt(activity.last_30d) || 0
      },
      performanceMetrics: {
        avgResponseTime: msToSeconds(parseFloat(perf.avg_time)),
        minResponseTime: msToSeconds(parseFloat(perf.min_time)),
        maxResponseTime: msToSeconds(parseFloat(perf.max_time)),
        medianResponseTime: msToSeconds(parseFloat(perf.median_time)),
        p95ResponseTime: msToSeconds(parseFloat(perf.p95_time)),
        p99ResponseTime: msToSeconds(parseFloat(perf.p99_time))
      },
      hourlyDistribution: hourlyResult.map((row: any) => ({
        hour: parseInt(row.hour),
        count: parseInt(row.count)
      })),
      errorTrend: errorTrendResult.map((row: any) => {
        const errors = parseInt(row.errors) || 0;
        const total = parseInt(row.total) || 0;
        return {
          date: row.date.toISOString().split('T')[0],
          errors,
          total,
          errorRate: total > 0 ? (errors / total) * 100 : 0
        };
      })
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

  // -----------------------------------------------------------------------
  // Filter Options (dynamic dropdown values)
  // -----------------------------------------------------------------------

  private filterOptionsCache: {
    data: FilterOptions | null;
    expiresAt: number;
  } = { data: null, expiresAt: 0 };

  async getFilterOptions(): Promise<FilterOptions> {
    const now = Date.now();
    if (this.filterOptionsCache.data && now < this.filterOptionsCache.expiresAt) {
      return this.filterOptionsCache.data;
    }

    const pool = dualDb.getSaiPool();

    const [
      cameraResult,
      locationResult,
      nodeResult,
      deviceResult,
      modelResult,
    ] = await Promise.all([
      pool.query<{ camera_id: string }>(
        'SELECT DISTINCT camera_id FROM executions WHERE camera_id IS NOT NULL ORDER BY 1'
      ),
      pool.query<{ location: string }>(
        'SELECT DISTINCT location FROM executions WHERE location IS NOT NULL ORDER BY 1'
      ),
      pool.query<{ node_id: string }>(
        'SELECT DISTINCT node_id FROM executions WHERE node_id IS NOT NULL ORDER BY 1'
      ),
      pool.query<{ device_id: string }>(
        'SELECT DISTINCT device_id FROM executions WHERE device_id IS NOT NULL ORDER BY 1'
      ),
      pool.query<{ yolo_model_version: string }>(
        'SELECT DISTINCT yolo_model_version FROM execution_analysis WHERE yolo_model_version IS NOT NULL ORDER BY 1'
      ),
    ]);

    const options: FilterOptions = {
      cameraId:         cameraResult.rows.map(r => r.camera_id),
      location:         locationResult.rows.map(r => r.location),
      nodeId:           nodeResult.rows.map(r => r.node_id),
      deviceId:         deviceResult.rows.map(r => r.device_id),
      yoloModelVersion: modelResult.rows.map(r => r.yolo_model_version),
    };

    this.filterOptionsCache = { data: options, expiresAt: now + 60_000 };
    logger.debug('filter-options: cache miss, fetched from DB');
    return options;
  }
}

// Export singleton instance
export const newExecutionService = new NewExecutionService();