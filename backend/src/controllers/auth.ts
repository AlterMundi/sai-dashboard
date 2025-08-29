import { Request, Response } from 'express';
import { generateToken, verifyPassword } from '@/middleware/auth';
import { AuthPayload, AuthResponse } from '@/types';
import { logger } from '@/utils/logger';
import { asyncHandler, generateId } from '@/utils';

export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { password }: AuthPayload = req.body;

  // Validate request
  if (!password || typeof password !== 'string') {
    res.status(400).json({
      error: {
        message: 'Password is required',
        code: 'MISSING_PASSWORD'
      }
    });
    return;
  }

  // Verify password
  const isValidPassword = await verifyPassword(password);
  
  if (!isValidPassword) {
    logger.warn('Invalid login attempt', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    res.status(401).json({
      error: {
        message: 'Invalid password',
        code: 'INVALID_CREDENTIALS'
      }
    });
    return;
  }

  // Generate session token
  const sessionId = generateId();
  const token = generateToken({
    userId: sessionId,
    isAuthenticated: true
  });

  logger.info('Successful login', {
    sessionId,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  const response: AuthResponse = {
    token,
    expiresIn: 86400 // 24 hours in seconds
  };

  res.json({
    data: response
  });
});

export const logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.session?.userId;

  if (sessionId) {
    logger.info('User logged out', {
      sessionId,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
  }

  res.json({
    data: {
      message: 'Logged out successfully'
    }
  });
});

export const validateToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // This endpoint is protected by authenticateToken middleware
  // If we reach here, token is valid
  
  const sessionData = req.session;
  if (!sessionData) {
    res.status(401).json({
      error: {
        message: 'Invalid session',
        code: 'INVALID_SESSION'
      }
    });
    return;
  }

  res.json({
    data: {
      valid: true,
      userId: sessionData.userId,
      expiresAt: sessionData.expiresAt.toISOString(),
      remainingTime: Math.floor((sessionData.expiresAt.getTime() - Date.now()) / 1000)
    }
  });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // This endpoint is protected by authenticateToken middleware
  const sessionData = req.session;
  
  if (!sessionData) {
    res.status(401).json({
      error: {
        message: 'Invalid session',
        code: 'INVALID_SESSION'
      }
    });
    return;
  }

  // Check if token is close to expiration (less than 1 hour remaining)
  const remainingTime = sessionData.expiresAt.getTime() - Date.now();
  const oneHour = 60 * 60 * 1000;

  if (remainingTime > oneHour) {
    res.status(400).json({
      error: {
        message: 'Token does not need refresh yet',
        code: 'TOKEN_NOT_EXPIRED'
      }
    });
    return;
  }

  // Generate new token
  const newToken = generateToken({
    userId: sessionData.userId,
    isAuthenticated: true
  });

  logger.info('Token refreshed', {
    userId: sessionData.userId,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  const response: AuthResponse = {
    token: newToken,
    expiresIn: 86400
  };

  res.json({
    data: response
  });
});