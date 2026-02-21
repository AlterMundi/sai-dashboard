import { useState, useEffect, useCallback } from 'react';
import { authApi, tokenManager } from '@/services/api';
import { UseAuthReturn } from '@/types';
import { DashboardRole } from '@/types';

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return {};
  }
}

export function useAuth(): UseAuthReturn {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<DashboardRole | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const applyToken = useCallback((t: string) => {
    const payload = decodeJwtPayload(t);
    setToken(t);
    setIsAuthenticated(true);
    setUserEmail((payload.email as string) || null);
    setUserRole((payload.role as DashboardRole) || null);
    setUserId((payload.userId as string) || null);
    setError(null);
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const storedToken = tokenManager.get();

      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        const validation = await authApi.validateToken();

        if (validation.valid) {
          applyToken(storedToken);
        } else {
          tokenManager.remove();
          setIsAuthenticated(false);
          setToken(null);
        }
      } catch (err) {
        tokenManager.remove();
        setIsAuthenticated(false);
        setToken(null);
        setError(err instanceof Error ? err.message : 'Authentication check failed');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [applyToken]);

  const login = useCallback(async (_password?: string): Promise<void> => {
    authApi.login();
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setIsAuthenticated(false);
    setToken(null);
    setUserEmail(null);
    setUserRole(null);
    setUserId(null);
    setError(null);
    authApi.logout();
  }, []);

  // Check token expiry and refresh if needed
  useEffect(() => {
    if (!isAuthenticated || !token) return;

    const checkTokenExpiry = async () => {
      try {
        const validation = await authApi.validateToken();

        if (validation.remainingTime < 3600) {
          const refreshResponse = await authApi.refreshToken();
          applyToken(refreshResponse.token);
        }
      } catch (err) {
        console.warn('Token refresh check failed:', err);
      }
    };

    const interval = setInterval(checkTokenExpiry, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated, token, applyToken]);

  return {
    isAuthenticated,
    isLoading,
    login,
    logout,
    token,
    error,
    user: isAuthenticated && userId
      ? { id: userId, email: userEmail || '', role: userRole || 'SAI_VIEWER' }
      : null,
  };
}
