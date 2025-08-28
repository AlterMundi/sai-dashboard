# SAI Dashboard - Development Guide

**Step-by-step development guide for building the SAI Image Analysis Dashboard MVP**

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- PostgreSQL access to n8n database
- Docker and Docker Compose (optional)
- Git for version control

### Environment Setup
```bash
# Clone/navigate to project
cd ~/sai-dashboard

# Copy environment template  
cp .env.example .env

# Edit database connection
vim .env
```

**Required Environment Variables**:
```env
# Database Connection (n8n PostgreSQL)
DATABASE_URL=postgresql://n8n_user:REDACTED@localhost:5432/n8n
DB_HOST=localhost
DB_PORT=5432
DB_NAME=n8n
DB_USER=n8n_user
DB_PASSWORD=REDACTED

# Application Settings
NODE_ENV=development
API_PORT=3001
FRONTEND_PORT=3000
CORS_ORIGIN=http://localhost:3000

# Dashboard Configuration
SAI_WORKFLOW_NAME=Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto
DEFAULT_PAGE_SIZE=50
MAX_IMAGE_SIZE=5242880  # 5MB limit
CACHE_TTL=300           # 5 minutes

# Security
JWT_SECRET=your-secret-key-here
API_KEY=optional-api-key-for-auth
```

---

## 📁 Project Structure Setup

### Backend API Structure
```bash
mkdir -p backend/src/{routes,services,types,utils,middleware}
```

**Backend Files to Create**:
```
backend/
├── src/
│   ├── app.ts              # Express application setup
│   ├── server.ts           # Server startup
│   ├── routes/
│   │   ├── index.ts        # Route definitions
│   │   ├── executions.ts   # Execution data endpoints
│   │   ├── health.ts       # Health check endpoints
│   │   └── images.ts       # Image serving endpoints
│   ├── services/
│   │   ├── database.ts     # PostgreSQL connection
│   │   ├── executions.ts   # Execution data service
│   │   ├── images.ts       # Image extraction service
│   │   └── ollama.ts       # Ollama result parsing
│   ├── types/
│   │   ├── execution.ts    # Execution data types
│   │   ├── database.ts     # Database response types
│   │   └── api.ts          # API request/response types
│   ├── utils/
│   │   ├── logger.ts       # Logging configuration
│   │   ├── validation.ts   # Input validation
│   │   └── errors.ts       # Error handling
│   └── middleware/
│       ├── auth.ts         # Authentication middleware
│       ├── cors.ts         # CORS configuration
│       └── rate-limit.ts   # Rate limiting
├── package.json
├── tsconfig.json
└── Dockerfile
```

### Frontend Structure
```bash
mkdir -p frontend/src/{components,services,types,utils,assets}
```

**Frontend Files to Create**:
```
frontend/
├── src/
│   ├── App.tsx             # Main application component
│   ├── main.tsx            # Application entry point
│   ├── components/
│   │   ├── Gallery/
│   │   │   ├── ImageGallery.tsx
│   │   │   ├── ImageCard.tsx
│   │   │   └── ImageModal.tsx
│   │   ├── Layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Footer.tsx
│   │   ├── Filters/
│   │   │   ├── DateFilter.tsx
│   │   │   ├── StatusFilter.tsx
│   │   │   └── SearchFilter.tsx
│   │   └── Common/
│   │       ├── LoadingSpinner.tsx
│   │       ├── ErrorBoundary.tsx
│   │       └── StatusBadge.tsx
│   ├── services/
│   │   ├── api.ts          # API client configuration
│   │   ├── executions.ts   # Execution data service
│   │   └── images.ts       # Image handling service
│   ├── types/
│   │   ├── execution.ts    # Execution data types
│   │   ├── api.ts          # API response types
│   │   └── ui.ts           # UI component types
│   ├── utils/
│   │   ├── formatters.ts   # Date/time formatting
│   │   ├── constants.ts    # Application constants
│   │   └── helpers.ts      # Utility functions
│   └── assets/
│       └── styles/
│           └── globals.css # Global styles
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

---

## 🛠️ Implementation Steps

### Phase 1: Backend API Development

#### Step 1: Database Connection Setup

**File: `backend/src/services/database.ts`**
```typescript
import { Pool } from 'pg';
import { logger } from '../utils/logger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  statement_timeout: 10000
});

pool.on('error', (err) => {
  logger.error('Unexpected database error:', err);
  process.exit(-1);
});

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    logger.error('Database query failed:', { text, error });
    throw error;
  }
};

