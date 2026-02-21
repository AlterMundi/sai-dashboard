/**
 * Execution Controller - Clean Image Path Resolution
 *
 * Image paths are stored as RELATIVE paths in the database.
 * This controller resolves them using IMAGE_BASE_PATH at runtime.
 *
 * Path resolution: IMAGE_BASE_PATH + relative_path = filesystem_path
 * Example: ./image-cache + original/410/410000.jpg = ./image-cache/original/410/410000.jpg
 */

import { Request, Response } from 'express';
import { newExecutionService } from '@/services/new-execution-service';
import { cacheConfig } from '@/config';
import { ExecutionFilters } from '@/types';
import { logger } from '@/utils/logger';
import { asyncHandler, parseIntSafe } from '@/utils';
import path from 'path';
import fs from 'fs';

/**
 * Resolve a relative image path to an absolute filesystem path
 * Uses IMAGE_BASE_PATH from configuration
 */
function resolveImagePath(relativePath: string | null): string | null {
  if (!relativePath) return null;

  // If path is already absolute (legacy data), return as-is
  if (relativePath.startsWith('/')) {
    return relativePath;
  }

  return path.join(cacheConfig.basePath, relativePath);
}

/**
 * Build relative path for an execution image (when DB path not available)
 * Used as fallback when execution_images record doesn't exist
 */
function buildRelativePath(executionId: number, type: 'original' | 'thumb' | 'webp'): string {
  const partition = Math.floor(executionId / 1000);
  const ext = type === 'original' ? 'jpg' : 'webp';
  return `${type}/${partition}/${executionId}.${ext}`;
}

/**
 * Legacy path patterns for backward compatibility
 */
function buildLegacyPath(executionId: number, type: 'original' | 'thumb' | 'webp'): string {
  const filenames: Record<string, string> = {
    original: 'original.jpg',
    thumb: 'thumb.webp',
    webp: 'high.webp'
  };
  return path.join(cacheConfig.basePath, 'by-execution', executionId.toString(), filenames[type]);
}

/**
 * Find image path - tries DB path, then partition path, then legacy path
 */
async function findImagePath(
  executionId: number,
  type: 'original' | 'thumb' | 'webp'
): Promise<string | null> {
  // 1. Try to get path from database
  const dbPaths = await newExecutionService.getImagePaths(executionId);

  if (dbPaths) {
    const relativePath = type === 'original' ? dbPaths.originalPath :
                         type === 'thumb' ? dbPaths.thumbnailPath :
                         dbPaths.cachedPath;

    if (relativePath) {
      const fullPath = resolveImagePath(relativePath);
      if (fullPath && fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  // 2. Try partition-based path
  const partitionPath = path.join(cacheConfig.basePath, buildRelativePath(executionId, type));
  if (fs.existsSync(partitionPath)) {
    return partitionPath;
  }

  // 3. Try legacy path structure
  const legacyPath = buildLegacyPath(executionId, type);
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return null;
}

export const getExecutions = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const {
    page,
    limit,
    status,
    startDate,
    endDate,
    search,
    alertLevel,
    alertLevels,
    nodeId,
    cameraId,
    cameraType,
    cameraTypes,
    deviceId,
    location,
    hasImage,
    hasSmoke,
    telegramSent,
    datePreset,
    sortBy,
    sortOrder,
    yoloModelVersion
  } = req.query;

  // Parse array parameters (alertLevels, cameraTypes)
  const parseArrayParam = (param: any): string[] | undefined => {
    if (!param) return undefined;
    if (Array.isArray(param)) return param as string[];
    if (typeof param === 'string') return param.split(',').filter(Boolean);
    return undefined;
  };

  const filters: ExecutionFilters = {
    page: parseIntSafe(page as string, 1),
    pageSize: parseIntSafe(limit as string, 50),
    status: status as any,
    startDate: startDate as string,
    endDate: endDate as string,
    searchQuery: search as string,
    alertLevel: alertLevel as any,
    alertLevels: parseArrayParam(alertLevels) as any,
    nodeId: nodeId as string,
    cameraId: cameraId as string,
    cameraType: cameraType as any,
    cameraTypes: parseArrayParam(cameraTypes) as any,
    deviceId: deviceId as string,
    location: location as string,
    hasImage: hasImage === 'true' ? true : hasImage === 'false' ? false : undefined,
    hasSmoke: hasSmoke === 'true' ? true : hasSmoke === 'false' ? false : undefined,
    telegramSent: telegramSent === 'true' ? true : telegramSent === 'false' ? false : undefined,
    datePreset: datePreset as any,
    sortBy: sortBy as any,
    sortOrder: sortOrder as any,
    yoloModelVersion: yoloModelVersion as string,
  };

  // Get executions from NEW system only
  const result = await newExecutionService.getExecutions(filters);

  // Simple, clean response
  res.json({
    data: result.executions,
    meta: {
      total: result.pagination.total,
      page: result.pagination.page,
      pageSize: result.pagination.pageSize,
      totalPages: result.pagination.totalPages,
      hasNext: result.pagination.page < result.pagination.totalPages
    }
  });
});

export const getExecutionById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const executionId = parseInt(req.params.executionId);

  if (isNaN(executionId)) {
    res.status(400).json({
      error: {
        message: 'Invalid execution ID',
        code: 'INVALID_ID'
      }
    });
    return;
  }

  const execution = await newExecutionService.getExecutionById(executionId);

  if (!execution) {
    res.status(404).json({
      error: {
        message: 'Execution not found',
        code: 'NOT_FOUND'
      }
    });
    return;
  }

  res.json({
    data: execution
  });
});

