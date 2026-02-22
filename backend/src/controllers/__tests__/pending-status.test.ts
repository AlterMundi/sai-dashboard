/**
 * Security tests for GET /auth/pending/status endpoint.
 *
 * This is a public endpoint (no auth required). Tests verify:
 * - Correct response shapes
 * - Input validation (sub length cap)
 * - No auth required
 */

// Mock @/config BEFORE any imports so config validation (which calls process.exit
// on missing OIDC env vars) never runs during unit tests.
jest.mock('@/config', () => ({
  appConfig: {
    oidc: {
      issuer: 'https://test.zitadel.cloud',
      clientId: 'test-client-id',
      clientSecret: '',
      redirectUri: 'http://localhost:3001/auth/callback',
      postLogoutUri: 'http://localhost:3000/',
      projectId: '',
      mgmtKeyJson: '',
    },
    security: {
      sessionSecret: 'test_secret',
      sessionDuration: 86400,
      enforceHttps: false,
      trustProxy: false,
    },
    rateLimit: {
      windowMs: 60000,
      maxRequests: 60,
      loginWindowMs: 900000,
      loginMaxAttempts: 5,
    },
  },
  cacheConfig: {},
  n8nDatabaseConfig: {},
  saiDatabaseConfig: {},
  isDevelopment: false,
  isProduction: false,
}));

// Mock OIDC module — not needed for pending/status but imported transitively
jest.mock('@/auth/oidc', () => ({
  buildAuthorizationUrl: jest.fn(),
  generatePKCEParams: jest.fn(),
  exchangeCode: jest.fn(),
  buildLogoutUrl: jest.fn(),
}));

// Mock logger to suppress output
jest.mock('@/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import request from 'supertest';
import express from 'express';
import { getPendingStatus } from '../auth';
import * as pendingUsersService from '../../services/pending-users-service';

// Mock the DB service — we don't want real DB calls in unit tests
jest.mock('../../services/pending-users-service');

const mockedGetBySub = pendingUsersService.getPendingUserBySub as jest.MockedFunction<
  typeof pendingUsersService.getPendingUserBySub
>;

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  // Public route — NO authenticateToken middleware
  app.get('/auth/pending/status', getPendingStatus);
  return app;
};

describe('GET /auth/pending/status', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
  });

  it('returns 400 when sub query param is missing', async () => {
    const res = await request(app).get('/auth/pending/status').expect(400);
    expect(res.body.error.code).toBe('MISSING_SUB');
  });

  it('returns 400 when sub is longer than 128 characters', async () => {
    const longSub = 'a'.repeat(129);
    const res = await request(app)
      .get(`/auth/pending/status?sub=${longSub}`)
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_SUB');
  });

  it('returns not_found status for an unknown sub', async () => {
    mockedGetBySub.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/auth/pending/status?sub=unknown-sub')
      .expect(200);
    expect(res.body.data.status).toBe('not_found');
  });

  it('returns pending status for a pending user', async () => {
    mockedGetBySub.mockResolvedValueOnce({
      id: 1, zitadelSub: 'sub-123', email: 'a@b.com',
      firstSeenAt: new Date(), lastAttemptAt: new Date(),
      attemptCount: 1, status: 'pending',
    });
    const res = await request(app)
      .get('/auth/pending/status?sub=sub-123')
      .expect(200);
    expect(res.body.data.status).toBe('pending');
  });

  it('returns approved status for an approved user', async () => {
    mockedGetBySub.mockResolvedValueOnce({
      id: 2, zitadelSub: 'sub-456', email: 'b@c.com',
      firstSeenAt: new Date(), lastAttemptAt: new Date(),
      attemptCount: 1, status: 'approved',
    });
    const res = await request(app)
      .get('/auth/pending/status?sub=sub-456')
      .expect(200);
    expect(res.body.data.status).toBe('approved');
  });

  it('returns rejected status for a rejected user', async () => {
    mockedGetBySub.mockResolvedValueOnce({
      id: 3, zitadelSub: 'sub-789', email: 'c@d.com',
      firstSeenAt: new Date(), lastAttemptAt: new Date(),
      attemptCount: 1, status: 'rejected',
    });
    const res = await request(app)
      .get('/auth/pending/status?sub=sub-789')
      .expect(200);
    expect(res.body.data.status).toBe('rejected');
  });

  it('is accessible without an Authorization header (public endpoint)', async () => {
    mockedGetBySub.mockResolvedValueOnce(null);
    // No .set('Authorization', ...) — verify it still returns 200
    const res = await request(app)
      .get('/auth/pending/status?sub=any-sub')
      .expect(200);
    expect(res.body.data).toHaveProperty('status');
  });

  it('accepts a sub at exactly 128 characters (boundary)', async () => {
    mockedGetBySub.mockResolvedValueOnce(null);
    const sub128 = 'a'.repeat(128);
    const res = await request(app)
      .get(`/auth/pending/status?sub=${sub128}`)
      .expect(200);
    expect(res.body.data.status).toBe('not_found');
  });
});
