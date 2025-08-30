import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageGallery } from './ImageGallery';
import { 
  renderWithProviders, 
  screen, 
  waitFor, 
  fireEvent,
  mockIntersectionObserver,
  createMockExecution,
} from '@/test/test-utils';
import * as useExecutionsModule from '@/hooks/useExecutions';

vi.mock('@/hooks/useExecutions');

describe('ImageGallery', () => {
  const mockLoadMore = vi.fn();
  const mockRefresh = vi.fn();
  const mockUpdateFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockIntersectionObserver(false);
  });

  it('renders loading state initially', () => {
    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: [],
      isLoading: true,
      error: null,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    renderWithProviders(<ImageGallery />);
    
    expect(screen.getByText(/Loading.../i)).toBeInTheDocument();
  });

  it('renders executions grid when data is loaded', async () => {
    const mockExecutions = [
      createMockExecution({ id: 'exec-1' }),
      createMockExecution({ id: 'exec-2', status: 'error' }),
      createMockExecution({ id: 'exec-3', status: 'running' }),
    ];

    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: mockExecutions,
      isLoading: false,
      error: null,
      hasNext: true,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    renderWithProviders(<ImageGallery />);
    
    await waitFor(() => {
      expect(screen.getByText(/Executions/i)).toBeInTheDocument();
      expect(screen.getByText(/3 loaded/i)).toBeInTheDocument();
    });

    // Check that all execution cards are rendered
    expect(screen.getAllByText(/exec-/i)).toHaveLength(3);
  });

  it('renders empty state when no executions', () => {
    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: [],
      isLoading: false,
      error: null,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    renderWithProviders(<ImageGallery />);
    
    expect(screen.getByText(/No Executions Found/i)).toBeInTheDocument();
    expect(screen.getByText(/No SAI workflow executions are available yet/i)).toBeInTheDocument();
  });

  it('renders error state and retry button', async () => {
    const errorMessage = 'Failed to fetch executions';
    
    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: [],
      isLoading: false,
      error: errorMessage,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    renderWithProviders(<ImageGallery />);
    
    expect(screen.getByText(/Failed to Load Executions/i)).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
    
    const retryButton = screen.getByRole('button', { name: /Try Again/i });
    expect(retryButton).toBeInTheDocument();
    
    fireEvent.click(retryButton);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('toggles between grid and list view', async () => {
    const mockExecutions = [createMockExecution({ id: 'exec-1' })];

    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: mockExecutions,
      isLoading: false,
      error: null,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    const { container } = renderWithProviders(<ImageGallery />);
    
    // Default is grid view
    expect(container.querySelector('.grid-cols-1.sm\\:grid-cols-2')).toBeInTheDocument();
    
    // Click list view button
    const listButton = screen.getByTitle('List view');
    fireEvent.click(listButton);
    
    await waitFor(() => {
      expect(container.querySelector('.grid-cols-1:not(.sm\\:grid-cols-2)')).toBeInTheDocument();
    });
    
    // Click grid view button
    const gridButton = screen.getByTitle('Grid view');
    fireEvent.click(gridButton);
    
    await waitFor(() => {
      expect(container.querySelector('.grid-cols-1.sm\\:grid-cols-2')).toBeInTheDocument();
    });
  });

  it('calls refresh when refresh button is clicked', () => {
    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: [createMockExecution()],
      isLoading: false,
      error: null,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    renderWithProviders(<ImageGallery />);
    
    const refreshButton = screen.getByTitle('Refresh executions');
    fireEvent.click(refreshButton);
    
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('triggers infinite scroll when reaching bottom', async () => {
    const mockExecutions = Array.from({ length: 10 }, (_, i) => 
      createMockExecution({ id: `exec-${i}` })
    );

    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: mockExecutions,
      isLoading: false,
      error: null,
      hasNext: true,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    // Mock intersection observer to simulate scrolling into view
    mockIntersectionObserver(true);
    
    renderWithProviders(<ImageGallery />);
    
    await waitFor(() => {
      expect(mockLoadMore).toHaveBeenCalled();
    });
  });

  it('shows end of results when hasNext is false', () => {
    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: [createMockExecution()],
      isLoading: false,
      error: null,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    renderWithProviders(<ImageGallery />);
    
    expect(screen.getByText(/You've reached the end of the results/i)).toBeInTheDocument();
  });

  it('opens modal when card is clicked', async () => {
    const mockExecution = createMockExecution({ id: 'exec-modal-test' });
    
    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: [mockExecution],
      isLoading: false,
      error: null,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    renderWithProviders(<ImageGallery />);
    
    // Find and click the card
    const card = screen.getByText('#exec-modal').closest('div[class*="cursor-pointer"]');
    expect(card).toBeInTheDocument();
    
    fireEvent.click(card!);
    
    await waitFor(() => {
      // Modal should be open (mocked createPortal returns the content directly)
      expect(screen.getByText(/Execution Details/i)).toBeInTheDocument();
    });
  });

  it('shows scroll to top button when scrolled down', async () => {
    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: Array.from({ length: 20 }, (_, i) => 
        createMockExecution({ id: `exec-${i}` })
      ),
      isLoading: false,
      error: null,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters: {},
    });

    renderWithProviders(<ImageGallery />);
    
    // Simulate scroll
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      value: 600,
    });
    
    fireEvent.scroll(window);
    
    await waitFor(() => {
      const scrollTopButton = screen.getByTitle('Back to top');
      expect(scrollTopButton).toBeInTheDocument();
      
      fireEvent.click(scrollTopButton);
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });
  });

  it('applies filters when provided', () => {
    const filters = { status: 'success' as const, hasImage: true };
    
    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: [],
      isLoading: false,
      error: null,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters,
    });

    renderWithProviders(<ImageGallery initialFilters={filters} />);
    
    expect(useExecutionsModule.useExecutions).toHaveBeenCalledWith(filters);
  });

  it('shows clear filters option when filters are applied', () => {
    const filters = { search: 'test' };
    
    vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
      executions: [],
      isLoading: false,
      error: null,
      hasNext: false,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      filters,
    });

    renderWithProviders(<ImageGallery initialFilters={filters} />);
    
    expect(screen.getByText(/Try adjusting your filters/i)).toBeInTheDocument();
    
    const clearButton = screen.getByText(/Clear all filters/i);
    fireEvent.click(clearButton);
    
    expect(mockUpdateFilters).toHaveBeenCalledWith({});
  });
});