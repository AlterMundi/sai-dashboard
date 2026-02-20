import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { sseApi } from '@/services/api';
import {
  UseSSEReturn,
  SSEExecutionEvent,
  SSEHeartbeatEvent,
  SSEConnectionEvent,
  SSEStage2CompletionEvent,
  SSEStage2FailureEvent,
  SSEEtlStatusEvent
} from '@/types';
import toast from 'react-hot-toast';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationOverlay } from '@/components/notifications/NotificationOverlay';

// Create the SSE Context
const SSEContext = createContext<UseSSEReturn | null>(null);

interface SSEProviderProps {
  children: ReactNode;
}

export function SSEProvider({ children }: SSEProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastEvent, setLastEvent] = useState<{ type: string; data: unknown; timestamp: Date } | null>(null);
  const [clientCount, setClientCount] = useState(0);
  const [liveStats, setLiveStats] = useState<any>(null);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const connectionIdRef = useRef(0);
  const isConnectingRef = useRef(false);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // 1 second

  // Notification system
  const {
    notifications,
    dismissNotification,
    handleNotificationAction,
    notifyNewExecution,
    notifyExecutionError,
    notifyBatchComplete,
    notifySystemHealth,
    notifySystemStats
  } = useNotifications();

  // Stable refs for notification functions used inside connect()
  const notifyNewExecutionRef = useRef(notifyNewExecution);
  const notifyExecutionErrorRef = useRef(notifyExecutionError);
  const notifyBatchCompleteRef = useRef(notifyBatchComplete);
  const notifySystemHealthRef = useRef(notifySystemHealth);
  const notifySystemStatsRef = useRef(notifySystemStats);
  const fallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs current
  notifyNewExecutionRef.current = notifyNewExecution;
  notifyExecutionErrorRef.current = notifyExecutionError;
  notifyBatchCompleteRef.current = notifyBatchComplete;
  notifySystemHealthRef.current = notifySystemHealth;
  notifySystemStatsRef.current = notifySystemStats;

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (fallbackTimeoutRef.current) {
      clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    isConnectingRef.current = false;
  }, []);

  const connect = useCallback(() => {
    // Prevent concurrent connection attempts
    if (isConnectingRef.current) {
      return;
    }
    
    // Don't create multiple connections - be more strict
    if (eventSourceRef.current) {
      if (eventSourceRef.current.readyState === EventSource.CONNECTING || eventSourceRef.current.readyState === EventSource.OPEN) {
        return;
      }
      // Only cleanup if it's closed
      if (eventSourceRef.current.readyState === EventSource.CLOSED) {
        eventSourceRef.current = null;
      }
    }
    
    isConnectingRef.current = true;
    setConnectionStatus('connecting');
    
    try {
      connectionIdRef.current += 1;
      const connectionId = connectionIdRef.current;
      const eventSource = sseApi.createEventSource();
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttempts.current = 0;
        isConnectingRef.current = false;
      };

      // Fallback: Check connection after 10 seconds if onopen hasn't fired
      fallbackTimeoutRef.current = setTimeout(() => {
        if (eventSource.readyState === EventSource.OPEN) {
          setIsConnected(true);
          setConnectionStatus('connected');
          reconnectAttempts.current = 0;
          isConnectingRef.current = false;
        } else if (eventSource.readyState === EventSource.CLOSED) {
          isConnectingRef.current = false;
        }
      }, 10000);

      eventSource.onerror = (error) => {
        console.error(`❌ SSE Context: Connection #${connectionId} error:`, error);
        console.error(`❌ SSE Context: EventSource #${connectionId} readyState:`, eventSource.readyState);
        console.error(`❌ SSE Context: EventSource #${connectionId} URL:`, eventSource.url);
        setIsConnected(false);
        isConnectingRef.current = false; // Connection attempt failed
        
        if (eventSource.readyState === EventSource.CLOSED) {
          setConnectionStatus('disconnected');
          
          // Attempt reconnection with exponential backoff
          if (reconnectAttempts.current < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts.current);
            reconnectAttempts.current += 1;
            
            
            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, delay);
          } else {
            setConnectionStatus('error');
            toast.error('Real-time connection failed. Please refresh the page.');
          }
        } else {
          setConnectionStatus('error');
        }
      };

      // Helper: defer processing so the EventSource message handler returns
      // immediately, preventing main-thread violations and input lag.
      const defer = (fn: () => void) => setTimeout(fn, 0);

      // Connection event
      eventSource.addEventListener('connection', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data: SSEConnectionEvent = JSON.parse(raw);
          setLastEvent({ type: 'connection', data, timestamp: new Date() });
          if (data.message === 'Connected to SAI Dashboard real-time updates') {
            setIsConnected(true);
            setConnectionStatus('connected');
            reconnectAttempts.current = 0;
          }
        } catch (e) { console.warn('SSE Context: Failed to parse connection event:', e); } });
      });

      // New execution event
      eventSource.addEventListener('execution:new', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data: SSEExecutionEvent = JSON.parse(raw);
          setLastEvent({ type: 'execution:new', data, timestamp: new Date() });
          notifyNewExecutionRef.current(data);
        } catch (e) { console.warn('SSE Context: Failed to parse execution:new event:', e); } });
      });

      // Execution error event
      eventSource.addEventListener('execution:error', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data = JSON.parse(raw);
          setLastEvent({ type: 'execution:error', data, timestamp: new Date() });
          notifyExecutionErrorRef.current(data);
        } catch (e) { console.warn('SSE Context: Failed to parse execution:error event:', e); } });
      });

      // Heartbeat event
      eventSource.addEventListener('heartbeat', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data: SSEHeartbeatEvent = JSON.parse(raw);
          setClientCount(data.clients);
          setLastEvent({ type: 'heartbeat', data, timestamp: new Date() });
        } catch (e) { console.warn('SSE Context: Failed to parse heartbeat event:', e); } });
      });

      // System statistics event
      eventSource.addEventListener('system:stats', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data = JSON.parse(raw);
          setLastEvent({ type: 'system:stats', data, timestamp: new Date() });
          setLiveStats(data);
          notifySystemStatsRef.current(data);
        } catch (e) { console.warn('SSE Context: Failed to parse system:stats event:', e); } });
      });

      // System health event
      eventSource.addEventListener('system:health', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data = JSON.parse(raw);
          setLastEvent({ type: 'system:health', data, timestamp: new Date() });
          setSystemHealth(data);
          notifySystemHealthRef.current(data);
        } catch (e) { console.warn('SSE Context: Failed to parse system:health event:', e); } });
      });

      // Batch completion event
      eventSource.addEventListener('execution:batch', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data = JSON.parse(raw);
          setLastEvent({ type: 'execution:batch', data, timestamp: new Date() });
          notifyBatchCompleteRef.current(data);
        } catch (e) { console.warn('❌ SSE Context: Failed to parse execution:batch event:', e); } });
      });

      // Execution progress event
      eventSource.addEventListener('execution:progress', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data = JSON.parse(raw);
          setLastEvent({ type: 'execution:progress', data, timestamp: new Date() });
        } catch (e) { console.warn('SSE Context: Failed to parse execution:progress event:', e); } });
      });

      // Stage 2 completion event
      eventSource.addEventListener('etl:stage2:complete', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data: SSEStage2CompletionEvent = JSON.parse(raw);
          setLastEvent({ type: 'etl:stage2:complete', data, timestamp: new Date() });
        } catch (e) { console.warn('SSE Context: Failed to parse etl:stage2:complete event:', e); } });
      });

      // Stage 2 failure event
      eventSource.addEventListener('etl:stage2:failed', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data: SSEStage2FailureEvent = JSON.parse(raw);
          setLastEvent({ type: 'etl:stage2:failed', data, timestamp: new Date() });
        } catch (e) { console.warn('SSE Context: Failed to parse etl:stage2:failed event:', e); } });
      });

      // ETL status event
      eventSource.addEventListener('etl:status', (event) => {
        const raw = event.data;
        defer(() => { try {
          const data: SSEEtlStatusEvent = JSON.parse(raw);
          setLastEvent({ type: 'etl:status', data, timestamp: new Date() });
        } catch (e) { console.warn('SSE Context: Failed to parse etl:status event:', e); } });
      });

      // Generic message handler (fallback)
      eventSource.onmessage = (event) => {
        const raw = event.data;
        if (!raw || raw.trim() === '') return;
        defer(() => { try {
          const data = JSON.parse(raw);
          setLastEvent({ type: 'message', data, timestamp: new Date() });
        } catch (e) { console.warn('SSE Context: Failed to parse message:', e); } });
      };

    } catch (error) {
      console.error('SSE Context: Failed to create SSE connection:', error);
      setConnectionStatus('error');
      setIsConnected(false);
      isConnectingRef.current = false; // Connection attempt failed
    }
  }, []);

  // Initialize connection on mount
  useEffect(() => {
    connect();

    // Cleanup on unmount
    return () => {
      cleanup();
    };
  }, [connect, cleanup]);


  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => {
      connect();
    };

    const handleOffline = () => {
      cleanup();
      setConnectionStatus('disconnected');
      setIsConnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [connect, cleanup]);

  const contextValue: UseSSEReturn = {
    isConnected,
    lastEvent,
    connectionStatus,
    clientCount,
    liveStats,
    systemHealth,
    connect,
    disconnect: cleanup,
  };

  return (
    <SSEContext.Provider value={contextValue}>
      {children}
      <div aria-live="polite" aria-atomic="false">
        <NotificationOverlay
          notifications={notifications}
          onDismiss={dismissNotification}
          onAction={handleNotificationAction}
        />
      </div>
    </SSEContext.Provider>
  );
}

