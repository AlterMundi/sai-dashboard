/**
 * Advanced Detection Filter Service
 * Provides JSONB-based filtering capabilities for YOLO detections
 * Leverages PostgreSQL JSONB operators and GIN indexes for optimal performance
 */

import { dualDb } from '@/database/dual-pool';
import { logger } from '@/utils/logger';

export interface DetectionFilterCriteria {
  // Basic detection filters
  hasClass?: string[];  // e.g., ['fire', 'smoke']
  minConfidence?: number;  // Minimum confidence for any detection
  maxConfidence?: number;  // Maximum confidence for any detection

  // Advanced spatial filters
  minBoundingBoxSize?: number;  // Minimum area (width * height)
  maxBoundingBoxSize?: number;  // Maximum area (width * height)

  // Detection count filters
  minDetections?: number;  // Minimum number of detections of specific class
  maxDetections?: number;  // Maximum number of detections of specific class

  // Spatial positioning filters
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  overlapThreshold?: number;  // For detecting overlapping detections
}

export interface DetectionQueryResult {
  executionId: number;
  detectionCount: number;
  matchingDetections: any[];
  totalConfidence: number;
  primaryClass: string;
}

export class AdvancedDetectionFilterService {

  /**
   * Build JSONB query for complex detection filtering
   * Uses PostgreSQL JSONB operators for efficient querying
   */
  private buildDetectionQuery(criteria: DetectionFilterCriteria): {
    whereClause: string;
    params: any[];
  } {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramCount = 0;

    // Basic class presence filter
    if (criteria.hasClass && criteria.hasClass.length > 0) {
      paramCount++;
      conditions.push(`ea.detections @> $${paramCount}::jsonb`);
      params.push(JSON.stringify([{ class: criteria.hasClass[0] }]));
    }

    // Confidence range filter using JSON path queries
    if (criteria.minConfidence !== undefined || criteria.maxConfidence !== undefined) {
      const confidenceConditions: string[] = [];

      if (criteria.minConfidence !== undefined) {
        paramCount++;
        confidenceConditions.push(`detections @@ '$[*] ? (@.confidence >= $${paramCount})'`);
        params.push(criteria.minConfidence);
      }

      if (criteria.maxConfidence !== undefined) {
        paramCount++;
        confidenceConditions.push(`detections @@ '$[*] ? (@.confidence <= $${paramCount})'`);
        params.push(criteria.maxConfidence);
      }

      if (confidenceConditions.length > 0) {
        conditions.push(`(${confidenceConditions.join(' AND ')})`);
      }
    }

    // Bounding box size filter
    if (criteria.minBoundingBoxSize !== undefined || criteria.maxBoundingBoxSize !== undefined) {
      const sizeConditions: string[] = [];

      if (criteria.minBoundingBoxSize !== undefined) {
        paramCount++;
        sizeConditions.push(`detections @@ '$[*] ? ((@.bounding_box.width * @.bounding_box.height) >= $${paramCount})'`);
        params.push(criteria.minBoundingBoxSize);
      }

      if (criteria.maxBoundingBoxSize !== undefined) {
        paramCount++;
        sizeConditions.push(`detections @@ '$[*] ? ((@.bounding_box.width * @.bounding_box.height) <= $${paramCount})'`);
        params.push(criteria.maxBoundingBoxSize);
      }

      if (sizeConditions.length > 0) {
        conditions.push(`(${sizeConditions.join(' AND ')})`);
      }
    }

    // Detection count filter
    if (criteria.minDetections !== undefined || criteria.maxDetections !== undefined) {
      const countConditions: string[] = [];

      if (criteria.minDetections !== undefined) {
        paramCount++;
        countConditions.push(`jsonb_array_length(detections) >= $${paramCount}`);
        params.push(criteria.minDetections);
      }

      if (criteria.maxDetections !== undefined) {
        paramCount++;
        countConditions.push(`jsonb_array_length(detections) <= $${paramCount}`);
        params.push(criteria.maxDetections);
      }

      if (countConditions.length > 0) {
        conditions.push(`(${countConditions.join(' AND ')})`);
      }
    }

    // Spatial positioning filter
    if (criteria.position) {
      const positionQueries: Record<string, string> = {
        top: `detections @@ '$[*] ? (@.bounding_box.y <= 0.3)'`,
        bottom: `detections @@ '$[*] ? (@.bounding_box.y >= 0.7)'`,
        left: `detections @@ '$[*] ? (@.bounding_box.x <= 0.3)'`,
        right: `detections @@ '$[*] ? (@.bounding_box.x >= 0.7)'`,
        center: `detections @@ '$[*] ? (@.bounding_box.x >= 0.3 && @.bounding_box.x <= 0.7 && @.bounding_box.y >= 0.3 && @.bounding_box.y <= 0.7)'`
      };

      if (positionQueries[criteria.position]) {
        conditions.push(positionQueries[criteria.position]);
      }
    }

    return {
      whereClause: conditions.length > 0 ? `AND (${conditions.join(' AND ')})` : '',
      params
    };
  }