export const getClient = () => pool.connect();
export default pool;
```

#### Step 2: Execution Data Service

**File: `backend/src/services/executions.ts`**
```typescript
import { query } from './database';
import { ExecutionData, ExecutionSummary } from '../types/execution';
import { logger } from '../utils/logger';

export class ExecutionService {
  private static readonly SAI_WORKFLOW_NAME = 
    'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto';

  async getRecentExecutions(
    limit: number = 50, 
    offset: number = 0,
    status?: string,
    days: number = 30
  ): Promise<ExecutionData[]> {
    const queryText = `
      SELECT 
        e.id as execution_id,
        e.status,
        e."startedAt",
        e."stoppedAt",
        EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt")) as duration_seconds,
        ed.data as execution_payload
      FROM execution_entity e
      JOIN workflow_entity w ON e."workflowId" = w.id
      LEFT JOIN execution_data ed ON e.id = ed."executionId"
      WHERE w.name = $1
        AND e."deletedAt" IS NULL
        AND e."startedAt" > CURRENT_DATE - INTERVAL '${days} days'
        ${status ? 'AND e.status = $4' : ''}
      ORDER BY e."startedAt" DESC
      LIMIT $2 OFFSET $3
    `;

    const params = status 
      ? [this.SAI_WORKFLOW_NAME, limit, offset, status]
      : [this.SAI_WORKFLOW_NAME, limit, offset];

    try {
      const result = await query(queryText, params);
      return result.rows.map(this.transformExecutionData);
    } catch (error) {
      logger.error('Failed to fetch executions:', error);
      throw new Error('Failed to fetch execution data');
    }
  }

  async getExecutionById(id: number): Promise<ExecutionData | null> {
    const queryText = `
      SELECT 
        e.id as execution_id,
        e.status,
        e."startedAt",
        e."stoppedAt",
        EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt")) as duration_seconds,
        ed.data as execution_payload,
        ed."workflowData" as workflow_data
      FROM execution_entity e
      JOIN workflow_entity w ON e."workflowId" = w.id
      LEFT JOIN execution_data ed ON e.id = ed."executionId"
      WHERE e.id = $1 AND w.name = $2 AND e."deletedAt" IS NULL
    `;

    try {
      const result = await query(queryText, [id, this.SAI_WORKFLOW_NAME]);
      return result.rows.length > 0 
        ? this.transformExecutionData(result.rows[0])
        : null;
    } catch (error) {
      logger.error(`Failed to fetch execution ${id}:`, error);
      throw new Error('Failed to fetch execution details');
    }
  }

  async getDailySummary(days: number = 7): Promise<ExecutionSummary[]> {
    const queryText = `
      SELECT 
        DATE(e."startedAt") as execution_date,
        COUNT(*) as total_executions,
        COUNT(CASE WHEN e.status = 'success' THEN 1 END) as successful,
        COUNT(CASE WHEN e.status = 'error' THEN 1 END) as failed,
        ROUND(AVG(EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))), 2) as avg_duration_seconds
      FROM execution_entity e
      JOIN workflow_entity w ON e."workflowId" = w.id
      WHERE w.name = $1
        AND e."deletedAt" IS NULL
        AND e."startedAt" > CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(e."startedAt")
      ORDER BY execution_date DESC
    `;

    try {
      const result = await query(queryText, [this.SAI_WORKFLOW_NAME]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to fetch daily summary:', error);
      throw new Error('Failed to fetch execution summary');
    }
  }

  private transformExecutionData(row: any): ExecutionData {
    let parsedPayload = null;
    
    if (row.execution_payload) {
      try {
        parsedPayload = JSON.parse(row.execution_payload);
      } catch (error) {
        logger.warn(`Failed to parse payload for execution ${row.execution_id}`);
      }
    }

    return {
      id: row.execution_id,
      status: row.status,
      startedAt: row.startedAt,
      stoppedAt: row.stoppedAt,
      duration: row.duration_seconds,
      payload: parsedPayload,
      // Extract specific data points
      imageData: this.extractImageData(parsedPayload),
      ollamaResult: this.extractOllamaResult(parsedPayload),
      telegramStatus: this.extractTelegramStatus(parsedPayload)
    };
  }

  private extractImageData(payload: any): string | null {
    try {
      return payload?.nodeInputData?.Webhook?.[0]?.json?.body?.image || 
             payload?.nodeInputData?.Webhook?.[0]?.json?.image ||
             null;
    } catch {
      return null;
    }
  }

  private extractOllamaResult(payload: any): any {
    try {
      return payload?.nodeOutputData?.Ollama?.[0]?.json || null;
    } catch {
      return null;
    }
  }

  private extractTelegramStatus(payload: any): any {
    try {
      return payload?.nodeOutputData?.Telegram?.[0]?.json || null;
    } catch {
      return null;
    }
  }
}

export const executionService = new ExecutionService();
```

#### Step 3: API Routes Setup

**File: `backend/src/routes/executions.ts`**
```typescript
import { Router } from 'express';
import { executionService } from '../services/executions';
import { validateQuery } from '../middleware/validation';
import { asyncHandler } from '../utils/errors';

const router = Router();

// GET /api/executions - Get paginated executions
router.get('/', validateQuery, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0, status, days = 30 } = req.query;
  
