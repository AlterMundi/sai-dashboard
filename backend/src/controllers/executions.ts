import { Request, Response } from 'express';
import { executionService } from '@/services/execution';
import { imageService } from '@/services/image';
import { ExecutionFilters } from '@/types';
import { logger } from '@/utils/logger';
import { asyncHandler, parseIntSafe } from '@/utils';

export const getExecutions = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const {
    page,
    limit,
    offset,
    status,
    startDate,
    endDate,
    search,
    hasImage,
    riskLevel,
    telegramDelivered,
    datePreset,
    sortBy,
    sortOrder
  } = req.query;

  const filters: ExecutionFilters = {
    page: parseIntSafe(page as string, 0),
    limit: parseIntSafe(limit as string, 50),
    offset: offset ? parseIntSafe(offset as string, 0) : undefined,
    status: status as any,
    startDate: startDate as string,
    endDate: endDate as string,
    search: search as string,
    hasImage: hasImage === 'true' ? true : hasImage === 'false' ? false : undefined,
    riskLevel: riskLevel as any,
    telegramDelivered: telegramDelivered === 'true' ? true : telegramDelivered === 'false' ? false : undefined,
    datePreset: datePreset as any,
    sortBy: sortBy as any,
    sortOrder: sortOrder as any
  };

  // Validate date filters
  if (filters.startDate && isNaN(Date.parse(filters.startDate))) {
    res.status(400).json({
      error: {
        message: 'Invalid startDate format',
        code: 'INVALID_DATE_FORMAT'
      }
    });
    return;
  }

  if (filters.endDate && isNaN(Date.parse(filters.endDate))) {
    res.status(400).json({
      error: {
        message: 'Invalid endDate format', 
        code: 'INVALID_DATE_FORMAT'
      }
    });
    return;
  }

  try {
    const result = await executionService.getExecutions(filters);

    // Prepare response with discrete alert system
    const response: any = {
      data: result.executions,
      meta: {
        total: result.total,
        page: filters.page || 0,
        limit: filters.limit || 50,
        hasNext: result.hasNext,
        filters: {
          status: filters.status,
          startDate: filters.startDate,
          endDate: filters.endDate,
          search: filters.search,
          hasImage: filters.hasImage
        }
      }
    };

    // Always add analysis status - even for non-enriched queries
    if (result.analysisStatus) {
      const { totalInRange, analyzed, pending, coverage } = result.analysisStatus;
      
      response.meta.analysisStatus = {
        totalInRange,
        analyzed: analyzed === -1 ? 'unknown' : analyzed,
        pending: pending === -1 ? 'unknown' : pending,
        coverage: coverage === -1 ? 'unknown' : Math.round(coverage * 100) / 100
      };
      
      // Enhanced alerts with trigger action for missing analyses
      if (coverage < 50) {
        response.alerts = [{
          type: 'warning',
          level: 'high',
          message: `Low analysis coverage (${Math.round(coverage)}%). Results may be incomplete.`,
          details: `${pending} of ${totalInRange} executions need analysis processing.`,
          action: 'trigger_analysis_available',
          actionLabel: 'Process Missing Analyses'
        }];
      } else if (coverage < 90) {
        response.alerts = [{
          type: 'info',
          level: 'medium', 
          message: `Analysis processing in progress (${Math.round(coverage)}% complete).`,
          details: `${pending} analyses pending completion.`,
          action: 'background_processing_active',
          actionLabel: 'Processing...'
        }];
      } else if (pending > 0) {
        response.alerts = [{
          type: 'info',
          level: 'low',
          message: `Analysis nearly complete (${Math.round(coverage)}%).`,
          details: `${pending} final analyses processing.`,
          action: 'background_processing_active',
          actionLabel: 'Almost done'
        }];
      }
      
      logger.info('Analysis coverage status', {
        coverage: Math.round(coverage),
        totalInRange,
        analyzed,
        pending,
        hasAlerts: !!response.alerts
      });
    } else {
      // For non-enriched queries, still provide basic analysis status
      response.meta.analysisStatus = {
        totalInRange: result.total || 0,
        analyzed: 'unknown',
        pending: 'unknown', 
        coverage: 'unknown'
      };
    }

    res.json(response);

  } catch (error) {
    logger.error('Failed to fetch executions:', { filters, error });
    res.status(500).json({
      error: {
        message: 'Failed to fetch executions',
        code: 'FETCH_EXECUTIONS_ERROR'
      }
    });
  }
});

