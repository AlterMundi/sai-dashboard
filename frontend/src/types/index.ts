/**
 * SAI Dashboard Types - Main Export File
 *
 * This file re-exports all type definitions used throughout the application.
 * Types are organized into logical modules for better maintainability.
 *
 * IMPORTANT: These types match the backend YOLO schema exactly.
 * Schema Version: 2.1 (Optimized YOLO)
 * Last Updated: October 12, 2025
 */

// ============================================================================
// Execution Types (Core)
// ============================================================================
export type {
  Execution,
  ExecutionWithImageUrls,
  ExecutionWithProcessingStage,
  ExecutionStatus,
  AlertLevel,
  DetectionMode,
  YoloDetection,
  ProcessingStage,
} from './execution';

// ============================================================================
// API Types
// ============================================================================
export type {
  ApiResponse,
  PaginatedResponse,
  ExecutionFilters,
  DailySummary,
  ExecutionStats,
  AuthResponse,
  LoginRequest,
  TokenValidation,
  HealthStatus,
  SSEStatus,
  SSEExecutionEvent,
  SSEHeartbeatEvent,
  SSEConnectionEvent,
  SSEStage2CompletionEvent,
  SSEStage2FailureEvent,
  SSEEtlStatusEvent,
  FilterOptions,
  StatsFilters,
  StatsRankingItem,
  StatsRanking,
} from './api';

// ============================================================================
// Component Prop Types
// ============================================================================
export type {
  ImageCardProps,
  ImageModalProps,
  ImageGalleryProps,
  StatusBadgeProps,
  AlertLevelBadgeProps,
  DetectionBadgeProps,
  LiveStatsCardProps,
  StatsDashboardProps,
  PaginationProps,
  LayoutProps,
  LoginFormProps,
} from './components';

// ============================================================================
// Hook Types
// ============================================================================
export type {
  UseAuthReturn,
  UseExecutionsReturn,
  UseSSEReturn,
} from './hooks';

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Make all properties of T optional recursively
 */
export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

/**
 * Extract keys from T where value type is V
 */
export type KeysOfType<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

/**
 * Nullable version of T
 */
export type Nullable<T> = T | null;

/**
 * Optional version of T
 */
export type Optional<T> = T | undefined;

// ============================================================================
// Error Types
// ============================================================================

export interface AppError {
  message: string;
  code: string;
  status?: number;
  details?: Record<string, any>;
}

// ============================================================================
// Theme Types
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeStore {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

// ============================================================================
// Store Types (Zustand)
// ============================================================================

import type { ExecutionWithImageUrls } from './execution';
import type { ExecutionFilters } from './api';

export interface AuthStore {
  isAuthenticated: boolean;
  token: string | null;
  user: { id: string } | null;
  login: (token: string) => void;
  logout: () => void;
  setUser: (user: { id: string }) => void;
}

export interface UIStore {
  selectedExecution: ExecutionWithImageUrls | null;
  isModalOpen: boolean;
  filters: ExecutionFilters;
  setSelectedExecution: (execution: ExecutionWithImageUrls | null) => void;
  setModalOpen: (open: boolean) => void;
  setFilters: (filters: ExecutionFilters) => void;
  resetFilters: () => void;
}
