import { useState, useEffect, useRef, useCallback } from 'react';
import { sseApi } from '@/services/api';
import { UseSSEReturn, SSEExecutionEvent, SSEHeartbeatEvent, SSEConnectionEvent } from '@/types';
import toast from 'react-hot-toast';

export function useSSE(): UseSSEReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastEvent, setLastEvent] = useState<any>(null);
  const [clientCount, setClientCount] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef(0);
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
  }, []);

  const connect = useCallback(() => {
    // Don't create multiple connections
    if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
      return;
    }

    setConnectionStatus('connecting');
    
    try {
      const eventSource = sseApi.createEventSource();
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('SSE connection opened');
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttempts.current = 0; // Reset reconnect attempts on successful connection
      };

      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        setIsConnected(false);
        
        if (eventSource.readyState === EventSource.CLOSED) {
          setConnectionStatus('disconnected');
          
          // Attempt reconnection with exponential backoff
          if (reconnectAttempts.current < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts.current);
            reconnectAttempts.current += 1;
            
            console.log(`Attempting to reconnect SSE in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`);
            
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
          console.log('SSE connection event:', data);
          setLastEvent({ type: 'connection', data, timestamp: new Date() });
          
          if (data.message === 'Connected to SAI Dashboard real-time updates') {
            toast.success('Real-time updates connected', { duration: 2000 });
          }
        } catch (error) {
          console.warn('Failed to parse connection event:', error);
        }
      });

      // New execution event
      eventSource.addEventListener('execution:new', (event) => {
        try {
          const data: SSEExecutionEvent = JSON.parse(event.data);
          console.log('New execution received:', data.execution.id);
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
          console.warn('Failed to parse execution:new event:', error);
        }
      });

      // Execution error event
      eventSource.addEventListener('execution:error', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Execution error received:', data.executionId);
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
          console.warn('Failed to parse execution:error event:', error);
        }
      });

      // Heartbeat event
      eventSource.addEventListener('heartbeat', (event) => {
        try {
          const data: SSEHeartbeatEvent = JSON.parse(event.data);
          setClientCount(data.clients);
          setLastEvent({ type: 'heartbeat', data, timestamp: new Date() });
          console.debug('SSE heartbeat:', data);
        } catch (error) {
          console.warn('Failed to parse heartbeat event:', error);
        }
      });

      // Generic message handler (fallback)
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('SSE generic message:', data);
          setLastEvent({ type: 'message', data, timestamp: new Date() });
        } catch (error) {
          console.warn('Failed to parse generic SSE message:', error);
        }
      };

    } catch (error) {
      console.error('Failed to create SSE connection:', error);
      setConnectionStatus('error');
      setIsConnected(false);
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

  // Handle visibility change (reconnect when tab becomes visible)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden, close connection to save resources
        if (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.OPEN) {
          console.log('Tab hidden, closing SSE connection');
          eventSourceRef.current.close();
        }
      } else {
        // Tab is visible, reconnect if needed
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
          console.log('Tab visible, reconnecting SSE');
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
      console.log('Browser online, attempting SSE reconnection');
      connect();
    };

    const handleOffline = () => {
      console.log('Browser offline, closing SSE connection');
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

  return {
    isConnected,
    lastEvent,
    connectionStatus,
    clientCount,
    connect,
  };
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