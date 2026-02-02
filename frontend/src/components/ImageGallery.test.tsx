import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageGallery } from './ImageGallery';
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  createMockExecution,
} from '@/test/test-utils';
import * as useExecutionsModule from '@/hooks/useExecutions';

vi.mock('@/hooks/useExecutions');

vi.mock('@/services/api', () => ({
  executionsApi: {
    getImageUrl: vi.fn(
      (id: number, thumbnail: boolean) =>
        `/api/executions/${id}/image${thumbnail ? '?thumbnail=true' : ''}`
    ),
  },
}));

// Mock react-intersection-observer to control inView state per-test
let mockInView = false;
vi.mock('react-intersection-observer', () => ({
  useInView: vi.fn(() => ({
    ref: (node: HTMLElement | null) => { void node; },
    inView: mockInView,
    entry: undefined,
  })),
}));

function mockUseExecutions(overrides: Partial<ReturnType<typeof useExecutionsModule.useExecutions>> = {}) {
  vi.mocked(useExecutionsModule).useExecutions = vi.fn().mockReturnValue({
    executions: [],
    isLoading: false,
    error: null,
    hasNext: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
    updateFilters: vi.fn(),
    filters: {},
    prependExecutions: vi.fn(),
    updateExecutionStage: vi.fn(),
    totalResults: 0,
    ...overrides,
  });
}

describe('ImageGallery', () => {
  const mockLoadMore = vi.fn();
  const mockRefresh = vi.fn();
  const mockUpdateFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockInView = false;
  });

  it('renders loading state initially', () => {
    mockUseExecutions({ isLoading: true });

    renderWithProviders(<ImageGallery />);

    // LoadingSpinner renders sr-only "Loading..." text
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders executions grid when data is loaded', async () => {
    const mockExecutions = [
      createMockExecution({ id: 180001 }),
      createMockExecution({ id: 180002, status: 'error' }),
      createMockExecution({ id: 180003 }),
    ];

    mockUseExecutions({
      executions: mockExecutions,
      hasNext: true,
      loadMore: mockLoadMore,
      refresh: mockRefresh,
      updateFilters: mockUpdateFilters,
      totalResults: 3,
    });

    renderWithProviders(<ImageGallery />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Executions/i })).toBeInTheDocument();
      expect(screen.getByText(/3 loaded/i)).toBeInTheDocument();
    });
  });

  it('renders empty state when no executions', () => {
    mockUseExecutions();

    renderWithProviders(<ImageGallery />);

    expect(screen.getByText(/No Executions Found/i)).toBeInTheDocument();
    expect(screen.getByText(/No SAI workflow executions are available yet/i)).toBeInTheDocument();
  });

  it('renders error state and retry button', () => {
    const errorMessage = 'Failed to fetch executions';

    mockUseExecutions({
      error: errorMessage,
      refresh: mockRefresh,
    });

    renderWithProviders(<ImageGallery />);

    expect(screen.getByText(/Failed to Load Executions/i)).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /Try Again/i });
    fireEvent.click(retryButton);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('toggles between grid and list view', async () => {
    const mockExecutions = [createMockExecution({ id: 180001 })];

    mockUseExecutions({
      executions: mockExecutions,
      totalResults: 1,
    });

    const { container } = renderWithProviders(<ImageGallery />);

    // Default is grid view
    expect(container.querySelector('.grid-cols-1.sm\\:grid-cols-2')).toBeInTheDocument();

    // Click list view button
    const listButton = screen.getByTitle('List view');
    fireEvent.click(listButton);

    await waitFor(() => {
      // List view: space-y-2 container instead of grid
      expect(container.querySelector('.space-y-2')).toBeInTheDocument();
    });

    // Click grid view button
    const gridButton = screen.getByTitle('Grid view');
    fireEvent.click(gridButton);

    await waitFor(() => {
      expect(container.querySelector('.grid-cols-1.sm\\:grid-cols-2')).toBeInTheDocument();
    });
  });

  it('calls refresh when refresh button is clicked', () => {
    mockUseExecutions({
      executions: [createMockExecution()],
      refresh: mockRefresh,
      totalResults: 1,
    });

    renderWithProviders(<ImageGallery />);

    const refreshButton = screen.getByTitle('Refresh executions');
    fireEvent.click(refreshButton);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('triggers infinite scroll when reaching bottom', async () => {
    const mockExecutions = Array.from({ length: 10 }, (_, i) =>
      createMockExecution({ id: 180001 + i })
    );

    // Set inView=true before render so the useEffect fires loadMore
    mockInView = true;

    mockUseExecutions({
      executions: mockExecutions,
      hasNext: true,
      loadMore: mockLoadMore,
      totalResults: 100,
    });

    renderWithProviders(<ImageGallery />);

    await waitFor(() => {
      expect(mockLoadMore).toHaveBeenCalled();
    });
  });

  it('shows end of results when hasNext is false', () => {
    mockUseExecutions({
      executions: [createMockExecution()],
      hasNext: false,
      totalResults: 1,
    });

    renderWithProviders(<ImageGallery />);

    expect(screen.getByText(/You've reached the end of the results/i)).toBeInTheDocument();
  });

  it('opens modal when card is clicked', async () => {
    const mockExecution = createMockExecution({ id: 180099 });

    mockUseExecutions({
      executions: [mockExecution],
      totalResults: 1,
    });

    renderWithProviders(<ImageGallery />);

    // Card has role="button" with aria-label containing the execution id
    const card = screen.getByRole('button', { name: /Execution 180099/ });
    fireEvent.click(card);

    await waitFor(() => {
      expect(screen.getByText(/Execution Details/i)).toBeInTheDocument();
    });
  });

  it('shows scroll to top button when scrolled down', async () => {
    mockUseExecutions({
      executions: Array.from({ length: 20 }, (_, i) =>
        createMockExecution({ id: 180001 + i })
      ),
      totalResults: 20,
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

  it('passes initialFilters to useExecutions hook', () => {
    const filters = { status: 'success' as const };

    mockUseExecutions();

    renderWithProviders(<ImageGallery initialFilters={filters} />);

    // useExecutions is called with (initialFilters, refreshTrigger)
    expect(useExecutionsModule.useExecutions).toHaveBeenCalledWith(filters, undefined);
  });

  it('shows clear filters option when filters are applied', () => {
    mockUseExecutions({
      filters: { search: 'test' },
      updateFilters: mockUpdateFilters,
    });

    renderWithProviders(<ImageGallery initialFilters={{ search: 'test' }} />);

    expect(screen.getByText(/Try adjusting your filters/i)).toBeInTheDocument();

    const clearButton = screen.getByText(/Clear all filters/i);
    fireEvent.click(clearButton);
    expect(mockUpdateFilters).toHaveBeenCalledWith({});
  });
});
