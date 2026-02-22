// Mock @/config before any module imports to prevent process.exit on missing env vars.
jest.mock('@/config', () => ({
  appConfig: {
    security: { sessionSecret: 'test-secret', sessionDuration: 86400, enforceHttps: false, trustProxy: false },
    rateLimit: { windowMs: 60_000, maxRequests: 60, loginWindowMs: 900_000, loginMaxAttempts: 5 },
    oidc: { issuer: 'https://auth.example.com', clientId: 'test-client', clientSecret: '', redirectUri: '', postLogoutUri: '', projectId: '', mgmtKeyJson: '' },
    nodeEnv: 'test',
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/auth/oidc', () => ({
  buildAuthorizationUrl: jest.fn().mockResolvedValue(new URL('https://auth.example.com/authorize')),
  generatePKCEParams: jest.fn().mockResolvedValue({ codeVerifier: 'v', codeChallenge: 'c', state: 's' }),
  exchangeCode: jest.fn(),
  buildLogoutUrl: jest.fn().mockReturnValue(new URL('https://auth.example.com/end_session')),
}));

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { logout, validateToken, refreshToken } from '../auth';
import { authenticateToken } from '../../middleware/auth';

// Must match the sessionSecret in the @/config mock above
const TEST_SECRET = 'test-secret';

// Inline token helper — no dependency on deleted legacy setup
const createTestToken = (payload: any = { userId: 'test-user', isAuthenticated: true }) => {
  return jwt.sign(payload, TEST_SECRET, { expiresIn: '1h' });
};

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  app.post('/auth/logout', authenticateToken, logout);
  app.get('/auth/validate', authenticateToken, validateToken);
  app.post('/auth/refresh', authenticateToken, refreshToken);

  return app;
};

describe('Auth Controller', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  describe('POST /auth/logout', () => {
    it('should redirect to Zitadel end_session with valid token', async () => {
      const token = createTestToken();

      const response = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(302);

      expect(response.headers['location']).toContain('auth.example.com');
    });

    it('should reject logout without token', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .expect(401);

      expect(response.body.error.message).toBe('Access token is required');
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject logout with invalid token', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error.message).toBe('Invalid token');
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('GET /auth/validate', () => {
    it('should validate a valid token', async () => {
      const token = createTestToken({
        userId: 'test-user-123',
        isAuthenticated: true,
      });

      const response = await request(app)
        .get('/auth/validate')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('valid', true);
      expect(response.body.data).toHaveProperty('userId', 'test-user-123');
      expect(response.body.data).toHaveProperty('expiresAt');
      expect(response.body.data).toHaveProperty('remainingTime');
      expect(response.body.data.remainingTime).toBeGreaterThan(0);
    });

    it('should reject validation without token', async () => {
      const response = await request(app)
        .get('/auth/validate')
        .expect(401);

      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject expired token', async () => {
      const expiredToken = jwt.sign(
        { userId: 'test-user', isAuthenticated: true },
        TEST_SECRET,
        { expiresIn: '1ms' }
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      const response = await request(app)
        .get('/auth/validate')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.error.message).toBe('Token has expired');
      expect(response.body.error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh token when close to expiry', async () => {
      const nearExpiryToken = jwt.sign(
        { userId: 'test-user', isAuthenticated: true },
        TEST_SECRET,
        { expiresIn: 1800 } // 30 minutes
      );

      const response = await request(app)
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${nearExpiryToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('expiresIn', 86400);
      expect(response.body.data.token).not.toBe(nearExpiryToken);
    });

    it('should reject refresh for token with lots of time remaining', async () => {
      const token = jwt.sign(
        { userId: 'test-user', isAuthenticated: true },
        TEST_SECRET,
        { expiresIn: '2h' }
      );

      const response = await request(app)
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.body.error.message).toBe('Token does not need refresh yet');
      expect(response.body.error.code).toBe('TOKEN_NOT_EXPIRED');
    });

    it('should reject refresh without token', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .expect(401);

      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should handle malformed token', async () => {
      const response = await request(app)
        .get('/auth/validate')
        .set('Authorization', 'Bearer malformed.token.here')
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Token validation edge cases', () => {
    it('should handle token without Bearer prefix', async () => {
      const token = createTestToken();

      const response = await request(app)
        .get('/auth/validate')
        .set('Authorization', token)
        .expect(401);

      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should handle empty Authorization header', async () => {
      const response = await request(app)
        .get('/auth/validate')
        .set('Authorization', '')
        .expect(401);

      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should handle Bearer with no token', async () => {
      const response = await request(app)
        .get('/auth/validate')
        .set('Authorization', 'Bearer ')
        .expect(401);

      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });
  });
});
