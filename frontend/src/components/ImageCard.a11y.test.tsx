import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageCard } from './ImageCard';
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

describe('ImageCard Accessibility', () => {
  const onClick = vi.fn();
  const execution = createMockYoloExecution();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // role, tabIndex, keyboard interaction
  // -----------------------------------------------------------------------

  it('has role="button" and tabIndex=0', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button');
    expect(card).toHaveAttribute('tabindex', '0');
  });

  it('activates on Enter key press', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith(execution);
  });

  it('activates on Space key press', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledWith(execution);
  });

  it('does not activate on other keys', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: 'Tab' });
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not activate when loading', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} loading={true} />
    );

    const card = screen.getByRole('button');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.click(card);
    expect(onClick).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // aria-label
  // -----------------------------------------------------------------------

  it('has aria-label containing execution id and status', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button');
    const label = card.getAttribute('aria-label')!;
    expect(label).toContain('180001');
    expect(label).toContain('success');
  });

  it('includes alert level in aria-label when present and not none', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button');
    expect(card.getAttribute('aria-label')).toContain('alert level high');
  });

  it('omits alert level from aria-label when none', () => {
    const noAlert = createMockYoloExecution({ alertLevel: 'none' });
    renderWithProviders(
      <ImageCard execution={noAlert} onClick={onClick} />
    );

    const card = screen.getByRole('button');
    expect(card.getAttribute('aria-label')).not.toContain('alert level');
  });

  // -----------------------------------------------------------------------
  // focus-visible and CSS transitions
  // -----------------------------------------------------------------------

  it('has focus-visible ring classes instead of focus ring', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button');
    expect(card.className).toContain('focus-visible:ring-2');
    expect(card.className).toContain('outline-none');
  });

  it('uses specific transition properties, not transition-all on card', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const card = screen.getByRole('button');
    expect(card.className).toContain('transition-[box-shadow,border-color]');
    expect(card.className).not.toContain('transition-all');
  });

  it('uses specific transition on img element', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.className).toContain('transition-[opacity,transform]');
    expect(img!.className).not.toContain('transition-all');
  });

  // -----------------------------------------------------------------------
  // aria-hidden on decorative icons
  // -----------------------------------------------------------------------

  it('marks decorative icons with aria-hidden', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const hiddenIcons = document.querySelectorAll('svg[aria-hidden="true"]');
    expect(hiddenIcons.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // img dimensions (layout shift prevention)
  // -----------------------------------------------------------------------

  it('sets width and height on img to prevent layout shift', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const img = document.querySelector('img');
    expect(img).toHaveAttribute('width', '400');
    expect(img).toHaveAttribute('height', '300');
  });

  // -----------------------------------------------------------------------
  // tabular-nums on numeric content
  // -----------------------------------------------------------------------

  it('uses tabular-nums class on confidence percentages', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const tabularElements = document.querySelectorAll('.tabular-nums');
    expect(tabularElements.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Unicode ellipsis
  // -----------------------------------------------------------------------

  it('uses unicode ellipsis in stage1 processing text', () => {
    const stage1 = createMockProcessingExecution('stage1', { hasImage: false });
    renderWithProviders(
      <ImageCard execution={stage1} onClick={onClick} />
    );

    const processingText = screen.getByText(/Processing/);
    expect(processingText.textContent).toContain('\u2026');
    expect(processingText.textContent).not.toContain('...');
  });

  // -----------------------------------------------------------------------
  // Telegram indicator aria-label
  // -----------------------------------------------------------------------

  it('has aria-label on telegram indicator', () => {
    renderWithProviders(
      <ImageCard execution={execution} onClick={onClick} />
    );

    const telegram = document.querySelector('[aria-label="Telegram notification sent"]');
    expect(telegram).not.toBeNull();
  });
});