  const executions = await executionService.getRecentExecutions(
    parseInt(limit as string),
    parseInt(offset as string), 
    status as string,
    parseInt(days as string)
  );

  res.json({
    data: executions,
    pagination: {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      total: executions.length
    }
  });
}));

// GET /api/executions/:id - Get specific execution details
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const execution = await executionService.getExecutionById(parseInt(id));
  
  if (!execution) {
    return res.status(404).json({ error: 'Execution not found' });
  }

  res.json({ data: execution });
}));

// GET /api/executions/summary/daily - Get daily execution summary
router.get('/summary/daily', asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;
  const summary = await executionService.getDailySummary(parseInt(days as string));
  
  res.json({ data: summary });
}));

// GET /api/executions/:id/image - Serve execution image
router.get('/:id/image', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const execution = await executionService.getExecutionById(parseInt(id));
  
  if (!execution || !execution.imageData) {
    return res.status(404).json({ error: 'Image not found' });
  }

  // Convert base64 to buffer and serve
  const imageBuffer = Buffer.from(execution.imageData, 'base64');
  res.set({
    'Content-Type': 'image/jpeg',
    'Content-Length': imageBuffer.length.toString(),
    'Cache-Control': 'public, max-age=3600' // 1 hour cache
  });
  
  res.send(imageBuffer);
}));

export default router;
```

### Phase 2: Frontend Development

#### Step 1: API Service Setup

**File: `frontend/src/services/api.ts`**
```typescript
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Request interceptor for auth (if needed)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
```

#### Step 2: Main Gallery Component

**File: `frontend/src/components/Gallery/ImageGallery.tsx`**
```tsx
import React, { useState, useEffect } from 'react';
import { ExecutionData } from '../../types/execution';
import { executionService } from '../../services/executions';
import ImageCard from './ImageCard';
import LoadingSpinner from '../Common/LoadingSpinner';
import ErrorBoundary from '../Common/ErrorBoundary';

interface ImageGalleryProps {
  filters?: {
    status?: string;
    days?: number;
    search?: string;
  };
}

