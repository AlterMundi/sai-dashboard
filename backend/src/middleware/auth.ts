import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';
import { SessionData } from '@/types';

declare global {
  namespace Express {
    interface Request {
      session?: SessionData;
      user?: { id: string; isAuthenticated: boolean };
    }
  }
}

export const loginRateLimit = rateLimit({
  windowMs: appConfig.rateLimit.loginWindowMs,
  max: appConfig.rateLimit.loginMaxAttempts,
  message: {
    error: {
      message: 'Too many login attempts, please try again later',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || 'unknown';
  },
  skip: (req) => {
    // Skip rate limiting in development and test environments
    return (appConfig.nodeEnv === 'development' || appConfig.nodeEnv === 'test') && 
           (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1');
  },
  handler: (req, res) => {
    logger.warn('Login rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      error: {
        message: 'Too many login attempts, please try again later',
        code: 'RATE_LIMIT_EXCEEDED'
      }
    });
  }
});

export const apiRateLimit = rateLimit({
  windowMs: appConfig.rateLimit.windowMs,
  max: appConfig.rateLimit.maxRequests,
  message: {
    error: {
      message: 'Too many requests, please try again later',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || 'unknown';
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/api/health';
  }
});

export const burstRateLimit = rateLimit({
  windowMs: appConfig.rateLimit.burstWindow,
  max: appConfig.rateLimit.burstMax,
  message: {
    error: {
      message: 'Request burst limit exceeded',
      code: 'BURST_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: false,
  legacyHeaders: false
});

export const generateToken = (sessionData: Omit<SessionData, 'createdAt' | 'expiresAt'>): string => {
  const payload = {
    ...sessionData,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + appConfig.security.sessionDuration
  };

  return jwt.sign(payload, appConfig.security.sessionSecret);
};

export const verifyPassword = async (plainPassword: string, hashedPassword?: string): Promise<boolean> => {
  if (!hashedPassword) {
    // For single password authentication, compare directly with configured password
    return plainPassword === appConfig.security.dashboardPassword;
  }
  
  try {
    return await bcrypt.compare(plainPassword, hashedPassword);
  } catch (error) {
    logger.error('Password verification error:', error);
    return false;
  }
};

export const hashPassword = async (password: string): Promise<string> => {
  try {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    logger.error('Password hashing error:', error);
    throw new Error('Password hashing failed');
  }
};

export const authenticateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
      res.status(401).json({
        error: {
          message: 'Access token is required',
          code: 'MISSING_TOKEN'
        }
      });
      return;
    }

    const decoded = jwt.verify(token, appConfig.security.sessionSecret) as any;
    
    // Check if token is expired (additional check)
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      res.status(401).json({
        error: {
          message: 'Token has expired',
          code: 'TOKEN_EXPIRED'
        }
      });
      return;
    }

    // Attach session data to request
    req.session = {
      userId: decoded.userId,
      isAuthenticated: decoded.isAuthenticated,
      createdAt: new Date(decoded.iat * 1000),
      expiresAt: new Date(decoded.exp * 1000)
    };

    req.user = {
      id: decoded.userId,
      isAuthenticated: decoded.isAuthenticated
    };

    logger.debug('Token authenticated successfully', {
      userId: decoded.userId,
      expiresAt: req.session.expiresAt
    });

    next();
    
  } catch (error) {
    logger.warn('Token authentication failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        error: {
          message: 'Token has expired',
          code: 'TOKEN_EXPIRED'
        }
      });
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: {
          message: 'Invalid token',
          code: 'INVALID_TOKEN'
        }
      });
    } else {
      res.status(500).json({
        error: {
          message: 'Authentication error',
          code: 'AUTH_ERROR'
        }
      });
    }
  }
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session?.isAuthenticated || !req.user?.isAuthenticated) {
    res.status(403).json({
      error: {
        message: 'Authentication required',
        code: 'NOT_AUTHENTICATED'
      }
    });
    return;
  }

  next();
};

// Optional authentication - adds user data if token is present but doesn't require it
export const optionalAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, appConfig.security.sessionSecret) as any;
    
    if (decoded.exp && decoded.exp >= Math.floor(Date.now() / 1000)) {
      req.session = {
        userId: decoded.userId,
        isAuthenticated: decoded.isAuthenticated,
        createdAt: new Date(decoded.iat * 1000),
        expiresAt: new Date(decoded.exp * 1000)
      };

      req.user = {
        id: decoded.userId,
        isAuthenticated: decoded.isAuthenticated
      };
    }
  } catch (error) {
    // Silent fail for optional auth
    logger.debug('Optional auth failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  next();
};