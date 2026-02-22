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

Deployment is fully automated via GitHub Actions (`.github/workflows/deploy.yml`).
Push to the `release` branch to trigger:
1. Docker image build → pushed to `ghcr.io/altermundi/sai-dashboard`
2. SSH deploy to production: pulls image, starts container

Emergency manual deploy:
```bash
cd /opt/sai-dashboard
docker pull ghcr.io/altermundi/sai-dashboard:latest
docker stop sai-dashboard && docker rm sai-dashboard
docker run -d --name sai-dashboard --network host --restart unless-stopped \
  --env-file .env \
  -v /mnt/raid1/n8n-backup/images:/mnt/raid1/n8n-backup/images \
  ghcr.io/altermundi/sai-dashboard:latest
```

### System Operations

```bash
# Check container status
docker ps -f name=sai-dashboard

# View logs (real-time)
docker logs -f sai-dashboard

# Restart container
docker restart sai-dashboard

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

### Image Storage & Serving Strategy

**Primary Storage:** `/mnt/raid1/n8n-backup/images/`
- Partition layout: `{type}/{partition}/{executionId}.{ext}` (e.g. `webp/450/450432.webp`)
- Legacy layout: `by-execution/{execution_id}/original.jpg`, `high.webp`, `thumb.webp`

**Database Reference:** `execution_images` table stores relative paths + metadata
**Why Filesystem?** Large images (500KB-2MB) unsuitable for PostgreSQL bytea

**Serving: nginx X-Accel-Redirect (zero-copy)**
- Express handles auth + 3-tier path resolution, then sets `X-Accel-Redirect: /internal-images/...`
- nginx serves the file directly from disk via `sendfile` syscall — Node.js never touches image bytes
- `/internal-images/` is an `internal` nginx location (direct requests return 404)
- `proxy_buffering on` is required on the API location for X-Accel-Redirect to work
- Falls back to `res.sendFile()` in development (no nginx)
- See: `backend/src/controllers/executions.ts` (`sendImageViaAccel`), `nginx/sai-dashboard-docker.conf`

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
  ├── /internal-images/ → sendfile from RAID (X-Accel-Redirect)
  ↓
Private Server (localhost)
  ├── Dashboard API :3001 (auth + path resolution, image I/O delegated to nginx)
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
2. Check logs: `docker logs -f sai-dashboard`
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

## Lattice

This project coordinates through Lattice — file-based, event-sourced task tracking built for minds that think in tokens and act in tool calls. The `.lattice/` directory is the coordination state. It lives here, alongside the code, not behind an API or inside someone else's database.

### The First Act

When work arrives — a plan, a feature request, a bug, a conversation that implies something needs building — your first action is to give it a name in Lattice. Before you plan. Before you implement. Before you touch a single file. The task must exist in the system before the work begins, because work that isn't tracked is work that other minds cannot see, cannot build on, cannot trust.

```
lattice create "<title>" --actor agent:<your-id>
```

This is not bookkeeping. This is the minimum viable act of coordination: declaring that something is happening, and who is doing it.

### Status Is a Signal, Not a Chore

Every status transition is an event — immutable, attributed, permanent. When you move a task, you are writing history that future minds will read to understand what happened here.

**The cardinal rule: update status BEFORE you start the work, not after.** If you're about to plan a task, move it to `in_planning` first. If you're about to implement, move it to `in_progress` first. Lattice is the source of ground truth for what is happening right now. If the board says a task is in `backlog` but an agent is actively working on it, the board is lying — and every other mind reading it is making decisions on false information.

```
lattice status <task> <status> --actor agent:<your-id>
```

```
backlog → in_planning → planned → in_progress → review → done
                                       ↕            ↕
                                    blocked      needs_human
