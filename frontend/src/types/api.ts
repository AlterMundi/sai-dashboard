/**
 * API Types - Request/Response structures
 *
 * These interfaces define the shape of API requests and responses.
 * They align with the backend API contract.
 */

import { Execution } from './execution';

/**
 * Generic API Response wrapper
 */
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

/**
 * Paginated API Response
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

/**
 * Execution Filters - Query parameters for fetching executions
 */
export interface ExecutionFilters {
  // Pagination
  page?: number;
  limit?: number;

  // Basic filters
  status?: 'success' | 'error';  // Only these 2 exist in DB
  startDate?: string;
  endDate?: string;
  search?: string;
  hasImage?: boolean;

  // YOLO-specific filters
  alertLevel?: 'none' | 'low' | 'high' | 'critical';  // 'medium' removed (doesn't exist in DB)
  hasFire?: boolean;
  hasSmoke?: boolean;
  detectionCount?: number;  // NEW: Filter by number of detections
  confidenceFire?: number;  // NEW: Fire-specific confidence (0.0-1.0)
  confidenceSmoke?: number;  // NEW: Smoke-specific confidence (0.0-1.0)
  detectionMode?: string;   // NEW: e.g., 'smoke-only'
  minConfidence?: number;   // DEPRECATED: Use confidenceFire/confidenceSmoke instead
  maxConfidence?: number;   // DEPRECATED: Use confidenceFire/confidenceSmoke instead

  // Device/Camera filters
  cameraId?: string;
  cameraType?: 'onvif' | 'rtsp';  // NEW: Camera protocol type
  nodeId?: string;
  deviceId?: string;
  location?: string;

  // Notification filters
  telegramSent?: boolean;

  // Date presets
  datePreset?: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth';

  // Sorting
  sortBy?: 'date' | 'alert' | 'status' | 'confidence' | 'camera';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Daily Summary statistics
 */
export interface DailySummary {
  date: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  avgExecutionTime: number | null;
  fireDetections?: number;
  smokeDetections?: number;
}

/**
 * Execution Statistics
 */
export interface ExecutionStats {
  totalExecutions: number;
  successRate: number;
  avgDailyExecutions: number;
  lastExecution: string | null;

  // Detection breakdown
  fireDetections: number;
  smokeDetections: number;
  bothDetections: number;

  // Alert distribution
  critical: number;
  high: number;
  medium: number;
  low: number;
  none: number;
}

/**
 * Authentication types
 */
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

/**
 * Health Check Response
 */
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

/**
 * SSE (Server-Sent Events) Types
 */
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
  execution: Execution;
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
