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
 *
 * IMPORTANT: Two-stage ETL considerations:
 * - Stage 1 filters: status, dates, search, basic metadata
 * - Stage 2 filters: YOLO detections, confidence, alert levels (applied after Stage 2 completion)
 * - Mixed filters: Require special handling for partial data availability
 */
export interface ExecutionFilters {
  // Pagination
  page?: number;
  limit?: number;

  // Basic filters (available immediately after Stage 1)
  status?: 'success' | 'error';  // Only these 2 exist in DB
  startDate?: string;
  endDate?: string;
  search?: string;
  hasImage?: boolean;

  // YOLO-specific filters (require Stage 2 completion)
  alertLevels?: ('none' | 'low' | 'medium' | 'high' | 'critical')[];  // Multi-select array (consolidated)
  hasFire?: boolean;
  hasSmoke?: boolean;
  detectionCount?: number;  // Filter by number of detections
  confidenceFire?: number;  // Fire-specific confidence (0.0-1.0)
  confidenceSmoke?: number;  // Smoke-specific confidence (0.0-1.0)
  detectionMode?: string;   // e.g., 'smoke-only'
  minConfidence?: number;   // DEPRECATED: Use confidenceFire/confidenceSmoke instead
  maxConfidence?: number;   // DEPRECATED: Use confidenceFire/confidenceSmoke instead

  // Device/Camera filters (available after Stage 2, but can be partially available)
  cameraId?: string;
  cameraTypes?: ('onvif' | 'rtsp')[];  // Multi-select array (consolidated)
  nodeId?: string;
  deviceId?: string;
  location?: string;

  // Notification filters (available after Stage 2)
  telegramSent?: boolean;

  // Date presets
  datePreset?: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth';

  // Sorting
  sortBy?: 'date' | 'alert' | 'status' | 'confidence' | 'camera';
  sortOrder?: 'asc' | 'desc';

  // Advanced filters (future enhancement)
  detectionClasses?: string[];  // Filter by specific detection classes
  minDetectionConfidence?: number;  // Minimum confidence for any detection

  // Two-stage ETL specific filters
  processingStage?: 'stage1' | 'stage2' | 'failed';  // Filter by ETL processing stage
  hasStage2Data?: boolean;  // Only show executions with complete Stage 2 data
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
  avgProcessingTime: number;

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

/**
 * Two-Stage ETL SSE Events
 */
export interface SSEStage2CompletionEvent {
  execution_id: number;
  stage: 'stage2';
  processing_time_ms: number;
  extracted_data: {
    has_fire: boolean;
    has_smoke: boolean;
    alert_level: string | null;
    detection_count: number;
    has_image: boolean;
    telegram_sent: boolean;
  };
  timestamp: string;
}

export interface SSEStage2FailureEvent {
  execution_id: number;
  stage: 'stage2';
  error: string;
  retry_count: number;
  timestamp: string;
}

export interface SSEEtlStatusEvent {
  stage1: {
    processed: number;
    failed: number;
    avg_processing_time_ms: number;
  };
  stage2: {
    processed: number;
    failed: number;
    pending: number;
    avg_processing_time_ms: number;
  };
  timestamp: string;
}
