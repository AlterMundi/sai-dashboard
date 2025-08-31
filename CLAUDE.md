# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🎯 Project Overview

SAI Dashboard is an autonomous read-only consumer that provides visual monitoring for n8n's primary image analysis workflow. It efficiently handles base64 images already stored in the n8n database, implements filesystem caching for performance, and supports public access with simple authentication.

**Core Architecture Decisions**:
- Images are already base64 in n8n database - we extract, not store
- Filesystem cache at `/mnt/raid1/n8n/backup/images/` for persistence
- Simple password authentication for public access
- Server-Sent Events (SSE) for real-time updates, not WebSockets
- Two-phase query pattern to avoid memory issues

## 🏗️ Architecture

**Stack**: React 18 + TypeScript frontend, Node.js + Express API backend, PostgreSQL database (read-only access), filesystem caching.

**Key Components**:
- **Frontend**: React SPA with authentication, lazy-loaded gallery, SSE client, responsive design
- **Backend**: Express API with password auth, filesystem cache, SSE events, rate limiting
- **Cache**: Filesystem at `/mnt/raid1/n8n/backup/images/` with structured folders (by-date, by-execution, by-status)
- **Database**: Read-only PostgreSQL user with restricted views, parameterized queries
- **Security**: HTTPS required, session management, input validation, security headers

## 🚀 Development Commands

### Initial Setup
```bash
# Environment setup (secure credentials!)
cp .env.example .env
# Edit .env with proper database connection and DASHBOARD_PASSWORD

# Create cache directory structure
sudo mkdir -p /mnt/raid1/n8n/backup/images/{by-date,by-execution,by-status}
sudo chown -R $(whoami) /mnt/raid1/n8n/backup/images

# Backend development
cd backend && npm install && npm run dev

# Frontend development (CRITICAL: Must include API URL for production routing)
cd frontend && npm install
VITE_BASE_PATH=/dashboard/ VITE_API_URL=/dashboard/api npm run dev

# Full stack with Docker (after fixing port conflicts)
docker-compose up -d
```

## 🌐 Production Deployment (TESTED & WORKING)

### Production Setup
```bash
# installation script
./install-production.sh

# Test enhanced statistics endpoint with proper auth
# Get auth token first
curl -s "https://sai.altermundi.net/dashboard/api/auth/login" -H "Content-Type:application/json" -d '{"password":"SaiDash2025SecureProd"}' > /tmp/token.json
# Extract token
jq -r '.data.token' /tmp/token.json > /tmp/token.txt
# Test desired endpoint (example)
curl -s "https://sai.altermundi.net/dashboard/api/executions/stats/enhanced" -H "Authorization: Bearer $(cat /tmp/token.txt)"
```

### Critical Production Configuration

**Server Status (Reverse Tunnel Architecture):**
- Frontend: nginx port 80 (tunneled via remote port 3000 to sai.altermundi.net)
- Backend: API port 3001 (tunneled via remote port 3001 to sai.altermundi.net)  
- Database: 7,721+ SAI workflow executions successfully connected
- Tunnels: tunnel-dashboard.service and tunnel-dashboard-api.service (active)

**nginx Configuration Requirements:**
The following locations must be added to the existing sai.altermundi.net server block:

```nginx
# Dashboard - Exact redirect for trailing slash
location = /dashboard {
    return 301 $scheme://$server_name/dashboard/;
}

# Dashboard API - Backend routing (URL rewrite required)
location /dashboard/api/ {
    rewrite ^/dashboard/api/(.*) /api/$1 break;
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Dashboard Assets - Must come BEFORE general static assets location
location ~* ^/dashboard/.*\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    proxy_pass http://127.0.0.1:3000;  # Remote port via reverse tunnel
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}

# Dashboard Frontend - All other dashboard routes  
location /dashboard/ {
    proxy_pass http://127.0.0.1:3000/dashboard/;  # Remote port via reverse tunnel
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

**⚠️ Critical nginx Ordering Rules:**
1. Dashboard asset location MUST come before general `~* \.(js|css|...)$` location
2. API location requires URL rewrite: `/dashboard/api/xxx` → `/api/xxx` 
3. No `try_files` with `proxy_pass` - causes nginx errors
4. No URI parts in named locations - causes configuration failures

### Development Workflow
```bash
# Backend API development (port 3001)
cd backend
npm run dev          # Start with hot reload (tsx watch)
npm run build        # TypeScript compilation to dist/
npm run start        # Production start (requires build first)
npm run lint         # ESLint code checking with --fix
npm run type-check   # TypeScript validation without emit
npm test             # Jest test suite
npm run test:watch   # Jest in watch mode
npm run db:setup     # Initialize database views

