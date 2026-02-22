import axios, { AxiosResponse, AxiosError } from 'axios';
import {
  ApiResponse,
  Execution,
  ExecutionFilters,
  DailySummary,
  ExecutionStats,
  AuthResponse,
  TokenValidation,
  HealthStatus,
  SSEStatus,
  FilterOptions,
  StatsFilters,
  StatsRanking,
  DashboardRole,
  PendingUser,
} from '@/types';
import { getStorageItem, setStorageItem, removeStorageItem } from '@/utils';

// Create axios instance with base configuration
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Token management
const TOKEN_KEY = 'sai_dashboard_token';

export const tokenManager = {
  get: () => getStorageItem<string | null>(TOKEN_KEY, null),
  set: (token: string) => setStorageItem(TOKEN_KEY, token),
  remove: () => removeStorageItem(TOKEN_KEY),
};

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = tokenManager.get();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any;

    // Handle 401 errors (unauthorized) - but not for refresh requests to avoid infinite loops
    if (error.response?.status === 401 && 
        !originalRequest._retry && 
        !originalRequest.url?.includes('/auth/refresh')) {
      originalRequest._retry = true;

      // Try to refresh token
      try {
        const token = tokenManager.get();
        if (token) {
          const refreshResponse = await api.post<ApiResponse<AuthResponse>>('/auth/refresh');
          const newToken = refreshResponse.data.data.token;
          tokenManager.set(newToken);
          
          // Retry original request with new token
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed, remove token and redirect to login  
        tokenManager.remove();
        authApi.login();
      }
    }

    return Promise.reject(error);
  }
);

// Error handler helper
const handleApiError = (error: unknown): never => {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error?.message || error.message;
    const code = error.response?.data?.error?.code || 'API_ERROR';
    const status = error.response?.status;
    
    throw new Error(`${code}: ${message} ${status ? `(${status})` : ''}`);
  }
  
  throw new Error(error instanceof Error ? error.message : 'Unknown error occurred');
};

