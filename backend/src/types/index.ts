export interface SaiExecution {
  id: string;
  workflowId: string;
  status: 'success' | 'error' | 'waiting' | 'running' | 'canceled';
  startedAt: Date;
  stoppedAt: Date | null;
  mode: 'webhook' | 'manual' | 'retry';
  finished: boolean;
  retryOf: string | null;
  retrySuccessId: string | null;
}

export interface SaiExecutionData {
  executionId: string;
  nodeId: string;
  data: Record<string, unknown>;
  createdAt: Date;
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

export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    hasNext?: boolean;
  };
  error?: {
    message: string;
    code: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  offset?: number;
}

export interface ExecutionFilters extends PaginationQuery {
  status?: 'success' | 'error' | 'waiting' | 'running' | 'canceled';
  startDate?: string;
  endDate?: string;
  search?: string;
  hasImage?: boolean;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  maxConnections: number;
  idleTimeout: number;
  connectionTimeout: number;
}

export interface AuthPayload {
  password: string;
}

export interface AuthResponse {
  token: string;
  expiresIn: number;
}

export interface SessionData {
  userId: string;
  isAuthenticated: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface CacheConfig {
  path: string;
  enableThumbnails: boolean;
  thumbnailSize: number;
  thumbnailQuality: number;
  maxImageSize: number;
  supportedFormats: string[];
  ttl: number;
}

export interface SSEClient {
  id: string;
  response: Response;
  lastPing: Date;
}

export interface SSEMessage {
  type: 'execution:new' | 'execution:error' | 'heartbeat' | 'connection';
  data?: Record<string, unknown>;
  id?: string;
  retry?: number;
}

export interface DailySummary {
  date: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  avgExecutionTime: number | null;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    database: 'connected' | 'disconnected' | 'error';
    cache: 'available' | 'unavailable';
    filesystem: 'writable' | 'readonly' | 'error';
  };
  version: string;
  uptime: number;
}