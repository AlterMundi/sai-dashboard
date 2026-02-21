import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';
import { SessionData, DashboardRole } from '@/types';

declare global {
  namespace Express {
    interface Request {
      session?: SessionData;
      user?: { id: string; email: string; role: DashboardRole; isAuthenticated: boolean };
    }
  }
}

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
    if (req.path === '/api/health') return true;
    if (appConfig.nodeEnv === 'development' &&
        (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1')) {
      return true;
    }
    return false;
  }
});

export const generateToken = (sessionData: Omit<SessionData, 'createdAt' | 'expiresAt'>): string => {
  const { idToken, ...rest } = sessionData;
  const payload: Record<string, unknown> = {
    ...rest,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + appConfig.security.sessionDuration
  };

  // Include idToken hint for Zitadel end_session (not secret, just an identity assertion)
  if (idToken) {
    payload.idToken = idToken;
  }

  return jwt.sign(payload, appConfig.security.sessionSecret);
};

export const authenticateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    // For image/SSE requests, also check query parameters
    if (!token && req.query.token) {
      token = req.query.token as string;
    }

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

    req.session = {
      userId: decoded.userId,
      email: decoded.email || '',
      role: decoded.role || 'VIEWER',
      isAuthenticated: decoded.isAuthenticated,
      createdAt: new Date(decoded.iat * 1000),
      expiresAt: new Date(decoded.exp * 1000),
      ...(decoded.idToken ? { idToken: decoded.idToken } : {})
    };

    req.user = {
      id: decoded.userId,
      email: decoded.email || '',
      role: decoded.role || 'VIEWER',
      isAuthenticated: decoded.isAuthenticated
    };

    logger.debug('Token authenticated successfully', {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role
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

export const requireRole = (...roles: DashboardRole[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user?.role || !roles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          message: 'Insufficient permissions',
          code: 'FORBIDDEN'
        }
      });
      return;
    }
    next();
  };

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
        email: decoded.email || '',
        role: decoded.role || 'VIEWER',
        isAuthenticated: decoded.isAuthenticated,
        createdAt: new Date(decoded.iat * 1000),
        expiresAt: new Date(decoded.exp * 1000)
      };

      req.user = {
        id: decoded.userId,
        email: decoded.email || '',
        role: decoded.role || 'VIEWER',
        isAuthenticated: decoded.isAuthenticated
      };
    }
  } catch (error) {
    logger.debug('Optional auth failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  next();
};
