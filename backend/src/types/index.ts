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

// Enhanced Analysis Types for SAI System
export interface SaiEnhancedAnalysis {
  // Primary Key
  executionId: string;
  
  // Node & Device Context
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  cameraId?: string;
  cameraLocation?: string;
  
  // Core Risk Analysis (AI Generated)
  riskLevel: 'high' | 'medium' | 'low' | 'none';
  confidenceScore?: number;
  hasImage: boolean;
  
  // Detailed Detection Flags
  smokeDetected?: boolean;
  flameDetected?: boolean;
  heatSignatureDetected?: boolean;
  motionDetected?: boolean;
  
  // Image Quality Metrics
  imageWidth?: number;
  imageHeight?: number;
  imageSizeBytes?: number;
  imageFormat?: string;
  imageQualityScore?: number;
  
  // AI/ML Context
  modelVersion?: string;
  processingTimeMs?: number;
  featuresDetected?: string[];
  colorAnalysis?: Record<string, unknown>;
  
  // Alert & Response
  alertPriority: 'critical' | 'high' | 'normal' | 'low';
  responseRequired?: boolean;
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
  
  // Temporal Context
  detectionTimestamp?: Date;
  isDaylight?: boolean;
  weatherConditions?: string;
  temperatureCelsius?: number;
  humidityPercent?: number;
  windSpeedKmh?: number;
  
  // Correlation & Incidents
  incidentId?: string;
  relatedExecutionIds?: string[];
  duplicateOf?: string;
  
  // Analysis Content
  ollamaAnalysisText?: string;
  rawAnalysisJson?: Record<string, unknown>;
  confidenceBreakdown?: Record<string, number>;
  
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

export interface ExecutionWithImage extends SaiExecution {
  imageUrl?: string;
  thumbnailUrl?: string;
  analysis?: ImageAnalysis;
  telegramDelivered?: boolean;
  telegramMessageId?: string;
  
  // Enhanced analysis data (optional for backward compatibility)
  enhancedAnalysis?: SaiEnhancedAnalysis;
  expertReview?: ExpertReview;
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
  riskLevel?: 'high' | 'medium' | 'low' | 'none';
  telegramDelivered?: boolean;
  datePreset?: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth';
  sortBy?: 'date' | 'risk' | 'status' | 'confidence' | 'camera' | 'priority';
  sortOrder?: 'asc' | 'desc';
  
  // Enhanced filters for new analysis fields
  cameraId?: string;
  nodeType?: string;
  nodeId?: string;
  alertPriority?: 'critical' | 'high' | 'normal' | 'low';
  responseRequired?: boolean;
  verifiedByHuman?: boolean;
  incidentId?: string;
  fireType?: string;
  minConfidence?: number;
  maxConfidence?: number;
  smokeDetected?: boolean;
  flameDetected?: boolean;
  isDaylight?: boolean;
  weatherConditions?: string;
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
  type: 'execution:new' | 'execution:error' | 'heartbeat' | 'connection' | 'expert:assigned' | 'expert:review_completed' | 'incident:created' | 'emergency:response_required';
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

export interface ExecutionStatistics {
  overview: {
    totalExecutions: number;
    successRate: number;
    averageExecutionTime: number;
    activeToday: number;
  };
  riskDistribution: {
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
  
  // Enhanced statistics for new analysis capabilities
  detectionBreakdown?: {
    smokeDetected: number;
    flameDetected: number;
    heatSignatureDetected: number;
    motionDetected: number;
  };
  alertDistribution?: {
    critical: number;
    high: number;
    normal: number;
    low: number;
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
    riskDetections: number;
    falsePositives: number;
    averageImageQuality: number;
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