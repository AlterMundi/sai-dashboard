# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🎯 Project Overview

SAI Dashboard is a real-time fire detection monitoring system that provides a web interface for analyzing images processed by n8n workflows with **YOLO-based fire/smoke detection**.

**Key Context:**
- Uses custom YOLO Inference service for fire/smoke detection
- Two-database architecture: `n8n` (source) + `sai_dashboard` (analytics)
- Production deployment on public server with nginx

**Stack:** React 18 + TypeScript, Node.js + Express, PostgreSQL, Sharp (image processing)

---

## 🚀 Essential Commands

### Development

```bash
# Start both backend and frontend in development mode
npm run dev

# Or start individually
npm run dev:backend   # API on http://localhost:3001
npm run dev:frontend  # UI on http://localhost:3000

# Type checking (no compilation)
npm run type-check
npm run type-check:backend
npm run type-check:frontend

# Build for production
npm run build
npm run build:backend   # Runs: tsc && tsc-alias
npm run build:frontend  # Vite build with /dashboard/ base path
```

### Testing

```bash
# Run all tests (Jest for backend, frontend tests)
npm test

# Watch mode for rapid development
npm run test:watch

# Coverage reports
npm run test:coverage

# Quick sanity check
npm run test:quick

# Integration tests
npm run test:integration

# Production deployment verification
npm run test:deployment
```

### Linting

```bash
# ESLint with auto-fix
npm run lint
npm run lint:backend
npm run lint:frontend
```

### Database Operations

```bash
# Setup initial database schema
npm run db:setup --prefix backend

# Initialize ETL service
npm run etl:init --prefix backend

# Test ETL pipeline
npm run etl:test --prefix backend
```

### Production Deployment

```bash
# ALWAYS use this script for production
./install-production.sh

# This handles:
# - Dependency installation
# - Backend/frontend builds
# - Database migrations (if needed)
# - Quality checks
# - Service restart (systemd)

# Verify deployment
npm run deploy:verify
```

### System Operations

```bash
# Check service status
sudo systemctl status sai-dashboard-api

# View logs (real-time)
sudo journalctl -u sai-dashboard-api -f

# Restart service
sudo systemctl restart sai-dashboard-api

# Check ETL health
psql -U postgres -d sai_dashboard -c "SELECT * FROM etl_queue_health"
```

---

## 🏗️ Architecture Overview

### Two-Database Pattern

**n8n Database (Source):**
- Read-only access via `n8n_user`
- Contains raw execution data from n8n workflows
- Data format: n8n's compact reference-based JSON (NOT flat JSON)
- Retention: ~5 days of execution_data due to size

**sai_dashboard Database (Analytics):**
- Full read/write access via `sai_dashboard_user`
- Stores extracted/analyzed data for dashboard
- Tables: `executions`, `execution_analysis`, `execution_detections`, `execution_images`, `etl_processing_queue`
- Long-term retention (no automatic cleanup)

### Two-Stage ETL Pipeline (Critical)

```
n8n Workflow Completes → PostgreSQL NOTIFY
          ↓
[STAGE 1] Fast Metadata Extraction (<20ms)
  - Service: stage1-etl-service.ts
  - Inserts into executions table
  - Adds to etl_processing_queue for Stage 2
  - Dashboard immediately shows execution
          ↓
[STAGE 2] Deep YOLO Analysis Extraction (50-300ms)
  - Service: stage2-etl-service.ts
  - Parses n8n's compact reference format
  - Extracts YOLO results, images, bounding boxes
  - Inserts into execution_analysis + execution_detections
  - Updates execution_images table
  - SSE broadcast triggers UI update
```

**Why Two Stages?**
- Stage 1: Fast response (~15ms) - dashboard shows data immediately
- Stage 2: Expensive operations (JSONB parsing, image processing) happen async
- Prevents n8n NOTIFY/LISTEN from blocking

**Critical Implementation Detail:**
n8n stores data as an array with string-indexed references:
```javascript
// data[0] might be: {"node": "YOLO Inference", "data": ["69"]}
// Actual data is at: data[69]
// Must recursively resolve these references!
```

