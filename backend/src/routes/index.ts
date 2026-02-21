import { Router, Request, Response } from 'express';
import {
  apiRateLimit,
  authenticateToken,
  requireAuth,
  requireRole,
  optionalAuth
} from '@/middleware/auth';
import {
  initiateOIDC,
  handleCallback,
  logout,
  validateToken,
  refreshToken
} from '@/controllers/auth';
import {
  getExecutions,
  getExecutionById,
  getExecutionImage,
  getExecutionImageWebP,
  getExecutionThumbnail,
  getExecutionData,
  getDailySummary,
  getExecutionStats,
  getStatsRanking,
  searchExecutions,
  getEnhancedStatistics,
  triggerAnalysisProcessing,
  getFilterOptions
} from '@/controllers/executions';
import {
  connectSSE,
  getSSEStatus
} from '@/controllers/sse';
import {
  healthCheck,
  readiness,
  liveness
} from '@/controllers/health';
import { dualDb } from '@/database/dual-pool';
import { logger } from '@/utils/logger';
import { asyncHandler } from '@/utils';
import { advancedDetectionFilter, DetectionFilterCriteria } from '@/services/advanced-detection-filter';

const router = Router();

// =================================================================
// Health Check Routes (No Authentication Required)
// =================================================================
router.get('/health', healthCheck);
router.get('/health/ready', readiness);
router.get('/health/live', liveness);

// =================================================================
// Authentication Routes (OIDC)
// =================================================================
const authRouter = Router();

// OIDC: initiate login (redirect to Zitadel)
authRouter.get('/login', initiateOIDC);

// OIDC: callback from Zitadel (exchanges code, issues JWT, redirects frontend)
authRouter.get('/callback', handleCallback);

// Protected auth endpoints
authRouter.post('/logout', authenticateToken, requireAuth, logout);
authRouter.get('/validate', authenticateToken, requireAuth, validateToken);
authRouter.post('/refresh', authenticateToken, requireAuth, refreshToken);

router.use('/auth', authRouter);

// =================================================================
// Main API Routes (Protected)
// =================================================================

// Apply general rate limiting to all API routes
router.use(apiRateLimit);

// =================================================================
// Server-Sent Events (SSE) Routes - Special Auth Handling
// =================================================================
const sseRouter = Router();

// SSE needs special auth handling since EventSource can't send headers
// Authentication via query parameter: ?token=JWT_TOKEN
sseRouter.get('/', (req, res, next) => {
  const token = req.query.token as string;
  if (token) {
    req.headers.authorization = `Bearer ${token}`;
  }
  authenticateToken(req, res, (err) => {
    if (err) return next(err);
    requireAuth(req, res, next);
  });
}, connectSSE);

// SSE status requires normal auth
sseRouter.get('/status', authenticateToken, requireAuth, getSSEStatus);

// SSE Events (must come BEFORE global auth middleware to use custom auth)
router.use('/events', sseRouter);

// =================================================================
// Secure Image Routes (Token-based Authentication)
// =================================================================
const secureImageRouter = Router();

// Secure image endpoints with token-based auth (for HTML img tags with ?token=xxx)
secureImageRouter.get('/:executionId/image', (req, res, next) => {
  const token = req.query.token as string;
  if (token) {
    req.headers.authorization = `Bearer ${token}`;
  }
  authenticateToken(req, res, (err) => {
    if (err) return next(err);
    requireAuth(req, res, next);
  });
}, getExecutionImage);

secureImageRouter.get('/:executionId/image/webp', (req, res, next) => {
  const token = req.query.token as string;
  if (token) {
    req.headers.authorization = `Bearer ${token}`;
  }
  authenticateToken(req, res, (err) => {
    if (err) return next(err);
    requireAuth(req, res, next);
  });
}, getExecutionImageWebP);

secureImageRouter.get('/:executionId/thumbnail', (req, res, next) => {
  const token = req.query.token as string;
  if (token) {
    req.headers.authorization = `Bearer ${token}`;
  }
  authenticateToken(req, res, (err) => {
    if (err) return next(err);
    requireAuth(req, res, next);
  });
}, getExecutionThumbnail);

router.use('/executions', secureImageRouter);

// =================================================================
// Protected Routes - Require Authentication
// =================================================================

// All main routes require authentication
router.use(authenticateToken);
router.use(requireAuth);

// =================================================================
// Execution Routes
// =================================================================
const executionRouter = Router();

// List executions with filtering and pagination
executionRouter.get('/', getExecutions);

// Search executions
executionRouter.get('/search', searchExecutions);

// Daily summary statistics
executionRouter.get('/summary/daily', getDailySummary);

// General execution statistics
executionRouter.get('/stats', getExecutionStats);

