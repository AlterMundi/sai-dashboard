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

// Enhanced Analysis Types for SAI System (YOLO-based)
export interface SaiEnhancedAnalysis {
  // Primary Key
  executionId: string;

  // YOLO Inference Results
  requestId?: string;
  yoloModelVersion?: string;
  detectionCount?: number;
  hasFire?: boolean;
  hasSmoke?: boolean;
  alertLevel?: 'none' | 'low' | 'high' | 'critical';  // 'medium' removed (doesn't exist in DB)
  detectionMode?: string;
  activeClasses?: string[];
  detections?: YoloDetection[];

  // Confidence Scores
  confidenceFire?: number;
  confidenceSmoke?: number;
  confidenceScore?: number;  // Max confidence

  // Node & Device Context
  nodeId?: string;
  deviceId?: string;
  cameraId?: string;
  cameraLocation?: string;
  cameraType?: string;

  // Image Data
  hasImage: boolean;

  // Image Quality Metrics
  imageWidth?: number;
  imageHeight?: number;
  imageSizeBytes?: number;
  imageFormat?: string;

  // Processing Metrics
  yoloProcessingTimeMs?: number;
  processingTimeMs?: number;

  // Alert & Response
  falsePositiveFlag?: boolean;
  verifiedByHuman?: boolean;
  humanVerifier?: string;

  // Communication Status
  telegramDelivered: boolean;
  telegramMessageId?: string;
  telegramChatId?: string;
  emailSent?: boolean;
  smsSent?: boolean;

  // Geographic Context
  latitude?: number;
  longitude?: number;
  elevation?: number;
  fireZoneRisk?: string;
  location?: string;

  // Temporal Context
  detectionTimestamp?: Date;
  captureTimestamp?: Date;
  isDaylight?: boolean;
  weatherConditions?: string;
  temperatureCelsius?: number;
  humidityPercent?: number;
  windSpeedKmh?: number;

  // Correlation & Incidents
  incidentId?: string;
  relatedExecutionIds?: string[];
  duplicateOf?: string;

  // Processing Metadata
  processedAt: Date;
  processingVersion: string;
  extractionMethod: string;
}

export interface ExpertReview {
  // Expert Review Status
  expertReviewStatus: 'pending' | 'in_review' | 'completed' | 'disputed';
  expertReviewPriority: 1 | 2 | 3 | 4 | 5; // 1=urgent, 5=training
  assignedExpertId?: string;
  expertReviewDeadline?: Date;
  
  // Expert Judgment
  expertRiskAssessment?: 'high' | 'medium' | 'low' | 'none';
  expertConfidence?: number;
  expertAgreesWithAi?: boolean;
  expertNotes?: string;
  expertReasoning?: string;
  
  // Tagging System
  expertTags?: string[];
  fireType?: string;
  fireStage?: string;
  fireCause?: string;
  
  // Validation Metadata
  reviewedAt?: Date;
  reviewDurationMinutes?: number;
  expertName?: string;
  expertCertification?: string;
  expertExperienceYears?: number;
  
  // Quality Assurance
  needsSecondOpinion?: boolean;
  secondReviewerId?: string;
  secondExpertAgrees?: boolean;
  consensusReached?: boolean;
  escalatedToSupervisor?: boolean;
  
  // Training & Learning
  useForTraining: boolean;
  trainingWeight?: number;
  imageClarityRating?: number; // 1-5
  detectionDifficulty?: number; // 1-5
  
  // Feedback Loop
  aiImprovementSuggestions?: string;
  feedbackCategory?: string;
  recommendedCameraAdjustment?: string;
  
  // Legal & Compliance
  legalEvidenceQuality?: 'admissible' | 'standard' | 'poor' | 'unusable';
  chainOfCustodyMaintained?: boolean;
  expertSignatureHash?: string;
  
  // Performance Tracking
  expertAccuracyScore?: number;
  reviewComplexityScore?: number;
  expertSpecialization?: string;
}