export const getExecutionImage = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const executionId = parseInt(req.params.executionId);

  if (isNaN(executionId)) {
    res.status(400).json({
      error: {
        message: 'Invalid execution ID',
        code: 'INVALID_ID'
      }
    });
    return;
  }

  const imagePath = await findImagePath(executionId, 'original');

  if (!imagePath) {
    res.status(404).json({
      error: {
        message: 'Image not found',
        code: 'IMAGE_NOT_FOUND'
      }
    });
    return;
  }

  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path.resolve(imagePath));
});

export const getExecutionImageWebP = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const executionId = parseInt(req.params.executionId);

  if (isNaN(executionId)) {
    res.status(400).json({
      error: {
        message: 'Invalid execution ID',
        code: 'INVALID_ID'
      }
    });
    return;
  }

  // Try WebP first, fall back to original JPEG
  let imagePath = await findImagePath(executionId, 'webp');

  if (!imagePath) {
    imagePath = await findImagePath(executionId, 'original');
  }

  if (!imagePath) {
    res.status(404).json({
      error: {
        message: 'Image not found',
        code: 'IMAGE_NOT_FOUND'
      }
    });
    return;
  }

  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path.resolve(imagePath));
});

export const getExecutionThumbnail = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const executionId = parseInt(req.params.executionId);

  if (isNaN(executionId)) {
    res.status(400).json({
      error: {
        message: 'Invalid execution ID',
        code: 'INVALID_ID'
      }
    });
    return;
  }

  const thumbnailPath = await findImagePath(executionId, 'thumb');

  if (!thumbnailPath) {
    res.status(404).json({
      error: {
        message: 'Thumbnail not found',
        code: 'THUMBNAIL_NOT_FOUND'
      }
    });
    return;
  }

  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path.resolve(thumbnailPath));
});

export const getExecutionData = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const executionId = parseInt(req.params.executionId);

  if (isNaN(executionId)) {
    res.status(400).json({
      error: {
        message: 'Invalid execution ID',
        code: 'INVALID_ID'
      }
    });
    return;
  }

  const executionData = await newExecutionService.getExecutionData(executionId);

  if (!executionData) {
    res.status(404).json({
      error: {
        message: 'Execution data not found',
        code: 'NOT_FOUND'
      }
    });
    return;
  }

  res.json({
    data: executionData
  });
});

