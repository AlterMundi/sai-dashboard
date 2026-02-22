/**
 * TDD: Verify pendingStatusRateLimit is exported from middleware/auth and
 * behaves as a rate-limit middleware (sets standard headers on responses).
 *
 * RED phase: `pendingStatusRateLimit` does not exist yet.
 */

// Mock @/config before any module imports so the config validation
// (which calls process.exit on missing env vars) never runs.
jest.mock('@/config', () => ({
  appConfig: {
    security: { sessionSecret: 'test-secret', sessionDuration: 86400, enforceHttps: false, trustProxy: false },
    rateLimit: { windowMs: 60_000, maxRequests: 60, loginWindowMs: 900_000, loginMaxAttempts: 5 },
    nodeEnv: 'test',
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import { pendingStatusRateLimit } from '@/middleware/auth';

function buildApp() {
  const app = express();
  app.set('trust proxy', false);
  app.use('/status', pendingStatusRateLimit, (_req: any, res: any) => {
    res.json({ ok: true });
  });
  return app;
}

describe('pendingStatusRateLimit', () => {
  it('is exported from middleware/auth', () => {
    expect(pendingStatusRateLimit).toBeDefined();
    expect(typeof pendingStatusRateLimit).toBe('function');
  });

  it('allows requests within the limit', async () => {
    const app = buildApp();
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
  });

  it('sets RateLimit-Limit header on responses', async () => {
    const app = buildApp();
    const res = await request(app).get('/status');
    // express-rate-limit v7 sets standardised headers
    const limitHeader =
      res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit'];
    expect(limitHeader).toBeDefined();
  });
});
