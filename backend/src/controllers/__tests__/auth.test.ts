import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { login, logout, validateToken, refreshToken } from '../auth';
import { loginRateLimit, authenticateToken } from '../../middleware/auth';

// Inline token helper — no dependency on deleted legacy setup
const createTestToken = (payload: any = { userId: 'test-user', isAuthenticated: true }) => {
  return jwt.sign(payload, process.env.SESSION_SECRET!, { expiresIn: '1h' });
};

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  
  app.post('/auth/login', loginRateLimit, login);
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

  describe('POST /auth/login', () => {
    it('should login with correct password', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ password: 'test_password' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('expiresIn', 86400);
      expect(typeof response.body.data.token).toBe('string');
    });

    it('should reject login with incorrect password', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ password: 'wrong-password' })
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.message).toBe('Invalid password');
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject login without password', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.message).toBe('Password is required');
      expect(response.body.error.code).toBe('MISSING_PASSWORD');
    });

    it('should reject login with empty password', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ password: '' })
        .expect(400);

      expect(response.body.error.message).toBe('Password is required');
    });

    it('should reject login with non-string password', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ password: 12345 })
        .expect(400);

      expect(response.body.error.message).toBe('Password is required');
    });

    it('should handle rate limiting', async () => {
      // Note: Rate limiting is bypassed in test environment for localhost
      // This test would need modification to test actual rate limiting
      const promises = Array(10).fill(null).map(() =>
        request(app)
          .post('/auth/login')
          .send({ password: 'wrong' })
      );

      const responses = await Promise.all(promises);
      
      // In test environment, all should return 401 (wrong password)
      responses.forEach(res => {
        expect(res.status).toBe(401);
      });
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout with valid token', async () => {
      const token = createTestToken();

      const response = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('message', 'Logged out successfully');
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
      // Create a token that expires very quickly, then wait for it to expire
      const expiredToken = jwt.sign(
        { 
          userId: 'test-user', 
          isAuthenticated: true
        },
        process.env.SESSION_SECRET!,
        { expiresIn: '1ms' } // Expires in 1 millisecond
      );
      
      // Wait for the token to expire
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
      // Create token that expires in 30 minutes (less than 1 hour)
      const nearExpiryToken = jwt.sign(
        { userId: 'test-user', isAuthenticated: true },
        process.env.SESSION_SECRET!,
        { expiresIn: 1800 } // 30 minutes
      );

      const response = await request(app)
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${nearExpiryToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('expiresIn', 86400);
      
      // New token should be different
      expect(response.body.data.token).not.toBe(nearExpiryToken);
    });

    it('should reject refresh for token with lots of time remaining', async () => {
      // Create a token with 2 hours expiry (more than the 1 hour threshold)
      const token = jwt.sign(
        { userId: 'test-user', isAuthenticated: true },
        process.env.SESSION_SECRET!,
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