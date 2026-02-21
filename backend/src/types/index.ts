// YOLO Detection object (matches Stage2 ETL)
export interface YoloDetection {
  class: string;
  confidence: number;
  bounding_box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ExecutionWithImage {
  // Core execution data
  id: number;
  workflowId: string;
  executionTimestamp: Date;
  completionTimestamp: Date | null;
  durationMs: number | null;
  status: 'success' | 'error' | 'canceled' | 'running';
  mode: string;

  // Device and Camera data
  deviceId: string | null;
  nodeId: string | null;
  cameraId: string | null;
  location: string | null;
  cameraType: string | null;
  captureTimestamp: Date | null;

  // YOLO Analysis data
  requestId: string | null;
  yoloModelVersion: string | null;
  detectionCount: number;
  hasSmoke: boolean;
  alertLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
  detectionMode: string | null;
  activeClasses: string[] | null;
  detections: YoloDetection[] | null;

  // Confidence scores
  confidenceSmoke: number | null;
  confidenceScore: number | null;

  // Image data
  hasImage: boolean;
  imagePath: string | null;
  thumbnailPath: string | null;
  cachedPath: string | null;
  imageSizeBytes: number | null;
  imageFormat: string | null;
  imageWidth: number | null;
  imageHeight: number | null;

  // Notification data
  telegramSent: boolean;
  telegramMessageId: number | null;
  telegramSentAt: Date | null;

  // Processing metadata
  yoloProcessingTimeMs: number | null;
  processingTimeMs: number | null;
  extractedAt: Date | null;

  // False positive tracking
  isFalsePositive: boolean;
  falsePositiveReason: string | null;
  markedFalsePositiveAt: Date | null;
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
  // Basic filters (executions table)
  status?: 'success' | 'error';  // Only these 2 exist in DB
  startDate?: string;
  endDate?: string;
  search?: string;
  hasImage?: boolean;

  // YOLO-specific filters (execution_analysis table)
  alertLevel?: 'none' | 'low' | 'medium' | 'high' | 'critical';  // Single selection (legacy)
  alertLevels?: ('none' | 'low' | 'medium' | 'high' | 'critical')[];  // Multi-select array
  hasSmoke?: boolean;
  detectionCount?: number;  // Filter by minimum number of detections
  confidenceSmoke?: number;  // Smoke-specific confidence (0.0-1.0)
  detectionMode?: string;   // e.g., 'smoke-only'
  yoloModelVersion?: string; // e.g., 'saiNET-v1'
  minConfidence?: number;   // DEPRECATED: Use confidenceSmoke instead
  maxConfidence?: number;   // DEPRECATED: Use confidenceSmoke instead

  // Device/Camera filters (executions table)
  cameraId?: string;
  cameraType?: 'onvif' | 'rtsp';  // Single selection (legacy)
  cameraTypes?: ('onvif' | 'rtsp')[];  // Multi-select array
  nodeId?: string;
  deviceId?: string;
  location?: string;

  // Notification filters (execution_notifications table)
  telegramSent?: boolean;

  // Date presets
  datePreset?: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth';

  // Sorting
  sortBy?: 'date' | 'status' | 'confidence' | 'camera' | 'alert';
  sortOrder?: 'asc' | 'desc';

  // Legacy fields for compatibility
  searchQuery?: string;  // Alias for 'search'
  pageSize?: number;     // Alias for 'limit'

  // Advanced JSONB detection filters (future enhancement)
  detectionClasses?: string[];  // Filter by specific detection classes
  minDetectionConfidence?: number;  // Minimum confidence for any detection
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

export type DashboardRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export interface AuthResponse {
  token: string;
  expiresIn: number;
  user: { id: string; email: string; role: DashboardRole };
}

export interface SessionData {
  userId: string;
  email: string;
  role: DashboardRole;
  isAuthenticated: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface CacheConfig {
  path: string;
  basePath: string;  // Base path for image storage (used by ETL services)
  n8nBinaryDataPath: string;  // Path to n8n's filesystem-v2 binary storage
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
  type: 'execution:new' | 'execution:error' | 'execution:progress' | 'execution:batch' | 'heartbeat' | 'connection' |
        'system:stats' | 'system:health' | 'system:notification' |
        'alert:critical' | 'emergency:response_required' |
        string; // Allow dynamic system messages
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
  // Detection counts
  smokeDetections: number;
  // New fields for enhanced daily summary
  highRiskDetections: number;
  criticalDetections: number;
  lowAlertDetections: number;
  executionsWithImages: number;
  telegramNotificationsSent: number;
  avgProcessingTimeMs: number;
  avgConfidenceScore: number;
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

export interface ExecutionStatistics {
  overview: {
    totalExecutions: number;
    successRate: number;
    averageExecutionTime: number;
    activeToday: number;
  };
  alertDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    none: number;
  };
  statusBreakdown: {
    success: number;
    error: number;
    running: number;
    waiting: number;
    canceled: number;
  };
  telegramDelivery: {
    delivered: number;
    pending: number;
    failed: number;
  };
  recentActivity: {
    lastHour: number;
    last24Hours: number;
    last7Days: number;
  };
  performanceMetrics: {
    avgResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };

  // YOLO detection statistics
  detectionBreakdown?: {
    hasSmoke: number;
  };
  cameraPerformance?: Array<{
    cameraId: string;
    location?: string;
    totalDetections: number;
    smokeDetections: number;
  }>;
}

// API response helpers with enhanced types
export interface UseExecutionsReturn {
  executions: ExecutionWithImage[];
  isLoading: boolean;
  error: string | null;
  hasNext: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  updateFilters: (filters: ExecutionFilters) => void;
  filters: ExecutionFilters;
}

export interface ExecutionStats {
  totalExecutions: number;
  successRate: number;
  avgDailyExecutions: number;
  lastExecution: Date | null;
}

export interface FilterOptions {
  cameraId:         string[];
  location:         string[];
  nodeId:           string[];
  deviceId:         string[];
  yoloModelVersion: string[];
}

export interface StatsRankingItem {
  id: string;
  smokeDetections: number;
  criticalAlerts: number;
  totalExecutions: number;
}

export interface StatsRanking {
  cameras: StatsRankingItem[];
  locations: StatsRankingItem[];
  nodes: StatsRankingItem[];
}
