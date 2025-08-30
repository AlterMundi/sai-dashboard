import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { vi } from 'vitest';
import { ExecutionWithImage, ImageAnalysis } from '@/types';

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
        <BrowserRouter>
          {children}
        </BrowserRouter>
      </HelmetProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

// Mock data factories
export const createMockExecution = (overrides?: Partial<ExecutionWithImage>): ExecutionWithImage => ({
  id: 'exec-123',
  workflowId: 'workflow-456',
  status: 'success',
  startedAt: '2025-08-29T10:00:00Z',
  stoppedAt: '2025-08-29T10:00:30Z',
  mode: 'webhook',
  finished: true,
  retryOf: null,
  retrySuccessId: null,
  imageUrl: '/api/executions/exec-123/image',
  thumbnailUrl: '/api/executions/exec-123/image?thumbnail=true',
  analysis: {
    riskAssessment: 'Low risk detected',
    confidence: 0.85,
    description: 'Image analysis completed successfully',
    recommendations: ['No immediate action required'],
  },
  telegramDelivered: true,
  telegramMessageId: 'msg-789',
  ...overrides,
});

export const createMockAnalysis = (overrides?: Partial<ImageAnalysis>): ImageAnalysis => ({
  riskAssessment: 'Medium risk detected',
  confidence: 0.75,
  description: 'Analysis shows potential issues',
  recommendations: ['Monitor closely', 'Review in 24 hours'],
  ...overrides,
});

// Mock API responses
export const mockApiResponses = {
  executions: {
    success: {
      data: [
        createMockExecution({ id: 'exec-1' }),
        createMockExecution({ id: 'exec-2', status: 'error' }),
        createMockExecution({ id: 'exec-3', status: 'running' }),
      ],
      meta: {
        total: 100,
        page: 0,
        limit: 50,
        hasNext: true,
      },
    },
    empty: {
      data: [],
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
        lastExecution: '2025-08-29T10:00:00Z',
      },
    },
  },
};

// Mock hooks
export const mockUseAuth = (authenticated = false, loading = false) => ({
  isAuthenticated: authenticated,
  isLoading: loading,
  login: vi.fn(),
  logout: vi.fn(),
  token: authenticated ? 'test-token' : null,
  error: null,
});

export const mockUseExecutions = (
  executions = mockApiResponses.executions.success.data,
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
});

export const mockUseSSE = (connected = true) => ({
  isConnected: connected,
  lastEvent: null,
  connectionStatus: connected ? 'connected' : 'disconnected',
  clientCount: 1,
  connect: vi.fn(),
  disconnect: vi.fn(),
});

// Wait utilities
export const waitForLoadingToFinish = () => 
  new Promise(resolve => setTimeout(resolve, 0));

// Mock image loading
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

// Mock IntersectionObserver for infinite scroll
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
    // Trigger callback immediately with mock entry
    callback([{ isIntersecting, target: document.createElement('div') }], mockObserver as any);
    return mockObserver;
  }) as any;

  return mockObserver;
};

// Mock EventSource for SSE
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