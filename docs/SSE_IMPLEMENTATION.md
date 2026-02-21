# Server-Sent Events (SSE) Implementation Guide

## Overview

This document covers the complete implementation of Server-Sent Events (SSE) in the SAI Dashboard, including browser compatibility fixes, nginx proxy configuration, and real-time UI updates.

## SSE Browser Implementation with nginx Proxy Architecture

### Technical Architecture

The SAI Dashboard uses a triangular proxy architecture for SSE:

```
Browser → Public Proxy (sai.altermundi.net) → SSH Tunnel → Local nginx → Node.js API (port 3001)
```

### Critical Implementation Details

#### 1. Browser EventSource Limitations

**Authentication Challenge**: EventSource cannot send custom headers, requiring query parameter authentication:

```javascript
// ❌ This doesn't work
new EventSource('/api/events', {
  headers: { 'Authorization': 'Bearer token123' }
});

// ✅ This works
const token = getAuthToken();
new EventSource(`/api/events?token=${token}`);
```

**HTTP/2 Compatibility Issues**: Modern browsers default to HTTP/2, which causes SSE connection failures:
- HTTP/2 stream multiplexing interferes with persistent SSE connections
- Flow control mechanisms can buffer SSE data
- Solution: Force HTTP/1.1 for SSE endpoints

#### 2. Backend SSE Controller Implementation

```javascript
export const connectSSE = async (req, res) => {
  // Set proper SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': req.get('origin'),
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });

  // CRITICAL: Send initial data to trigger browser onopen event
  res.write('data: \n\n');
  res.flush?.(); // Force immediate response flush
  
  // Add client to SSE manager
  const clientId = sseManager.addClient(res, req.user?.id);
  
  // Send welcome message
  sseManager.sendToClient(clientId, {
    type: 'connection',
    data: {
      clientId,
      timestamp: new Date().toISOString(),
      message: 'Connected to SAI Dashboard real-time updates'
    }
  });
};
```

#### 3. nginx Configuration for SSE

**Public Proxy Configuration** (`sai-altermundi-net.conf`):

```nginx
# Special handling for SSE events endpoint
location /dashboard/api/events {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Critical SSE configuration
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_set_header Cache-Control 'no-cache';
    proxy_set_header X-Accel-Buffering 'no';
    
    # Disable compression for SSE streaming
    gzip off;
    
    # Extended timeouts for long-lived connections
    proxy_connect_timeout 30s;
    proxy_send_timeout 24h;
    proxy_read_timeout 24h;
    proxy_ignore_client_abort on;
    
    # CORS for SSE
    add_header Access-Control-Allow-Origin $http_origin always;
    add_header Access-Control-Allow-Credentials 'true' always;
}
```

#### 4. Frontend SSE Context Implementation

**SSE Context Provider** (`frontend/src/contexts/SSEContext.tsx`):

```typescript
export function SSEProvider({ children }: SSEProviderProps) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const isConnectingRef = useRef(false);
  
  const connect = useCallback(async () => {
    if (isConnectingRef.current || eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }
    
    try {
      isConnectingRef.current = true;
      const token = await getValidToken();
      
      const url = new URL('/dashboard/api/events', window.location.origin);
      url.searchParams.set('token', token);
      
      const eventSource = new EventSource(url.toString());
      
      eventSource.onopen = () => {
        console.log('✅ SSE Connection established');
        setConnectionStatus('connected');
        setIsConnected(true);
      };
      
      eventSource.onerror = (error) => {
        console.error('❌ SSE Connection error:', error);
        setConnectionStatus('error');
        setIsConnected(false);
      };
      
      eventSourceRef.current = eventSource;
      
    } catch (error) {
      console.error('Failed to create SSE connection:', error);
      setConnectionStatus('error');
    } finally {
      isConnectingRef.current = false;
    }
  }, []);
}
```

## Key Fixes and Solutions

### 1. Middleware Ordering Bug

**Problem**: Global authentication middleware was overriding SSE custom authentication.

**Solution**: Move SSE routes before global auth middleware:

```javascript
// SSE Events (must come BEFORE global auth middleware to use custom auth)
router.use('/events', sseRouter);

// All main routes require authentication
router.use(authenticateToken);
router.use(requireAuth);
```

### 2. Browser readyState Transition Issue

**Problem**: EventSource stuck at readyState 0 (CONNECTING), never transitioning to readyState 1 (OPEN).

**Solution**: Add `res.flush()` to force immediate response:

```javascript
// Send initial data to trigger browser onopen event
res.write('data: \n\n');
res.flush?.(); // Force immediate response flush
```

### 3. HTTP/2 Compatibility

**Problem**: nginx serving SSE over HTTP/2 causes browser compatibility issues.

**Solution**: Configure nginx to force HTTP/1.1 for SSE endpoints (note: `http2_push off;` is insufficient, requires proper HTTP/1.1 configuration).

### 4. JSON Parsing Errors

**Problem**: Initial empty SSE messages cause JSON parsing errors in frontend.

**Solution**: Skip empty data messages:

```javascript
eventSource.onmessage = (event) => {
  // Skip empty data messages (initial SSE connection messages)
  if (!event.data || event.data.trim() === '') {
    console.log('SSE: Received keepalive message');
    return;
  }
  
  try {
    const data = JSON.parse(event.data);
    // Process valid data
  } catch (error) {
    console.warn('Failed to parse SSE message:', error);
  }
};
```

## Troubleshooting Guide

### Common Issues

1. **EventSource readyState stuck at 0**
   - Check if `res.flush()` is called after initial data
   - Verify nginx buffering is disabled
   - Ensure proper SSE headers are set

2. **Authentication failures**
   - Confirm token is passed via query parameter
   - Check middleware ordering
   - Verify token hasn't expired

3. **HTTP/2 related failures**
   - Force HTTP/1.1 for SSE endpoints
   - Check browser network tab for protocol version
   - Consider separate server block for SSE

4. **CORS issues**
   - Set proper CORS headers at proxy level
   - Handle OPTIONS preflight requests
   - Verify origin headers match

### Debugging Commands

```bash
# Check SSE connections in logs
docker logs --since 5m sai-dashboard 2>&1 | grep "SSE client"

# Test SSE endpoint directly
curl -N "https://sai.altermundi.net/dashboard/api/events?token=YOUR_TOKEN"

# Monitor nginx access logs
sudo tail -f /var/log/nginx/access.log | grep events
```

## Performance Considerations

- **Connection Limits**: Browsers limit SSE connections per domain (typically 6)
- **Memory Usage**: Each SSE connection consumes server memory
- **Heartbeat Management**: Implement periodic heartbeat to detect stale connections
- **Graceful Shutdown**: Properly close all SSE connections on server shutdown

## Status: WORKING ✅

As of 2025-08-31, the SSE implementation is fully functional:
- ✅ Browser EventSource successfully connects (readyState transitions 0 → 1)
- ✅ Authentication working via query parameters
- ✅ nginx proxy configuration optimized for SSE
- ✅ Real-time events flowing from backend to frontend
- ✅ Proper error handling and reconnection logic

The SAI Dashboard now supports real-time updates for new execution notifications, system status changes, and other live data streams.