import { jest } from '@jest/globals';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DASHBOARD_PASSWORD = 'test-password';
process.env.SESSION_SECRET = 'test-secret-key-for-testing';
process.env.CACHE_PATH = '/tmp/test-cache';
process.env.SAI_WORKFLOW_NAME = 'test-workflow';

// Mock database pool
jest.mock('../database/pool', () => ({
  db: {
    query: jest.fn(),
    getClient: jest.fn(),
    transaction: jest.fn(),
    testConnection: jest.fn(),
    close: jest.fn(),
    getPoolStats: jest.fn().mockReturnValue({
      total: 5,
      idle: 3,
      waiting: 0,
    }),
  },
}));

// Mock logger to reduce test output noise
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  expressLogger: {
    info: jest.fn(),
  },
}));

// Mock file system operations
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs') as any;
  return {
    ...actualFs,
    promises: {
      access: jest.fn(),
      mkdir: jest.fn(),
      writeFile: jest.fn(),
      readFile: jest.fn(),
      unlink: jest.fn(),
      stat: jest.fn(),
      readdir: jest.fn(),
      rmdir: jest.fn(),
      symlink: jest.fn(),
    },
    createReadStream: jest.fn(),
    existsSync: jest.fn(),
  };
});

// Mock sharp for image processing
jest.mock('sharp', () => {
  const mockSharp = jest.fn().mockImplementation(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockImplementation(() => Promise.resolve(Buffer.from('test-image'))),
    metadata: jest.fn().mockImplementation(() => Promise.resolve({
      width: 1920,
      height: 1080,
      format: 'jpeg',
    })),
  }));
  return mockSharp;
});

// Global test utilities
export const mockExecutionData = {
  id: 'test-exec-123',
  workflow_id: 'workflow-456',
  status: 'success',
  started_at: new Date('2025-08-29T10:00:00Z'),
  stopped_at: new Date('2025-08-29T10:00:30Z'),
  mode: 'webhook',
  finished: true,
  retry_of: null,
  retry_success_id: null,
  workflow_name: 'test-workflow',
  image_mime_type: 'image/jpeg',
  has_image: true,
  ollama_analysis: 'Test analysis result',
  total_payload_size: 1024,
  telegram_delivered: true,
  telegram_message_id: 'msg-123',
  image_url: '/api/executions/test-exec-123/image',
  thumbnail_url: '/api/executions/test-exec-123/image?thumbnail=true',
  duration_seconds: 30,
};

export const mockExecutionDataPayload = {
  execution_id: 'test-exec-123',
  node_id: 'Webhook',
  data: JSON.stringify({
    main: [{
      binary: {
        data: Buffer.from('test-image').toString('base64'),
        mimeType: 'image/jpeg',
      },
    }],
  }),
  data_size_bytes: 1024,
  created_at: new Date('2025-08-29T10:00:00Z'),
};

export const mockDailySummary = {
  date: '2025-08-29',
  total_executions: 100,
  successful_executions: 95,
  failed_executions: 5,
  success_rate: 95.0,
  avg_execution_time: 25.5,
};

export const mockHealthStatus = {
  status: 'healthy',
  timestamp: new Date().toISOString(),
  version: '1.0.0',
  uptime: 1000,
  services: {
    database: 'connected',
    cache: 'available',
    filesystem: 'writable',
  },
};

// JWT token for testing
export const createTestToken = (payload: any = { userId: 'test-user', isAuthenticated: true }) => {
  const jwt = require('jsonwebtoken');
  return jwt.sign(payload, process.env.SESSION_SECRET, { expiresIn: '1h' });
};

// Reset all mocks after each test
global.afterEach(() => {
  jest.clearAllMocks();
});

// This file is setup only - no tests here