### Path Aliases (`@/`)

Backend uses TypeScript path aliases resolved by `tsc-alias`:
```typescript
import { logger } from '@/utils/logger';  // → backend/src/utils/logger.ts
import { config } from '@/config';        // → backend/src/config/index.ts
```

**Build Process:** `tsc` compiles, then `tsc-alias` resolves `@/` paths to relative paths in `dist/`.

### Image Storage Strategy

**Primary Storage:** `/mnt/raid1/n8n-backup/images/by-execution/{execution_id}/`
- `original.jpg` - JPEG from n8n
- `high.webp` - High-quality WebP (80% quality)
- `thumb.webp` - Thumbnail WebP (200px, 70% quality)

**Database Reference:** `execution_images` table stores paths + metadata
**Why Filesystem?** Large images (500KB-2MB) unsuitable for PostgreSQL bytea

---

## 📊 Database Schema (Pure YOLO - Post Migration 005)

### Core Tables

**`executions`** (Stage 1 ETL)
- Primary execution metadata from n8n
- Fields: `id`, `workflow_id`, `execution_timestamp`, `status`, `mode`, `duration_ms`
- Device metadata: `node_id`, `camera_id`, `device_id`, `location`, `camera_type`, `capture_timestamp`

**`execution_analysis`** (Stage 2 ETL)
- YOLO smoke detection results
- Fields: `execution_id`, `request_id`, `alert_level`, `detection_count`, `has_smoke`
- Confidence: `confidence_smoke`, `confidence_score`
- Detections: `detections` (JSONB array with bounding boxes), `active_classes` (string array)
- **16 columns total** (fire columns removed in Migration 010)
- **GIN Index:** Fast JSONB queries like `WHERE detections @> '[{"class": "smoke"}]'`

**`execution_images`** (Stage 2 ETL)
- Image cache metadata
- Fields: `execution_id`, `original_path`, `thumbnail_path`, `cached_path`
- Metadata: `size_bytes`, `width`, `height`, `format`, `quality_score`

**`etl_processing_queue`** (ETL Management)
- Tracks Stage 2 ETL processing status
- Fields: `execution_id`, `stage`, `status` (pending/processing/completed/failed), `priority`
- Retry logic: `attempts`, `max_attempts`, `last_error`

**`execution_notifications`** (Optional)
- Telegram notification tracking
- Fields: `execution_id`, `telegram_sent`, `telegram_message_id`, `sent_at`

### Foreign Keys (CASCADE)

All child tables have `ON DELETE CASCADE` to `executions.id`:
- Delete execution → automatically deletes analysis, images, queue entries

### Removed Tables (Migration 005)

**Previously existed but removed as unused:**
- `execution_detections` - Denormalized bounding boxes (now in `execution_analysis.detections` JSONB)
- `dashboard_stats` - Pre-computed metrics cache (never implemented)

---

## 🔧 Critical Code Patterns

### Stage 2 ETL: N8N Data Extraction

**IMPORTANT:** n8n uses a compact reference-based format. You MUST recursively resolve references:

```typescript
// WRONG - assumes direct data access
const yoloData = executionData.data[0].json;

// CORRECT - resolve references
function resolveReferences(data: any[], value: any): any {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const index = parseInt(value, 10);
    if (data[index]) return resolveReferences(data, data[index]);
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveReferences(data, v));
  }
  if (typeof value === 'object' && value !== null) {
    const resolved: any = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveReferences(data, v);
    }
    return resolved;
  }
  return value;
}

const resolvedData = resolveReferences(executionData.data, executionData.data[0]);
```

See: `backend/src/services/stage2-etl-service.ts` for full implementation.

### TypeScript Interfaces (YOLO Schema)

**Key interfaces in `backend/src/types/index.ts`:**

