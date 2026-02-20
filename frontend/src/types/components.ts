/**
 * Component Prop Types
 *
 * TypeScript interfaces for React component props.
 * Keeps component files cleaner and types reusable.
 */

import React from 'react';
import { Execution, ExecutionWithImageUrls } from './execution';

// ============================================================================
// Image Gallery Components
// ============================================================================

export interface ImageCardProps {
  execution: ExecutionWithImageUrls;
  onClick: (execution: ExecutionWithImageUrls) => void;
  loading?: boolean;
}

export interface NavContext {
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  index: number;   // 0-based current position
  total: number;
  /** Returns executions in range [index-behind .. index+ahead] (clamped to array bounds). */
  getNeighbors: (behind: number, ahead: number) => import('./execution').ExecutionWithImageUrls[];
}

export interface ImageModalProps {
  execution: ExecutionWithImageUrls | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: (execution: ExecutionWithImageUrls) => void;
  cameraNav?: NavContext;   // same nodeId+cameraId, sorted by executionTimestamp ASC
  galleryNav?: NavContext;  // all loaded executions in current gallery order
}

export interface ImageGalleryProps {
  executions: ExecutionWithImageUrls[];
  onExecutionClick: (execution: ExecutionWithImageUrls) => void;
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

// ============================================================================
// Status and Badge Components
// ============================================================================

export interface StatusBadgeProps {
  status: Execution['status'];
  size?: 'sm' | 'md' | 'lg';
}

export interface AlertLevelBadgeProps {
  alertLevel: Execution['alertLevel'];
  size?: 'sm' | 'md' | 'lg';
}

export interface DetectionBadgeProps {
  hasSmoke: boolean;
  detectionCount: number;
  size?: 'sm' | 'md' | 'lg';
}

// ============================================================================
// Stats Components
// ============================================================================

export interface LiveStatsCardProps {
  title: string;
  icon: React.ReactNode;
  statKey: string;
  initialValue: number;
  format?: (value: number) => string;
  className?: string;
}

export interface StatsDashboardProps {
  dateRange?: {
    startDate: string;
    endDate: string;
  };
}

// ============================================================================
// Pagination Components
// ============================================================================

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  hasNext: boolean;
  hasPrev: boolean;
  isLoading?: boolean;
}

// ============================================================================
// Layout Components
// ============================================================================

export interface LayoutProps {
  children: React.ReactNode;
  title?: string;
}

// ============================================================================
// Auth Components
// ============================================================================

export interface LoginFormProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}