// Authentication API
export const authApi = {
  /**
   * Initiate OIDC login by redirecting to the backend's /auth/login endpoint,
   * which in turn redirects to Zitadel.
   */
  login(): void {
    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    window.location.href = `${baseUrl}/auth/login`;
  },

  /**
   * Logout: clear local token then redirect to backend /auth/logout
   * (which redirects to Zitadel end_session).
   */
  logout(): void {
    tokenManager.remove();
    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    window.location.href = `${baseUrl}/auth/logout`;
  },

  /**
   * Called by AuthCallback page: reads ?token= from the URL, stores it, cleans URL.
   * Returns true if a token was found and stored.
   */
  getTokenFromUrl(): boolean {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const authError = params.get('auth_error');

    if (authError) {
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      throw new Error(decodeURIComponent(authError));
    }

    if (!token) return false;

    tokenManager.set(token);
    // Clean the token from URL to avoid leaks
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  },

  async validateToken(): Promise<TokenValidation> {
    try {
      const response: AxiosResponse<ApiResponse<TokenValidation>> = await api.get('/auth/validate');
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async refreshToken(): Promise<AuthResponse> {
    try {
      const response: AxiosResponse<ApiResponse<AuthResponse>> = await api.post('/auth/refresh');
      const token = response.data.data.token;
      tokenManager.set(token);
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async getPendingStatus(sub: string): Promise<{ status: 'pending' | 'approved' | 'rejected' | 'not_found' }> {
    try {
      const response = await api.get<ApiResponse<{ status: string }>>(`/auth/pending/status?sub=${encodeURIComponent(sub)}`);
      return response.data.data as { status: 'pending' | 'approved' | 'rejected' | 'not_found' };
    } catch {
      return { status: 'pending' }; // fail-safe: keep polling on network errors
    }
  },
};

// Admin API
export const adminApi = {
  async getPendingUsers(): Promise<PendingUser[]> {
    const response = await api.get<ApiResponse<PendingUser[]>>('/auth/admin/pending');
    return response.data.data;
  },

  async approveUser(sub: string, role: DashboardRole): Promise<void> {
    await api.post(`/auth/admin/users/${encodeURIComponent(sub)}/approve`, { role });
  },

  async rejectUser(sub: string): Promise<void> {
    await api.post(`/auth/admin/users/${encodeURIComponent(sub)}/reject`);
  },
};

// Executions API
export const executionsApi = {
  async getExecutions(filters: ExecutionFilters = {}): Promise<{
    executions: Execution[];
    meta: any;
    alerts?: any[];
  }> {
    try {
      const response: AxiosResponse<ApiResponse<Execution[]>> = await api.get('/executions', {
        params: filters
      });
      return {
        executions: response.data.data,
        meta: response.data.meta || {},
        alerts: (response.data as any).alerts || []
      };
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async getExecutionById(id: number): Promise<Execution> {
    try {
      const response: AxiosResponse<ApiResponse<Execution>> = await api.get(`/executions/${id}`);
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async searchExecutions(query: string, limit?: number): Promise<Execution[]> {
    try {
      const response: AxiosResponse<ApiResponse<Execution[]>> = await api.get('/executions/search', {
        params: { q: query, limit }
      });
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async getDailySummary(params?: number | StatsFilters): Promise<DailySummary[]> {
    try {
      const queryParams: Record<string, any> = {};
      if (typeof params === 'number') {
        queryParams.days = params;
      } else if (params) {
        queryParams.startDate = params.startDate;
        queryParams.endDate = params.endDate;
        queryParams.granularity = params.granularity;
        if (params.dimensionKey && params.dimensionValue) {
          if (params.dimensionKey === 'cameraId') queryParams.cameraId = params.dimensionValue;
          else if (params.dimensionKey === 'location') queryParams.location = params.dimensionValue;
          else if (params.dimensionKey === 'nodeId') queryParams.nodeId = params.dimensionValue;
          else if (params.dimensionKey === 'yoloModelVersion') queryParams.yoloModelVersion = params.dimensionValue;
        }
      }
      const response: AxiosResponse<ApiResponse<DailySummary[]>> = await api.get('/executions/summary/daily', {
        params: queryParams
      });
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async getStatsRanking(startDate: string, endDate: string, limit = 5): Promise<StatsRanking> {
    try {
      const response: AxiosResponse<ApiResponse<StatsRanking>> = await api.get('/executions/stats/ranking', {
        params: { startDate, endDate, limit }
      });
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async getStats(): Promise<ExecutionStats> {
    try {
      const response: AxiosResponse<ApiResponse<ExecutionStats>> = await api.get('/executions/stats');
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  /**
   * Get secure image URL (use with SecureImage component or useSecureImage hook).
   * Does NOT include token in URL - authentication handled via Authorization header.
   */
  getImageUrl(executionId: number, thumbnail = false): string {
    const baseUrl = import.meta.env.VITE_API_URL || '/api';

    // Use proper endpoint based on image type
    if (thumbnail) {
      return `${baseUrl}/executions/${executionId}/thumbnail`;
    }
    return `${baseUrl}/executions/${executionId}/image/webp`;
  },

  async triggerAnalysis(batchSize = 50): Promise<{
    triggered: boolean;
    pending: number;
    message: string;
    estimatedTime?: string;
  }> {
    try {
      const response: AxiosResponse<ApiResponse<any>> = await api.post('/executions/trigger-analysis', {
        batchSize
      });
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  /**
   * Bulk mark executions as false positives (or undo)
   */
  async bulkMarkFalsePositive(
    executionIds: number[],
    isFalsePositive: boolean,
    reason?: string
  ): Promise<{ updatedCount: number }> {
    try {
      const response: AxiosResponse<ApiResponse<{ updatedCount: number }>> = await api.post(
        '/executions/bulk/false-positive',
        { executionIds, isFalsePositive, reason }
      );
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  /**
   * Mark an execution as a false positive or valid detection
   */
  async markFalsePositive(
    executionId: number,
    isFalsePositive: boolean,
    reason?: string
  ): Promise<Execution> {
    try {
      const response: AxiosResponse<ApiResponse<Execution>> = await api.post(
        `/executions/${executionId}/false-positive`,
        { isFalsePositive, reason }
      );
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async getFilterOptions(): Promise<FilterOptions> {
    const response = await api.get<{ data: FilterOptions }>('/executions/filter-options');
    return response.data.data;
  },
};

// Detection Filter API
export interface DetectionFilterCriteria {
  hasClass?: string[];
  minConfidence?: number;
  maxConfidence?: number;
  minBoundingBoxSize?: number;
  maxBoundingBoxSize?: number;
  minDetections?: number;
  maxDetections?: number;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export interface DetectionQueryResult {
  executionId: number;
  detectionCount: number;
  matchingDetections: any[];
  totalConfidence: number;
  primaryClass: string;
}

export const detectionsApi = {
  /**
   * Search executions with advanced detection criteria
   */
  async search(criteria: DetectionFilterCriteria, limit = 100): Promise<DetectionQueryResult[]> {
    try {
      const response: AxiosResponse<ApiResponse<DetectionQueryResult[]>> = await api.post(
        '/detections/search',
        criteria,
        { params: { limit } }
      );
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  /**
   * Get detection statistics for a time range
   */
  async getStatistics(timeRange: 'hour' | 'day' | 'week' = 'day'): Promise<{
    totalDetections: number;
    averageConfidence: number;
    classDistribution: Record<string, number>;
    sizeDistribution: { small: number; medium: number; large: number };
    temporalPatterns: Array<{ period: string; count: number; avgConfidence: number }>;
  }> {
    try {
      const response = await api.get('/detections/statistics', {
        params: { timeRange },
      });
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },
};

// Health API
export const healthApi = {
  async getHealth(): Promise<HealthStatus> {
    try {
      const response: AxiosResponse<ApiResponse<HealthStatus>> = await api.get('/health');
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async getReadiness(): Promise<{ ready: boolean; reason?: string }> {
    try {
      const response: AxiosResponse<ApiResponse<{ ready: boolean; reason?: string }>> = await api.get('/health/ready');
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },
};

// SSE API
export const sseApi = {
  async getStatus(): Promise<SSEStatus> {
    try {
      const response: AxiosResponse<ApiResponse<SSEStatus>> = await api.get('/events/status');
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  createEventSource(): EventSource {
    const token = tokenManager.get();
    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    const url = new URL(`${baseUrl}/events`, window.location.origin);
    
    // Add token as query parameter for SSE authentication
    if (token) {
      url.searchParams.set('token', token);
    }
    
    console.log('🔧 API: Creating EventSource with URL:', url.toString());
    console.log('🔧 API: withCredentials test - trying without credentials first');
    
    // Try without withCredentials first (research shows this can cause CORS issues)
    const eventSource = new EventSource(url.toString());
    
    console.log('🔧 API: EventSource created, readyState:', eventSource.readyState);

    return eventSource;
  },
};

// Export the configured axios instance for direct use if needed
export { api };
export default api;