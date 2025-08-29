import { config } from 'dotenv';
import { DatabaseConfig, CacheConfig } from '@/types';

config();

const requiredEnvVars = [
  'DATABASE_URL',
  'DASHBOARD_PASSWORD',
  'SESSION_SECRET',
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

export const appConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.API_PORT || '3001', 10),
  basePath: process.env.API_BASE_PATH || '/api',
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },

  security: {
    dashboardPassword: process.env.DASHBOARD_PASSWORD!,
    sessionSecret: process.env.SESSION_SECRET!,
    sessionDuration: parseInt(process.env.SESSION_DURATION || '86400', 10),
    enforceHttps: process.env.ENFORCE_HTTPS === 'true',
    trustProxy: process.env.TRUST_PROXY === 'true',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10),
    burstMax: parseInt(process.env.RATE_LIMIT_BURST_MAX || '10', 10),
    burstWindow: parseInt(process.env.RATE_LIMIT_BURST_WINDOW || '10000', 10),
    loginWindowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW || '900000', 10),
    loginMaxAttempts: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10),
  },

  sai: {
    workflowName: process.env.SAI_WORKFLOW_NAME || 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto',
    defaultPageSize: parseInt(process.env.DEFAULT_PAGE_SIZE || '50', 10),
    maxPageSize: parseInt(process.env.MAX_PAGE_SIZE || '200', 10),
    maxDaysLookback: parseInt(process.env.MAX_DAYS_LOOKBACK || '365', 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'simple',
    filePath: process.env.LOG_FILE_PATH,
    logDatabaseQueries: process.env.LOG_DATABASE_QUERIES === 'true',
  },

  sse: {
    heartbeatInterval: parseInt(process.env.SSE_HEARTBEAT_INTERVAL || '30000', 10),
    maxClients: parseInt(process.env.SSE_MAX_CLIENTS || '100', 10),
    timeout: parseInt(process.env.SSE_TIMEOUT || '300000', 10),
  },

  health: {
    timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000', 10),
    enableMetrics: process.env.ENABLE_SYSTEM_METRICS === 'true',
  },

  features: {
    imageProcessing: process.env.FEATURE_IMAGE_PROCESSING !== 'false',
    realTimeUpdates: process.env.FEATURE_REAL_TIME_UPDATES !== 'false',
    exportFunctionality: process.env.FEATURE_EXPORT_FUNCTIONALITY === 'true',
    devTools: process.env.ENABLE_DEV_TOOLS === 'true',
  }
};

export const databaseConfig: DatabaseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'n8n',
  username: process.env.DB_USER || 'sai_dashboard_readonly',
  password: process.env.DB_PASSWORD || 'password',
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '5', 10),
  idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000', 10),
};

export const cacheConfig: CacheConfig = {
  path: process.env.CACHE_PATH || '/cache',
  enableThumbnails: process.env.ENABLE_THUMBNAIL_GENERATION === 'true',
  thumbnailSize: parseInt(process.env.THUMBNAIL_SIZE || '200', 10),
  thumbnailQuality: parseInt(process.env.THUMBNAIL_QUALITY || '70', 10),
  maxImageSize: parseInt(process.env.MAX_IMAGE_SIZE || '5242880', 10),
  supportedFormats: (process.env.SUPPORTED_IMAGE_FORMATS || 'jpeg,png,webp').split(','),
  ttl: parseInt(process.env.IMAGE_CACHE_TTL || '86400', 10),
};

export const isDevelopment = appConfig.nodeEnv === 'development';
export const isProduction = appConfig.nodeEnv === 'production';