# Frontend development (port 3000)
cd frontend  
npm run dev          # Vite dev server with hot reload
npm run build        # TypeScript + Vite production build
npm run preview      # Preview production build locally
npm run lint         # ESLint + TypeScript checking with --fix
npm run type-check   # TypeScript validation without emit
npm test             # Vitest test suite
npm test:ui          # Vitest UI mode
npm test:coverage    # Test coverage report
```

**Key Development Notes**:
- Backend uses `tsx` for TypeScript execution in development
- Frontend uses Vite with React plugin for hot reload
- Both have path aliases configured (`@/` points to `src/`)
- ESLint configured for TypeScript + React with auto-fix
- Tests use Jest (backend) and Vitest (frontend)

### Production Installation
```bash
# One-command production deployment with quality checks
./install-production.sh

# The script includes:
# - Pre-build TypeScript validation
# - Path alias resolution verification  
# - Database connectivity testing
# - Post-deployment health checks
# - Service status monitoring
```

## 📊 Database Integration

**Connection**: Read-only PostgreSQL connection to existing n8n database
- **Primary Tables**: `execution_entity`, `execution_data`, `workflow_entity`
- **Target Workflow**: "Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto" (ID: yDbfhooKemfhMIkC)
- **Safety**: No write operations allowed, connection pooling with timeouts

**Key Database Queries**:
- Recent executions with pagination and filtering
- Image data extraction from JSON payloads
- Ollama analysis results parsing
- Telegram delivery status checking
- Daily/hourly execution summaries

## 🔌 API Architecture

**Base URL**: `http://localhost:3001/api`

**Core Endpoints**:
- `GET /api/executions` - Paginated execution list with filters
- `GET /api/executions/{id}` - Detailed execution information  
- `GET /api/executions/{id}/image` - Serve execution images
- `GET /api/executions/summary/daily` - Daily statistics
- `GET /api/health` - System health check

**Response Format**: Standardized JSON with data/meta/error structure
**Authentication**: Bearer token
**Rate Limiting**: 100 requests/minute with burst protection

## 🎨 Frontend Structure

**Component Architecture**:
- `ImageGallery` - Main grid view of execution images
- `ImageCard` - Individual execution display with status/results
- `ImageModal` - Full-screen image viewer with analysis overlay
- `StatusBadge` - Execution status indicators
- `Filters` - Date, status, and search filtering

**State Management**: React Query for server state, local state for UI
**Styling**: Tailwind CSS with responsive grid layouts
**Image Handling**: Base64 extraction from execution payloads, optimized serving

## 🔧 Configuration

**Key Environment Variables** (see `.env.example` for complete list):
```env
# Database (required)
DATABASE_URL=postgresql://sai_dashboard_readonly:CHANGE_PASSWORD@localhost:5432/n8n
DB_HOST=localhost
DB_PORT=5432
DB_NAME=n8n
DB_USER=sai_dashboard_readonly
DB_PASSWORD=CHANGE_PASSWORD

# Application  
NODE_ENV=development|production
API_PORT=3001
FRONTEND_PORT=3000
CORS_ORIGIN=http://localhost:3000

# SAI Workflow Target
SAI_WORKFLOW_NAME=Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto

# Authentication (REQUIRED for production)
DASHBOARD_PASSWORD=CHANGE_THIS_SECURE_PASSWORD_2025
SESSION_SECRET=your-super-secret-session-key-change-this

# Performance & Security
DEFAULT_PAGE_SIZE=50
MAX_IMAGE_SIZE=5242880
CACHE_PATH=/mnt/raid1/n8n/backup/images/
RATE_LIMIT_MAX_REQUESTS=60
ENFORCE_HTTPS=true

# Frontend Build (production routing)
VITE_BASE_PATH=/dashboard/
VITE_API_URL=/dashboard/api
```