// Combined interface for complete analysis with expert review
export interface ComprehensiveAnalysis extends SaiEnhancedAnalysis, ExpertReview {}

// Expert user interface
export interface ExpertUser {
  id: string;
  name: string;
  email: string;
  certification: string;
  specialization: string;
  experienceYears: number;
  isActive: boolean;
  maxCaseload: number;
  currentCaseload: number;
  accuracyScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

// Incident grouping interface
export interface FireIncident {
  incidentId: string;
  startTime: Date;
  endTime?: Date;
  maxRiskLevel: 'high' | 'medium' | 'low' | 'none';
  camerasInvolved: string[];
  totalDetections: number;
  responseDispatched: boolean;
  incidentStatus: 'active' | 'monitoring' | 'resolved' | 'false_alarm';
  geographicCenter?: { latitude: number; longitude: number };
  affectedRadius?: number; // in meters
  createdAt: Date;
  updatedAt: Date;
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
  hasFire: boolean;
  hasSmoke: boolean;
  alertLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
  detectionMode: string | null;
  activeClasses: string[] | null;
  detections: YoloDetection[] | null;

  // Confidence scores
  confidenceFire: number | null;
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
  alertLevel?: 'none' | 'low' | 'high' | 'critical';  // 'medium' removed (doesn't exist in DB)
  hasFire?: boolean;
  hasSmoke?: boolean;
  detectionCount?: number;  // NEW: Filter by number of detections
  confidenceFire?: number;  // NEW: Fire-specific confidence (0.0-1.0)
  confidenceSmoke?: number;  // NEW: Smoke-specific confidence (0.0-1.0)
  detectionMode?: string;   // NEW: e.g., 'smoke-only'
  minConfidence?: number;   // DEPRECATED: Use confidenceFire/confidenceSmoke instead
  maxConfidence?: number;   // DEPRECATED: Use confidenceFire/confidenceSmoke instead

  // Device/Camera filters (executions table)
  cameraId?: string;
  cameraType?: 'onvif' | 'rtsp';  // NEW: Camera protocol type
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
}

// Expert-specific filters
export interface ExpertReviewFilters extends PaginationQuery {
  expertReviewStatus?: 'pending' | 'in_review' | 'completed' | 'disputed';
  assignedExpertId?: string;
  expertReviewPriority?: 1 | 2 | 3 | 4 | 5;
  needsSecondOpinion?: boolean;
  escalatedToSupervisor?: boolean;
  consensusReached?: boolean;
  expertSpecialization?: string;
  reviewDeadlinePast?: boolean;
  useForTraining?: boolean;
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
  basePath: string;  // Base path for image storage (used by ETL services)
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
        'expert:assigned' | 'expert:review_completed' | 'expert:review' |
        'incident:created' | 'incident:update' |
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
  // New fields for enhanced daily summary
  highRiskDetections: number;
  criticalDetections: number;
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
    hasFire: number;
    hasSmoke: number;
    bothDetected: number;
  };
  expertReviewStats?: {
    pending: number;
    inReview: number;
    completed: number;
    disputed: number;
    averageReviewTime: number;
    expertAgreementRate: number;
  };
  cameraPerformance?: Array<{
    cameraId: string;
    location?: string;
    totalDetections: number;
    fireDetections: number;
    smokeDetections: number;
    falsePositives: number;
  }>;
  incidentStatistics?: {
    activeIncidents: number;
    resolvedIncidents: number;
    multiCameraIncidents: number;
    averageIncidentDuration: number;
  };
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

// Expert dashboard specific return type
export interface UseExpertReviewReturn {
  assignments: ComprehensiveAnalysis[];
  isLoading: boolean;
  error: string | null;
  submitReview: (executionId: string, review: Partial<ExpertReview>) => Promise<void>;
  requestSecondOpinion: (executionId: string, reason: string) => Promise<void>;
  escalateToSupervisor: (executionId: string, reason: string) => Promise<void>;
}

export interface ExecutionStats {
  totalExecutions: number;
  successRate: number;
  avgDailyExecutions: number;
  lastExecution: Date | null;
}