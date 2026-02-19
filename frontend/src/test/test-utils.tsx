import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { vi } from 'vitest';
import { ExecutionWithImageUrls } from '@/types';
import { LanguageProvider } from '@/contexts/LanguageContext';

// Custom render with providers
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', ...options }: CustomRenderOptions = {}
) {
  window.history.pushState({}, 'Test page', route);

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <HelmetProvider>
        <LanguageProvider>
          <BrowserRouter>
            {children}
          </BrowserRouter>
        </LanguageProvider>
      </HelmetProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

// ---------------------------------------------------------------------------
// Mock data factories (YOLO schema - matches ExecutionWithImageUrls)
// ---------------------------------------------------------------------------

export const createMockExecution = (overrides?: Partial<ExecutionWithImageUrls>): ExecutionWithImageUrls => ({
  id: 180001,
  workflowId: 'wf-sai-001',
  status: 'success',
  executionTimestamp: '2025-10-15T10:00:00Z',
  completionTimestamp: '2025-10-15T10:00:30Z',
  durationMs: 30000,
  mode: 'webhook',
  deviceId: null,
  nodeId: 'NODE_001',
  cameraId: 'CAM_001',
  location: 'Zone A',
  cameraType: null,
  captureTimestamp: null,

  // YOLO analysis
  requestId: 'req-001',
  yoloModelVersion: 'yolov8n',
  detectionCount: 1,
  hasFire: false,
  hasSmoke: false,
  alertLevel: 'none',
  detectionMode: null,
  activeClasses: null,
  detections: null,
  confidenceFire: null,
  confidenceSmoke: null,
  confidenceScore: null,

  // Image
  hasImage: true,
  imagePath: '/images/180001/original.jpg',
  thumbnailPath: '/images/180001/thumb.webp',
  cachedPath: '/images/180001/high.webp',
  imageSizeBytes: 512000,
  imageFormat: 'jpeg',
  imageWidth: 1920,
  imageHeight: 1080,
  imageUrl: '/api/executions/180001/image',
  thumbnailUrl: '/api/executions/180001/image?thumbnail=true',

  // Notifications
  telegramSent: false,
  telegramMessageId: null,
  telegramSentAt: null,

  // Metadata
  yoloProcessingTimeMs: 150,
  processingTimeMs: 5000,
  extractedAt: '2025-10-15T10:00:15Z',

  ...overrides,
});

// ---------------------------------------------------------------------------
// Mock API responses
// ---------------------------------------------------------------------------

export const mockApiResponses = {
  executions: {
    success: {
      executions: [
        createMockExecution({ id: 180001 }),
        createMockExecution({ id: 180002, status: 'error' }),
        createMockExecution({ id: 180003 }),
      ],
      meta: {
        total: 100,
        page: 0,
        limit: 50,
        hasNext: true,
      },
    },
    empty: {
      executions: [],
      meta: {
        total: 0,
        page: 0,
        limit: 50,
        hasNext: false,
      },
    },
    error: {
      error: {
        message: 'Failed to fetch executions',
        code: 'FETCH_ERROR',
      },
    },
  },
  auth: {
    loginSuccess: {
      data: {
        token: 'test-jwt-token',
        expiresIn: 86400,
      },
    },
    loginError: {
      error: {
        message: 'Invalid password',
        code: 'INVALID_CREDENTIALS',
      },
    },
    validateSuccess: {
      data: {
        valid: true,
        userId: 'user-123',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        remainingTime: 86400,
      },
    },
  },
  stats: {
    success: {
      data: {
        totalExecutions: 4893,
        successRate: 99.96,
        avgDailyExecutions: 163.1,
        lastExecution: '2025-10-15T10:00:00Z',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Mock hooks (matching current return types)
// ---------------------------------------------------------------------------

export const mockUseAuth = (authenticated = false, loading = false) => ({
  isAuthenticated: authenticated,
  isLoading: loading,
  login: vi.fn(),
  logout: vi.fn(),
  token: authenticated ? 'test-token' : null,
  error: null,
});

export const mockUseExecutions = (
  executions = mockApiResponses.executions.success.executions,
  loading = false
) => ({
  executions,
  isLoading: loading,
  error: null,
  hasNext: true,
  loadMore: vi.fn(),
  refresh: vi.fn(),
  updateFilters: vi.fn(),
  filters: {},
  prependExecutions: vi.fn(),
  updateExecutionStage: vi.fn(),
  totalResults: executions.length,
});

export const mockUseSSE = (connected = true) => ({
  isConnected: connected,
  lastEvent: null,
  connectionStatus: connected ? 'connected' as const : 'disconnected' as const,
  clientCount: 1,
  connect: vi.fn(),
  disconnect: vi.fn(),
  liveStats: null,
  systemHealth: null,
});

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

export const waitForLoadingToFinish = () =>
  new Promise(resolve => setTimeout(resolve, 0));

export const mockImageLoad = (img: HTMLImageElement) => {
  Object.defineProperty(img, 'complete', {
    writable: true,
    value: true,
  });

  setTimeout(() => {
    img.onload?.(new Event('load'));
  }, 0);
};

export const mockImageError = (img: HTMLImageElement) => {
  setTimeout(() => {
    img.onerror?.(new Event('error'));
  }, 0);
};

export const mockIntersectionObserver = (
  isIntersecting = false,
  disconnect = vi.fn()
) => {
  const mockObserver = {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect,
  };

  (globalThis as any).IntersectionObserver = vi.fn().mockImplementation((callback) => {
    callback([{ isIntersecting, target: document.createElement('div') }], mockObserver as any);
    return mockObserver;
  }) as any;

  return mockObserver;
};

export const mockEventSource = () => {
  const listeners: Record<string, Function[]> = {};
  const eventSource = {
    addEventListener: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    removeEventListener: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN
    trigger: (event: string, data: any) => {
      const handlers = listeners[event] || [];
      handlers.forEach(handler => handler({ data: JSON.stringify(data) }));
    },
  };

  (globalThis as any).EventSource = vi.fn().mockImplementation(() => eventSource) as any;
  return eventSource;
};

// Re-export everything from @testing-library/react
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