// ISO date pattern: YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const getDailySummary = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const {
    days: daysRaw,
    startDate,
    endDate,
    granularity,
    cameraId,
    location,
    nodeId,
    yoloModelVersion
  } = req.query;

  // Validate granularity whitelist
  const validGranularities = ['day', 'week', 'month'];
  const safeGranularity = validGranularities.includes(granularity as string)
    ? (granularity as 'day' | 'week' | 'month')
    : 'day';

  // Dimension filters forwarded in both branches
  const dimFilters = {
    cameraId: cameraId as string | undefined,
    location: location as string | undefined,
    nodeId: nodeId as string | undefined,
    yoloModelVersion: yoloModelVersion as string | undefined,
  };

  // Range mode: require BOTH startDate and endDate
  if (startDate || endDate) {
    if (!startDate || !endDate) {
      res.status(400).json({
        error: { message: 'Both startDate and endDate are required for range mode', code: 'MISSING_PARAMS' }
      });
      return;
    }
    if (!DATE_RE.test(startDate as string) || !DATE_RE.test(endDate as string)) {
      res.status(400).json({
        error: { message: 'startDate and endDate must be in YYYY-MM-DD format', code: 'INVALID_DATE_FORMAT' }
      });
      return;
    }
    const summary = await newExecutionService.getDailySummary({
      startDate: startDate as string,
      endDate: endDate as string,
      granularity: safeGranularity,
      ...dimFilters,
    });
    res.json({ data: summary });
    return;
  }

  // Days mode: clamp to [1, 365] and forward dimension filters
  const days = Math.min(365, Math.max(1, parseIntSafe(daysRaw as string, 7)));
  const summary = await newExecutionService.getDailySummary({
    days,
    granularity: safeGranularity,
    ...dimFilters,
  });
  res.json({ data: summary });
});

export const getStatsRanking = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { startDate, endDate, limit } = req.query;

  if (!startDate || !endDate) {
    res.status(400).json({
      error: { message: 'startDate and endDate are required', code: 'MISSING_PARAMS' }
    });
    return;
  }

  if (!DATE_RE.test(startDate as string) || !DATE_RE.test(endDate as string)) {
    res.status(400).json({
      error: { message: 'startDate and endDate must be in YYYY-MM-DD format', code: 'INVALID_DATE_FORMAT' }
    });
    return;
  }

  // Clamp limit to [1, 50]
  const safeLimit = Math.min(50, Math.max(1, parseIntSafe(limit as string, 5)));

  const ranking = await newExecutionService.getTopByDimension({
    startDate: startDate as string,
    endDate: endDate as string,
    limit: safeLimit,
  });

  res.json({ data: ranking });
});

export const getExecutionStats = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const stats = await newExecutionService.getExecutionStats();

  res.json({
    data: stats
  });
});

export const searchExecutions = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const query = req.query.q as string;
  const limit = parseIntSafe(req.query.limit as string, 50);

  if (!query || query.trim().length === 0) {
    res.status(400).json({
      error: {
        message: 'Search query is required',
        code: 'MISSING_QUERY'
      }
    });
    return;
  }

  const executions = await newExecutionService.searchExecutions(query.trim(), limit);

  res.json({
    data: executions,
    meta: {
      query,
      total: executions.length
    }
  });
});

export const getEnhancedStatistics = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const stats = await newExecutionService.getEnhancedStatistics();

  res.json({
    data: stats
  });
});

export const triggerAnalysisProcessing = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // In the new system, analysis is automatic via ETL
  // This endpoint returns immediate success since everything is already processed
  res.json({
    data: {
      message: 'Analysis processing is automatic in the new system',
      status: 'success',
      processed: 0,
      alreadyProcessed: true
    }
  });
});

export const getFilterOptions = asyncHandler(async (_req: Request, res: Response) => {
  const options = await newExecutionService.getFilterOptions();
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ data: options });
});