**Port Configuration**:
- Backend API: Port 3001
- Frontend: Port 3000 (development only, production uses nginx on port 80)

## 🧪 Testing Strategy

**Backend Testing**:
- Jest for unit tests
- Supertest for API integration tests
- Database query testing with mock data
- Error handling and validation tests

**Frontend Testing**:
- React Testing Library for component tests
- Vitest as test runner
- Mock API responses for service tests
- Visual regression tests for image components

## 🔒 Security Considerations

- **Read-Only Database Access**: No write operations to n8n database
- **Input Validation**: All API inputs validated and sanitized
- **Rate Limiting**: Request throttling to prevent abuse
- **CORS Configuration**: Domain restrictions for API access
- **Image Security**: Base64 validation and size limits
- **Error Handling**: No sensitive data exposed in error responses

## 📦 Deployment Architecture

**Production Stack**:
- Direct Node.js deployment via systemd service
- Nginx reverse proxy with SSL termination (required for public access)
- Filesystem cache on RAID storage at `/mnt/raid1/n8n/backup/images/`
- Authentication middleware with session management
- Rate limiting and security headers
- Health checks at `/dashboard/api/health`

**Critical Configuration**:
- HTTPS enforced for public deployment via nginx
- Self-contained API routes under `/dashboard/api/*`
- Rate limiting: 60 req/min general, 5 login attempts/15min
- Session duration: 24 hours (configurable)

## 🎯 SAI Workflow Context

**Target Workflow Specifics**:
- **Execution Pattern**: Webhook-triggered image uploads
- **Success Rate**: 99.96% (4,892/4,893 total executions)
- **Node Flow**: Webhook → Ollama Analysis → Telegram Notification
- **Key Data Points**: Risk assessment, confidence scores, delivery confirmation

**Integration Points**:
- **Ollama API**: qwen2.5vl:7b model for image analysis
- **Telegram Bot**: Multiple bot configurations for alerts
- **Webhook Endpoint**: https://ai.altermundi.net/pipelines/[uuid]

## 💡 Critical Implementation Guidelines

### Backend Architecture Notes
- **Self-Contained Routes**: Backend serves all routes under `/dashboard/api/*` (see `backend/src/index.ts:62`)  
- **Authentication**: Simple password-based auth with JWT tokens and rate limiting
- **Database**: Read-only PostgreSQL access with connection pooling (5 connections max)
- **Caching**: Filesystem-based at `/mnt/raid1/n8n/backup/images/`
- **Error Handling**: Comprehensive error middleware with development/production modes

### Frontend Architecture Notes  
- **Base Path Support**: Configurable via `VITE_BASE_PATH` environment variable
- **Proxy Configuration**: Vite dev server proxies `/dashboard/api` to backend (port 3001)
- **State Management**: React Query for server state, Zustand for client state
- **Component Structure**: Organized by feature with shared UI components in `/ui/`
- **Testing**: Vitest + React Testing Library setup

### Database Query Patterns
- **Two-Phase Loading**: Never load full execution data in list views
- **Parameterized Queries**: All database queries use prepared statements
- **Connection Pool**: Max 5 connections with 5s timeout
- **Target Tables**: `execution_entity`, `execution_data`, `workflow_entity`

### Production Deployment Lessons (BATTLE-TESTED)

