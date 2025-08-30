import { jest } from '@jest/globals';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_n8n';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'test_n8n';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DASHBOARD_PASSWORD = 'test_password';
process.env.SESSION_SECRET = 'test_secret';
process.env.CACHE_PATH = '/tmp/test_cache';
process.env.SAI_WORKFLOW_NAME = 'Test-Workflow';

// Global test timeout
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Global error handler for unhandled rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Global beforeAll setup
beforeAll(async () => {
  // Add any global setup needed before all tests
});

// Global afterAll cleanup
afterAll(async () => {
  // Add any global cleanup needed after all tests
});