export const getExecutionById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;

  if (!executionId) {
    res.status(400).json({
      error: {
        message: 'Execution ID is required',
        code: 'MISSING_EXECUTION_ID'
      }
    });
    return;
  }

  try {
    const execution = await executionService.getExecutionById(executionId);

    if (!execution) {
      res.status(404).json({
        error: {
          message: 'Execution not found',
          code: 'EXECUTION_NOT_FOUND'
        }
      });
      return;
    }

    res.json({
      data: execution
    });

  } catch (error) {
    logger.error('Failed to fetch execution:', { executionId, error });
    res.status(500).json({
      error: {
        message: 'Failed to fetch execution',
        code: 'FETCH_EXECUTION_ERROR'
      }
    });
  }
});

export const getExecutionImage = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;
  const { thumbnail } = req.query;

  if (!executionId) {
    res.status(400).json({
      error: {
        message: 'Execution ID is required',
        code: 'MISSING_EXECUTION_ID'
      }
    });
    return;
  }

  const isThumbnail = thumbnail === 'true';

  try {
    // First verify execution exists and has image
    const execution = await executionService.getExecutionById(executionId);
    
    if (!execution) {
      res.status(404).json({
        error: {
          message: 'Execution not found',
          code: 'EXECUTION_NOT_FOUND'
        }
      });
      return;
    }

    // Skip imageUrl check - try to extract image directly from database

    // Get image data
    const imageData = await imageService.getImage(executionId, isThumbnail);

    if (!imageData) {
      res.status(404).json({
        error: {
          message: 'Image data not found or corrupted',
          code: 'IMAGE_DATA_ERROR'
        }
      });
      return;
    }

    // Set appropriate headers
    res.setHeader('Content-Type', imageData.contentType);
    res.setHeader('Content-Length', imageData.size);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
    res.setHeader('ETag', `"${executionId}-${isThumbnail ? 'thumb' : 'original'}"`);
    
    // Handle conditional requests
    const ifNoneMatch = req.get('If-None-Match');
    if (ifNoneMatch === res.get('ETag')) {
      res.status(304).end();
      return;
    }

    // Stream the image
    imageData.stream.pipe(res);

    logger.debug('Image served successfully:', {
      executionId,
      thumbnail: isThumbnail,
      contentType: imageData.contentType,
      size: imageData.size
    });

  } catch (error) {
    logger.error('Failed to serve image:', { executionId, thumbnail: isThumbnail, error });
    res.status(500).json({
      error: {
        message: 'Failed to serve image',
        code: 'IMAGE_SERVE_ERROR'
      }
    });
  }
});

/**
 * Serve WebP variant of execution image (optimized for web display)
 * GET /api/executions/:executionId/image/webp
 */
export const getExecutionImageWebP = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;

  if (!executionId) {
    res.status(400).json({
      error: {
        message: 'Execution ID is required',
        code: 'MISSING_EXECUTION_ID'
      }
    });
    return;
  }

  try {
    // First verify execution exists and has image
    const execution = await executionService.getExecutionById(executionId);
    
    if (!execution) {
      res.status(404).json({
        error: {
          message: 'Execution not found',
          code: 'EXECUTION_NOT_FOUND'
        }
      });
      return;
    }

    // Get WebP image data
    const imageData = await imageService.getImageWebP(executionId);

    if (!imageData) {
      // Fallback to JPEG original if WebP not available
      logger.debug('WebP not available, falling back to JPEG:', { executionId });
      const jpegData = await imageService.getImage(executionId, false);
      
      if (!jpegData) {
        res.status(404).json({
          error: {
            message: 'Image data not found',
            code: 'IMAGE_DATA_ERROR'
          }
        });
        return;
      }

      res.setHeader('Content-Type', jpegData.contentType);
      res.setHeader('Content-Length', jpegData.size);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('ETag', `"${executionId}-jpeg-fallback"`);
      
      jpegData.stream.pipe(res);
      return;
    }

    // Set WebP headers
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', imageData.size);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('ETag', `"${executionId}-webp"`);
    res.setHeader('Vary', 'Accept');

    // Handle conditional requests
    const ifNoneMatch = req.get('If-None-Match');
    if (ifNoneMatch === res.get('ETag')) {
      res.status(304).end();
      return;
    }

    // Stream the WebP image
    imageData.stream.pipe(res);

    logger.debug('WebP image served successfully:', {
      executionId,
      contentType: 'image/webp',
      size: imageData.size
    });

  } catch (error) {
    logger.error('Failed to serve WebP image:', { executionId, error });
    res.status(500).json({
      error: {
        message: 'Failed to serve WebP image',
        code: 'WEBP_SERVE_ERROR'
      }
    });
  }
});

