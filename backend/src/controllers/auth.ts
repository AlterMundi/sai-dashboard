import { Request, Response } from 'express';
import { generateToken } from '@/middleware/auth';
import { AuthResponse } from '@/types';
import { logger } from '@/utils/logger';
import { asyncHandler } from '@/utils';
import { buildAuthorizationUrl, generatePKCEParams, exchangeCode, buildLogoutUrl } from '@/auth/oidc';
import { extractRole } from '@/auth/roles';
import { appConfig } from '@/config';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: appConfig.security.enforceHttps,
  maxAge: 10 * 60 * 1000, // 10 minutes
};

/**
 * Step 1 of OIDC flow: generate PKCE params, store in signed cookies, redirect to Zitadel.
 */
export const initiateOIDC = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { state, codeVerifier, codeChallenge } = generatePKCEParams();

  const authUrl = buildAuthorizationUrl({ state, codeChallenge });

  // Store ephemeral PKCE params in signed cookies (10 min TTL)
  res.cookie('oidc_state', state, COOKIE_OPTS);
  res.cookie('oidc_pkce', codeVerifier, COOKIE_OPTS);

  logger.info('OIDC: Redirecting to authorization endpoint', {
    ip: req.ip,
    authUrl: authUrl.toString().replace(/client_id=[^&]+/, 'client_id=REDACTED'),
  });

  res.redirect(authUrl.toString());
});

/**
 * Step 2 of OIDC flow: handle the callback, exchange code, issue our own JWT.
 */
export const handleCallback = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { code, state, error: oidcError } = req.query as Record<string, string>;

  // Handle Zitadel-side errors
  if (oidcError) {
    logger.warn('OIDC callback received error from Zitadel', { error: oidcError });
    const frontendBase = appConfig.oidc.postLogoutUri || '/';
    res.redirect(`${frontendBase}?auth_error=${encodeURIComponent(oidcError)}`);
    return;
  }

  if (!code || !state) {
    res.status(400).json({
      error: { message: 'Missing code or state in callback', code: 'INVALID_CALLBACK' }
    });
    return;
  }

  // Validate state from signed cookie
  const storedState = (req as any).cookies?.oidc_state;
  const codeVerifier = (req as any).cookies?.oidc_pkce;

  if (!storedState || !codeVerifier) {
    logger.warn('OIDC callback: missing PKCE cookies', { ip: req.ip });
    res.status(400).json({
      error: { message: 'OIDC session cookies missing or expired. Please try logging in again.', code: 'MISSING_PKCE_COOKIES' }
    });
    return;
  }

  if (state !== storedState) {
    logger.warn('OIDC callback: state mismatch', { ip: req.ip });
    res.status(400).json({
      error: { message: 'State parameter mismatch. Possible CSRF attack.', code: 'STATE_MISMATCH' }
    });
    return;
  }

  // Clear ephemeral cookies
  res.clearCookie('oidc_state');
  res.clearCookie('oidc_pkce');

  // Exchange code for tokens
  const callbackUrl = `${appConfig.oidc.redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

  const tokenSet = await exchangeCode({
    callbackUrl,
    storedState,
    codeVerifier,
  });

  const claims = tokenSet.claims();

  logger.info('OIDC: Code exchanged successfully', {
    sub: claims.sub,
    email: claims.email,
  });

  // Extract role from Zitadel project claims
  let role;
  try {
    role = extractRole(claims as Record<string, unknown>);
  } catch (err) {
    logger.warn('OIDC: User has no recognized role', {
      sub: claims.sub,
      email: claims.email,
    });
    const frontendBase = appConfig.oidc.postLogoutUri || '/';
    res.redirect(
      `${frontendBase}?auth_error=${encodeURIComponent(
        'Tu cuenta no tiene rol asignado en este proyecto. Contactar al administrador.'
      )}`
    );
    return;
  }

  const email = (claims.email as string) || '';
  const userId = claims.sub;

  // Issue our own JWT
  const token = generateToken({
    userId,
    email,
    role,
    isAuthenticated: true,
  });

  logger.info('OIDC: JWT issued', { userId, email, role, ip: req.ip });

  // Redirect frontend with token
  const frontendBase = appConfig.oidc.postLogoutUri || '/';
  const redirectTarget = `${frontendBase}auth/callback?token=${encodeURIComponent(token)}`;

  res.redirect(redirectTarget);
});

/**
 * Logout: redirect to Zitadel end_session endpoint.
 */
export const logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const sessionData = req.session;

  if (sessionData) {
    logger.info('User logged out', {
      userId: sessionData.userId,
      email: sessionData.email,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
  }

  const logoutUrl = buildLogoutUrl();
  res.redirect(logoutUrl.toString());
});

export const validateToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const sessionData = req.session;
  if (!sessionData) {
    res.status(401).json({
      error: { message: 'Invalid session', code: 'INVALID_SESSION' }
    });
    return;
  }

  res.json({
    data: {
      valid: true,
      userId: sessionData.userId,
      email: sessionData.email,
      role: sessionData.role,
      expiresAt: sessionData.expiresAt.toISOString(),
      remainingTime: Math.floor((sessionData.expiresAt.getTime() - Date.now()) / 1000)
    }
  });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const sessionData = req.session;

  if (!sessionData) {
    res.status(401).json({
      error: { message: 'Invalid session', code: 'INVALID_SESSION' }
    });
    return;
  }

  const remainingTime = sessionData.expiresAt.getTime() - Date.now();
  const oneHour = 60 * 60 * 1000;

  if (remainingTime > oneHour) {
    res.status(400).json({
      error: { message: 'Token does not need refresh yet', code: 'TOKEN_NOT_EXPIRED' }
    });
    return;
  }

  const newToken = generateToken({
    userId: sessionData.userId,
    email: sessionData.email,
    role: sessionData.role,
    isAuthenticated: true,
  });

  logger.info('Token refreshed', {
    userId: sessionData.userId,
    email: sessionData.email,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  const response: AuthResponse = {
    token: newToken,
    expiresIn: appConfig.security.sessionDuration,
    user: { id: sessionData.userId, email: sessionData.email, role: sessionData.role },
  };

  res.json({ data: response });
});
