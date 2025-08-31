import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { sseApi } from '@/services/api';
import { UseSSEReturn, SSEExecutionEvent, SSEHeartbeatEvent, SSEConnectionEvent } from '@/types';
import toast from 'react-hot-toast';

// Create the SSE Context
const SSEContext = createContext<UseSSEReturn | null>(null);

interface SSEProviderProps {
  children: ReactNode;
}

export function SSEProvider({ children }: SSEProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastEvent, setLastEvent] = useState<any>(null);
  const [clientCount, setClientCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef(0);
  const connectionIdRef = useRef(0);
  const isConnectingRef = useRef(false);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // 1 second

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    isConnectingRef.current = false;
  }, []);

  const connect = useCallback(() => {
    // Prevent concurrent connection attempts
    if (isConnectingRef.current) {
      console.log('🚫 SSE Context: Connection already in progress, skipping');
      return;
    }
    
    // Don't create multiple connections - be more strict
    if (eventSourceRef.current) {
      if (eventSourceRef.current.readyState === EventSource.CONNECTING || eventSourceRef.current.readyState === EventSource.OPEN) {
        console.log('🚫 SSE Context: EventSource already exists and active, readyState:', eventSourceRef.current.readyState);
        return;
      }
      // Only cleanup if it's closed
      if (eventSourceRef.current.readyState === EventSource.CLOSED) {
        console.log('🗑️ SSE Context: Cleaning up closed EventSource');
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

      console.log(`🔌 SSE Context: Creating EventSource #${connectionId}:`, eventSource.url);
      console.log(`🔌 SSE Context: Initial readyState #${connectionId}:`, eventSource.readyState);
      
      // Monitor readyState changes every second for debugging
      const readyStateMonitor = setInterval(() => {
        console.log(`🔍 SSE Context: EventSource #${connectionId} readyState check:`, {
          readyState: eventSource.readyState,
          url: eventSource.url,
          timestamp: new Date().toISOString()
        });
        
        // Stop monitoring if connection opened or closed
        if (eventSource.readyState !== EventSource.CONNECTING) {
          clearInterval(readyStateMonitor);
        }
      }, 1000);

      eventSource.onopen = () => {
        console.log(`✅ SSE Context: Connection #${connectionId} opened - onopen fired!`);
        console.log(`✅ SSE Context: EventSource #${connectionId} readyState:`, eventSource.readyState);
        console.log(`✅ SSE Context: EventSource #${connectionId} URL:`, eventSource.url);
        console.log(`✅ SSE Context: EventSource #${connectionId} withCredentials:`, eventSource.withCredentials);
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttempts.current = 0; // Reset reconnect attempts on successful connection
        isConnectingRef.current = false; // Connection attempt completed
      };

      // Fallback: Check connection after 3 seconds if onopen hasn't fired
      setTimeout(() => {
        if (eventSource.readyState === EventSource.OPEN) {
          console.log('SSE Context: Connection established via fallback check');
          setIsConnected(true);
          setConnectionStatus('connected');
          reconnectAttempts.current = 0;
          isConnectingRef.current = false; // Connection attempt completed
        } else if (eventSource.readyState === EventSource.CLOSED) {
          console.log('SSE Context: Connection failed - EventSource closed during fallback check');
          isConnectingRef.current = false; // Connection attempt failed
        }
      }, 3000);

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
            
            console.log(`SSE Context: Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, delay) as unknown as number;
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
          console.log('SSE Context: Connection event:', data);
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
          console.log('SSE Context: New execution received:', data.execution.id);
          setLastEvent({ type: 'execution:new', data, timestamp: new Date() });
          
          // Show notification for new successful executions
          toast.success(
            `New analysis completed: ${data.execution.id.slice(-8)}`,
            {
              duration: 4000,
              icon: '🔍',
            }
          );
        } catch (error) {
          console.warn('SSE Context: Failed to parse execution:new event:', error);
        }
      });

      // Execution error event
      eventSource.addEventListener('execution:error', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('SSE Context: Execution error received:', data.executionId);
          setLastEvent({ type: 'execution:error', data, timestamp: new Date() });
          
          // Show error notification
          toast.error(
            `Execution failed: ${data.executionId.slice(-8)}`,
            {
              duration: 5000,
              icon: '⚠️',
            }
          );
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
          console.debug('SSE Context: Heartbeat:', data);
        } catch (error) {
          console.warn('SSE Context: Failed to parse heartbeat event:', error);
        }
      });

      // Generic message handler (fallback)
      eventSource.onmessage = (event) => {
        try {
          // Skip empty data messages (initial SSE connection messages)
          if (!event.data || event.data.trim() === '') {
            console.log('SSE Context: Received empty data message (connection keepalive)');
            return;
          }
          
          const data = JSON.parse(event.data);
          console.log('SSE Context: Generic message:', data);
          setLastEvent({ type: 'message', data, timestamp: new Date() });
        } catch (error) {
          console.warn('SSE Context: Failed to parse SSE message:', error, 'Raw data:', event.data);
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
    console.log('🚀 SSE Context: Provider mounted, initializing connection');
    connect();

    // Cleanup on unmount
    return () => {
      console.log('🔌 SSE Context: Provider unmounting, cleaning up');
      cleanup();
    };
  }, [connect, cleanup]);

  // Handle visibility change (reconnect when tab becomes visible)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden, close connection to save resources
        if (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.OPEN) {
          console.log('SSE Context: Tab hidden, closing connection');
          eventSourceRef.current.close();
        }
      } else {
        // Tab is visible, reconnect if needed
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
          console.log('SSE Context: Tab visible, reconnecting');
          setTimeout(connect, 100); // Small delay to ensure tab is fully visible
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [connect]);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => {
      console.log('SSE Context: Browser online, attempting reconnection');
      connect();
    };

    const handleOffline = () => {
      console.log('SSE Context: Browser offline, closing connection');
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
    connect,
  };

  return <SSEContext.Provider value={contextValue}>{children}</SSEContext.Provider>;
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
  onConnection?: (data: SSEConnectionEvent) => void;
  onHeartbeat?: (data: SSEHeartbeatEvent) => void;
}) {
  const { lastEvent, ...sseState } = useSSE();

  useEffect(() => {
    if (!lastEvent) return;

    switch (lastEvent.type) {
      case 'execution:new':
        handlers.onNewExecution?.(lastEvent.data);
        break;
      case 'execution:error':
        handlers.onExecutionError?.(lastEvent.data);
        break;
      case 'connection':
        handlers.onConnection?.(lastEvent.data);
        break;
      case 'heartbeat':
        handlers.onHeartbeat?.(lastEvent.data);
        break;
    }
  }, [lastEvent, handlers]);

  return {
    ...sseState,
    lastEvent,
  };
}