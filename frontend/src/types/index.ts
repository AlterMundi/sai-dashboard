// API Response Types
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    hasNext?: boolean;
    filters?: Record<string, any>;
  };
  error?: {
    message: string;
    code: string;
    details?: Record<string, any>;
  };
}

// Execution Types
export interface SaiExecution {
  id: string;
  workflowId: string;
  status: 'success' | 'error' | 'waiting' | 'running' | 'canceled';
  startedAt: string;
  stoppedAt: string | null;
  mode: 'webhook' | 'manual' | 'retry';
  finished: boolean;
  retryOf: string | null;
  retrySuccessId: string | null;
}

export interface ImageAnalysis {
  riskAssessment: string;
  confidence: number;
  description: string;
  recommendations?: string[];
}

export interface ExecutionWithImage extends SaiExecution {
  imageUrl?: string;
  thumbnailUrl?: string;
  analysis?: ImageAnalysis;
  telegramDelivered?: boolean;
  telegramMessageId?: string;
}

// Filter and Pagination Types
export interface ExecutionFilters {
  page?: number;
  limit?: number;
  status?: 'success' | 'error' | 'waiting' | 'running' | 'canceled';
  startDate?: string;
  endDate?: string;
  search?: string;
  hasImage?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

// Daily Summary Type
export interface DailySummary {
  date: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  avgExecutionTime: number | null;
}

// Statistics Types
export interface ExecutionStats {
  totalExecutions: number;
  successRate: number;
  avgDailyExecutions: number;
  lastExecution: string | null;
}

// Authentication Types
export interface AuthResponse {
  token: string;
  expiresIn: number;
}

export interface LoginRequest {
  password: string;
}

export interface TokenValidation {
  valid: boolean;
  userId: string;
  expiresAt: string;
  remainingTime: number;
}

// Health Check Types
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: 'connected' | 'disconnected' | 'error';
    cache: 'available' | 'unavailable';
    filesystem: 'writable' | 'readonly' | 'error';
  };
}

// SSE Types
export interface SSEStatus {
  enabled: boolean;
  clients: number;
  maxClients: number;
  heartbeatInterval: number;
  timeout: number;
  oldestConnection: string | null;
  newestConnection: string | null;
}

export interface SSEExecutionEvent {
  execution: {
    id: string;
    status: string;
    startedAt: string;
    hasImage: boolean;
    imageUrl?: string;
    thumbnailUrl?: string;
    analysis?: ImageAnalysis;
  };
  timestamp: string;
}

export interface SSEHeartbeatEvent {
  timestamp: string;
  clients: number;
}

export interface SSEConnectionEvent {
  clientId?: string;
  timestamp: string;
  message: string;
}

// Component Props Types
export interface ImageCardProps {
  execution: ExecutionWithImage;
  onClick: (execution: ExecutionWithImage) => void;
  loading?: boolean;
}

export interface ImageModalProps {
  execution: ExecutionWithImage | null;
  isOpen: boolean;
  onClose: () => void;
}

export interface FilterBarProps {
  filters: ExecutionFilters;
  onFiltersChange: (filters: ExecutionFilters) => void;
  isLoading?: boolean;
}

export interface StatusBadgeProps {
  status: SaiExecution['status'];
  size?: 'sm' | 'md' | 'lg';
}

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  hasNext: boolean;
  hasPrev: boolean;
  isLoading?: boolean;
}

// Hook Types
export interface UseAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => void;
  token: string | null;
  error: string | null;
}

export interface UseExecutionsReturn {
  executions: ExecutionWithImage[];
  isLoading: boolean;
  error: string | null;
  hasNext: boolean;
  loadMore: () => void;
  refresh: () => void;
  updateFilters: (filters: ExecutionFilters) => void;
  filters: ExecutionFilters;
}

export interface UseSSEReturn {
  isConnected: boolean;
  lastEvent: any;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  clientCount: number;
  connect: () => void;
}

// Store Types (Zustand)
export interface AuthStore {
  isAuthenticated: boolean;
  token: string | null;
  user: { id: string } | null;
  login: (token: string) => void;
  logout: () => void;
  setUser: (user: { id: string }) => void;
}

export interface UIStore {
  selectedExecution: ExecutionWithImage | null;
  isModalOpen: boolean;
  filters: ExecutionFilters;
  setSelectedExecution: (execution: ExecutionWithImage | null) => void;
  setModalOpen: (open: boolean) => void;
  setFilters: (filters: ExecutionFilters) => void;
  resetFilters: () => void;
}

// Error Types
export interface AppError {
  message: string;
  code: string;
  status?: number;
  details?: Record<string, any>;
}

// Route Types
export interface RouteParams {
  executionId?: string;
}

// Theme Types
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeStore {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}