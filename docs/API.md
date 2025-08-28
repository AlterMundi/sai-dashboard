# SAI Dashboard - API Documentation

**REST API specification for the SAI Image Analysis Dashboard**

---

## 🌐 API Overview

### Base Information
- **Base URL**: `http://localhost:3001/api` (development)
- **Production URL**: `https://sai-dashboard.local/api`
- **API Version**: v1
- **Content Type**: `application/json`
- **Authentication**: Optional (Bearer token or API key)

### Response Format
All API responses follow this standard format:
```json
{
  "data": {}, // Response data
  "meta": {   // Metadata (optional)
    "pagination": {},
    "filters": {},
    "timestamp": "2025-08-28T12:34:56Z"
  },
  "error": null  // Error information (if applicable)
}
```

---

## 🔍 Execution Endpoints

### GET /api/executions
Retrieve paginated list of workflow executions.

**Query Parameters:**
- `limit` (integer, optional): Number of results per page (default: 50, max: 200)
- `offset` (integer, optional): Number of results to skip (default: 0)
- `status` (string, optional): Filter by execution status (`success`, `error`, `canceled`, `running`)
- `days` (integer, optional): Number of days to look back (default: 30, max: 365)
- `search` (string, optional): Search term for filtering

**Example Request:**
```bash
curl "http://localhost:3001/api/executions?limit=20&status=success&days=7"
```

**Response:**
```json
{
  "data": [
    {
      "id": 4893,
      "status": "success",
      "startedAt": "2025-08-27T12:55:57.601Z",
      "stoppedAt": "2025-08-27T12:55:59.234Z", 
      "duration": 1.633,
      "imageData": "iVBORw0KGgoAAAANSUhEUgAA...", // base64 string
      "ollamaResult": {
        "response": "RISK_LEVEL: LOW\nConfidence: 0.89\nDescription: Normal scene",
        "model": "qwen2.5vl:7b",
        "created_at": "2025-08-27T12:55:59.100Z"
      },
      "telegramStatus": {
        "success": true,
        "message_id": 12345,
        "chat": {"id": -4768100208, "type": "supergroup"}
      }
    }
  ],
  "meta": {
    "pagination": {
      "limit": 20,
      "offset": 0,
      "total": 4893,
      "hasMore": true
    },
    "filters": {
      "status": "success",
      "days": 7
    }
  }
}
```

**Status Codes:**
- `200 OK`: Successfully retrieved executions
- `400 Bad Request`: Invalid query parameters
- `500 Internal Server Error`: Database or server error

---

### GET /api/executions/{id}
Retrieve detailed information for a specific execution.

**Path Parameters:**
- `id` (integer): Execution ID

**Example Request:**
```bash
curl "http://localhost:3001/api/executions/4893"
```

**Response:**
```json
{
  "data": {
    "id": 4893,
    "status": "success",
    "startedAt": "2025-08-27T12:55:57.601Z",
    "stoppedAt": "2025-08-27T12:55:59.234Z",
    "duration": 1.633,
    "imageData": "iVBORw0KGgoAAAANSUhEUgAA...",
    "ollamaResult": {
      "response": "RISK_LEVEL: LOW\nConfidence: 0.89\nDescription: Normal scene with no apparent risks detected.",
      "model": "qwen2.5vl:7b",
      "context": [1, 2, 3, ...],
      "created_at": "2025-08-27T12:55:59.100Z",
      "done": true,
      "total_duration": 1633542917,
      "load_duration": 234567,
      "prompt_eval_count": 15,
      "eval_count": 42,
      "eval_duration": 876543210
    },
    "telegramStatus": {
      "success": true,
      "message_id": 12345,
      "chat": {
        "id": -4768100208,
        "title": "SAI Alerts",
        "type": "supergroup"
      },
      "date": 1724857234,
      "photo": [
        {
          "file_id": "AgACAgIAAxkBAAIC...",
          "file_unique_id": "AQADyA0AAlJx...",
          "width": 1024,
          "height": 768,
          "file_size": 89234
        }
      ]
    },
    "payload": {
      // Complete execution payload (large object)
      "nodeInputData": {...},
      "nodeOutputData": {...}
    },
    "workflowData": {
      // Workflow definition at execution time
      "nodes": [...],
      "connections": {...}
    }
  }
}
```

**Status Codes:**
- `200 OK`: Successfully retrieved execution
- `404 Not Found`: Execution not found
- `500 Internal Server Error`: Database or server error

---

### GET /api/executions/{id}/image
Serve the image file associated with an execution.

**Path Parameters:**
- `id` (integer): Execution ID

**Query Parameters:**
- `format` (string, optional): Image format (`jpeg`, `png`, `webp`) - default: `jpeg`
- `size` (string, optional): Image size (`thumbnail`, `medium`, `full`) - default: `full`

**Example Request:**
```bash
curl "http://localhost:3001/api/executions/4893/image?size=medium" \
  --output execution_4893.jpg
```

**Response:**
- **Content-Type**: `image/jpeg`, `image/png`, etc.
- **Content-Length**: Size in bytes
- **Cache-Control**: `public, max-age=3600`
- **Body**: Binary image data

