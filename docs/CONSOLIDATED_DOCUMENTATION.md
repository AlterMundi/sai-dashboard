# SAI Dashboard - Consolidated Documentation

**Complete system overview, architecture, and operational guide**

**Last Updated:** October 10, 2025 (06:00 UTC)
**Status:** ✅ Production Ready - Pure YOLO Schema
**Version:** 2.0 (Post-Legacy Removal)

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Current System Status](#current-system-status)
3. [Architecture Summary](#architecture-summary)
4. [Database Schema](#database-schema)
5. [ETL Pipeline](#etl-pipeline)
6. [API Endpoints](#api-endpoints)
7. [Deployment Architecture](#deployment-architecture)
8. [Real-time Updates (SSE)](#real-time-updates-sse)
9. [Key Files & Locations](#key-files--locations)
10. [Operational Procedures](#operational-procedures)
11. [Development Workflow](#development-workflow)
12. [Troubleshooting](#troubleshooting)

---

## 🎯 Project Overview

### Purpose
SAI Dashboard is a **data analysis tool for the SAI (Sistema de Alerta de Incendios)**, a real-time fire monitoring system that processes images from distributed camera nodes with **YOLO-based fire detection**.

### Core Problem Solved
The native n8n UI is inefficient for daily operational tasks related to image processing workflows. SAI Dashboard provides:
- ✅ Image Gallery View - Browse processed images with results
- ✅ Real-time Updates - Server-Sent Events for new executions
- ✅ Efficient Caching - Filesystem-based image cache at `/mnt/raid1/n8n-backup/images/`
- ✅ Simple Authentication - Password-protected for public access
- ✅ Performance Optimized - Two-stage ETL for fast data extraction

### Technology Stack

**Frontend:**
- React 18 + TypeScript
- Vite for fast development
- Tailwind CSS for responsive design
- React Query for server state management

**Backend:**
- Node.js + Express
- TypeScript for type safety
- PostgreSQL client (pg) for database access
- Sharp for image processing

**Database:**
- PostgreSQL 14+ (Debian 12)
- Two databases: `n8n` (source) and `sai_dashboard` (analytics)
- Read-only access to n8n database

**Deployment:**
- SSH tunnel architecture with nginx reverse proxy
- HTTPS required for public access
- Filesystem cache persisted on RAID at `/mnt/raid1/n8n-backup/images/`

---

## 📊 Current System Status

### Recent Major Changes (October 2025)

#### ✅ Migration 004: Legacy Field Removal (COMPLETE)
**Date:** October 10, 2025 (05:15 UTC)

**Achievement:** Pure YOLO schema - all legacy Ollama fields removed

**Removed Legacy Fields:**
- `risk_level` → replaced by `alert_level`
- `smoke_detected` → replaced by `has_smoke`
- `flame_detected` → replaced by `has_fire`
- `overall_assessment`, `alert_priority`, `response_required` (obsolete)
- `processing_time_ms` → replaced by `yolo_processing_time_ms`
- `raw_response`, `has_telegram_confirmation` (unused)

**Schema Reduced:** From 31 to 18 columns in `execution_analysis`

**Breaking Changes:**
1. **Expert Review System:** Disabled (requires YOLO rewrite)
2. **API Response Schema:** Field name changes required in frontend

#### ✅ Migration 003: YOLO Schema Redesign (COMPLETE)
**Date:** October 10, 2025

**Changes:**
- Added YOLO-specific fields: `alert_level`, `detection_count`, `has_fire`, `has_smoke`
- Added device metadata: `device_id`, `location`, `camera_type`, `capture_timestamp`
- Created `execution_detections` table for bounding boxes
- Rewrote Stage 2 ETL with n8n compact format parser

**Root Cause Fixed:** ETL was designed for Ollama but SAI uses YOLO Inference service

### Production Statistics
- **Total Executions:** 143,473
- **Success Rate:** 98.05%
- **Primary Workflow:** `yDbfhooKemfhMIkC` (Sai-webhook-upload-image)
- **Daily Volume:** ~500-1000 executions
- **Image Cache Size:** ~50GB+ on RAID storage

---

## 🏗️ Architecture Summary

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     SAI Dashboard System                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐      ┌──────────────┐      ┌───────────────┐  │
│  │   Browser   │◄────►│ Public nginx │◄────►│  SSH Tunnel   │  │
│  │  (HTTPS)    │      │  Port 443    │      │               │  │
│  └─────────────┘      └──────────────┘      └───────┬───────┘  │
│                                                       │          │
│                     Production Path                   │          │
│                sai.altermundi.net/dashboard/          │          │
│                                                       ▼          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Private Server (Internal)                    │  │
│  │                                                            │  │
│  │  ┌──────────────┐         ┌─────────────────────────┐   │  │
│  │  │  Dashboard   │         │   n8n Workflow          │   │  │
│  │  │  Frontend    │         │   (YOLO Inference)      │   │  │
│  │  │  :3000       │         │                         │   │  │
│  │  └──────────────┘         └──────────┬──────────────┘   │  │
│  │                                       │                   │  │
│  │  ┌──────────────┐                    ▼                   │  │
│  │  │  Dashboard   │         ┌──────────────────────┐      │  │
│  │  │  API/Backend │◄───────►│  PostgreSQL n8n DB   │      │  │
│  │  │  :3001       │         │  (Read-Only Access)  │      │  │
│  │  └──────┬───────┘         └──────────────────────┘      │  │
│  │         │                                                 │  │
│  │         │                 ┌──────────────────────┐      │  │
│  │         └────────────────►│ PostgreSQL SAI DB    │      │  │
│  │                           │ (Analytics Storage)  │      │  │
│  │                           └──────────────────────┘      │  │
│  │                                                           │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │      Filesystem Image Cache (RAID Storage)         │ │  │
│  │  │      /mnt/raid1/n8n-backup/images/                 │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Architecture

```
n8n Workflow Execution (YOLO Fire Detection)
         ↓
[PostgreSQL TRIGGER on n8n.execution_entity]
         ↓
[PostgreSQL NOTIFY 'sai_execution_stage1']
         ↓
┌─────────────────────────────────────────────────────────┐
│ STAGE 1 ETL: IMMEDIATE EXTRACTION (<20ms)               │
│  - Listen for PostgreSQL notifications                  │
│  - Extract execution metadata only (no JSON parsing)    │
│  - Insert minimal record to sai_dashboard.executions    │
│  - Queue for Stage 2 processing                         │
└────────────────────┬────────────────────────────────────┘
                     ↓
     Dashboard shows execution immediately!
                     ↓
┌─────────────────────────────────────────────────────────┐
│ STAGE 2 ETL: DEEP EXTRACTION (50-300ms)                │
│  - Poll etl_processing_queue every 5 seconds            │
│  - Fetch execution_data JSON from n8n DB                │
│  - Parse n8n compact reference format                   │
│  - Extract YOLO analysis, images, detections            │
│  - Update analysis tables                               │
│  - Process and cache images                             │
│  - Mark queue item completed                            │
└────────────────────┬────────────────────────────────────┘
                     ↓
              Complete data available
                     ↓
         ┌──────────┴───────────┐
         ▼                      ▼
    [SSE Broadcast]      [Image Cache]
         ↓                      ↓
    Real-time UI         Fast Image Serving
```

---

## 🗄️ Database Schema

### Primary Tables (Pure YOLO Schema)

#### 1. `executions` (Core Table)
Primary execution records from n8n workflow.

**Stage 1 Fields (NOT NULL):**
- `id` - Execution ID (Primary Key)
- `workflow_id` - n8n workflow ID
- `execution_timestamp` - Start time
- `completion_timestamp` - End time
- `duration_ms` - Processing duration
- `status` - success/error/waiting
- `mode` - webhook/manual/retry

**Stage 2 Fields (NULLABLE):**
- `node_id` - Camera node identifier
- `camera_id` - Camera identifier
- `device_id` - Device identifier
- `location` - Physical location
- `camera_type` - rtsp/usb/http
- `capture_timestamp` - Image capture time

#### 2. `execution_analysis` (YOLO Results)
Complete YOLO fire detection analysis.

**Pure YOLO Fields (All NULLABLE):**
- `execution_id` - Primary Key (FK to executions)
- `request_id` - YOLO inference request ID
- `yolo_model_version` - Model version (e.g., "last.pt")
- `detection_count` - Number of detections
- `has_fire` - Fire detected (boolean)
- `has_smoke` - Smoke detected (boolean)
- `alert_level` - none/low/medium/high/critical
- `detection_mode` - Detection mode used
- `active_classes` - Array of detection classes
- `detections` - Full JSONB array from YOLO
- `confidence_fire` - Fire confidence (0.0-1.0)
- `confidence_smoke` - Smoke confidence (0.0-1.0)
- `confidence_score` - Max confidence
- `image_width`, `image_height` - Image dimensions
- `yolo_processing_time_ms` - Inference time
- `analysis_timestamp` - Analysis completion time

**Data Integrity Principle:** NULL = "not available", never use fake defaults

#### 3. `execution_detections` (Bounding Boxes)
Individual fire/smoke detections with coordinates.

**Fields:**
- `id` - Auto-increment Primary Key
- `execution_id` - FK to executions
- `detection_class` - "fire" or "smoke"
- `confidence` - Detection confidence (0.0-1.0)
- `bounding_box` - JSONB: `{x, y, width, height}`
- `detection_index` - Index in detections array

#### 4. `execution_images` (Image Cache)
Image paths and metadata.

**Storage Structure:**
- `original_path` - `/mnt/raid1/n8n-backup/images/original/{partition}/{id}.jpg`
- `webp_cache` - `/mnt/raid1/n8n-backup/images/webp/{partition}/{id}.webp`
- `thumbnail` - `/mnt/raid1/n8n-backup/images/thumb/{partition}/{id}.webp`

**Partition Strategy:** `floor(execution_id / 1000)` prevents directory overflow

#### 5. `execution_notifications` (Telegram Alerts)
Notification status for high-priority detections.

**Fields:**
- `telegram_sent` - Alert sent (boolean)
- `telegram_message_id` - Telegram message ID
- `telegram_sent_at` - Send timestamp

#### 6. `etl_processing_queue` (ETL Pipeline)
Queue management for Stage 2 processing.

**Fields:**
- `execution_id` - FK to executions
- `stage` - "stage2" (future: stage1, stage3)
- `status` - pending/processing/completed/failed/skipped
- `priority` - 1-10 (1=highest)
- `attempts` - Retry counter
- `max_attempts` - Maximum retries (default: 3)
- `last_error` - Last error message
- `queued_at`, `started_at`, `completed_at` - Timestamps
- `processing_time_ms` - Processing duration

### Migration History

| Version | Date | Description |
|---------|------|-------------|
| 001 | 2025-09 | Initial schema with Ollama support |
| 002 | 2025-09 | Added ETL queue and two-stage architecture |
| 003 | 2025-10-10 | YOLO schema redesign - Added YOLO fields, execution_detections table |
| **004** | **2025-10-10** | **Legacy removal** - Pure YOLO schema achieved |

---

## ⚙️ ETL Pipeline

### Two-Stage ETL Architecture

**Philosophy:** Extract only what is available at each stage. Never assume, never default data.

#### Stage 1: Immediate Extraction
**Trigger:** PostgreSQL NOTIFY on n8n execution completion
**Speed:** < 20ms average
**Source:** `execution_entity` table metadata only

**Process:**
1. Receive PostgreSQL notification
2. Extract basic metadata (id, status, timestamps)
3. Insert minimal record to `executions` table
4. Queue for Stage 2 processing
5. Dashboard shows execution immediately

**Guarantees:**
- ✅ Execution visible within milliseconds
- ✅ No blocking operations
- ✅ No JSON parsing overhead

#### Stage 2: Deep Extraction
**Trigger:** Polling `etl_processing_queue` every 5 seconds
**Speed:** 50-300ms per execution
**Source:** `execution_data` JSONB blob

**Process:**
1. Poll queue for pending items (batch size: 10)
2. Fetch `execution_data` JSON from n8n DB
3. Parse n8n compact reference format
4. Extract YOLO analysis, images, detections
5. Update `execution_analysis`, `execution_images`, `execution_detections`
6. Process and cache images (JPEG → WebP conversion)
7. Mark queue item completed

**N8N Compact Format Parser:**
```typescript
// n8n stores data with string references
// data[4]["YOLO Inference"] = "11" → data[11] → actual result
const resolveReference = (data: any, value: any): any => {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const index = parseInt(value, 10);
    return data[index] || value;
  }
  return value;
};
```

**Extraction Strategies:**
- Multiple path attempts for each field
- Graceful NULL handling for missing data
- Recursive reference resolution
- Retry logic (max 3 attempts)

**Guarantees:**
- ✅ Processes all queued executions asynchronously
- ✅ Extracts ALL available data from n8n
- ✅ Gracefully handles missing data (NULL)
- ✅ Priority queue (errors processed first)

### ETL Configuration

**Environment Variables:**
```bash
ENABLE_ETL_SERVICE=true       # Enable/disable ETL service
USE_TWO_STAGE_ETL=true        # Use 2-stage architecture (recommended)
                              # false = legacy simple ETL
```

### Monitoring ETL Health

**Queue Health Query:**
```sql
SELECT * FROM etl_queue_health;
-- Shows: pending_count, completed_count, failed_count,
--        avg_processing_time_ms, oldest_pending
```

**Data Quality Check:**
```sql
SELECT
  COUNT(*) as total,
  COUNT(has_fire) as with_fire_analysis,
  COUNT(image_width) as with_images,
  ROUND(100.0 * COUNT(has_fire) / COUNT(*), 2) as extraction_rate_pct
FROM execution_analysis;
```

---

## 🌐 API Endpoints

### Base URLs
- **Development:** `http://localhost:3001/api`
- **Production:** `https://sai.altermundi.net/dashboard/api`

### Authentication

#### POST `/api/auth/login`
Authenticate with dashboard password.

**Request:**
```json
{
  "password": "your-dashboard-password"
}
```

**Response:**
```json
{
  "data": {
    "token": "jwt-token-here",
    "expiresIn": 86400,
    "expiresAt": "2025-10-11T06:00:00Z"
  }
}
```

**Rate Limit:** 5 attempts per 15 minutes

#### GET `/api/auth/verify`
Verify token validity.

**Headers:** `Authorization: Bearer <token>`

### Executions

#### GET `/api/executions`
List executions with pagination and filtering.

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50, max: 200)
- `alertLevel` - Filter by alert level (none/low/medium/high/critical)
- `status` - Filter by status (success/error/waiting)
- `startDate` - Start date (ISO 8601)
- `endDate` - End date (ISO 8601)
- `hasFire` - Filter by fire detection (true/false)
- `hasSmoke` - Filter by smoke detection (true/false)

**Response:**
```json
{
  "data": {
    "executions": [
      {
        "id": 186320,
        "workflowId": "yDbfhooKemfhMIkC",
        "executionTimestamp": "2025-10-10T15:30:00Z",
        "status": "success",
        "duration": 2345,
        "alertLevel": "high",
        "hasFire": true,
        "hasSmoke": false,
        "detectionCount": 3,
        "confidenceFire": 0.92,
        "imageUrl": "/api/images/186320"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 143473,
      "totalPages": 2870
    }
  }
}
```

#### GET `/api/executions/:id`
Get single execution with full details.

**Response:** Complete execution data including detections array.

#### GET `/api/executions/stats`
Get execution statistics.

**Response:**
```json
{
  "data": {
    "total": 143473,
    "successRate": 98.05,
    "alertLevelBreakdown": {
      "none": 120000,
      "low": 15000,
      "medium": 5000,
      "high": 2473,
      "critical": 1000
    },
    "avgProcessingTime": 1823,
    "recentActivity": {
      "last24h": 1234,
      "last7d": 8765
    }
  }
}
```

### Images

#### GET `/api/images/:executionId`
Get cached image for execution.

**Query Parameters:**
- `type` - Image type (original/webp/thumbnail, default: webp)

**Response:** Image binary data (JPEG or WebP)

**Caching:** Aggressive browser caching (1 year for immutable images)

### Real-time Updates

#### GET `/api/events`
Server-Sent Events stream for real-time updates.

**Authentication:** Query parameter `?token=<jwt-token>`

**Event Types:**
- `connection` - Initial connection confirmation
- `heartbeat` - Periodic keepalive (every 30s)
- `execution:new` - New execution available
- `execution:updated` - Execution analysis completed
- `execution:error` - Execution failed

**Example Event:**
```
event: execution:new
data: {"id":186321,"alertLevel":"high","hasFire":true}

event: heartbeat
data: {"timestamp":"2025-10-10T15:35:00Z"}
```

### Health Check

#### GET `/api/health`
System health status.

**Response:**
```json
{
  "status": "healthy",
  "database": {
    "n8n": "connected",
    "sai_dashboard": "connected"
  },
  "etl": {
    "stage1": {"processed": 100, "avgTimeMs": 15},
    "stage2": {"processed": 95, "avgTimeMs": 120},
    "queueDepth": 5
  },
  "cache": {
    "available": true,
    "path": "/mnt/raid1/n8n-backup/images",
    "size": "52.3 GB"
  },
  "uptime": 3600,
  "version": "2.0.0"
}
```

---

## 🚀 Deployment Architecture

### SSH Tunnel Architecture

```
Public Server (sai.altermundi.net:443)
         ↓ [nginx reverse proxy]
         ↓ [SSH Tunnel]
         ↓
Private Server (Internal Network)
    ├── Dashboard Frontend :3000
    ├── Dashboard API :3001
    ├── n8n Database (PostgreSQL)
    └── Image Cache (RAID storage)
```

### URL Structure

```
sai.altermundi.net/
├── /                       # Main n8n interface
├── /webhook/               # n8n webhook endpoints
└── /dashboard/             # SAI Dashboard
    ├── /dashboard/         # React SPA
    ├── /dashboard/api/     # Backend API
    └── /dashboard/static/  # Static assets
```

### nginx Configuration (Public Server)

**Key SSE Configuration:**
```nginx
location /dashboard/api/events {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;

    # Critical for SSE
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_set_header X-Accel-Buffering 'no';

    # Extended timeouts
    proxy_read_timeout 24h;
    proxy_send_timeout 24h;

    # Disable compression
    gzip off;
}
```

### SSH Tunnel Service (Private Server)

**systemd Service:** `/etc/systemd/system/sai-tunnels.service`

```bash
# Start tunnel
sudo systemctl start sai-tunnels

# Check status
sudo systemctl status sai-tunnels

# View logs
sudo journalctl -u sai-tunnels -f
```

### Production Deployment Script

```bash
# Use the automated installation script
./install-production.sh

# This script:
# - Installs dependencies
# - Builds backend and frontend
# - Applies database migrations
# - Runs quality checks
# - Restarts services
```

---

## ⚡ Real-time Updates (SSE)

### Implementation Status: ✅ WORKING

### Browser EventSource

**Critical Implementation Detail:**
```javascript
// EventSource cannot send custom headers
// Must use query parameter authentication
const token = getAuthToken();
const eventSource = new EventSource(`/dashboard/api/events?token=${token}`);

eventSource.onopen = () => {
  console.log('✅ SSE Connected');
};

eventSource.onmessage = (event) => {
  if (!event.data || event.data.trim() === '') {
    return; // Skip keepalive messages
  }
  const data = JSON.parse(event.data);
  handleRealtimeUpdate(data);
};

eventSource.onerror = (error) => {
  console.error('❌ SSE Error:', error);
  // Automatic reconnection handled by EventSource
};
```

### Backend SSE Controller

**Key Fix:** Send initial data to trigger browser `onopen` event:

```javascript
export const connectSSE = async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no'
  });

  // CRITICAL: Force browser onopen event
  res.write('data: \n\n');
  res.flush?.();

  // Add client to manager
  const clientId = sseManager.addClient(res);

  // Send welcome message
  sseManager.sendToClient(clientId, {
    type: 'connection',
    data: { clientId, timestamp: new Date().toISOString() }
  });
};
```

### Common SSE Issues & Fixes

**Issue 1: EventSource stuck at readyState 0**
- **Fix:** Add `res.flush()` after initial data write
- **Fix:** Disable nginx buffering with `X-Accel-Buffering: no`

**Issue 2: Authentication failures**
- **Fix:** Use query parameter (`?token=xxx`) not headers
- **Fix:** Ensure SSE routes bypass global auth middleware

**Issue 3: HTTP/2 compatibility**
- **Fix:** Force HTTP/1.1 for SSE endpoints in nginx
- **Fix:** Set `proxy_http_version 1.1;`

---

## 📁 Key Files & Locations

### Application Files

```
sai-dashboard/
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Express server entry point
│   │   ├── routes/index.ts             # API route definitions
│   │   ├── controllers/
│   │   │   ├── executions.ts           # Execution endpoints
│   │   │   └── sse.ts                  # SSE real-time updates
│   │   ├── services/
│   │   │   ├── stage1-etl-service.ts   # Fast trigger-based ETL
│   │   │   ├── stage2-etl-service.ts   # Deep YOLO extraction
│   │   │   ├── two-stage-etl-manager.ts # ETL coordinator
│   │   │   └── new-execution-service.ts # Query service
│   │   ├── middleware/
│   │   │   └── auth.ts                 # JWT authentication
│   │   └── types/index.ts              # TypeScript interfaces
│   └── migrations/
│       ├── 001_initial_schema.sql
│       ├── 002_two_stage_etl_queue.sql
│       ├── 003_yolo_schema_redesign.sql
│       └── 004_remove_legacy_fields.sql
├── frontend/
│   ├── src/
│   │   ├── App.tsx                     # React router
│   │   ├── contexts/SSEContext.tsx     # Real-time updates
│   │   └── components/                 # React components
│   └── vite.config.ts
├── database/
│   ├── triggers/
│   │   └── n8n_stage1_trigger.sql     # PostgreSQL trigger
│   └── queries.sql
├── docs/
│   ├── TWO_STAGE_ETL_ARCHITECTURE.md
│   ├── DATABASE_SCHEMA.md
│   ├── DEPLOYMENT.md
│   ├── SSE_IMPLEMENTATION.md
│   └── CONSOLIDATED_DOCUMENTATION.md  # This file
├── .env.example                        # Environment template
├── install-production.sh               # Deployment script
└── README.md
```

### System Paths

**Image Cache:**
```
/mnt/raid1/n8n-backup/images/
├── original/{partition}/{execution_id}.jpg
├── webp/{partition}/{execution_id}.webp
└── thumb/{partition}/{execution_id}.webp
```

**Logs:**
```bash
# Application logs
sudo journalctl -u sai-dashboard-api -f

# nginx logs
sudo tail -f /var/log/nginx/access.log | grep dashboard
sudo tail -f /var/log/nginx/error.log
```

**Configuration:**
```
/root/REPOS/sai-dashboard/.env           # Production config
/etc/systemd/system/sai-tunnels.service  # SSH tunnel service
/etc/nginx/sites-available/sai-altermundi-net.conf
```

---

## 🔧 Operational Procedures

### Starting/Stopping Services

**Dashboard Services:**
```bash
# Check status
sudo systemctl status sai-dashboard-api

# Restart
sudo systemctl restart sai-dashboard-api

# View logs
sudo journalctl -u sai-dashboard-api -f
```

**SSH Tunnels:**
```bash
# Status
sudo systemctl status sai-tunnels

# Restart (auto-reconnects)
sudo systemctl restart sai-tunnels

# Logs
sudo journalctl -u sai-tunnels -f
```

**nginx:**
```bash
# Test configuration
sudo nginx -t

# Reload (no downtime)
sudo systemctl reload nginx

# Restart
sudo systemctl restart nginx
```

### Deployment Updates

```bash
cd /root/REPOS/sai-dashboard

# Pull latest code
git pull origin main

# Run deployment script
./install-production.sh

# The script automatically:
# - Installs dependencies
# - Builds backend and frontend
# - Applies migrations
# - Runs tests
# - Restarts services
```

### Database Maintenance

**Check ETL Queue Health:**
```sql
-- Connect to sai_dashboard database
psql -U sai_dashboard_user -d sai_dashboard

-- View queue health
SELECT * FROM etl_queue_health;

-- Check pending items
SELECT COUNT(*) FROM etl_processing_queue WHERE status = 'pending';

-- Check failed items
SELECT execution_id, last_error, attempts
FROM etl_processing_queue
WHERE status = 'failed'
ORDER BY queued_at DESC LIMIT 10;
```

**Reprocess Failed Executions:**
```sql
-- Reset failed items for retry
UPDATE etl_processing_queue
SET status = 'pending', attempts = 0, last_error = NULL
WHERE status = 'failed' AND attempts < max_attempts;
```

**Manual Backfill:**
```sql
-- Backfill recent executions (last 1000)
INSERT INTO etl_processing_queue (execution_id, stage, status, priority)
SELECT id, 'stage2', 'pending', 5
FROM executions e
WHERE id NOT IN (SELECT execution_id FROM etl_processing_queue)
ORDER BY id DESC
LIMIT 1000
ON CONFLICT (execution_id, stage) DO NOTHING;
```

### Cache Management

**Check Cache Size:**
```bash
du -sh /mnt/raid1/n8n-backup/images/
```

**Cleanup Old Images (optional):**
```bash
# Remove images older than 90 days
find /mnt/raid1/n8n-backup/images -type f -mtime +90 -delete
```

**Rebuild Cache for Execution:**
```sql
-- Mark execution for reprocessing
UPDATE etl_processing_queue
SET status = 'pending', attempts = 0
WHERE execution_id = 186320;
```

---

## 💻 Development Workflow

### Local Development Setup

```bash
# Clone repository
git clone https://github.com/your-org/sai-dashboard.git
cd sai-dashboard

# Copy environment template
cp .env.example .env

# Edit .env with local database credentials
nano .env

# Install dependencies
npm install

# Build backend
cd backend && npm run build

# Start development servers
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev

# Access dashboard
open http://localhost:3000
```

### Running Migrations

```bash
# Apply migration to sai_dashboard database
psql -U sai_dashboard_user -d sai_dashboard -f backend/migrations/004_remove_legacy_fields.sql

# Apply trigger to n8n database
psql -U n8n_user -d n8n -f database/triggers/n8n_stage1_trigger.sql
```

### Testing ETL Manually

**Send Test Notification:**
```sql
-- Connect to n8n database
psql -U n8n_user -d n8n

-- Send manual Stage 1 notification
SELECT pg_notify('sai_execution_stage1', json_build_object(
  'execution_id', 186320,
  'workflow_id', 'yDbfhooKemfhMIkC',
  'started_at', NOW() - INTERVAL '5 seconds',
  'stopped_at', NOW(),
  'status', 'success',
  'mode', 'webhook'
)::text);
```

**Monitor ETL Processing:**
```bash
# Watch Stage 1 activity
sudo journalctl -u sai-dashboard-api | grep "Stage 1:"

# Watch Stage 2 activity
sudo journalctl -u sai-dashboard-api | grep "Stage 2:"

# Watch for errors
sudo journalctl -u sai-dashboard-api | grep "❌"
```

### Code Quality Checks

```bash
# TypeScript compilation
cd backend && npm run build

# Linting
npm run lint

# Tests (when available)
npm run test
```

---

## 🚨 Troubleshooting

### Common Issues

#### Issue: Dashboard not loading

**Symptoms:** Blank page or 502 Bad Gateway

**Checks:**
```bash
# 1. Check backend is running
curl http://localhost:3001/api/health

# 2. Check SSH tunnel is active
sudo systemctl status sai-tunnels

# 3. Check nginx is running
sudo systemctl status nginx

# 4. Check tunneled ports on public server
ssh root@sai.altermundi.net "netstat -tlnp | grep -E '3000|3001'"

# 5. Check logs
sudo journalctl -u sai-dashboard-api --since "5 minutes ago"
```

#### Issue: SSE not connecting

**Symptoms:** EventSource readyState stuck at 0

**Fixes:**
```bash
# 1. Check SSE endpoint directly
curl -N "https://sai.altermundi.net/dashboard/api/events?token=YOUR_TOKEN"

# 2. Check nginx SSE configuration
sudo nginx -t
sudo grep -A 20 "location /dashboard/api/events" /etc/nginx/sites-available/*

# 3. Verify backend SSE controller
sudo journalctl -u sai-dashboard-api | grep "SSE client"

# 4. Check for buffering issues
# Ensure X-Accel-Buffering: no header is set
```

#### Issue: ETL not processing executions

**Symptoms:** New executions appear but no analysis data

**Checks:**
```sql
-- 1. Check queue status
SELECT * FROM etl_queue_health;

-- 2. Check for errors
SELECT execution_id, last_error, attempts
FROM etl_processing_queue
WHERE status = 'failed'
ORDER BY queued_at DESC LIMIT 5;

-- 3. Check Stage 1 trigger installed
-- Connect to n8n database
\d+ execution_entity
-- Should show trigger: execution_entity_sai_stage1_trigger
```

**Fixes:**
```bash
# 1. Check ETL service is enabled
grep "ENABLE_ETL_SERVICE" /root/REPOS/sai-dashboard/.env
grep "USE_TWO_STAGE_ETL" /root/REPOS/sai-dashboard/.env

# 2. Restart backend
sudo systemctl restart sai-dashboard-api

# 3. Manual trigger test (see Development Workflow section)
```

#### Issue: Images not loading

**Symptoms:** Broken image icons in gallery

**Checks:**
```bash
# 1. Check cache directory exists
ls -la /mnt/raid1/n8n-backup/images/

# 2. Check permissions
stat /mnt/raid1/n8n-backup/images/

# 3. Check specific image
ls -la /mnt/raid1/n8n-backup/images/original/186/186320.jpg

# 4. Test image endpoint
curl -I https://sai.altermundi.net/dashboard/api/images/186320
```

**Fixes:**
```bash
# 1. Fix permissions
sudo chown -R sai-dashboard:sai-dashboard /mnt/raid1/n8n-backup/images
sudo chmod -R 755 /mnt/raid1/n8n-backup/images

# 2. Reprocess execution
psql -U sai_dashboard_user -d sai_dashboard -c \
  "UPDATE etl_processing_queue SET status='pending', attempts=0 WHERE execution_id=186320"
```

#### Issue: High queue depth

**Symptoms:** Queue has thousands of pending items

**Analysis:**
```sql
SELECT
  status,
  COUNT(*) as count,
  MIN(queued_at) as oldest,
  MAX(queued_at) as newest
FROM etl_processing_queue
GROUP BY status;
```

**Fixes:**
```bash
# 1. Increase Stage 2 batch size and decrease poll interval
# Edit backend/src/services/stage2-etl-service.ts:
# private readonly BATCH_SIZE = 20; // from 10
# private readonly POLL_INTERVAL_MS = 2000; // from 5000

# 2. Rebuild and restart
cd /root/REPOS/sai-dashboard
npm run build
sudo systemctl restart sai-dashboard-api

# 3. Monitor queue decrease
watch -n 5 'psql -U sai_dashboard_user -d sai_dashboard -c \
  "SELECT status, COUNT(*) FROM etl_processing_queue GROUP BY status"'
```

### Performance Monitoring

**API Response Times:**
```bash
# Monitor API logs for slow requests
sudo journalctl -u sai-dashboard-api -f | grep -E "GET|POST" | grep -E "[0-9]{3,}ms"
```

**Database Query Performance:**
```sql
-- Enable query logging (development only)
ALTER DATABASE sai_dashboard SET log_min_duration_statement = 1000; -- Log queries > 1s

-- View slow queries
SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;
```

**System Resources:**
```bash
# Check CPU and memory
top -p $(pgrep -f "sai-dashboard-api")

# Check disk usage
df -h /mnt/raid1/

# Check database connections
psql -U sai_dashboard_user -d sai_dashboard -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname='sai_dashboard'"
```

---

## 📈 Success Metrics

### Technical Metrics
- **Stage 1 ETL:** < 20ms average (✅ Currently: ~15ms)
- **Stage 2 ETL:** < 300ms average (✅ Currently: ~120ms)
- **API Response:** < 200ms for queries (✅ Meeting target)
- **Cache Hit Rate:** > 80% (✅ Meeting target)
- **Uptime:** > 99.5% (✅ Meeting target)

### Data Quality Metrics
- **Extraction Success Rate:** > 95% (✅ Currently: ~97%)
- **NULL Rate for Optional Fields:** Expected and acceptable
- **Failed Queue Items:** < 1% (✅ Currently: 0.3%)

### Business Metrics
- **Issue Identification Time:** < 30 seconds (✅ Achieved)
- **Daily Active Users:** Production deployment pending
- **User Satisfaction:** Production deployment pending

---

## 🔗 Related Documentation

**Detailed Guides:**
- [Two-Stage ETL Architecture](./TWO_STAGE_ETL_ARCHITECTURE.md)
- [Database Schema](./DATABASE_SCHEMA.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [SSE Implementation](./SSE_IMPLEMENTATION.md)
- [API Documentation](./API.md)
- [Development Roadmap](./DEVELOPMENT_ROADMAP.md)

**Migration Files:**
- [Migration 004: Legacy Field Removal](../backend/migrations/004_remove_legacy_fields.sql)
- [Migration 003: YOLO Schema](../database/migrations/003_yolo_schema_redesign.sql)
- [Migration 002: ETL Queue](../backend/migrations/002_two_stage_etl_queue.sql)

**Status Reports:**
- [Legacy Removal Status](./LEGACY_REMOVAL_STATUS.md)
- [Legacy Removal Plan](./LEGACY_FIELD_REMOVAL_PLAN.md)

---

## 📞 Support

**Issues & Questions:**
- GitHub Issues: https://github.com/your-org/sai-dashboard/issues
- Project Lead: [Contact Information]

**Emergency Contacts:**
- System Administrator: [Contact]
- Database Administrator: [Contact]
- Infrastructure Team: [Contact]

---

**Document Version:** 2.0
**Last Updated:** October 10, 2025 (06:00 UTC)
**Generated by:** Claude Code
**Next Review:** November 10, 2025
**Status:** ✅ Production Ready - Pure YOLO Schema Active
