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

export interface SaiEnhancedAnalysis {
  executionId: string;
  cameraId?: string;
  cameraLocation?: string;
  nodeId?: string;
  nodeType?: string;
  riskLevel: 'high' | 'medium' | 'low' | 'none';
  confidenceScore?: number;
  hasImage: boolean;
  smokeDetected?: boolean;
  flameDetected?: boolean;
  heatSignatureDetected?: boolean;
  motionDetected?: boolean;
  imageWidth?: number;
  imageHeight?: number;
  imageSizeBytes?: number;
  imageFormat?: string;
  imageQualityScore?: number;
  alertPriority: 'critical' | 'high' | 'normal' | 'low';
  responseRequired: boolean;
  telegramDelivered: boolean;
  telegramMessageId?: string;
  telegramChatId?: string;
  latitude?: number;
  longitude?: number;
  fireZoneRisk?: string;
  detectionTimestamp?: string;
  isDaylight?: boolean;
  weatherConditions?: string;
  temperatureCelsius?: number;
  humidityPercent?: number;
  windSpeedKmh?: number;
  incidentId?: string;
  ollamaAnalysisText?: string;
  processedAt: string;
  processingVersion: string;
  extractionMethod: string;
}

export interface ExpertReview {
  expertReviewStatus: 'pending' | 'in_review' | 'completed' | 'disputed';
  expertReviewPriority?: number;
  assignedExpertId?: string;
  expertReviewDeadline?: string;
  expertRiskAssessment?: 'high' | 'medium' | 'low' | 'none';
  expertConfidence?: number;
  expertAgreesWithAi?: boolean;
  expertNotes?: string;
  expertReasoning?: string;
  expertTags?: string[];
  fireType?: string;
  fireStage?: string;
  fireCause?: string;
  reviewedAt?: string;
  reviewDurationMinutes?: number;
  expertName?: string;
  needsSecondOpinion?: boolean;
  consensusReached?: boolean;
  useForTraining: boolean;
}

export interface ExecutionWithImage extends SaiExecution {
  imageUrl?: string;
  thumbnailUrl?: string;
  analysis?: ImageAnalysis;
  enhancedAnalysis?: SaiEnhancedAnalysis;
  expertReview?: ExpertReview;
  telegramDelivered?: boolean;
  telegramMessageId?: string;
}

// Filter and Pagination Types
export interface ExecutionFilters {
  // Pagination
  page?: number;
  limit?: number;
  
  // Basic execution filters
  status?: 'success' | 'error' | 'waiting' | 'running' | 'canceled';
  startDate?: string;
  endDate?: string;
  search?: string;
  hasImage?: boolean;
  telegramDelivered?: boolean;
  
  // Enhanced analysis filters
  riskLevel?: 'high' | 'medium' | 'low' | 'none';
  cameraId?: string;
  cameraLocation?: string;
  nodeId?: string;
  alertPriority?: 'critical' | 'high' | 'normal' | 'low';
  responseRequired?: boolean;
  smokeDetected?: boolean;
  flameDetected?: boolean;
  heatSignatureDetected?: boolean;
  motionDetected?: boolean;
  confidenceMin?: number;
  confidenceMax?: number;
  imageQualityMin?: number;
  
  // Geographic filters
  latitude?: number;
  longitude?: number;
  fireZoneRisk?: string;
  withinRadius?: number; // km
  
  // Environmental filters
  isDaylight?: boolean;
  weatherConditions?: string;
  temperatureMin?: number;
  temperatureMax?: number;
  
  // Expert review filters
  expertReviewStatus?: 'pending' | 'in_review' | 'completed' | 'disputed';
  assignedExpertId?: string;
  expertRiskAssessment?: 'high' | 'medium' | 'low' | 'none';
  needsSecondOpinion?: boolean;
  useForTraining?: boolean;
  reviewOverdue?: boolean;
  
