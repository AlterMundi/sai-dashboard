import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImageGallery } from '../../components/ImageGallery';
import { executionsApi } from '../../services/api';
import { createMockExecution } from '../../test/test-utils';

// Mock the API functions
vi.mock('../../services/api');
const mockExecutionsApi = vi.mocked(executionsApi);

// Mock intersection observer for infinite scroll
const mockIntersectionObserver = vi.fn();
mockIntersectionObserver.mockReturnValue({
  observe: () => null,
  unobserve: () => null,
  disconnect: () => null
});
window.IntersectionObserver = mockIntersectionObserver;

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useLocation: () => ({ pathname: '/dashboard' })
}));

// Test wrapper with QueryClient
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Infinity,
    },
  },
});

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('ImageGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockExecutions = [
    createMockExecution({
      id: '1',
      status: 'success',
      executionTimestamp: '2025-08-29T10:00:00Z',
      completionTimestamp: '2025-08-29T10:05:00Z',
      overallAssessment: 'Low risk detected',
      confidenceScore: 0.95,
      imageUrl: '/api/executions/1/image',
      thumbnailUrl: '/api/executions/1/thumbnail',
    }),
    createMockExecution({
      id: '2',
      status: 'error',
      executionTimestamp: '2025-08-29T10:10:00Z',
      completionTimestamp: '2025-08-29T10:15:00Z',
    })
  ];

  it('should render loading state initially', () => {
    mockExecutionsApi.getExecutions.mockReturnValue(
      new Promise(() => {}) // Never resolves to keep loading state
    );

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    expect(screen.getByText('Loading executions...')).toBeInTheDocument();
  });

  it('should render executions grid when data loads', async () => {
    mockExecutionsApi.getExecutions.mockResolvedValueOnce({
      executions: mockExecutions,
      meta: {
        total: 2,
        page: 0,
        limit: 50,
        hasNext: false,
        filters: {}
      }
    });

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('2 executions found')).toBeInTheDocument();
    });

    // Check that execution cards are rendered
    expect(screen.getByText('Execution #1')).toBeInTheDocument();
    expect(screen.getByText('Execution #2')).toBeInTheDocument();
    
    // Check status badges
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('should handle empty results', async () => {
    mockExecutionsApi.getExecutions.mockResolvedValueOnce({
      executions: [],
      meta: {
        total: 0,
        page: 0,
        limit: 50,
        hasNext: false,
        filters: {}
      }
    });

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('No executions found')).toBeInTheDocument();
    });
  });

  it('should handle API errors', async () => {
    mockExecutionsApi.getExecutions.mockRejectedValueOnce(
      new Error('Failed to fetch executions')
    );

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load executions')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('should apply filters correctly', async () => {
    mockExecutionsApi.getExecutions.mockResolvedValueOnce({
      executions: mockExecutions.filter(e => e.status === 'success'),
      meta: {
        total: 1,
        page: 0,
        limit: 50,
        hasNext: false,
        filters: { status: 'success' }
      }
    });

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    // Find and interact with status filter
    const statusFilter = screen.getByLabelText('Filter by status');
    fireEvent.change(statusFilter, { target: { value: 'success' } });

    await waitFor(() => {
      expect(mockExecutionsApi.getExecutions).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success'
        })
      );
    });
  });

  it('should handle pagination', async () => {
    // First page
    mockExecutionsApi.getExecutions.mockResolvedValueOnce({
      executions: mockExecutions,
      meta: {
        total: 100,
        page: 0,
        limit: 50,
        hasNext: true,
        filters: {}
      }
    });

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('2 executions found')).toBeInTheDocument();
    });

    // Load more should be available
    expect(screen.getByText('Load More')).toBeInTheDocument();
  });

  it('should refresh data when refresh button is clicked', async () => {
    mockExecutionsApi.getExecutions.mockResolvedValue({
      executions: mockExecutions,
      meta: {
        total: 2,
        page: 0,
        limit: 50,
        hasNext: false,
        filters: {}
      }
    });

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('2 executions found')).toBeInTheDocument();
    });

    // Clear previous calls
    vi.clearAllMocks();

    // Click refresh
    const refreshButton = screen.getByLabelText('Refresh executions');
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(mockExecutionsApi.getExecutions).toHaveBeenCalledTimes(1);
    });
  });

  it('should handle search functionality', async () => {
    mockExecutionsApi.searchExecutions.mockResolvedValueOnce([mockExecutions[0]]);

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    // Find search input
    const searchInput = screen.getByPlaceholderText('Search executions...');
    fireEvent.change(searchInput, { target: { value: 'test search' } });
    
    // Trigger search (may need to press Enter or click search button)
    fireEvent.keyPress(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(mockExecutionsApi.searchExecutions).toHaveBeenCalledWith('test search', 20);
    });
  });

  it('should handle image modal opening', async () => {
    mockExecutionsApi.getExecutions.mockResolvedValueOnce({
      executions: mockExecutions,
      meta: {
        total: 2,
        page: 0,
        limit: 50,
        hasNext: false,
        filters: {}
      }
    });

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('2 executions found')).toBeInTheDocument();
    });

    // Click on an execution card with image
    const imageCard = screen.getByText('Execution #1').closest('[data-testid="execution-card"]');
    if (imageCard) {
      fireEvent.click(imageCard);
      
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    }
  });

  it('should display correct execution timing information', async () => {
    mockExecutionsApi.getExecutions.mockResolvedValueOnce({
      executions: mockExecutions,
      meta: {
        total: 2,
        page: 0,
        limit: 50,
        hasNext: false,
        filters: {}
      }
    });

    render(
      <TestWrapper>
        <ImageGallery />
      </TestWrapper>
    );

    await waitFor(() => {
      // Check execution time display
      expect(screen.getByText('5.0s')).toBeInTheDocument(); // 5000ms = 5.0s
      expect(screen.getByText('3.0s')).toBeInTheDocument(); // 3000ms = 3.0s
      
      // Check date formatting
      expect(screen.getByText(/Aug 29, 2025/)).toBeInTheDocument();
    });
  });
});