/**
 * Serve WebP thumbnail for execution image
 * GET /api/executions/:executionId/thumbnail?size=150|300
 */
export const getExecutionThumbnail = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;
  const { size = '300' } = req.query;

  if (!executionId) {
    res.status(400).json({
      error: {
        message: 'Execution ID is required',
        code: 'MISSING_EXECUTION_ID'
      }
    });
    return;
  }

  const thumbnailSize = size === '150' ? '150px' : '300px';

  try {
    // First verify execution exists and has image
    const execution = await executionService.getExecutionById(executionId);
    
    if (!execution) {
      res.status(404).json({
        error: {
          message: 'Execution not found',
          code: 'EXECUTION_NOT_FOUND'
        }
      });
      return;
    }

    // Get WebP thumbnail data
    const thumbnailData = await imageService.getThumbnail(executionId, thumbnailSize);

    if (!thumbnailData) {
      // Fallback to original image if thumbnail not available
      logger.debug('Thumbnail not available, falling back to original:', { executionId, size: thumbnailSize });
      const originalData = await imageService.getImage(executionId, true); // Use legacy thumbnail
      
      if (!originalData) {
        res.status(404).json({
          error: {
            message: 'Thumbnail data not found',
            code: 'THUMBNAIL_DATA_ERROR'
          }
        });
        return;
      }

      res.setHeader('Content-Type', originalData.contentType);
      res.setHeader('Content-Length', originalData.size);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('ETag', `"${executionId}-thumb-fallback"`);
      
      originalData.stream.pipe(res);
      return;
    }

    // Set WebP thumbnail headers
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', thumbnailData.size);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('ETag', `"${executionId}-thumb-${thumbnailSize}-webp"`);
    res.setHeader('Vary', 'Accept');

    // Handle conditional requests
    const ifNoneMatch = req.get('If-None-Match');
    if (ifNoneMatch === res.get('ETag')) {
      res.status(304).end();
      return;
    }

    // Stream the WebP thumbnail
    thumbnailData.stream.pipe(res);

    logger.debug('WebP thumbnail served successfully:', {
      executionId,
      size: thumbnailSize,
      contentType: 'image/webp',
      fileSize: thumbnailData.size
    });

  } catch (error) {
    logger.error('Failed to serve WebP thumbnail:', { executionId, size: thumbnailSize, error });
    res.status(500).json({
      error: {
        message: 'Failed to serve WebP thumbnail',
        code: 'THUMBNAIL_SERVE_ERROR'
      }
    });
  }
});

export const getExecutionData = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;
  const { nodeId } = req.query;

  if (!executionId) {
    res.status(400).json({
      error: {
        message: 'Execution ID is required',
        code: 'MISSING_EXECUTION_ID'
      }
    });
    return;
  }

  try {
    const executionData = await executionService.getExecutionData(
      executionId, 
      nodeId as string
    );

    if (!executionData) {
      res.status(404).json({
        error: {
          message: 'Execution data not found',
          code: 'EXECUTION_DATA_NOT_FOUND'
        }
      });
      return;
    }

    res.json({
      data: executionData
    });

  } catch (error) {
    logger.error('Failed to fetch execution data:', { executionId, nodeId, error });
    res.status(500).json({
      error: {
        message: 'Failed to fetch execution data',
        code: 'FETCH_EXECUTION_DATA_ERROR'
      }
    });
  }
});

