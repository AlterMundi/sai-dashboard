import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationOverlay, NotificationData, NotificationAction } from './NotificationOverlay';

// Mock createPortal to render inline (jsdom has no portal target)
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});

function createNotification(
  overrides?: Partial<NotificationData>
): NotificationData {
  return {
    id: 'notif-1',
    type: 'execution:new',
    title: 'Test Notification',
    body: 'Test body text',
    icon: '!',
    actions: [],
    duration: 5000,
    persistent: false,
    timestamp: new Date('2025-10-15T10:00:00Z'),
    ...overrides,
  };
}

describe('NotificationOverlay', () => {
  const onDismiss = vi.fn();
  const onAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  it('returns null when there are no notifications', () => {
    const { container } = render(
      <NotificationOverlay notifications={[]} onDismiss={onDismiss} onAction={onAction} />
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders notification title and body', () => {
    render(
      <NotificationOverlay
        notifications={[createNotification()]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    expect(screen.getByText('Test Notification')).toBeInTheDocument();
    expect(screen.getByText('Test body text')).toBeInTheDocument();
  });

  it('renders at most 5 notifications and shows overflow count', () => {
    const notifications = Array.from({ length: 7 }, (_, i) =>
      createNotification({ id: `notif-${i}`, title: `Notification ${i}` })
    );

    render(
      <NotificationOverlay
        notifications={notifications}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    // First 5 should be visible
    expect(screen.getByText('Notification 0')).toBeInTheDocument();
    expect(screen.getByText('Notification 4')).toBeInTheDocument();

    // Overflow indicator
    expect(screen.getByText(/\+ 2 more notifications/)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // aria-live region
  // -----------------------------------------------------------------------

  it('has role="status" and aria-live="polite" on container', () => {
    render(
      <NotificationOverlay
        notifications={[createNotification()]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    const container = document.querySelector('[role="status"]');
    expect(container).not.toBeNull();
    expect(container).toHaveAttribute('aria-live', 'polite');
    expect(container).toHaveAttribute('aria-atomic', 'false');
  });

  // -----------------------------------------------------------------------
  // Dismiss button accessibility
  // -----------------------------------------------------------------------

  it('dismiss button has aria-label', () => {
    render(
      <NotificationOverlay
        notifications={[createNotification()]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    const dismissBtn = screen.getByRole('button', { name: /Dismiss notification/ });
    expect(dismissBtn).toBeInTheDocument();
  });

  it('dismiss button has focus-visible ring classes', () => {
    render(
      <NotificationOverlay
        notifications={[createNotification()]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    const dismissBtn = screen.getByRole('button', { name: /Dismiss notification/ });
    expect(dismissBtn.className).toContain('focus-visible:ring-2');
    expect(dismissBtn.className).toContain('focus-visible:outline-none');
  });

  it('calls onDismiss when dismiss button is clicked', async () => {
    vi.useFakeTimers();

    render(
      <NotificationOverlay
        notifications={[createNotification()]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    const dismissBtn = screen.getByRole('button', { name: /Dismiss notification/ });
    fireEvent.click(dismissBtn);

    // Exit animation delay (300ms)
    vi.advanceTimersByTime(300);
    expect(onDismiss).toHaveBeenCalledWith('notif-1');

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // aria-hidden on decorative icons
  // -----------------------------------------------------------------------

  it('marks dismiss X icon with aria-hidden', () => {
    render(
      <NotificationOverlay
        notifications={[createNotification()]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    const dismissBtn = screen.getByRole('button', { name: /Dismiss notification/ });
    const icon = dismissBtn.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks action icons with aria-hidden', () => {
    const actions: NotificationAction[] = [
      { label: 'View Details', action: 'view', priority: 'high' },
    ];

    render(
      <NotificationOverlay
        notifications={[createNotification({ actions })]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    const actionBtn = screen.getByRole('button', { name: /View Details/ });
    const icon = actionBtn.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  // -----------------------------------------------------------------------
  // CSS transitions
  // -----------------------------------------------------------------------

  it('uses transition-[transform,opacity] not transition-all', () => {
    render(
      <NotificationOverlay
        notifications={[createNotification()]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    // The animation wrapper div has the transition class
    const animDiv = document.querySelector('.transition-\\[transform\\,opacity\\]');
    expect(animDiv).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Action buttons
  // -----------------------------------------------------------------------

  it('renders action buttons when provided', () => {
    const actions: NotificationAction[] = [
      { label: 'View', action: 'view', priority: 'high' },
      { label: 'Report', action: 'report', priority: 'medium' },
    ];

    render(
      <NotificationOverlay
        notifications={[createNotification({ actions })]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByText('Report')).toBeInTheDocument();
  });

  it('calls onAction when action button is clicked', async () => {
    vi.useFakeTimers();

    const actions: NotificationAction[] = [
      { label: 'View', action: 'view', priority: 'high' },
    ];

    render(
      <NotificationOverlay
        notifications={[createNotification({ actions, data: { executionId: 123 } })]}
        onDismiss={onDismiss}
        onAction={onAction}
      />
    );

    const viewBtn = screen.getByText('View');
    fireEvent.click(viewBtn);

    expect(onAction).toHaveBeenCalledWith('notif-1', 'view', { executionId: 123 });

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Type-specific styling
  // -----------------------------------------------------------------------

  it('applies type-specific border color', () => {
    const types: NotificationData['type'][] = [
      'execution:new',
      'execution:error',
      'execution:batch',
      'system:health',
      'system:stats',
    ];

    types.forEach((type) => {
      const { unmount } = render(
        <NotificationOverlay
          notifications={[createNotification({ type })]}
          onDismiss={onDismiss}
          onAction={onAction}
        />
      );

      const card = document.querySelector('.border-l-4');
      expect(card).not.toBeNull();
      unmount();
    });
  });
});
