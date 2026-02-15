import { config } from 'dotenv';
import { DatabaseConfig, CacheConfig } from '@/types';
import { resolve } from 'path';

// Load .env from project root (single source of truth)
config({ path: resolve(__dirname, '../../../.env') });

/**
 * Validation: Required environment variables
 * These MUST be set for the application to start
 * Note: DB passwords are optional in development (local peer auth)
 */
const requiredEnvVars = [
  'DASHBOARD_PASSWORD',
  'SESSION_SECRET',
] as const;

// DB passwords required in production only
const productionRequiredVars = [
  'N8N_DB_PASSWORD',
  'SAI_DB_PASSWORD',
] as const;

const missingVars: string[] = [];
const warningVars: Array<{ key: string; message: string }> = [];

// Check for missing required variables
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    missingVars.push(envVar);
  }
}

// Check production-only required variables
if (process.env.NODE_ENV === 'production') {
  for (const envVar of productionRequiredVars) {
    if (!process.env[envVar]) {
      missingVars.push(envVar);
    }
  }
}

// Warn if legacy DATABASE_URL is set (superseded by dual-database config)
if (process.env.DATABASE_URL) {
  warningVars.push({
    key: 'DATABASE_URL',
    message: 'Legacy variable - use N8N_DB_* and SAI_DB_* variables instead',
  });
}

// Check for insecure default values (production safety)
if (process.env.NODE_ENV === 'production') {
  if (process.env.DASHBOARD_PASSWORD === '12345') {
    warningVars.push({
      key: 'DASHBOARD_PASSWORD',
      message: 'Using weak password "12345" in production! Change immediately.',
    });
  }

  if (process.env.SESSION_SECRET === 'your-super-secret-session-key-change-this-in-production') {
    warningVars.push({
      key: 'SESSION_SECRET',
      message: 'Using default SESSION_SECRET in production! Change immediately.',
    });
  }
}

// Check for critical database configuration
const criticalDbVars = ['N8N_DB_HOST', 'N8N_DB_USER', 'N8N_DB_PASSWORD', 'SAI_DB_HOST', 'SAI_DB_USER', 'SAI_DB_PASSWORD'];
for (const dbVar of criticalDbVars) {
  if (!process.env[dbVar]) {
    warningVars.push({
      key: dbVar,
      message: 'Database configuration missing - ETL services may fail',
    });
  }
}

// Check for required frontend variables
if (!process.env.VITE_API_URL && !process.env.API_BASE_PATH) {
  warningVars.push({
    key: 'VITE_API_URL',
    message: 'Frontend API URL not configured - API calls may fail',
  });
}

// Report errors and exit if critical variables are missing
if (missingVars.length > 0) {
  console.error('\n❌ FATAL: Missing required environment variables:\n');
  missingVars.forEach((v) => console.error(`  - ${v}`));
  console.error('\nPlease check your .env file and ensure all required variables are set.');
  console.error('See .env.example for reference.\n');
  process.exit(1);
}

// Report warnings (non-fatal)
if (warningVars.length > 0) {
  console.warn('\n⚠️  WARNING: Configuration issues detected:\n');
  warningVars.forEach(({ key, message }) => {
    console.warn(`  - ${key}: ${message}`);
  });
  console.warn('\n');
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
    loginWindowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW || '900000', 10),
    loginMaxAttempts: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10),
  },

  sai: {
    workflowName: process.env.SAI_WORKFLOW_NAME || 'SAI Webhook + YOLO',
    workflowId: process.env.SAI_WORKFLOW_ID || 'yDbfhooKemfhMIkC',
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
    debug: process.env.SSE_DEBUG === 'true',
  },

  health: {
    timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000', 10),
    enableMetrics: process.env.ENABLE_SYSTEM_METRICS === 'true',
  },

  features: {
    realTimeUpdates: process.env.FEATURE_REAL_TIME_UPDATES !== 'false',
    devTools: process.env.ENABLE_DEV_TOOLS === 'true',
  }
};

// LEGACY: databaseConfig removed - use n8nDatabaseConfig or saiDatabaseConfig instead
// export const databaseConfig: DatabaseConfig = { ... }

// Resolve IMAGE_BASE_PATH relative to project root (where .env is located)
// This ensures paths like "./image-cache" work regardless of current working directory
const projectRoot = resolve(__dirname, '../../..');
const rawImageBasePath = process.env.IMAGE_BASE_PATH || '/mnt/raid1/n8n-backup/images';
const resolvedImageBasePath = rawImageBasePath.startsWith('/')
  ? rawImageBasePath
  : resolve(projectRoot, rawImageBasePath);

export const cacheConfig: CacheConfig = {
  path: process.env.CACHE_PATH || '/cache',
  basePath: resolvedImageBasePath,
  n8nBinaryDataPath: process.env.N8N_BINARY_DATA_PATH || '/mnt/n8n-data/.n8n/binaryData',
  enableThumbnails: process.env.ENABLE_THUMBNAIL_GENERATION === 'true',
  thumbnailSize: parseInt(process.env.THUMBNAIL_SIZE || '200', 10),
  thumbnailQuality: parseInt(process.env.THUMBNAIL_QUALITY || '70', 10),
  maxImageSize: parseInt(process.env.MAX_IMAGE_SIZE || '5242880', 10),
  supportedFormats: (process.env.SUPPORTED_IMAGE_FORMATS || 'jpeg,png,webp').split(','),
  ttl: parseInt(process.env.IMAGE_CACHE_TTL || '86400', 10),
};

// N8N Database Configuration (for ETL services)
// Note: Empty password string is valid for local peer auth
export const n8nDatabaseConfig = {
  host: process.env.N8N_DB_HOST || 'localhost',
  port: parseInt(process.env.N8N_DB_PORT || '5432', 10),
  database: process.env.N8N_DB_NAME || 'n8n',
  username: process.env.N8N_DB_USER || 'n8n_user',
  password: process.env.N8N_DB_PASSWORD ?? '',
};

// SAI Dashboard Database Configuration (separate database)
export const saiDatabaseConfig = {
  host: process.env.SAI_DB_HOST || 'localhost',
  port: parseInt(process.env.SAI_DB_PORT || '5432', 10),
  database: process.env.SAI_DB_NAME || 'sai_dashboard',
  username: process.env.SAI_DB_USER || 'sai_dashboard_user',
  password: process.env.SAI_DB_PASSWORD ?? '',
};

export const isDevelopment = appConfig.nodeEnv === 'development';
export const isProduction = appConfig.nodeEnv === 'production';