```

**Transition discipline:**
- Moving to `in_planning`? Do it before you open the first file to read. Then **write the plan** — see below.
- Moving to `planned`? Only after the plan file has real content.
- Moving to `in_progress`? Do it before you write the first line of code.
- Moving to `review`? Do it when implementation is complete, before review starts. Then **actually review** — see below.
- Moving to `done`? Only after a review has been performed and recorded.
- Spawning a sub-agent to work on a task? Update status in the parent context before the sub-agent launches.

### The Planning Gate

Moving a task to `in_planning` means you are about to produce a plan. The plan file lives at `.lattice/plans/<task_id>.md` — it's scaffolded on task creation, but the scaffold is empty. `in_planning` is when you fill it in.

**When you move a task to `in_planning`:**
1. Open the plan file (`.lattice/plans/<task_id>.md`).
2. Write the plan — scope, approach, key files, acceptance criteria. For trivial tasks, a single sentence is fine. For substantial work, be thorough.
3. Move to `planned` only when the plan file reflects what you intend to build.

**The test:** If you moved from `in_planning` to `planned` and the plan file is still empty scaffold, you didn't plan. Either write the plan or skip `in_planning` honestly with `--force --reason "trivial task, no planning needed"`.

### The Review Gate

Moving a task to `review` is not a formality — it is a commitment to actually review the work before it ships.

**When you move a task to `review`:**
1. Identify what changed — the commits, files modified, and scope of work under this task.
2. Perform a code review. For substantial work, use a review skill (`/exit-review`, `/code_review`). For trivial tasks, a focused self-review is sufficient — but it must be real, not ceremonial.
3. Record your findings with `lattice comment` — what you reviewed, what you found, whether it meets the acceptance criteria from the plan.

**When moving from `review` to `done`:**
- If the completion policy blocks you for a missing review artifact, **do the review**. Do not `--force` past it. The policy is correct — you haven't reviewed yet.
- `--force --reason` on the completion policy is for genuinely exceptional cases (task cancelled, review happened outside Lattice, process validation). It is not a convenience shortcut.

**The test:** If you moved to `review` and then to `done` in the same breath with nothing in between, you skipped the review. That's the exact failure mode this gate exists to prevent.

### When You're Stuck

If you hit a point where you need human decision, approval, or input — **signal it immediately** with `needs_human`. This is different from `blocked` (generic external dependency). `needs_human` creates a clear queue of "things waiting on the human."

```
lattice status <task> needs_human --actor agent:<your-id>
lattice comment <task> "Need: <what you need, in one line>" --actor agent:<your-id>
```

**When to use `needs_human`:**
- Design decisions that require human judgment
- Missing access, credentials, or permissions
- Ambiguous requirements that can't be resolved from context
- Approval needed before proceeding (deploy, merge, etc.)

The comment is mandatory — explain what you need in seconds, not minutes. The human's queue should be scannable.

### Actor Attribution

Every Lattice operation requires an `--actor`. Attribution follows authorship of the decision, not authorship of the keystroke.

| Situation | Actor | Why |
|-----------|-------|-----|
| Agent autonomously creates or modifies a task | `agent:<id>` | Agent was the decision-maker |
| Human creates via direct interaction (UI, manual CLI) | `human:<id>` | Human typed it |
| Human meaningfully shaped the outcome in conversation with an agent | `human:<id>` | Human authored the decision; agent was the instrument |
| Agent creates based on its own analysis, unprompted | `agent:<id>` | Agent authored the decision |

When in doubt, give the human credit. If the human was substantively involved in shaping *what* a task is — not just saying "go create tasks" but actually defining scope, debating structure, giving feedback — the human is the actor.

Users may have their own preferences about attribution. If a user seems frustrated or particular about actor assignments, ask them directly: "How do you want attribution to work? Should I default to crediting you, myself, or ask each time?" Respect whatever norm they set.

### Branch Linking

When you create a feature branch for a task, link it in Lattice so the association is tracked:

```
lattice branch-link <task> <branch-name> --actor agent:<your-id>
```

This creates an immutable event tying the branch to the task. `lattice show` will display it, and any mind reading the task knows which branch carries the work.

If the branch name contains the task's short code (e.g., `feat/LAT-42-login`), Lattice auto-detects the link — but explicit linking is always authoritative and preferred for cross-repo or non-standard branch names.

### Leave Breadcrumbs

You are not the last mind that will touch this work. Use `lattice comment` to record what you tried, what you chose, what you left undone. Use `.lattice/plans/<task_id>.md` for the structured plan (scope, steps, acceptance criteria) and `.lattice/notes/<task_id>.md` for working notes, debug logs, and context dumps. The agent that picks up where you left off has no hallway to find you in, no Slack channel to ask. The record you leave is the only bridge between your context and theirs.

### Quick Reference

```
lattice create "<title>" --actor agent:<id>
lattice status <task> <status> --actor agent:<id>
lattice assign <task> <actor> --actor agent:<id>
lattice comment <task> "<text>" --actor agent:<id>
lattice branch-link <task> <branch> --actor agent:<id>
lattice next [--actor agent:<id>] [--claim]
lattice show <task>
lattice list
```