```typescript
interface SaiEnhancedAnalysis {
  executionId: string;
  requestId?: string;
  alertLevel?: 'none' | 'low' | 'medium' | 'high' | 'critical';
  detectionCount?: number;
  hasSmoke?: boolean;
  confidenceSmoke?: number;
  detections?: YoloDetection[];
  // ... 16 fields total
}

interface YoloDetection {
  class: string;  // 'smoke' | 'unknown'
  confidence: number;
  bounding_box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

**CRITICAL:** These interfaces match the database schema exactly. Do NOT add fields without corresponding database migration.

### SSE (Server-Sent Events)

Real-time updates use Server-Sent Events:
- Endpoint: `GET /dashboard/api/sse`
- Events: `new-execution`, `analysis-update`, `batch-update`
- Client: `frontend/src/contexts/SSEContext.tsx`
- Server: `backend/src/controllers/sse.ts`

**Common Issue:** SSE connections can stall if:
1. ETL queue is empty (no new data)
2. Network timeouts (use 30s heartbeat)
3. Client reconnection logic fails

---

## 📝 Important Files

### Backend
- `backend/src/index.ts` - Express server, middleware setup, route mounting
- `backend/src/routes/index.ts` - All API endpoints (executions, images, auth, health)
- `backend/src/services/stage1-etl-service.ts` - Fast metadata extraction
- `backend/src/services/stage2-etl-service.ts` - Deep YOLO extraction (most complex)
- `backend/src/services/new-execution-service.ts` - Query service for executions + analysis
- `backend/src/controllers/sse.ts` - Server-Sent Events for real-time updates
- `backend/src/middleware/auth.ts` - JWT authentication
- `backend/src/config/index.ts` - Environment configuration
- `backend/src/types/index.ts` - TypeScript interfaces (MUST match DB schema)

### Frontend
- `frontend/src/main.tsx` - React app entry point
- `frontend/src/App.tsx` - Router, authentication wrapper
- `frontend/src/contexts/SSEContext.tsx` - Real-time updates context
- `frontend/src/pages/Dashboard.tsx` - Main execution gallery view
- `frontend/src/components/ExecutionCard.tsx` - Individual execution display

### Configuration
- `.env.example` - Environment variables template
- `backend/tsconfig.json` - TypeScript config (note: excludes expert-review files)
- `install-production.sh` - Production deployment script
- `package.json` - Monorepo scripts, npm workspaces

### Database
- `database/migrations/003_yolo_schema_redesign.sql` - YOLO schema (Oct 2025)
- `database/migrations/004_remove_legacy_fields.sql` - Legacy cleanup (Oct 2025)
- `database/migrations/005_schema_cleanup.sql` - Remove unused tables/columns (Oct 2025)
- `database/migrations/README.md` - Migration history

### Documentation
- `docs/CONSOLIDATED_DOCUMENTATION.md` - Complete system guide (START HERE)
- `docs/DATABASE_SCHEMA.md` - ER diagram, field descriptions
- `docs/TWO_STAGE_ETL_ARCHITECTURE.md` - ETL deep dive
- `docs/DATA_INTEGRITY_PRINCIPLES.md` - NULL handling philosophy

---

## ⚠️ Common Pitfalls

### 1. Ollama References (LEGACY - DO NOT USE)
Before October 2025, this system was incorrectly built for Ollama AI analysis. The workflow actually uses **YOLO Inference service**.

**DO NOT:**
- Look for `ollama_response`, `has_ollama_analysis` (removed in Migration 003)
- Use `risk_level`, `smoke_detected`, `flame_detected` (removed in Migration 004)
- Reference `enhanced-analysis.ts` or `expert-review.ts` (disabled, excluded from build)

**DO:**
- Use YOLO-specific fields: `alert_level`, `has_smoke`, `detection_count`
- Query `execution_analysis.detections` JSONB field for bounding boxes
- Parse YOLO Inference node output (not Ollama node)

### 2. N8N Data Format
n8n does NOT store flat JSON. Data is an array with string-indexed references that must be recursively resolved. See Stage 2 ETL implementation.

### 3. Path Aliases in Tests
Jest and other tools may not resolve `@/` aliases. Use `ts-jest` with path mapping or relative imports in tests.

### 4. Image Cache Assumptions
Images are stored on filesystem, not in database. Always check `execution_images` table for paths before attempting to serve images.

### 5. Manual Builds
**NEVER** manually run `npm run build:backend && npm run build:frontend` in production.
**ALWAYS** use `./install-production.sh` which includes:
- Dependency checks
- Database migration checks
- Quality verification
- Service restart

---

## 🌐 Production Environment

**URLs:**
- Frontend: https://sai.altermundi.net/dashboard/
- API: https://sai.altermundi.net/dashboard/api/
- Health: https://sai.altermundi.net/dashboard/api/health

**Architecture:**
```
Public Server (131.72.205.6:443)
  ↓ [nginx]
  ↓
