import { useState, useEffect, useCallback } from 'react';
import { authApi, tokenManager } from '@/services/api';
import { UseAuthReturn } from '@/types';

export function useAuth(): UseAuthReturn {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Check if user is authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      const storedToken = tokenManager.get();
      
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        // Validate the stored token
        const validation = await authApi.validateToken();
        
        if (validation.valid) {
          setIsAuthenticated(true);
          setToken(storedToken);
          setError(null);
        } else {
          // Token is invalid, remove it
          tokenManager.remove();
          setIsAuthenticated(false);
          setToken(null);
        }
      } catch (error) {
        // Token validation failed, remove it
        tokenManager.remove();
        setIsAuthenticated(false);
        setToken(null);
        setError(error instanceof Error ? error.message : 'Authentication check failed');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = useCallback(async (password: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authApi.login({ password });
      
      setIsAuthenticated(true);
      setToken(response.token);
      setError(null);
      
      // Token is already stored by the authApi.login function
    } catch (error) {
      setIsAuthenticated(false);
      setToken(null);
      setError(error instanceof Error ? error.message : 'Login failed');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    
    try {
      await authApi.logout();
    } catch (error) {
      console.warn('Logout API call failed:', error);
    } finally {
      // Always clear local state regardless of API call success
      setIsAuthenticated(false);
      setToken(null);
      setError(null);
      setIsLoading(false);
      
      // Redirect to login page
      const basePath = import.meta.env.VITE_BASE_PATH || '/';
      window.location.href = `${basePath}login`;
    }
  }, []);

  // Check if token is close to expiry and refresh if needed
  useEffect(() => {
    if (!isAuthenticated || !token) return;

    const checkTokenExpiry = async () => {
      try {
        const validation = await authApi.validateToken();
        
        // If less than 1 hour remaining, refresh the token
        if (validation.remainingTime < 3600) { // 1 hour in seconds
          const refreshResponse = await authApi.refreshToken();
          setToken(refreshResponse.token);
        }
      } catch (error) {
        console.warn('Token refresh check failed:', error);
        // Don't force logout here, let the user continue until token actually expires
      }
    };

    // Check token expiry every 15 minutes
    const interval = setInterval(checkTokenExpiry, 15 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [isAuthenticated, token]);

  return {
    isAuthenticated,
    isLoading,
    login,
    logout,
    token,
    error,
  };
}