  // Incident correlation
  incidentId?: string;
  hasIncident?: boolean;
  multiCamera?: boolean;
  
  // Date presets and sorting
  datePreset?: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth';
  sortBy?: 'date' | 'risk' | 'status' | 'confidence' | 'priority' | 'camera' | 'expert';
  sortOrder?: 'asc' | 'desc';
  
  // Advanced filters
  analysisTextSearch?: string;
  expertNotesSearch?: string;
  tagFilter?: string[];
  processingVersion?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    hasNext: boolean;
    analysisStatus?: AnalysisStatus;
  };
  alerts?: AnalysisAlert[];
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

// Analysis Status Types
export interface AnalysisStatus {
  totalInRange: number;
  analyzed: number | 'unknown';
  pending: number | 'unknown';
  coverage: number | 'unknown';
}

export interface AnalysisAlert {
  type: 'warning' | 'info' | 'success';
  level: 'high' | 'medium' | 'low';
  message: string;
  details: string;
  action?: string;
  actionLabel?: string;
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
  analysisStatus: AnalysisStatus | null;
  alerts: AnalysisAlert[];
  triggerAnalysis: () => Promise<void>;
}

export interface UseSSEReturn {
  isConnected: boolean;
  lastEvent: any;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  clientCount: number;
  liveStats: any;
  systemHealth: any;
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

// Expert Review Types
export interface ExpertUser {
  id: string;
  name: string;
  email: string;
  certification?: string;
  specialization: 'general' | 'wildfire' | 'industrial' | 'residential' | 'urban';
  experienceYears: number;
  isActive: boolean;
  maxCaseload: number;
  accuracyScore: number;
  currentCaseload?: number;
}

export interface ExpertAssignment {
  executionId: string;
  expertReviewPriority: number;
  expertReviewDeadline?: string;
  cameraId?: string;
  cameraLocation?: string;
  aiAssessment: 'high' | 'medium' | 'low' | 'none';
  aiConfidence?: number;
  detectionTimestamp?: string;
  ollamaAnalysisText?: string;
  assignedExpertId?: string;
  expertReviewStatus: 'pending' | 'in_review' | 'completed' | 'disputed';
  deadlineStatus: 'OVERDUE' | 'URGENT' | 'ON_TIME';
  executionStatus: string;
  executionStartedAt: string;
}

export interface ExpertTags {
  fire_indicators: string[];
  environmental: string[];
  false_positives: string[];
  image_quality: string[];
  urgency: string[];
  complexity: string[];
  fire_behavior: string[];
  weather_impact: string[];
}

export interface ExpertSystemStats {
  totalPendingReviews: number;
  averageReviewTime: number;
  expertAgreementRate: number;
  qualityScores: {
    aiAccuracy: number;
    expertConsistency: number;
    trainingDataQuality: number;
  };
}

export interface IncidentAnalysis {
  incidentId: string;
  totalDetections: number;
  camerasInvolved: number;
  maxRiskLevel: 'high' | 'medium' | 'low' | 'none';
  incidentStart: string;
  incidentEnd: string;
  responseRequired: boolean;
  expertReviewed: number;
  cameraList: string[];
}

// Enhanced Statistics Types
export interface EnhancedExecutionStats extends ExecutionStats {
  overview: {
    totalExecutions: number;
    successRate: number;
    errorRate: number;
    averageExecutionTime: number;
    activeToday: number;
  };
  statusBreakdown: {
    success: number;
    error: number;
    running: number;
    waiting: number;
    canceled: number;
  };
  recentActivity: {
    lastHour: number;
    last24Hours: number;
    last7Days: number;
    last30Days: number;
  };
  performanceMetrics: {
    avgResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    medianResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
  hourlyDistribution: Array<{
    hour: number;
    count: number;
  }>;
  errorTrend: Array<{
    date: string;
    errors: number;
    total: number;
    errorRate: number;
  }>;
}

// Theme Types
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeStore {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}