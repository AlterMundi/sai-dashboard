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
  getExecutionData,
  getDailySummary,
  getExecutionStats,
  searchExecutions
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

router.use('/events', sseRouter);

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

// Specific execution details
executionRouter.get('/:executionId', getExecutionById);

// Execution raw data (for debugging)
executionRouter.get('/:executionId/data', getExecutionData);

// Execution image serving (original and thumbnails)
executionRouter.get('/:executionId/image', getExecutionImage);

router.use('/executions', executionRouter);

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
      const executionService = require('@/services/execution').executionService;
      const detailedStats = await executionService.getExecutionStats();
      
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
            'GET /executions/:id/data': 'Get raw execution data'
          },
          realtime: {
            'GET /events': 'Server-Sent Events stream for real-time updates',
            'GET /events/status': 'SSE connection status and statistics'
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