// Enhanced execution statistics with detailed metrics
executionRouter.get('/stats/enhanced', getEnhancedStatistics);

// Rankings: top cameras/locations/nodes by detection metrics
executionRouter.get('/stats/ranking', getStatsRanking);

// Dynamic filter options (distinct values for dropdown population)
executionRouter.get('/filter-options', getFilterOptions);

// Specific execution details
executionRouter.get('/:executionId', getExecutionById);

// Execution raw data (for debugging, SAI_ADMIN+SAI_OPERATOR only)
executionRouter.get('/:executionId/data', requireRole('SAI_ADMIN', 'SAI_OPERATOR'), getExecutionData);

// Image routes moved to public section above for HTML <img> tag compatibility

// Manual analysis trigger (SAI_ADMIN only)
executionRouter.post('/trigger-analysis', requireRole('SAI_ADMIN'), triggerAnalysisProcessing);

// Bulk mark executions as false positive
executionRouter.post('/bulk/false-positive', requireRole('SAI_ADMIN', 'SAI_OPERATOR'), asyncHandler(async (req: Request, res: Response) => {
  const { executionIds, isFalsePositive, reason } = req.body;

  // Validate executionIds is an array of numbers, max 500
  if (!Array.isArray(executionIds) || executionIds.length === 0) {
    res.status(400).json({
      error: { message: 'executionIds must be a non-empty array', code: 'INVALID_REQUEST' }
    });
    return;
  }

  if (executionIds.length > 500) {
    res.status(400).json({
      error: { message: 'Maximum 500 executions per request', code: 'INVALID_REQUEST' }
    });
    return;
  }

  if (!executionIds.every((id: any) => Number.isInteger(id) && id > 0)) {
    res.status(400).json({
      error: { message: 'All executionIds must be positive integers', code: 'INVALID_REQUEST' }
    });
    return;
  }

  if (typeof isFalsePositive !== 'boolean') {
    res.status(400).json({
      error: { message: 'isFalsePositive must be a boolean', code: 'INVALID_REQUEST' }
    });
    return;
  }

  const { newExecutionService } = require('@/services/new-execution-service');
  const result = await newExecutionService.bulkMarkFalsePositive(executionIds, isFalsePositive, reason, req.user?.id, req.user?.email);

  if (!result.success) {
    res.status(500).json({
      error: { message: result.error || 'Failed to bulk update', code: 'BULK_UPDATE_FAILED' }
    });
    return;
  }

  res.json({
    data: { updatedCount: result.updatedCount },
    meta: {
      action: isFalsePositive ? 'bulk_marked_false_positive' : 'bulk_unmarked_false_positive',
      timestamp: new Date().toISOString()
    }
  });
}));

// Mark execution as false positive
executionRouter.post('/:executionId/false-positive', requireRole('SAI_ADMIN', 'SAI_OPERATOR'), asyncHandler(async (req: Request, res: Response) => {
  const executionId = parseInt(req.params.executionId);
  const { isFalsePositive, reason } = req.body;

  if (isNaN(executionId)) {
    res.status(400).json({
      error: {
        message: 'Invalid execution ID',
        code: 'INVALID_EXECUTION_ID'
      }
    });
    return;
  }

  if (typeof isFalsePositive !== 'boolean') {
    res.status(400).json({
      error: {
        message: 'isFalsePositive must be a boolean',
        code: 'INVALID_REQUEST'
      }
    });
    return;
  }

  const { newExecutionService } = require('@/services/new-execution-service');
  const result = await newExecutionService.markFalsePositive(executionId, isFalsePositive, reason, req.user?.id, req.user?.email);

  if (!result.success) {
    res.status(404).json({
      error: {
        message: result.error || 'Failed to update false positive status',
        code: 'UPDATE_FAILED'
      }
    });
    return;
  }

  res.json({
    data: result.execution,
    meta: {
      action: isFalsePositive ? 'marked_as_false_positive' : 'unmarked_false_positive',
      timestamp: new Date().toISOString()
    }
  });
}));

router.use('/executions', executionRouter);

// =================================================================
// Advanced Detection Filtering Routes (Protected)
// =================================================================
const detectionRouter = Router();

// Search executions with advanced JSONB detection criteria
detectionRouter.post('/search', requireRole('SAI_ADMIN', 'SAI_OPERATOR'), asyncHandler(async (req: Request, res: Response) => {
  const criteria: DetectionFilterCriteria = req.body;
  const limit = parseInt(req.query.limit as string) || 100;

  // Validate criteria
  const validation = advancedDetectionFilter.validateCriteria(criteria);
  if (!validation.valid) {
    res.status(400).json({
      error: {
        message: 'Invalid filter criteria',
        code: 'INVALID_CRITERIA',
        details: validation.errors
      }
    });
    return;
  }

  const results = await advancedDetectionFilter.findExecutionsWithAdvancedDetection(criteria, limit);

  res.json({
    data: results,
    meta: {
      total: results.length,
      criteria
    }
  });
}));