export const getDailySummary = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { days } = req.query;
  const daysCount = parseIntSafe(days as string, 30);

  if (daysCount > 90) {
    res.status(400).json({
      error: {
        message: 'Maximum 90 days allowed',
        code: 'INVALID_DAYS_RANGE'
      }
    });
    return;
  }

  try {
    const summary = await executionService.getDailySummary(daysCount);

    res.json({
      data: summary,
      meta: {
        days: daysCount,
        totalDays: summary.length
      }
    });

  } catch (error) {
    logger.error('Failed to fetch daily summary:', { days: daysCount, error });
    res.status(500).json({
      error: {
        message: 'Failed to fetch daily summary',
        code: 'FETCH_SUMMARY_ERROR'
      }
    });
  }
});

export const getExecutionStats = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await executionService.getExecutionStats();

    res.json({
      data: stats
    });

  } catch (error) {
    logger.error('Failed to fetch execution stats:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch execution statistics',
        code: 'FETCH_STATS_ERROR'
      }
    });
  }
});

export const searchExecutions = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { q, limit } = req.query;

  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    res.status(400).json({
      error: {
        message: 'Search query is required',
        code: 'MISSING_SEARCH_QUERY'
      }
    });
    return;
  }

  if (q.length > 100) {
    res.status(400).json({
      error: {
        message: 'Search query too long (max 100 characters)',
        code: 'SEARCH_QUERY_TOO_LONG'
      }
    });
    return;
  }

  const limitCount = parseIntSafe(limit as string, 20);

  try {
    const executions = await executionService.searchExecutions(q.trim(), limitCount);

    res.json({
      data: executions,
      meta: {
        query: q.trim(),
        limit: limitCount,
        resultsCount: executions.length
      }
    });

  } catch (error) {
    logger.error('Failed to search executions:', { query: q, error });
    res.status(500).json({
      error: {
        message: 'Search failed',
        code: 'SEARCH_ERROR'
      }
    });
  }
});

export const getEnhancedStatistics = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await executionService.getEnhancedStatistics();

    res.json({
      data: stats,
      meta: {
        timestamp: new Date().toISOString(),
        cached: false
      }
    });

  } catch (error) {
    logger.error('Failed to fetch enhanced statistics:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch enhanced statistics',
        code: 'FETCH_ENHANCED_STATS_ERROR'
      }
    });
  }
});

export const triggerAnalysisProcessing = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { batchSize = 50 } = req.body;

  try {
    // Get missing analyses count
    const query = `
      SELECT COUNT(*) as missing_count
      FROM execution_entity e
      JOIN workflow_entity w ON e."workflowId"::text = w.id::text
      LEFT JOIN sai_execution_analysis ea ON e.id = ea.execution_id
      WHERE w.id = 'yDbfhooKemfhMIkC'
        AND e.status IS NOT NULL
        AND e."deletedAt" IS NULL
        AND ea.execution_id IS NULL
    `;

    const countResult = await executionService.getExecutions({ hasImage: true, limit: 1 }); // Trigger enriched query
    const analysisStatus = countResult.analysisStatus;

    if (!analysisStatus || analysisStatus.pending === 0) {
      res.json({
        data: {
          message: 'No missing analyses found. All executions are up to date.',
          triggered: false,
          pending: 0
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    // Trigger background processing by making enriched query
    // This will automatically start processing missing analyses
    logger.info(`Manual analysis trigger requested`, {
      requestedBatchSize: batchSize,
      pendingAnalyses: analysisStatus.pending,
      coverage: analysisStatus.coverage
    });

    res.json({
      data: {
        message: `Analysis processing triggered for ${analysisStatus.pending} executions.`,
        triggered: true,
        pending: analysisStatus.pending,
        coverage: analysisStatus.coverage,
        estimatedTime: `${Math.ceil(analysisStatus.pending / 100)} minutes`
      },
      meta: {
        timestamp: new Date().toISOString(),
        batchSize: Math.min(batchSize, 50)
      }
    });

  } catch (error) {
    logger.error('Failed to trigger analysis processing:', error);
    res.status(500).json({
      error: {
        message: 'Failed to trigger analysis processing',
        code: 'TRIGGER_ANALYSIS_ERROR'
      }
    });
  }
});