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

      // Connection event
      eventSource.addEventListener('connection', (event) => {
        try {
          const data: SSEConnectionEvent = JSON.parse(event.data);
          setLastEvent({ type: 'connection', data, timestamp: new Date() });
          
          // Set connected state when we receive the connection event
          if (data.message === 'Connected to SAI Dashboard real-time updates') {
            setIsConnected(true);
            setConnectionStatus('connected');
            reconnectAttempts.current = 0;
            toast.success('Real-time updates connected', { duration: 2000 });
          }
        } catch (error) {
          console.warn('SSE Context: Failed to parse connection event:', error);
        }
      });

      // New execution event
      eventSource.addEventListener('execution:new', (event) => {
        try {
          const data: SSEExecutionEvent = JSON.parse(event.data);
          const newEvent = { type: 'execution:new', data, timestamp: new Date() };
          setLastEvent(newEvent);
          
          // Events are handled through useSSEHandler hook
          
          // Use smart notification system instead of basic toast
          notifyNewExecutionRef.current(data);
        } catch (error) {
          console.warn('SSE Context: Failed to parse execution:new event:', error);
        }
      });

      // Execution error event
      eventSource.addEventListener('execution:error', (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastEvent({ type: 'execution:error', data, timestamp: new Date() });
          
          // Use smart notification system
          notifyExecutionErrorRef.current(data);
        } catch (error) {
          console.warn('SSE Context: Failed to parse execution:error event:', error);
        }
      });

      // Heartbeat event
      eventSource.addEventListener('heartbeat', (event) => {
        try {
          const data: SSEHeartbeatEvent = JSON.parse(event.data);
          setClientCount(data.clients);
          setLastEvent({ type: 'heartbeat', data, timestamp: new Date() });
        } catch (error) {
          console.warn('SSE Context: Failed to parse heartbeat event:', error);
        }
      });

      // System statistics event
      eventSource.addEventListener('system:stats', (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastEvent({ type: 'system:stats', data, timestamp: new Date() });
          setLiveStats(data);
          
          // Events are captured directly via lastEvent state
          
          // Smart notification for significant stats changes
          notifySystemStatsRef.current(data);
        } catch (error) {
          console.warn('SSE Context: Failed to parse system:stats event:', error);
        }
      });

      // System health event
      eventSource.addEventListener('system:health', (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastEvent({ type: 'system:health', data, timestamp: new Date() });
          setSystemHealth(data);
          
          // Events are captured directly via lastEvent state
          
          // Smart notification for health issues
          notifySystemHealthRef.current(data);
        } catch (error) {
          console.warn('SSE Context: Failed to parse system:health event:', error);
        }
      });

      // Batch completion event
      eventSource.addEventListener('execution:batch', (event) => {
        try {
          const data = JSON.parse(event.data);
          const batchEvent = { type: 'execution:batch', data, timestamp: new Date() };
          setLastEvent(batchEvent);
          
          // Events are handled through useSSEHandler hook
          
          // Smart notification for batch completion
          notifyBatchCompleteRef.current(data);
        } catch (error) {
          console.warn('❌ SSE Context: Failed to parse execution:batch event:', error);
        }
      });

      // Execution progress event
      eventSource.addEventListener('execution:progress', (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastEvent({ type: 'execution:progress', data, timestamp: new Date() });

          // Could trigger progress UI updates here
        } catch (error) {
          console.warn('SSE Context: Failed to parse execution:progress event:', error);
        }
      });

      // Stage 2 completion event
      eventSource.addEventListener('etl:stage2:complete', (event) => {
        try {
          const data: SSEStage2CompletionEvent = JSON.parse(event.data);
          setLastEvent({ type: 'etl:stage2:complete', data, timestamp: new Date() });

          // Events are handled through useSSEHandler hook
        } catch (error) {
          console.warn('SSE Context: Failed to parse etl:stage2:complete event:', error);
        }
      });

      // Stage 2 failure event
      eventSource.addEventListener('etl:stage2:failed', (event) => {
        try {
          const data: SSEStage2FailureEvent = JSON.parse(event.data);
          setLastEvent({ type: 'etl:stage2:failed', data, timestamp: new Date() });

          // Events are handled through useSSEHandler hook
        } catch (error) {
          console.warn('SSE Context: Failed to parse etl:stage2:failed event:', error);
        }
      });

      // ETL status event
      eventSource.addEventListener('etl:status', (event) => {
        try {
          const data: SSEEtlStatusEvent = JSON.parse(event.data);
          setLastEvent({ type: 'etl:status', data, timestamp: new Date() });

          // Events are handled through useSSEHandler hook
        } catch (error) {
          console.warn('SSE Context: Failed to parse etl:status event:', error);
        }
      });

      // Generic message handler (fallback)
      eventSource.onmessage = (event) => {
        try {
          // Skip empty data messages (connection keepalive)
          if (!event.data || event.data.trim() === '') {
            return;
          }
          
          const data = JSON.parse(event.data);
          setLastEvent({ type: 'message', data, timestamp: new Date() });
          
          // Generic messages handled through lastEvent state
        } catch (error) {
          console.warn('SSE Context: Failed to parse message:', error);
        }
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