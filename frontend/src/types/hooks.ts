/**
 * React Hooks Return Types
 *
 * Type definitions for custom hook return values.
 */

import { ExecutionWithImageUrls } from './execution';
import { ExecutionFilters, DashboardRole } from './api';
import { ProcessingStage } from './execution';

/**
 * useAuth hook return type
 */
export interface UseAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (password?: string) => Promise<void>;
  logout: () => void;
  token: string | null;
  error: string | null;
  user: { id: string; email: string; role: DashboardRole } | null;
}

/**
 * useExecutions hook return type
 */
export interface UseExecutionsReturn {
  executions: ExecutionWithImageUrls[];
  isLoading: boolean;
  error: string | null;
  hasNext: boolean;
  loadMore: () => void;
  refresh: () => void;
  updateFilters: (filters: ExecutionFilters) => void;
  filters: ExecutionFilters;
  prependExecutions: (executions: ExecutionWithImageUrls[]) => void;
  updateExecutionStage: (executionId: number, stage: ProcessingStage, additionalData?: any) => boolean;
  totalResults: number;
}

/**
 * useSSE hook return type
 */
export interface UseSSEReturn {
  isConnected: boolean;
  lastEvent: {
    type: string;
    data: unknown;
    timestamp: Date;
  } | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  clientCount: number;
  connect: () => void;
  disconnect: () => void;
  liveStats: {
    totalExecutions: number;
    successRate: number;
    avgProcessingTime: number;
    activeAlerts: number;
  } | null;
  systemHealth: {
    status: 'healthy' | 'degraded' | 'down' | 'warning' | 'critical';
    etlQueueSize: number;
    lastUpdate: string;
    cpu?: number;
    memory?: number;
  } | null;
}
