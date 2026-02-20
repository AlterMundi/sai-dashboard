import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionListItem } from './ExecutionListItem';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createMockYoloExecution, createMockProcessingExecution } from '@/test/mock-factories';

vi.mock('@/services/api', () => ({
  executionsApi: {
    getImageUrl: vi.fn(
      (id: number, thumbnail: boolean) =>
        `/api/executions/${id}/image${thumbnail ? '?thumbnail=true' : ''}`
    ),
  },
}));

// Provide a blobUrl so the img element is rendered in tests.
vi.mock('@/components/ui/SecureImage', () => ({
  useSecureImage: vi.fn((url: string | undefined) => ({
    blobUrl: url ?? 'blob:http://localhost/test-image',
    loading: false,
    error: false,
  })),
}));

describe('ExecutionListItem', () => {
  const onClick = vi.fn();
  const execution = createMockYoloExecution();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Basic rendering
  // -----------------------------------------------------------------------

  it('renders execution id', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    expect(screen.getByText(/#180001/)).toBeInTheDocument();
  });

  it('renders camera and location info', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    expect(screen.getByText('CAM_001')).toBeInTheDocument();
    expect(screen.getByText('Zone A')).toBeInTheDocument();
  });

  it('renders alert level badge', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    expect(screen.getByText('high')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // role, tabIndex, keyboard interaction
  // -----------------------------------------------------------------------

  it('has role="button" and tabIndex=0', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    // The card is the first button; the Eye button is the second
    const card = screen.getByRole('button', { name: /Execution 180001/ });
    expect(card).toHaveAttribute('tabindex', '0');
  });

  it('activates on Enter key press', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button', { name: /Execution 180001/ });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith(execution);
  });

  it('activates on Space key press', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button', { name: /Execution 180001/ });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledWith(execution);
  });

  it('does not activate on other keys', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button', { name: /Execution 180001/ });
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not activate when loading', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} loading={true} />
    );

    const card = screen.getByRole('button', { name: /Execution 180001/ });
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.click(card);
    expect(onClick).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // aria-label
  // -----------------------------------------------------------------------

  it('includes execution id, status, and alert level in aria-label', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button', { name: /Execution 180001/ });
    const label = card.getAttribute('aria-label')!;
    expect(label).toContain('success');
    expect(label).toContain('alert level high');
  });

  it('omits alert level from aria-label when none', () => {
    const noAlert = createMockYoloExecution({ alertLevel: 'none' });
    renderWithProviders(
      <ExecutionListItem execution={noAlert} onClick={onClick} />
    );

    const card = screen.getByRole('button', { name: /Execution 180001/ });
    expect(card.getAttribute('aria-label')).not.toContain('alert level');
  });

  // -----------------------------------------------------------------------
  // focus-visible and CSS transitions
  // -----------------------------------------------------------------------

  it('has focus-visible ring classes', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button', { name: /Execution 180001/ });
    expect(card.className).toContain('focus-visible:ring-2');
    expect(card.className).toContain('outline-none');
  });

  it('uses transition-[box-shadow,border-color] not transition-all', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button', { name: /Execution 180001/ });
    expect(card.className).toContain('transition-[box-shadow,border-color]');
    expect(card.className).not.toContain('transition-all');
  });

  // -----------------------------------------------------------------------
  // View button accessibility
  // -----------------------------------------------------------------------

  it('view button has aria-label', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const viewBtn = screen.getByRole('button', { name: /View execution details/ });
    expect(viewBtn).toBeInTheDocument();
  });

  it('view button container has group-focus-within for keyboard visibility', () => {
    const { container } = renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    // The wrapper div around the Eye button should have group-focus-within
    const viewWrapper = container.querySelector('.group-focus-within\\:opacity-100');
    expect(viewWrapper).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // aria-hidden on decorative icons
  // -----------------------------------------------------------------------

  it('marks decorative icons with aria-hidden', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const hiddenIcons = document.querySelectorAll('svg[aria-hidden="true"]');
    expect(hiddenIcons.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // img dimensions
  // -----------------------------------------------------------------------

  it('sets width and height on thumbnail img', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const img = document.querySelector('img');
    expect(img).toHaveAttribute('width', '64');
    expect(img).toHaveAttribute('height', '64');
  });

  // -----------------------------------------------------------------------
  // Unicode ellipsis
  // -----------------------------------------------------------------------

  it('uses unicode ellipsis in stage1 processing text', () => {
    const stage1 = createMockProcessingExecution('stage1', { hasImage: false });
    renderWithProviders(
      <ExecutionListItem execution={stage1} onClick={onClick} />
    );

    const processingText = screen.getByText(/Processing/);
    expect(processingText.textContent).toContain('\u2026');
    expect(processingText.textContent).not.toContain('...');
  });

  // -----------------------------------------------------------------------
  // tabular-nums on numeric content
  // -----------------------------------------------------------------------

  it('uses tabular-nums on confidence percentages', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    const tabularElements = document.querySelectorAll('.tabular-nums');
    expect(tabularElements.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Detection display
  // -----------------------------------------------------------------------

  it('shows fire detection with confidence', () => {
    renderWithProviders(
      <ExecutionListItem execution={execution} onClick={onClick} />
    );

    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('shows "No detections" when no smoke', () => {
    const clean = createMockYoloExecution({
      hasSmoke: false,
      detectionCount: 0,
      alertLevel: 'none',
    });

    renderWithProviders(
      <ExecutionListItem execution={clean} onClick={onClick} />
    );

    expect(screen.getByText('No detections')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Stage 2 error state
  // -----------------------------------------------------------------------

  it('shows "Analysis failed" for failed stage2', () => {
    const failed = createMockProcessingExecution('failed');
    renderWithProviders(
      <ExecutionListItem execution={failed} onClick={onClick} />
    );

    expect(screen.getByText('Analysis failed')).toBeInTheDocument();
  });
});