**Status Codes:**
- `200 OK`: Successfully served image
- `404 Not Found`: Execution or image not found
- `415 Unsupported Media Type`: Invalid format requested
- `500 Internal Server Error`: Image processing error

---

### GET /api/executions/summary/daily
Get daily execution summary statistics.

**Query Parameters:**
- `days` (integer, optional): Number of days to include (default: 7, max: 90)
- `groupBy` (string, optional): Group by `day`, `hour` (default: `day`)

**Example Request:**
```bash
curl "http://localhost:3001/api/executions/summary/daily?days=14"
```

**Response:**
```json
{
  "data": [
    {
      "date": "2025-08-27",
      "totalExecutions": 127,
      "successful": 126,
      "failed": 1,
      "canceled": 0,
      "avgDurationSeconds": 2.34,
      "successRate": 99.21
    },
    {
      "date": "2025-08-26", 
      "totalExecutions": 98,
      "successful": 98,
      "failed": 0,
      "canceled": 0,
      "avgDurationSeconds": 2.12,
      "successRate": 100.0
    }
  ],
  "meta": {
    "period": {
      "days": 14,
      "startDate": "2025-08-14",
      "endDate": "2025-08-27"
    },
    "totals": {
      "executions": 1547,
      "successRate": 99.87,
      "avgDuration": 2.23
    }
  }
}
```

**Status Codes:**
- `200 OK`: Successfully retrieved summary
- `400 Bad Request`: Invalid parameters
- `500 Internal Server Error`: Database error

---

### GET /api/executions/summary/hourly
Get hourly execution summary for detailed analysis.

**Query Parameters:**
- `date` (string, required): Date in YYYY-MM-DD format
- `timezone` (string, optional): Timezone offset (default: UTC)

**Example Request:**
```bash
curl "http://localhost:3001/api/executions/summary/hourly?date=2025-08-27"
```

**Response:**
```json
{
  "data": [
    {
      "hour": "2025-08-27T00:00:00Z",
      "executions": 3,
      "successful": 3,
      "failed": 0,
      "avgDuration": 2.1,
      "minDuration": 1.8,
      "maxDuration": 2.5
    },
    {
      "hour": "2025-08-27T01:00:00Z",
      "executions": 5,
      "successful": 5, 
      "failed": 0,
      "avgDuration": 2.3,
      "minDuration": 1.9,
      "maxDuration": 2.8
    }
  ]
}
```

---

## 📊 Analytics Endpoints

### GET /api/analytics/performance
Get performance analytics and trends.

**Query Parameters:**
- `period` (string): Time period (`7d`, `30d`, `90d`) - default: `7d`
- `metrics` (array): Metrics to include (`duration`, `success_rate`, `volume`) - default: all

**Example Request:**
```bash
curl "http://localhost:3001/api/analytics/performance?period=30d&metrics=duration,success_rate"
```

**Response:**
```json
{
  "data": {
    "period": "30d",
    "metrics": {
      "averageDuration": {
        "current": 2.34,
        "previous": 2.45,
        "change": -4.49,
        "trend": "improving"
      },
      "successRate": {
        "current": 99.87,
        "previous": 99.78,
        "change": 0.09,
        "trend": "stable"
      },
      "executionVolume": {
        "current": 1547,
        "previous": 1423,
        "change": 8.71,
        "trend": "increasing"
      }
    },
    "timeSeries": [
      {
        "date": "2025-08-01",
        "avgDuration": 2.45,
        "successRate": 99.5,
        "volume": 45
      }
    ]
  }
}
```

---

### GET /api/analytics/errors
Analyze error patterns and trends.

**Query Parameters:**
- `days` (integer): Number of days to analyze (default: 30)
- `groupBy` (string): Group by `type`, `message`, `node` (default: `type`)

**Example Request:**
```bash
curl "http://localhost:3001/api/analytics/errors?days=30&groupBy=message"
```

**Response:**
```json
{
  "data": {
    "summary": {
      "totalErrors": 3,
      "errorRate": 0.13,
      "mostCommonError": "Connection timeout",
      "errorTrend": "stable"
    },
    "errorPatterns": [
      {
        "message": "Connection timeout to Ollama service",
        "count": 2,
        "percentage": 66.67,
        "firstOccurrence": "2025-08-15T10:30:00Z",
        "lastOccurrence": "2025-08-20T14:20:00Z",
        "affectedExecutions": [4789, 4812]
      }
    ],
    "recommendations": [
      "Monitor Ollama service availability",
      "Consider increasing connection timeout"
    ]
  }
}
```

---

## 🏥 Health & System Endpoints

### GET /api/health
System health check endpoint.

**Example Request:**
```bash
curl "http://localhost:3001/api/health"
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-08-28T12:34:56Z",
  "version": "1.0.0",
  "checks": {
    "database": {
      "status": "healthy",
      "responseTime": 12
    },
    "workflow": {
      "status": "healthy",
      "lastExecution": "2025-08-28T12:30:00Z"
    },
    "memory": {
      "status": "healthy",
      "usage": "45%"
    }
  }
}
```