  /**
   * Find executions matching advanced detection criteria
   * Returns detailed detection information for analysis
   */
  async findExecutionsWithAdvancedDetection(
    criteria: DetectionFilterCriteria,
    limit: number = 100
  ): Promise<DetectionQueryResult[]> {
    const { whereClause, params } = this.buildDetectionQuery(criteria);

    const query = `
      SELECT
        e.id as execution_id,
        ea.detection_count,
        ea.detections,
        ea.confidence_score,
        ea.active_classes[1] as primary_class,
        -- Extract matching detections with confidence filtering
        CASE
          WHEN ea.detections IS NOT NULL THEN
            jsonb_agg(
              jsonb_build_object(
                'class', det->>'class',
                'confidence', (det->>'confidence')::numeric,
                'bounding_box', det->'bounding_box'
              )
            ) FILTER (WHERE det->>'class' = ANY($${params.length + 1}))
          ELSE NULL
        END as matching_detections
      FROM executions e
      JOIN execution_analysis ea ON e.id = ea.execution_id
      CROSS JOIN LATERAL jsonb_array_elements(ea.detections) AS det
      WHERE ea.detections IS NOT NULL
        ${whereClause}
      GROUP BY e.id, ea.detection_count, ea.detections, ea.confidence_score, ea.active_classes
      ORDER BY ea.confidence_score DESC
      LIMIT $${params.length + 2}
    `;

    // Add class filter and limit parameters
    const queryParams = [
      ...params,
      criteria.hasClass || [],
      limit
    ];

    try {
      const results = await dualDb.query(query, queryParams);

      return results.map((row: any) => ({
        executionId: row.execution_id,
        detectionCount: row.detection_count,
        matchingDetections: row.matching_detections || [],
        totalConfidence: parseFloat(row.confidence_score) || 0,
        primaryClass: row.primary_class || 'unknown'
      }));
    } catch (error) {
      logger.error('Advanced detection query failed:', error);
      throw new Error('Failed to execute advanced detection query');
    }
  }

