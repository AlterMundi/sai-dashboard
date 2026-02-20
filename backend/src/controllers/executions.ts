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
    sortOrder
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
    sortOrder: sortOrder as any
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

export const getDailySummary = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const days = parseIntSafe(req.query.days as string, 7);

  const summary = await newExecutionService.getDailySummary(days);

  res.json({
    data: summary
  });
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
