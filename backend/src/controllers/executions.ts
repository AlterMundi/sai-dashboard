/**
 * NEW Execution Controller - Clean and Simple
 * Single source of truth: Uses ONLY newExecutionService and sai_dashboard
 * Merciless replacement of old complex logic with clean new approach
 */

import { Request, Response } from 'express';
import { newExecutionService } from '@/services/new-execution-service';
import { imageService } from '@/services/image';
import { ExecutionFilters } from '@/types';
import { logger } from '@/utils/logger';
import { asyncHandler, parseIntSafe } from '@/utils';

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
    hasFire,
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
    hasFire: hasFire === 'true' ? true : hasFire === 'false' ? false : undefined,
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

  // Support both partition-based (new) and legacy directory structures
  const partition = Math.floor(executionId / 1000);
  const partitionJpegPath = `/mnt/raid1/n8n-backup/images/original/${partition}/${executionId}.jpg`;
  const legacyJpegPath = `/mnt/raid1/n8n-backup/images/by-execution/${executionId}/original.jpg`;

  const fs = require('fs');
  let imagePath: string;

  if (fs.existsSync(partitionJpegPath)) {
    imagePath = partitionJpegPath;
  } else if (fs.existsSync(legacyJpegPath)) {
    imagePath = legacyJpegPath;
  } else {
    res.status(404).json({
      error: {
        message: 'Image not found',
        code: 'IMAGE_NOT_FOUND'
      }
    });
    return;
  }

  res.sendFile(imagePath);
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

  // Support both partition-based (new) and legacy directory structures
  const partition = Math.floor(executionId / 1000);
  const partitionWebpPath = `/mnt/raid1/n8n-backup/images/webp/${partition}/${executionId}.webp`;
  const legacyWebpPath = `/mnt/raid1/n8n-backup/images/by-execution/${executionId}/high.webp`;

  const fs = require('fs');
  let webpPath: string | null = null;

  if (fs.existsSync(partitionWebpPath)) {
    webpPath = partitionWebpPath;
  } else if (fs.existsSync(legacyWebpPath)) {
    webpPath = legacyWebpPath;
  }

  if (webpPath) {
    res.sendFile(webpPath);
    return;
  }

  // Fall back to JPEG original
  const partitionJpegPath = `/mnt/raid1/n8n-backup/images/original/${partition}/${executionId}.jpg`;
  const legacyJpegPath = `/mnt/raid1/n8n-backup/images/by-execution/${executionId}/original.jpg`;

  if (fs.existsSync(partitionJpegPath)) {
    res.sendFile(partitionJpegPath);
  } else if (fs.existsSync(legacyJpegPath)) {
    res.sendFile(legacyJpegPath);
  } else {
    res.status(404).json({
      error: {
        message: 'Image not found',
        code: 'IMAGE_NOT_FOUND'
      }
    });
  }
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

  // Support both partition-based (new) and legacy directory structures
  const partition = Math.floor(executionId / 1000);
  const partitionPath = `/mnt/raid1/n8n-backup/images/thumb/${partition}/${executionId}.webp`;
  const legacyPath = `/mnt/raid1/n8n-backup/images/by-execution/${executionId}/thumb.webp`;

  // Try partition-based path first, fallback to legacy
  const fs = require('fs');
  let thumbnailPath: string;

  if (fs.existsSync(partitionPath)) {
    thumbnailPath = partitionPath;
  } else if (fs.existsSync(legacyPath)) {
    thumbnailPath = legacyPath;
  } else {
    res.status(404).json({
      error: {
        message: 'Thumbnail not found',
        code: 'THUMBNAIL_NOT_FOUND'
      }
    });
    return;
  }

  res.sendFile(thumbnailPath);
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