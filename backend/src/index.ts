import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { appConfig, isDevelopment } from '@/config';
import { logger, expressLogger } from '@/utils/logger';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: isDevelopment ? false : {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: appConfig.cors.origin,
  credentials: appConfig.cors.credentials,
  optionsSuccessStatus: 200
}));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Request logging
const morganFormat = isDevelopment ? 'dev' : 'combined';
app.use(morgan(morganFormat, {
  stream: { write: message => expressLogger.info(message.trim()) }
}));

// Trust proxy if configured
if (appConfig.security.trustProxy) {
  app.set('trust proxy', true);
}

// Health check endpoint - Self-contained under /dashboard/api
app.get('/dashboard/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// API routes - Self-contained under /dashboard/api
import apiRoutes from '@/routes';
app.use('/dashboard/api', apiRoutes);

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  const statusCode = (err as any).statusCode || 500;
  res.status(statusCode).json({
    error: {
      message: isDevelopment ? err.message : 'Internal server error',
      code: 'INTERNAL_ERROR'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found',
      code: 'NOT_FOUND'
    }
  });
});

const startServer = async (): Promise<void> => {
  try {
    app.listen(appConfig.port, () => {
      logger.info(`SAI Dashboard API started on port ${appConfig.port}`);
      logger.info(`Environment: ${appConfig.nodeEnv}`);
      logger.info(`CORS origin: ${appConfig.cors.origin}`);
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

void startServer();