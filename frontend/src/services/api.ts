import axios, { AxiosResponse, AxiosError } from 'axios';
import { 
  ApiResponse, 
  ExecutionWithImage, 
  ExecutionFilters, 
  DailySummary,
  ExecutionStats,
  AuthResponse,
  LoginRequest,
  TokenValidation,
  HealthStatus,
  SSEStatus
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
        const basePath = import.meta.env.VITE_BASE_PATH || '/';
        window.location.href = `${basePath}login`;
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
  async login(credentials: LoginRequest): Promise<AuthResponse> {
    try {
      const response: AxiosResponse<ApiResponse<AuthResponse>> = await api.post('/auth/login', credentials);
      const token = response.data.data.token;
      tokenManager.set(token);
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      // Continue with logout even if API call fails
      console.warn('Logout API call failed:', error);
    } finally {
      tokenManager.remove();
    }
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
};

// Executions API
export const executionsApi = {
  async getExecutions(filters: ExecutionFilters = {}): Promise<{
    executions: ExecutionWithImage[];
    meta: any;
    alerts?: any[];
  }> {
    try {
      const response: AxiosResponse<ApiResponse<ExecutionWithImage[]>> = await api.get('/executions', {
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

  async getExecutionById(id: string): Promise<ExecutionWithImage> {
    try {
      const response: AxiosResponse<ApiResponse<ExecutionWithImage>> = await api.get(`/executions/${id}`);
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async searchExecutions(query: string, limit?: number): Promise<ExecutionWithImage[]> {
    try {
      const response: AxiosResponse<ApiResponse<ExecutionWithImage[]>> = await api.get('/executions/search', {
        params: { q: query, limit }
      });
      return response.data.data;
    } catch (error) {
      throw handleApiError(error);
    }
  },

  async getDailySummary(days?: number): Promise<DailySummary[]> {
    try {
      const response: AxiosResponse<ApiResponse<DailySummary[]>> = await api.get('/executions/summary/daily', {
        params: { days }
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

  getImageUrl(executionId: string, thumbnail = false): string {
    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    const token = tokenManager.get();
    const params = new URLSearchParams();
    
    if (thumbnail) {
      params.append('thumbnail', 'true');
    }
    
    if (token) {
      params.append('token', token);
    }
    
    const queryString = params.toString();
    return `${baseUrl}/executions/${executionId}/image${queryString ? '?' + queryString : ''}`;
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
    
    const eventSource = new EventSource(url.toString(), {
      withCredentials: true,
    });

    return eventSource;
  },
};

// Export the configured axios instance for direct use if needed
export { api };
export default api;