**SSH Reverse Tunnel Architecture (CORRECTED):**
```bash
# Existing reverse tunnel services (already running):
tunnel-dashboard.service: ssh -R 3000:localhost:80 user@sai.altermundi.net
tunnel-dashboard-api.service: ssh -R 3001:localhost:3001 user@sai.altermundi.net

# This creates remote bindings on public proxy (sai.altermundi.net):
# - localhost:3000 (on proxy) -> localhost:80 (on local server)
# - localhost:3001 (on proxy) -> localhost:3001 (on local server)

# Backend: Self-contained under /dashboard/api/*
app.use('/dashboard/api', apiRoutes);  # No URL rewriting needed

# Frontend Environment Variables:
VITE_BASE_PATH=/dashboard/
VITE_API_URL=/dashboard/api
```

**nginx Public Proxy Configuration (CORRECTED):**
```nginx
# ✅ REVERSE TUNNEL: Uses remote port bindings created by local services
location /dashboard/ {
    proxy_pass http://127.0.0.1:3000/dashboard/;  # Remote port 3000 -> local port 80
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
}

location /dashboard/api/ {
    proxy_pass http://127.0.0.1:3001;  # Remote port 3001 -> local port 3001
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
}

# ❌ OLD APPROACH: Complex URL rewriting (avoid this)
location /dashboard/api/ {
    rewrite ^/dashboard/api/(.*) /api/$1 break;  # Complex and fragile
    proxy_pass http://127.0.0.1:3001;
}

# ❌ WRONG: Location ordering conflicts with existing /api/
# /api/ location captures requests before /dashboard/api/ can match
```

**Self-Contained Benefits:**
1. **No Route Conflicts** → Complete isolation under `/dashboard/` path
2. **No URL Rewriting** → Backend handles `/dashboard/api/*` natively  
3. **Simple nginx Config** → One location block handles everything
4. **Future-Proof** → Won't break with nginx config changes
5. **Standard Pattern** → Used by many web applications

**Legacy Troubleshooting (Pre-Self-Contained):**
1. **MIME Type Errors** → Dashboard assets location not before general assets
2. **API 404 Errors** → Location precedence conflicts with existing `/api/`
3. **Redirect Loops** → Frontend base path configuration mismatch
4. **nginx Config Errors** → `try_files` or URI parts in wrong locations

### Image Handling Strategy
```javascript
// DON'T: Load base64 into JSON responses - causes memory issues
// DO: Serve images via separate endpoints
app.get('/api/executions/:id/image', cacheImage, serveFromFilesystem);

// DON'T: Query execution_data for listings
// DO: Use two-phase loading
// Phase 1: List without payloads
// Phase 2: Load specific execution data when needed
```

### Authentication Implementation
```javascript
// Simple password auth for public access
app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const { password } = req.body;
  if (password === process.env.DASHBOARD_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    await redis.setex(`session:${token}`, 86400, JSON.stringify({...}));
    res.json({ token });
  }
});
```

### Cache Management
```javascript
// Filesystem structure: /mnt/raid1/n8n/backup/images/
// - by-date/2025/08/28/4893_125557.jpg
// - by-execution/4893/original.jpg  
// - by-execution/4893/thumb.jpg
// - by-status/success/4893.jpg -> ../by-execution/4893/original.jpg
```

### SSE Implementation
```javascript
// Server-Sent Events, not WebSockets
app.get('/api/events', authenticateSSE, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache'
  });
  // Push new execution updates
});
```

### Database Security
- Use parameterized queries only
- Create read-only user with restricted views
- Never concatenate user input into SQL
- Implement query timeouts (5 seconds max)

## 🔍 Troubleshooting

**Production Deployment Issues (SOLVED):**
- **MIME Type Errors**: Dashboard asset location must come before general static assets in nginx
- **API 404 Errors**: Frontend must use `VITE_API_URL=/dashboard/api` and nginx needs URL rewrite
- **Redirect Loops**: Frontend base path must match nginx routing (`/dashboard/`)
- **nginx Config Fails**: Avoid `try_files` with `proxy_pass` and URI parts in named locations