**Status Codes:**
- `200 OK`: All systems healthy
- `503 Service Unavailable`: System unhealthy

---

### GET /api/system/info
Get system information and configuration.

**Example Request:**
```bash
curl "http://localhost:3001/api/system/info"
```

**Response:**
```json
{
  "data": {
    "application": {
      "name": "SAI Dashboard API",
      "version": "1.0.0",
      "environment": "production"
    },
    "workflow": {
      "name": "Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto",
      "id": "yDbfhooKemfhMIkC",
      "active": true,
      "nodeCount": 10
    },
    "database": {
      "type": "PostgreSQL",
      "version": "17.5",
      "size": "23GB"
    },
    "features": {
      "imageProcessing": true,
      "realTimeUpdates": false,
      "exportCapability": true
    }
  }
}
```

---

## 🔒 Authentication

### Bearer Token Authentication
If authentication is enabled, include the token in the Authorization header:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  "http://localhost:3001/api/executions"
```

### API Key Authentication  
Alternatively, use an API key:

```bash
curl -H "X-API-Key: YOUR_API_KEY_HERE" \
  "http://localhost:3001/api/executions"
```

---

## 🚫 Error Handling

### Standard Error Response
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid query parameters",
    "details": {
      "field": "limit",
      "reason": "Must be between 1 and 200"
    },
    "timestamp": "2025-08-28T12:34:56Z"
  },
  "data": null
}
```

### Error Codes
- `VALIDATION_ERROR`: Invalid request parameters
- `NOT_FOUND`: Requested resource not found  
- `DATABASE_ERROR`: Database connection or query error
- `PROCESSING_ERROR`: Image or data processing error
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `AUTHENTICATION_FAILED`: Invalid credentials
- `INTERNAL_ERROR`: Server error

### HTTP Status Codes
- `200 OK`: Successful request
- `400 Bad Request`: Invalid request
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Insufficient permissions  
- `404 Not Found`: Resource not found
- `422 Unprocessable Entity`: Validation error
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error
- `503 Service Unavailable`: Service down

---

## 📚 Usage Examples

### JavaScript/TypeScript Client
```typescript
class SAIDashboardClient {
  private baseURL: string;
  private apiKey?: string;

  constructor(baseURL: string, apiKey?: string) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
  }

  async getExecutions(params: {
    limit?: number;
    offset?: number;
    status?: string;
    days?: number;
  } = {}) {
    const url = new URL(`${this.baseURL}/api/executions`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, value.toString());
      }
    });

    const response = await fetch(url.toString(), {
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    return response.json();
  }

  async getExecutionImage(id: number): Promise<Blob> {
    const response = await fetch(`${this.baseURL}/api/executions/${id}/image`, {
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
    });

    if (!response.ok) {
      throw new Error(`Image fetch failed: ${response.status}`);
    }

    return response.blob();
  }
}

// Usage
const client = new SAIDashboardClient('http://localhost:3001');
const executions = await client.getExecutions({ limit: 20, status: 'success' });
```

### Python Client
```python
import requests
from typing import Optional, Dict, Any

class SAIDashboardClient:
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url
        self.api_key = api_key
        self.session = requests.Session()
        
        if api_key:
            self.session.headers.update({'X-API-Key': api_key})

    def get_executions(self, limit: int = 50, offset: int = 0, 
                      status: Optional[str] = None, days: int = 30) -> Dict[str, Any]:
        params = {'limit': limit, 'offset': offset, 'days': days}
        if status:
            params['status'] = status
            
        response = self.session.get(f'{self.base_url}/api/executions', params=params)
        response.raise_for_status()
        return response.json()

    def get_execution_image(self, execution_id: int) -> bytes:
        response = self.session.get(f'{self.base_url}/api/executions/{execution_id}/image')
        response.raise_for_status()
        return response.content

# Usage
client = SAIDashboardClient('http://localhost:3001')
executions = client.get_executions(limit=20, status='success')
```

---

## ⚡ Rate Limiting

The API implements rate limiting to ensure fair usage:

- **Default Limit**: 100 requests per minute per IP
- **Burst Limit**: 20 requests per 10 seconds  
- **Headers**: Rate limit information in response headers
  - `X-RateLimit-Limit`: Requests allowed per window
  - `X-RateLimit-Remaining`: Requests remaining in window
  - `X-RateLimit-Reset`: Window reset time (Unix timestamp)

When rate limit is exceeded:
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 60
  }
}
```

---

## 🔄 WebSocket Support (Future)

For real-time updates, WebSocket support will be added:

**Connection**: `ws://localhost:3001/ws/executions`

**Events**:
```javascript
// Subscribe to execution updates
ws.send(JSON.stringify({
  type: 'subscribe',
  channel: 'executions',
  filters: { status: ['error'] }
}));

// Receive real-time updates
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('New execution:', data.execution);
};
```

---

*API Documentation Version: 1.0*  
*Last Updated: August 28, 2025*  
*SAI Image Analysis Dashboard API*