// Hook to use the SSE Context
export function useSSE(): UseSSEReturn {
  const context = useContext(SSEContext);
  if (!context) {
    throw new Error('useSSE must be used within an SSEProvider');
  }
  return context;
}

// Hook for handling SSE events with custom handlers
export function useSSEHandler(handlers: {
  onNewExecution?: (data: SSEExecutionEvent) => void;
  onExecutionError?: (data: any) => void;
  onExecutionBatch?: (data: any) => void;
  onConnection?: (data: SSEConnectionEvent) => void;
  onHeartbeat?: (data: SSEHeartbeatEvent) => void;
  onStage2Complete?: (data: SSEStage2CompletionEvent) => void;
  onStage2Failure?: (data: SSEStage2FailureEvent) => void;
  onEtlStatus?: (data: SSEEtlStatusEvent) => void;
}) {
  const { lastEvent, ...sseState } = useSSE();

  useEffect(() => {
    if (!lastEvent) return;

    switch (lastEvent.type) {
      case 'execution:new':
        handlers.onNewExecution?.(lastEvent.data as SSEExecutionEvent);
        break;
      case 'execution:error':
        handlers.onExecutionError?.(lastEvent.data);
        break;
      case 'execution:batch':
        handlers.onExecutionBatch?.(lastEvent.data);
        break;
      case 'connection':
        handlers.onConnection?.(lastEvent.data as SSEConnectionEvent);
        break;
      case 'heartbeat':
        handlers.onHeartbeat?.(lastEvent.data as SSEHeartbeatEvent);
        break;
      case 'etl:stage2:complete':
        handlers.onStage2Complete?.(lastEvent.data as SSEStage2CompletionEvent);
        break;
      case 'etl:stage2:failed':
        handlers.onStage2Failure?.(lastEvent.data as SSEStage2FailureEvent);
        break;
      case 'etl:status':
        handlers.onEtlStatus?.(lastEvent.data as SSEEtlStatusEvent);
        break;
    }
  }, [lastEvent, handlers]);

  return {
    ...sseState,
    lastEvent,
  };
}