// Get detection statistics
detectionRouter.get('/statistics', asyncHandler(async (req: Request, res: Response) => {
  const timeRange = (req.query.timeRange as 'hour' | 'day' | 'week') || 'day';

  if (!['hour', 'day', 'week'].includes(timeRange)) {
    res.status(400).json({
      error: {
        message: 'Invalid time range. Must be hour, day, or week.',
        code: 'INVALID_TIME_RANGE'
      }
    });
    return;
  }

  const statistics = await advancedDetectionFilter.getDetectionStatistics(timeRange);

  res.json({
    data: statistics,
    meta: {
      timeRange,
      timestamp: new Date().toISOString()
    }
  });
}));

router.use('/detections', detectionRouter);

// =================================================================
// Optional Routes (With Optional Auth)
// =================================================================

// Public stats endpoint (optional auth for enhanced data)
router.get('/public/stats', optionalAuth, async (req, res) => {
  try {
    const { newExecutionService } = require('@/services/new-execution-service');
    const stats = await newExecutionService.getExecutionStats();

    // Basic stats available to everyone
    const basicStats = {
      totalExecutions: stats.totalExecutions,
      successRate: stats.successRate,
      lastUpdate: new Date().toISOString()
    };

    // Enhanced stats for authenticated users
    if (req.user?.isAuthenticated) {
      res.json({
        data: {
          ...basicStats,
          ...stats,
          authenticated: true
        }
      });
    } else {
      res.json({
        data: {
          ...basicStats,
          authenticated: false
        }
      });
    }
  } catch (error) {
    logger.error('Failed to fetch public stats:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch public stats',
        code: 'PUBLIC_STATS_ERROR'
      }
    });
  }
});

// =================================================================
// Debug Routes (Development Only or SSE_DEBUG enabled)
// =================================================================
if (process.env.NODE_ENV === 'development' || process.env.SSE_DEBUG === 'true') {
  const debugRouter = require('./debug').default;
  router.use('/debug', debugRouter);
  console.log('🐛 SSE Debug routes enabled at /dashboard/api/debug/*');
}

// =================================================================
// API Documentation (Development Only)
// =================================================================
if (process.env.NODE_ENV === 'development' || process.env.ENABLE_API_DOCS === 'true') {
  router.get('/docs', (req, res) => {
    res.json({
      data: {
        title: 'SAI Dashboard API',
        version: '1.0.0',
        description: 'Visual management interface for n8n image analysis workflow',
        endpoints: {
          authentication: {
            'GET /auth/login': 'Initiate OIDC login (redirect to Zitadel)',
            'GET /auth/callback': 'OIDC callback handler (exchange code, issue JWT)',
            'POST /auth/logout': 'Logout and redirect to Zitadel end_session',
            'GET /auth/validate': 'Validate current token',
            'POST /auth/refresh': 'Refresh expiring token'
          },
          executions: {
            'GET /executions': 'List executions with filters and pagination',
            'GET /executions/search': 'Search executions by analysis content',
            'GET /executions/summary/daily': 'Daily execution statistics',
            'GET /executions/stats': 'Overall execution statistics',
            'GET /executions/:id': 'Get specific execution details',
            'GET /executions/:id/image': 'Get execution image (original)',
            'GET /executions/:id/image?thumbnail=true': 'Get execution thumbnail',
            'GET /executions/:id/data': 'Get raw execution data (SAI_ADMIN/SAI_OPERATOR)',
            'GET /executions/:id/analysis': 'Get comprehensive analysis'
          },
          realtime: {
            'GET /events': 'Server-Sent Events stream for real-time updates',
            'GET /events/status': 'SSE connection status and statistics'
          },
          detections: {
            'POST /detections/search': 'Search executions with advanced JSONB detection filters (SAI_ADMIN/SAI_OPERATOR)',
            'GET /detections/statistics': 'Get detection statistics with class distribution'
          },
          health: {
            'GET /health': 'Complete health check with service status',
            'GET /health/ready': 'Readiness probe for container orchestration',
            'GET /health/live': 'Liveness probe for container orchestration'
          }
        },
        authentication: {
          type: 'OIDC / Bearer Token',
          flow: 'GET /api/auth/login → Zitadel → GET /api/auth/callback → JWT',
          header: 'Authorization: Bearer <token>'
        },
        rateLimit: {
          general: '60 requests per minute'
        }
      }
    });
  });
}

// =================================================================
// 404 Handler for API routes
// =================================================================
router.use('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
      code: 'ENDPOINT_NOT_FOUND'
    }
  });
});

export default router;