  /**
   * Get detection statistics for dashboard insights
   * Aggregates detection patterns across time periods
   */
  async getDetectionStatistics(timeRange: 'hour' | 'day' | 'week' = 'day'): Promise<{
    totalDetections: number;
    averageConfidence: number;
    classDistribution: Record<string, number>;
    sizeDistribution: { small: number; medium: number; large: number };
    temporalPatterns: Array<{ period: string; count: number; avgConfidence: number }>;
  }> {
    const timeInterval = {
      hour: '1 hour',
      day: '1 day',
      week: '7 days'
    }[timeRange];

    const timeGroup = {
      hour: "date_trunc('hour', e.execution_timestamp)",
      day: "date_trunc('day', e.execution_timestamp)",
      week: "date_trunc('week', e.execution_timestamp)"
    }[timeRange];

    try {
      // Get total detections and average confidence
      const summaryQuery = `
        SELECT
          COALESCE(SUM(ea.detection_count), 0) as total_detections,
          AVG(ea.confidence_score) as average_confidence
        FROM executions e
        JOIN execution_analysis ea ON e.id = ea.execution_id
        WHERE e.execution_timestamp >= NOW() - INTERVAL '${timeInterval}'
          AND ea.detections IS NOT NULL
      `;
      const summaryResult = await dualDb.query(summaryQuery);

      // Get class distribution
      const classQuery = `
        SELECT
          det->>'class' as class,
          COUNT(*) as count
        FROM executions e
        JOIN execution_analysis ea ON e.id = ea.execution_id
        CROSS JOIN LATERAL jsonb_array_elements(ea.detections) AS det
        WHERE e.execution_timestamp >= NOW() - INTERVAL '${timeInterval}'
          AND ea.detections IS NOT NULL
        GROUP BY det->>'class'
      `;
      const classResult = await dualDb.query(classQuery);
      const classDistribution: Record<string, number> = {};
      classResult.forEach((row: any) => {
        classDistribution[row.class] = parseInt(row.count);
      });

      // Get size distribution
      const sizeQuery = `
        SELECT
          COUNT(*) FILTER (WHERE
            COALESCE((det->'bounding_box'->>'width')::numeric, 0) *
            COALESCE((det->'bounding_box'->>'height')::numeric, 0) < 0.1
          ) as small,
          COUNT(*) FILTER (WHERE
            COALESCE((det->'bounding_box'->>'width')::numeric, 0) *
            COALESCE((det->'bounding_box'->>'height')::numeric, 0) BETWEEN 0.1 AND 0.5
          ) as medium,
          COUNT(*) FILTER (WHERE
            COALESCE((det->'bounding_box'->>'width')::numeric, 0) *
            COALESCE((det->'bounding_box'->>'height')::numeric, 0) > 0.5
          ) as large
        FROM executions e
        JOIN execution_analysis ea ON e.id = ea.execution_id
        CROSS JOIN LATERAL jsonb_array_elements(ea.detections) AS det
        WHERE e.execution_timestamp >= NOW() - INTERVAL '${timeInterval}'
          AND ea.detections IS NOT NULL
      `;
      const sizeResult = await dualDb.query(sizeQuery);

      // Get temporal patterns
      const temporalQuery = `
        SELECT
          ${timeGroup} as period,
          COUNT(*) as count,
          AVG(ea.confidence_score) as avg_confidence
        FROM executions e
        JOIN execution_analysis ea ON e.id = ea.execution_id
        WHERE e.execution_timestamp >= NOW() - INTERVAL '30 days'
          AND ea.detections IS NOT NULL
        GROUP BY ${timeGroup}
        ORDER BY period DESC
        LIMIT 30
      `;
      const temporalResult = await dualDb.query(temporalQuery);

      return {
        totalDetections: parseInt(summaryResult[0]?.total_detections) || 0,
        averageConfidence: parseFloat(summaryResult[0]?.average_confidence) || 0,
        classDistribution,
        sizeDistribution: {
          small: parseInt(sizeResult[0]?.small) || 0,
          medium: parseInt(sizeResult[0]?.medium) || 0,
          large: parseInt(sizeResult[0]?.large) || 0
        },
        temporalPatterns: temporalResult.map((row: any) => ({
          period: row.period?.toISOString() || '',
          count: parseInt(row.count) || 0,
          avgConfidence: parseFloat(row.avg_confidence) || 0
        }))
      };
    } catch (error) {
      logger.error('Detection statistics query failed:', error);
      throw new Error('Failed to fetch detection statistics');
    }
  }

  /**
   * Validate detection filter criteria
   */
  validateCriteria(criteria: DetectionFilterCriteria): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (criteria.minConfidence !== undefined && (criteria.minConfidence < 0 || criteria.minConfidence > 1)) {
      errors.push('minConfidence must be between 0 and 1');
    }

    if (criteria.maxConfidence !== undefined && (criteria.maxConfidence < 0 || criteria.maxConfidence > 1)) {
      errors.push('maxConfidence must be between 0 and 1');
    }

    if (criteria.minConfidence !== undefined && criteria.maxConfidence !== undefined &&
        criteria.minConfidence > criteria.maxConfidence) {
      errors.push('minConfidence cannot be greater than maxConfidence');
    }

    if (criteria.minBoundingBoxSize !== undefined && criteria.minBoundingBoxSize < 0) {
      errors.push('minBoundingBoxSize must be non-negative');
    }

    if (criteria.maxBoundingBoxSize !== undefined && criteria.maxBoundingBoxSize < 0) {
      errors.push('maxBoundingBoxSize must be non-negative');
    }

    if (criteria.minDetections !== undefined && criteria.minDetections < 0) {
      errors.push('minDetections must be non-negative');
    }

    if (criteria.maxDetections !== undefined && criteria.maxDetections < 0) {
      errors.push('maxDetections must be non-negative');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Export singleton instance
export const advancedDetectionFilter = new AdvancedDetectionFilterService();