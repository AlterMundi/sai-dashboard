import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageCard } from './ImageCard';
import { 
  renderWithProviders, 
  screen, 
  fireEvent,
  waitFor,
  createMockExecution,
  mockImageLoad,
  mockImageError
} from '@/test/test-utils';
import * as apiModule from '@/services/api';

vi.mock('@/services/api', () => ({
  executionsApi: {
    getImageUrl: vi.fn((id: string, thumbnail: boolean) => 
      `/api/executions/${id}/image${thumbnail ? '?thumbnail=true' : ''}`
    ),
  },
}));

describe('ImageCard', () => {
  const mockOnClick = vi.fn();
  const defaultExecution = createMockExecution();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders execution card with basic information', () => {
    renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    // Check for execution ID
    expect(screen.getByText(/#exec-123/i)).toBeInTheDocument();
    
    // Check for status badge
    expect(screen.getByText(/success/i)).toBeInTheDocument();
    
    // Check for mode
    expect(screen.getByText(/webhook/i)).toBeInTheDocument();
  });

  it('displays thumbnail image when available', async () => {
    const { container } = renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain('/api/executions/exec-123/image?thumbnail=true');
    
    // Simulate image load
    mockImageLoad(img);
    
    await waitFor(() => {
      expect(img.style.opacity).not.toBe('0');
    });
  });

  it('shows error state when image fails to load', async () => {
    const { container } = renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    const img = container.querySelector('img') as HTMLImageElement;
    
    // Simulate image error
    mockImageError(img);
    
    await waitFor(() => {
      expect(screen.getByText(/Image failed to load/i)).toBeInTheDocument();
    });
  });

  it('shows no image placeholder when execution has no image', () => {
    const executionWithoutImage = createMockExecution({
      imageUrl: undefined,
      thumbnailUrl: undefined,
    });

    renderWithProviders(
      <ImageCard execution={executionWithoutImage} onClick={mockOnClick} />
    );

    expect(screen.getByText(/No image/i)).toBeInTheDocument();
  });

  it('displays analysis information when available', () => {
    renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    // Check for analysis text
    expect(screen.getByText(/Low risk detected/i)).toBeInTheDocument();
    
    // Check for confidence display
    expect(screen.getByText(/85%/i)).toBeInTheDocument();
  });

  it('shows confidence bar with correct width', () => {
    const { container } = renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    const confidenceBar = container.querySelector('[style*="width: 85%"]');
    expect(confidenceBar).toBeInTheDocument();
  });

  it('calls onClick when card is clicked', () => {
    renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    const card = screen.getByText(/#exec-123/i).closest('div[class*="cursor-pointer"]');
    fireEvent.click(card!);
    
    expect(mockOnClick).toHaveBeenCalledWith(defaultExecution);
  });

  it('shows loading overlay when loading prop is true', () => {
    renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} loading={true} />
    );

    // Check for loading overlay
    const overlay = screen.getByText(/#exec-123/i)
      .closest('div[class*="cursor-pointer"]')
      ?.querySelector('div[class*="bg-opacity-50"]');
    
    expect(overlay).toBeInTheDocument();
  });

  it('prevents click when loading', () => {
    renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} loading={true} />
    );

    const card = screen.getByText(/#exec-123/i).closest('div[class*="cursor-pointer"]');
    fireEvent.click(card!);
    
    expect(mockOnClick).not.toHaveBeenCalled();
  });

  it('displays telegram delivery indicator when delivered', () => {
    renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    // Check for telegram indicator (MessageCircle icon)
    const telegramIndicator = document.querySelector('div[class*="bg-success-600"]');
    expect(telegramIndicator).toBeInTheDocument();
  });

  it('does not show telegram indicator when not delivered', () => {
    const executionNotDelivered = createMockExecution({
      telegramDelivered: false,
    });

    const { container } = renderWithProviders(
      <ImageCard execution={executionNotDelivered} onClick={mockOnClick} />
    );

    const telegramIndicator = container.querySelector('div[class*="bg-success-600"]');
    expect(telegramIndicator).not.toBeInTheDocument();
  });

  it('displays execution duration correctly', () => {
    renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    // Duration is 30 seconds (from mock data)
    expect(screen.getByText(/30s/i)).toBeInTheDocument();
  });

  it('shows relative time correctly', () => {
    // Mock the current date
    const now = new Date('2025-08-29T12:00:00Z');
    vi.setSystemTime(now);

    renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    // Should show "2 hours ago" based on mock data
    expect(screen.getByText(/2 hours ago/i)).toBeInTheDocument();
    
    vi.useRealTimers();
  });

  it('applies error styling for failed executions', () => {
    const failedExecution = createMockExecution({
      status: 'error',
    });

    const { container } = renderWithProviders(
      <ImageCard execution={failedExecution} onClick={mockOnClick} />
    );

    const card = container.querySelector('div[class*="border-danger-200"]');
    expect(card).toBeInTheDocument();
  });

  it('truncates long analysis text', () => {
    const longAnalysis = createMockExecution({
      analysis: {
        riskAssessment: 'A'.repeat(200),
        confidence: 0.5,
        description: 'A'.repeat(200),
      },
    });

    renderWithProviders(
      <ImageCard execution={longAnalysis} onClick={mockOnClick} />
    );

    // Check that text is truncated (120 chars + ...)
    const analysisText = screen.getByText(/A+\.\.\./);
    expect(analysisText.textContent?.length).toBeLessThan(150);
  });

  it('shows different status badges correctly', () => {
    const statuses = ['success', 'error', 'running', 'waiting', 'canceled'] as const;
    
    statuses.forEach(status => {
      const { unmount } = renderWithProviders(
        <ImageCard 
          execution={createMockExecution({ status })} 
          onClick={mockOnClick} 
        />
      );
      
      expect(screen.getByText(new RegExp(status, 'i'))).toBeInTheDocument();
      unmount();
    });
  });

  it('applies hover effects on mouse over', async () => {
    const { container } = renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    const card = container.querySelector('div[class*="group"]');
    expect(card).toBeInTheDocument();
    
    // Check for hover classes
    expect(card?.className).toContain('hover:shadow-lg');
  });

  it('lazy loads images', () => {
    const { container } = renderWithProviders(
      <ImageCard execution={defaultExecution} onClick={mockOnClick} />
    );

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.loading).toBe('lazy');
  });
});