Private Server (localhost)
  ├── Dashboard API :3001
  ├── Dashboard UI :3000
  ├── PostgreSQL (n8n + sai_dashboard)
  └── RAID Storage (/mnt/raid1/n8n-backup/images/)
```

**Authentication:**
- Single password authentication (DASHBOARD_PASSWORD env var)
- JWT tokens with 24h expiration
- Session-based for UI, token-based for API

**Ports:**
- Backend: 3001 (bound to localhost only)
- Frontend: 3000 (bound to localhost only)
- SSH tunnels forward to public server

---

## 🔍 Debugging Tips

### ETL Not Processing
1. Check queue: `SELECT * FROM etl_processing_queue WHERE status = 'failed'`
2. Check logs: `sudo journalctl -u sai-dashboard-api -f`
3. Check n8n NOTIFY: `LISTEN n8n_execution_update;` in psql
4. Verify Stage 1 running: Look for "Stage 1: Processing execution X" in logs
5. Verify Stage 2 running: Look for "Stage 2: Completed execution X" in logs

### Images Not Loading
1. Check path exists: `ls -la /mnt/raid1/n8n-backup/images/by-execution/{exec_id}/`
2. Check permissions: Files should be readable by service user
3. Check execution_images table: `SELECT * FROM execution_images WHERE execution_id = X`
4. Check API response: `/dashboard/api/executions/{id}` should include image URLs

### SSE Not Updating
1. Check SSE connection: Browser DevTools → Network → EventSource
2. Check heartbeat: Should see ping every 30s
3. Check ETL: New executions should trigger `analysis-update` events
4. Check client reconnection logic in SSEContext.tsx

### Type Errors After Schema Changes
1. Update TypeScript interfaces in `backend/src/types/index.ts`
2. Update SQL queries in services (search for old field names)
3. Run `npm run type-check` to find remaining issues
4. Rebuild: `npm run build:backend`

---

## 📚 Additional Context

### Recent History (October 2025)
- **Migration 003:** Redesigned schema for YOLO (was incorrectly built for Ollama)
- **Migration 004:** Removed 13 legacy Ollama fields (31 → 18 columns)
- **Migration 005:** Removed unused tables (`execution_detections`, `dashboard_stats`) and columns (`backup_path`)
- **Ollama Cleanup:** Deleted 133,696 historical Ollama executions (recovered 167 GB)
- **Current State:** Pure YOLO system with clean schema, JSONB-based detection storage

### Data Retention
- **n8n database:** ~5 days of execution_data (automatically purged by n8n)
- **sai_dashboard database:** Indefinite retention
- **Images:** Indefinite retention on RAID (180 GB total as of Oct 2025)
- **Execution ID cutoff:** 176444+ are YOLO executions (< 176444 were Ollama, now deleted)

### Expert Review System
**Status:** DISABLED (as of Oct 2025)

The expert review system was designed for Ollama's text-based analysis. With the switch to YOLO, this system needs redesign. Files are excluded from compilation in `tsconfig.json`:
- `src/services/expert-review.ts`
- `src/controllers/expert-review.ts`
- `src/services/enhanced-analysis.ts`

Do not attempt to re-enable without first updating for YOLO schema.