const ImageGallery: React.FC<ImageGalleryProps> = ({ filters = {} }) => {
  const [executions, setExecutions] = useState<ExecutionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  const loadExecutions = async (reset = false) => {
    try {
      setLoading(true);
      const offset = reset ? 0 : page * 50;
      
      const data = await executionService.getExecutions({
        limit: 50,
        offset,
        status: filters.status,
        days: filters.days || 30
      });

      if (reset) {
        setExecutions(data);
        setPage(1);
      } else {
        setExecutions(prev => [...prev, ...data]);
        setPage(prev => prev + 1);
      }

      setHasMore(data.length === 50);
      setError(null);
    } catch (err) {
      setError('Failed to load executions');
      console.error('Error loading executions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExecutions(true);
  }, [filters]);

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      loadExecutions(false);
    }
  };

  if (loading && executions.length === 0) {
    return <LoadingSpinner />;
  }

  if (error && executions.length === 0) {
    return (
      <div className="error-container">
        <p>Error: {error}</p>
        <button onClick={() => loadExecutions(true)}>Retry</button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="image-gallery">
        <div className="gallery-header">
          <h2>SAI Image Analysis Results</h2>
          <p>{executions.length} executions loaded</p>
        </div>
        
        <div className="gallery-grid">
          {executions.map((execution) => (
            <ImageCard 
              key={execution.id} 
              execution={execution}
              onImageClick={(exec) => {
                // Handle image click - open modal
                console.log('Image clicked:', exec.id);
              }}
            />
          ))}
        </div>

        {hasMore && (
          <div className="load-more">
            <button 
              onClick={handleLoadMore} 
              disabled={loading}
              className="load-more-button"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default ImageGallery;
```

#### Step 3: Image Card Component

**File: `frontend/src/components/Gallery/ImageCard.tsx`**
```tsx
import React from 'react';
import { ExecutionData } from '../../types/execution';
import StatusBadge from '../Common/StatusBadge';
import { formatTimestamp, formatDuration } from '../../utils/formatters';

interface ImageCardProps {
  execution: ExecutionData;
  onImageClick: (execution: ExecutionData) => void;
}

const ImageCard: React.FC<ImageCardProps> = ({ execution, onImageClick }) => {
  const imageUrl = execution.imageData 
    ? `data:image/jpeg;base64,${execution.imageData}`
    : null;

  const riskLevel = execution.ollamaResult?.response?.includes('RISK_LEVEL:') 
    ? execution.ollamaResult.response.match(/RISK_LEVEL:\s*(\w+)/)?.[1]
    : 'UNKNOWN';

  const telegramSent = execution.telegramStatus?.success === true;

  return (
    <div 
      className="image-card"
      onClick={() => onImageClick(execution)}
    >
      <div className="image-container">
        {imageUrl ? (
          <img 
            src={imageUrl} 
            alt={`Execution ${execution.id}`}
            className="execution-image"
          />
        ) : (
          <div className="no-image-placeholder">
            No Image Available
          </div>
        )}
        
        <div className="image-overlay">
          <StatusBadge status={execution.status} />
        </div>
      </div>

      <div className="card-content">
        <div className="execution-info">
          <div className="timestamp">
            {formatTimestamp(execution.startedAt)}
          </div>
          
          {execution.duration && (
            <div className="duration">
              {formatDuration(execution.duration)}s
            </div>
          )}
        </div>

        <div className="analysis-results">
          {riskLevel !== 'UNKNOWN' && (
            <div className={`risk-level risk-${riskLevel.toLowerCase()}`}>
              Risk: {riskLevel}
            </div>
          )}
          
          <div className="telegram-status">
            {telegramSent ? (
              <span className="telegram-sent">✓ Sent to Telegram</span>
            ) : (
              <span className="telegram-failed">✗ Telegram Failed</span>
            )}
          </div>
        </div>

        {execution.status === 'error' && (
          <div className="error-info">
            <button className="retry-button" onClick={(e) => {
              e.stopPropagation();
              // Handle retry logic
            }}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageCard;
```

---

## 🎨 Styling and UI

### CSS Framework Setup

**Recommended: Tailwind CSS**
```bash
cd frontend
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**File: `frontend/tailwind.config.js`**
```javascript
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sai-primary': '#1e40af',
        'sai-secondary': '#64748b', 
        'risk-low': '#10b981',
        'risk-medium': '#f59e0b',
        'risk-high': '#ef4444',
      },
      gridTemplateColumns: {
        'gallery': 'repeat(auto-fill, minmax(300px, 1fr))'
      }
    },
  },
  plugins: [],
}
```

### Component Styles

**File: `frontend/src/assets/styles/components.css`**
```css
/* Image Gallery Styles */
.image-gallery {
  @apply container mx-auto p-6;
}

.gallery-header {
  @apply mb-8 text-center;
}

.gallery-header h2 {
  @apply text-3xl font-bold text-gray-900 mb-2;
}

.gallery-grid {
  @apply grid grid-cols-gallery gap-6 mb-8;
}

/* Image Card Styles */
.image-card {
  @apply bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow cursor-pointer overflow-hidden;
}

.image-container {
  @apply relative aspect-video bg-gray-100;
}

.execution-image {
  @apply w-full h-full object-cover;
}

.no-image-placeholder {
  @apply w-full h-full flex items-center justify-center text-gray-500;
}

.image-overlay {
  @apply absolute top-2 right-2;
}

.card-content {
  @apply p-4;
}

.execution-info {
  @apply flex justify-between items-center mb-3 text-sm text-gray-600;
}

.analysis-results {
  @apply space-y-2;
}

.risk-level {
  @apply inline-block px-2 py-1 rounded text-sm font-medium;
}

.risk-low {
  @apply bg-green-100 text-green-800;
}

.risk-medium {
  @apply bg-yellow-100 text-yellow-800;
}

.risk-high {
  @apply bg-red-100 text-red-800;
}

.telegram-sent {
  @apply text-green-600 text-sm;
}

.telegram-failed {
  @apply text-red-600 text-sm;
}

/* Status Badge */
.status-badge {
  @apply px-2 py-1 rounded-full text-xs font-medium;
}

.status-success {
  @apply bg-green-100 text-green-800;
}

.status-error {
  @apply bg-red-100 text-red-800;
}

.status-running {
  @apply bg-blue-100 text-blue-800;
}

/* Loading and Error States */
.loading-spinner {
  @apply flex justify-center items-center p-8;
}

.error-container {
  @apply text-center p-8 bg-red-50 rounded-lg;
}

.load-more-button {
  @apply bg-sai-primary text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50;
}

/* Responsive Design */
@media (max-width: 768px) {
  .gallery-grid {
    @apply grid-cols-1;
  }
  
  .image-card {
    @apply mx-4;
  }
}

@media (max-width: 640px) {
  .execution-info {
    @apply flex-col items-start gap-1;
  }
}
```

---

## 🔧 Development Tools

### Package.json Templates

**Backend package.json**:
```json
{
  "name": "sai-dashboard-backend",
  "version": "1.0.0",
  "description": "SAI Image Analysis Dashboard API",
  "main": "dist/server.js",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.0",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "morgan": "^1.10.0",
    "compression": "^1.7.4",
    "dotenv": "^16.0.3"
  },
  "devDependencies": {
    "@types/express": "^4.17.17",
    "@types/pg": "^8.10.0",
    "@types/cors": "^2.8.13",
    "@types/node": "^18.16.0",
    "typescript": "^5.0.0",
    "ts-node-dev": "^2.0.0",
    "jest": "^29.5.0",
    "@types/jest": "^29.5.0",
    "eslint": "^8.39.0",
    "@typescript-eslint/eslint-plugin": "^5.59.0"
  }
}
```

**Frontend package.json**:
```json
{
  "name": "sai-dashboard-frontend",
  "version": "1.0.0",
  "description": "SAI Image Analysis Dashboard UI",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "axios": "^1.4.0",
    "react-query": "^3.39.3",
    "react-router-dom": "^6.11.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.6",
    "@types/react-dom": "^18.2.4",
    "@typescript-eslint/eslint-plugin": "^5.59.0",
    "@typescript-eslint/parser": "^5.59.0",
    "@vitejs/plugin-react": "^4.0.0",
    "autoprefixer": "^10.4.14",
    "eslint": "^8.39.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.3.4",
    "postcss": "^8.4.24",
    "tailwindcss": "^3.3.0",
    "typescript": "^5.0.0",
    "vite": "^4.3.9"
  }
}
```

### Docker Configuration

**File: `docker-compose.yml`**
```yaml
version: '3.8'

services:
  sai-dashboard-backend:
    build: 
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://n8n_user:REDACTED@host.docker.internal:5432/n8n
      - API_PORT=3001
    depends_on:
      - postgres
    restart: unless-stopped
    
  sai-dashboard-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:80"
    depends_on:
      - sai-dashboard-backend
    restart: unless-stopped
    
  postgres:
    image: postgres:17-alpine
    environment:
      - POSTGRES_DB=n8n
      - POSTGRES_USER=n8n_user
      - POSTGRES_PASSWORD=REDACTED
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

---

## 🧪 Testing Strategy

### Backend Testing Setup
```bash
cd backend
npm install --save-dev jest supertest @types/supertest
```

**File: `backend/src/__tests__/executions.test.ts`**
```typescript
import request from 'supertest';
import app from '../app';

describe('Executions API', () => {
  test('GET /api/executions should return executions', async () => {
    const response = await request(app)
      .get('/api/executions')
      .expect(200);
      
    expect(response.body).toHaveProperty('data');
    expect(Array.isArray(response.body.data)).toBe(true);
  });
  
  test('GET /api/executions/:id should return specific execution', async () => {
    // Test with known execution ID
    const response = await request(app)
      .get('/api/executions/1')
      .expect(200);
      
    expect(response.body.data).toHaveProperty('id', 1);
  });
});
```

### Frontend Testing Setup
```bash
cd frontend  
npm install --save-dev @testing-library/react @testing-library/jest-dom vitest
```

---

## 🚀 Deployment

### Production Build
```bash
# Backend
cd backend
npm run build

# Frontend
cd frontend
npm run build
```

### Environment Configuration
```bash
# Production .env
NODE_ENV=production
DATABASE_URL=postgresql://n8n_user:password@localhost:5432/n8n
API_PORT=3001
FRONTEND_PORT=3000
```

### Nginx Configuration
```nginx
server {
    listen 80;
    server_name sai-dashboard.local;

    location / {
        root /app/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

This development guide provides a complete roadmap for building the SAI Image Analysis Dashboard MVP, from initial setup through production deployment.

---

*Development Guide Version: 1.0*  
*Target Implementation: 2-week MVP*  
*Focus: SAI Image Workflow Management*