/**
 * Component Prop Types
 *
 * TypeScript interfaces for React component props.
 * Keeps component files cleaner and types reusable.
 */

import { Execution, ExecutionWithImageUrls } from './execution';
import { ExecutionFilters } from './api';

// ============================================================================
// Image Gallery Components
// ============================================================================

export interface ImageCardProps {
  execution: ExecutionWithImageUrls;
  onClick: (execution: ExecutionWithImageUrls) => void;
  loading?: boolean;
}

export interface ImageModalProps {
  execution: ExecutionWithImageUrls | null;
  isOpen: boolean;
  onClose: () => void;
}

export interface ImageGalleryProps {
  executions: ExecutionWithImageUrls[];
  onExecutionClick: (execution: ExecutionWithImageUrls) => void;
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

// ============================================================================
// Filter Components
// ============================================================================

export interface FilterBarProps {
  filters: ExecutionFilters;
  onFiltersChange: (filters: ExecutionFilters) => void;
  onReset: () => void;
  isLoading?: boolean;
  className?: string;
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
  hasFire: boolean;
  hasSmoke: boolean;
  detectionCount: number;
  size?: 'sm' | 'md' | 'lg';
}

// ============================================================================
// Stats Components
// ============================================================================

export interface LiveStatsCardProps {
  stats: {
    totalExecutions: number;
    fireDetections: number;
    smokeDetections: number;
    avgConfidence: number;
  };
  isLoading?: boolean;
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