**Common Development Issues**:
- **Database connection timeouts**: Check n8n database availability and credentials
- **Port conflicts**: Ensure ports 3000/3001 are free
- **CORS errors**: Verify `CORS_ORIGIN` matches frontend URL
- **Image loading failures**: Check filesystem cache permissions and base64 extraction
- **Memory issues**: Monitor execution data queries, implement proper pagination
- **Build failures**: Clear `node_modules` and reinstall, check TypeScript paths
- **Path alias errors**: Ensure tsc-alias runs after TypeScript compilation

**Development Database**: If n8n database is unavailable, use the provided test data in `database/test-data.json` for local development.

**Debugging Tips**:
- Backend logs: Check console output for detailed error information  
- Frontend network: Use browser DevTools to inspect API calls
- Database queries: Enable `LOG_DATABASE_QUERIES=true` for SQL debugging
- Authentication: Check token validity and rate limiting headers
- SSE connections: Monitor browser EventSource connection status

## ✅ Production Deployment Status

### **Self-Contained Architecture (2025-08-29):**
- ✅ **Domain**: https://sai.altermundi.net/dashboard/
- ✅ **Backend**: Self-contained routes under `/dashboard/api/*` (port 3001)
- ✅ **Frontend**: Vite development server (port 3000)  
- ✅ **Database**: 7,721+ SAI workflow executions connected
- ✅ **nginx**: Single location block, no route conflicts
- ✅ **No URL Rewriting**: Clean, maintainable configuration

**Current Live Environment:**
- Frontend: Port 3000 with `/dashboard/` base path
- Backend: Port 3001 with self-contained `/dashboard/api/*` routes
- Database: PostgreSQL read-only access with custom views
- Performance: Sub-second response times for dashboard queries

**Architecture Benefits:**
- **Zero Conflicts**: Complete isolation from existing SAI Proxy `/api/` routes
- **Maintainable**: Standard self-contained web application pattern
- **Future-Proof**: Won't break with infrastructure changes
- **Clean Deployment**: One nginx location block handles everything

This **self-contained deployment configuration** is production-ready and represents the evolution from complex routing to clean, maintainable architecture.

## 🔧 API Testing & Authentication (MANDATORY REFERENCE)

### **Correct API Authentication Pattern:**
```bash
# Get auth token first
curl -s "https://sai.altermundi.net/dashboard/api/auth/login" \
  -H "Content-Type:application/json" \
  -d '{"password":"SaiDash2025SecureProd"}' > /tmp/token.json

# Extract token  
jq -r '.data.token' /tmp/token.json > /tmp/token.txt

# Use token for API calls
curl -s "https://sai.altermundi.net/dashboard/api/executions/stats/enhanced" \
  -H "Authorization: Bearer $(cat /tmp/token.txt)"
```

### **Local Development Testing:**
```bash
# Health check (no auth required)
curl -s http://localhost:3001/dashboard/api/health | jq

# Login and get token
curl -s -X POST http://localhost:3001/dashboard/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"SaiDash2025SecureProd"}' | jq -r '.data.token' > /tmp/token.txt

# Test authenticated endpoint  
curl -s "http://localhost:3001/dashboard/api/executions?limit=1" \
  -H "Authorization: Bearer $(cat /tmp/token.txt)" | jq '.data | length'
```

### **NEVER DO (Common Mistakes):**
- Don't try multiple curl syntax variations in sequence
- Don't use shell variables for tokens across tool calls  
- Don't test authentication without first checking CLAUDE.md
- Always use the exact patterns documented above


## 🎯 Key Files to Understand

- **Backend Entry**: `backend/src/index.ts` - Express server with self-contained routes
- **API Routes**: `backend/src/routes/index.ts` - Complete API endpoint definitions
- **Frontend Entry**: `frontend/src/main.tsx` - React application bootstrap  
- **Vite Config**: `frontend/vite.config.ts` - Development server and build configuration
- **Database Schema**: `database/schema-analysis.md` - n8n database structure reference
- **Environment**: `.env.example` - Complete configuration template

**Architecture Docs**: Review `docs/ARCHITECTURE_ANALYSIS.md` for detailed design decisions and potential issues.