import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { useNotifications } from './useNotifications';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <BrowserRouter>{children}</BrowserRouter>;
}

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // createNotification / dismissNotification / clearAll
  // -----------------------------------------------------------------------

  it('creates a notification and returns its id', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    let id: string;
    act(() => {
      id = result.current.createNotification({
        type: 'execution:new',
        title: 'Test',
        body: 'Body',
        icon: '!',
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].id).toBe(id!);
  });

  it('dismisses a notification by id', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    let id: string;
    act(() => {
      id = result.current.createNotification({
        type: 'execution:new',
        title: 'T',
        body: 'B',
        icon: '!',
      });
    });

    act(() => result.current.dismissNotification(id!));
    expect(result.current.notifications).toHaveLength(0);
  });

  it('clearAllNotifications removes everything', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.createNotification({ type: 'execution:new', title: '1', body: '', icon: '' });
      result.current.createNotification({ type: 'execution:error', title: '2', body: '', icon: '' });
    });

    expect(result.current.notifications).toHaveLength(2);

    act(() => result.current.clearAllNotifications());
    expect(result.current.notifications).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // notifyNewExecution (typed payload)
  // -----------------------------------------------------------------------

  it('creates high-risk notification for critical alertLevel', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notifyNewExecution({
        execution: {
          id: 180001,
          analysis: { alertLevel: 'critical', confidenceFire: 0.95, confidenceSmoke: 0 },
        },
      });
    });

    const n = result.current.notifications[0];
    expect(n.title).toBe('High Risk Detection');
    expect(n.persistent).toBe(true);
    expect(n.duration).toBe(10000);
    expect(n.body).toContain('critical');
    expect(n.body).toContain('95%');
  });

  it('creates normal notification for low alertLevel', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notifyNewExecution({
        execution: {
          id: 180002,
          analysis: { alertLevel: 'low', confidenceFire: 0.2, confidenceSmoke: 0.1 },
        },
      });
    });

    const n = result.current.notifications[0];
    expect(n.title).toContain('Analysis Complete');
    expect(n.persistent).toBeFalsy();
    expect(n.duration).toBe(6000);
  });

  it('handles missing analysis fields gracefully', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notifyNewExecution({
        execution: { id: 180003 },
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].body).toContain('none');
  });

  // -----------------------------------------------------------------------
  // notifyBatchComplete (the highRisk ?? 0 fix)
  // -----------------------------------------------------------------------

  it('handles undefined highRisk without crashing', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notifyBatchComplete({ count: 5, successful: 5 });
    });

    const n = result.current.notifications[0];
    expect(n.title).toBe('5 New Executions');
    expect(n.body).not.toContain('high risk');
  });

  it('shows highRisk count when present', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notifyBatchComplete({ count: 10, highRisk: 3, successful: 7 });
    });

    const n = result.current.notifications[0];
    expect(n.body).toContain('3 high risk');
  });

  // -----------------------------------------------------------------------
  // notifyExecutionError (typed payload)
  // -----------------------------------------------------------------------

  it('creates error notification with typed payload', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notifyExecutionError({
        executionId: '180004',
        error: 'YOLO timeout',
      });
    });

    const n = result.current.notifications[0];
    expect(n.type).toBe('execution:error');
    expect(n.body).toBe('YOLO timeout');
    expect(n.title).toContain('180004');
  });

  it('uses fallback message when error is undefined', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notifyExecutionError({ executionId: '180005' });
    });

    expect(result.current.notifications[0].body).toBe('Unknown error occurred');
  });

  // -----------------------------------------------------------------------
  // notifySystemHealth (typed payload)
  // -----------------------------------------------------------------------

  it('skips notification for healthy status', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notifySystemHealth({
        status: 'healthy',
        cpu: 20,
        memory: 40,
        queueSize: 0,
      });
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('creates critical notification for critical status', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.notifySystemHealth({
        status: 'critical',
        cpu: 95,
        memory: 90,
        queueSize: 50,
      });
    });

    const n = result.current.notifications[0];
    expect(n.title).toBe('System Critical');
    expect(n.persistent).toBe(true);
  });

  // -----------------------------------------------------------------------
  // notifySystemStats (typed payload)
  // -----------------------------------------------------------------------

  it('only notifies when success rate drops below 90%', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    // High success rate - should NOT notify
    act(() => {
      result.current.notifySystemStats({
        successRate: 0.95,
        queueSize: 2,
        avgProcessingTime: 1.5,
      });
    });

    expect(result.current.notifications).toHaveLength(0);

    // Low success rate - should notify
    act(() => {
      result.current.notifySystemStats({
        successRate: 0.85,
        queueSize: 10,
        avgProcessingTime: 3.2,
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].body).toContain('85.0%');
  });

  // -----------------------------------------------------------------------
  // handleNotificationAction
  // -----------------------------------------------------------------------

  it('navigates on view action with execution data', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.handleNotificationAction('n1', 'view', {
        execution: { id: 180001 },
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/executions/180001');
  });

  it('does not navigate on view without execution data', () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    act(() => {
      result.current.handleNotificationAction('n1', 'view', {});
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
