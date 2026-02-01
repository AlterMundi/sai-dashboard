import { Router } from 'express';
import { 
  apiRateLimit, 
  burstRateLimit, 
  loginRateLimit,
  authenticateToken, 
  requireAuth,
  optionalAuth 
} from '@/middleware/auth';
import { 
  login, 
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
  searchExecutions,
  getEnhancedStatistics,
  triggerAnalysisProcessing
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
import { NodeController } from '@/controllers/node';

const router = Router();

// =================================================================
// Health Check Routes (No Authentication Required)
// =================================================================
router.get('/health', healthCheck);
router.get('/health/ready', readiness);
router.get('/health/live', liveness);

// =================================================================
// Authentication Routes
// =================================================================
const authRouter = Router();

// Login with strict rate limiting
authRouter.post('/login', loginRateLimit, login);

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
router.use(burstRateLimit);

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

// Specific execution details
executionRouter.get('/:executionId', getExecutionById);

// Execution raw data (for debugging)
executionRouter.get('/:executionId/data', getExecutionData);

// Image routes moved to public section above for HTML <img> tag compatibility

// Manual analysis trigger
executionRouter.post('/trigger-analysis', triggerAnalysisProcessing);

router.use('/executions', executionRouter);


// =================================================================
// Incident Analysis Routes (Protected)
// =================================================================
const incidentRouter = Router();

// Multi-camera incident detection
incidentRouter.get('/', async (req, res) => {
  try {
    const {
      status = 'active',
      timeRange = '24h',
      minCameras = 1,
      alertLevel
    } = req.query;

    // Get active incidents across multiple cameras
    let whereConditions = ['incident_id IS NOT NULL'];
    const queryParams: any[] = [];
    let paramCount = 0;

    // Time range filter
    if (timeRange === '1h') {
      whereConditions.push(`detection_timestamp > NOW() - INTERVAL '1 hour'`);
    } else if (timeRange === '24h') {
      whereConditions.push(`detection_timestamp > NOW() - INTERVAL '24 hours'`);
    } else if (timeRange === '7d') {
      whereConditions.push(`detection_timestamp > NOW() - INTERVAL '7 days'`);
    }

    // Alert level filter
    if (alertLevel) {
      paramCount++;
      whereConditions.push(`alert_level = $${paramCount}`);
      queryParams.push(alertLevel);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get incident summaries
    const incidentsQuery = `
      SELECT
        incident_id,
        COUNT(*) as total_detections,
        COUNT(DISTINCT camera_id) as cameras_involved,
        MAX(alert_level) as max_alert_level,
        MIN(detection_timestamp) as incident_start,
        MAX(detection_timestamp) as incident_end,
        ARRAY_AGG(DISTINCT camera_id) as camera_list
      FROM execution_analysis
      WHERE ${whereClause}
      GROUP BY incident_id
      HAVING COUNT(DISTINCT camera_id) >= $${paramCount + 1}
      ORDER BY incident_start DESC
      LIMIT 50
    `;

    queryParams.push(parseInt(minCameras as string) || 1);
    const { dualDb } = await import('@/database/dual-pool');
    const incidents = await dualDb.query(incidentsQuery, queryParams);

    res.json({
      data: incidents.map((incident: any) => ({
        incidentId: incident.incident_id,
        totalDetections: parseInt(incident.total_detections),
        camerasInvolved: parseInt(incident.cameras_involved),
        maxAlertLevel: incident.max_alert_level,
        incidentStart: incident.incident_start,
        incidentEnd: incident.incident_end,
        cameraList: incident.camera_list
      })),
      meta: {
        totalIncidents: incidents.length,
        timeRange,
        minCameras: parseInt(minCameras as string) || 1
      }
    });

  } catch (error) {
    const { logger } = await import('@/utils/logger');
    logger.error('Failed to fetch incidents:', { query: req.query, error });
    res.status(500).json({
      error: {
        message: 'Failed to fetch incidents',
        code: 'FETCH_INCIDENTS_ERROR'
      }
    });
  }
});

router.use('/incidents', incidentRouter);

// =================================================================
// NODE-BASED REGIONAL MONITORING ROUTES (NEW)
// =================================================================

// Regional node management
router.get('/nodes', NodeController.getAllNodes);
router.get('/nodes/performance', NodeController.getNodePerformance);
router.get('/nodes/:nodeId', NodeController.getNodeDetails);
router.get('/nodes/:nodeId/executions', NodeController.getNodeExecutions);
router.get('/nodes/:nodeId/cameras', NodeController.getNodeCameras);

// Coverage and geographic data
router.get('/coverage/regional', NodeController.getRegionalCoverage);
router.get('/coverage/map', NodeController.getCoverageMap);

// =================================================================
// Optional Routes (With Optional Auth)
// =================================================================

// Public stats endpoint (optional auth for enhanced data)
router.get('/public/stats', optionalAuth, async (req, res) => {
  try {
    // Basic stats available to everyone
    const basicStats = {
      totalExecutions: 4893,
      successRate: 99.96,
      lastUpdate: new Date().toISOString()
    };

    // Enhanced stats for authenticated users
    if (req.user?.isAuthenticated) {
      const { newExecutionService } = require('@/services/new-execution-service');
      const detailedStats = await newExecutionService.getExecutionStats();
      
      res.json({
        data: {
          ...basicStats,
          ...detailedStats,
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
            'POST /auth/login': 'Login with dashboard password',
            'POST /auth/logout': 'Logout and invalidate token',
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
            'GET /executions/:id/data': 'Get raw execution data',
            'GET /executions/:id/analysis': 'Get comprehensive analysis',
            'POST /executions/:id/process': 'Process execution analysis'
          },
          realtime: {
            'GET /events': 'Server-Sent Events stream for real-time updates',
            'GET /events/status': 'SSE connection status and statistics'
          },
          incidents: {
            'GET /incidents': 'List multi-camera incidents',
            'GET /incidents/:id': 'Get incident analysis'
          },
          health: {
            'GET /health': 'Complete health check with service status',
            'GET /health/ready': 'Readiness probe for container orchestration',
            'GET /health/live': 'Liveness probe for container orchestration'
          }
        },
        authentication: {
          type: 'Bearer Token',
          header: 'Authorization: Bearer <token>',
          login: {
            url: '/api/auth/login',
            method: 'POST',
            body: { password: 'dashboard_password' }
          }
        },
        rateLimit: {
          general: '60 requests per minute',
          burst: '10 requests per 10 seconds',
          login: '5 attempts per 15 minutes'
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