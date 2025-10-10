# Two-Stage ETL Installation Guide

## Overview

This guide walks through installing and testing the new 2-stage ETL architecture for SAI Dashboard.

**Architecture:**
- **Stage 1**: Fast trigger-based extraction (< 100ms) - extracts minimal metadata immediately
- **Stage 2**: Async deep processing (1-5 seconds) - extracts images, analysis, model info

**Benefits:**
- ✅ Executions appear instantly in dashboard (no waiting for heavy processing)
- ✅ Honest data representation (NULL = "not available", not fake defaults)
- ✅ Retry logic for failed extractions
- ✅ Priority queue for high-risk executions
- ✅ Data quality metrics

See [TWO_STAGE_ETL_ARCHITECTURE.md](./TWO_STAGE_ETL_ARCHITECTURE.md) for full design.

---

## Prerequisites

- PostgreSQL 12+ with both `n8n` and `sai_dashboard` databases
- Node.js 18+ with npm
- Write access to n8n database (for trigger installation)
- Write access to sai_dashboard database (for queue table)

---

## Step 1: Install Database Components

### 1.1 Install Stage 2 Queue Table (sai_dashboard database)

```bash
# Connect to sai_dashboard database
psql -U sai_dashboard_user -d sai_dashboard

# Run migration
\i database/migrations/002_two_stage_etl_queue.sql
```

**Expected output:**
```
CREATE TABLE
CREATE INDEX (x4)
CREATE FUNCTION (x4)
CREATE TRIGGER
CREATE VIEW (x2)
NOTICE: ETL queue table created successfully. Queued items: 0 (should be 0 - backfill disabled)
NOTICE: ✅ Queue is empty - ready for new executions via Stage 1 trigger
```

**⚠️ IMPORTANT:** The migration does NOT automatically backfill existing executions. This prevents overloading the queue with 100K+ items on first install (most old executions don't have execution_data in n8n anyway). New executions will be queued automatically by the Stage 1 trigger.

**Verify installation:**
```sql
-- Check queue table exists
SELECT COUNT(*) FROM etl_processing_queue;

-- Check monitoring views
SELECT * FROM etl_queue_health;

-- Expected: pending_count=0, completed_count=0, failed_count=0
```

### 1.2 Install Stage 1 Trigger (n8n database)

```bash
# Connect to n8n database
psql -U n8n_user -d n8n

# Run trigger installation
\i database/triggers/n8n_stage1_trigger.sql
```

**Expected output:**
```
CREATE FUNCTION
DROP TRIGGER
CREATE TRIGGER
NOTICE: ✅ Stage 1 trigger installed successfully
```

**Verify installation:**
```sql
-- Check trigger exists
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'trigger_sai_execution_stage1';

-- Expected: tgname=trigger_sai_execution_stage1, tgenabled=O (enabled)

-- Check function exists
SELECT proname FROM pg_proc WHERE proname = 'notify_sai_execution_stage1';

-- Expected: proname=notify_sai_execution_stage1
```

---

## Step 2: Configure Environment

Edit your `.env` file:

```bash
# ETL Service Configuration
ENABLE_ETL_SERVICE=true
USE_TWO_STAGE_ETL=true    # Enable new 2-stage architecture

# N8N Database (for Stage 1 trigger and Stage 2 extraction)
N8N_DB_HOST=localhost
N8N_DB_PORT=5432
N8N_DB_NAME=n8n
N8N_DB_USER=n8n_user
N8N_DB_PASSWORD=your_password

# SAI Dashboard Database (for Stage 1/2 writes)
SAI_DB_HOST=localhost
SAI_DB_PORT=5432
SAI_DB_NAME=sai_dashboard
SAI_DB_USER=sai_dashboard_user
SAI_DB_PASSWORD=your_password

# SAI Workflow ID
SAI_WORKFLOW_ID=yDbfhooKemfhMIkC

# Image cache path
IMAGE_BASE_PATH=/mnt/raid1/n8n/backup/images
```

---

## Step 3: Install Dependencies

```bash
cd backend
npm install
```

---

## Step 4: Build and Start

```bash
# Build backend
npm run build

# Start server (includes ETL services)
npm start
```

**Expected log output:**
```
🚀 Starting Two-Stage ETL Manager alongside API...
🔍 Testing database connections...
✅ N8N Database connected (9956 SAI executions found)
✅ SAI Dashboard Database connected (0 existing records)
✅ ETL queue table verified
📡 Setting up PostgreSQL LISTEN for Stage 1 notifications...
✅ Listening for sai_execution_stage1 notifications
✅ Stage 2 ETL Service started successfully
✅ Two-Stage ETL Manager started successfully
   Stage 1: Listening for PostgreSQL notifications (fast path)
   Stage 2: Polling processing queue (deep extraction)
```

---

## Step 5: Test the Pipeline

### 5.1 Manual Test: Send Notification

From PostgreSQL (n8n database):

```sql
-- Send manual Stage 1 notification
SELECT pg_notify('sai_execution_stage1', '{
  "execution_id": 999999,
  "workflow_id": "yDbfhooKemfhMIkC",
  "started_at": "2025-01-08T10:00:00Z",
  "stopped_at": "2025-01-08T10:00:05Z",
  "status": "success",
  "mode": "webhook"
}'::text);
```

**Check backend logs:**
```
📬 Stage 1 notification received
⚡ Stage 1: Processing execution 999999 (fast path)
✅ Stage 1: Inserted execution 999999
⚡ Stage 1: Inserted execution 999999 (status: success)
```

**Verify in sai_dashboard database:**
```sql
-- Check execution was inserted
SELECT id, status, node_id, camera_id
FROM executions
WHERE id = 999999;

-- Expected: id=999999, status=success, node_id=NULL, camera_id=NULL

-- Check it was queued for Stage 2
SELECT execution_id, stage, status, priority
FROM etl_processing_queue
WHERE execution_id = 999999;

-- Expected: execution_id=999999, stage=stage2, status=pending, priority=1
```

**Wait ~5 seconds for Stage 2 processing:**
```
📦 Stage 2: Processing batch of 1 executions
🔍 Stage 2: Processing execution 999999 (deep extraction)
❌ Stage 2: Failed to process execution 999999: execution_data not found in n8n database
```

*Note: Stage 2 fails because 999999 is a fake execution. That's expected!*

### 5.2 Test with Real Execution

```sql
-- Find latest real SAI execution
SELECT id, "startedAt", "stoppedAt", status
FROM execution_entity
WHERE "workflowId"::text = 'yDbfhooKemfhMIkC'
  AND "finished" = TRUE
ORDER BY "startedAt" DESC
LIMIT 1;

-- Example result: id=185839

-- Simulate notification for real execution
SELECT pg_notify('sai_execution_stage1', json_build_object(
  'execution_id', 185839,
  'workflow_id', 'yDbfhooKemfhMIkC',
  'started_at', "startedAt",
  'stopped_at', "stoppedAt",
  'status', 'success',
  'mode', mode
)::text)
FROM execution_entity
WHERE id = 185839;
```

**Expected backend logs:**
```
📬 Stage 1 notification received
⚡ Stage 1: Processing execution 185839 (fast path)
✅ Stage 1: Inserted execution 185839
⚡ Stage 1: Inserted execution 185839 (status: success)

[5 seconds later]
📦 Stage 2: Processing batch of 1 executions
🔍 Stage 2: Processing execution 185839 (deep extraction)
📸 Image processed for execution 185839
✅ Stage 2: Completed execution 185839 (1234ms, image: yes)
🔍 Stage 2: Processed execution 185839 (1234ms, image: yes)
```

**Verify complete processing:**
```sql
-- Check execution record (Stage 1 data)
SELECT id, status, execution_timestamp, duration_ms
FROM executions
WHERE id = 185839;

-- Check analysis (Stage 2 data)
SELECT execution_id, risk_level, confidence_score, model_version
FROM execution_analysis
WHERE execution_id = 185839;

-- Check image (Stage 2 data)
SELECT execution_id, original_path, size_bytes
FROM execution_images
WHERE execution_id = 185839;

-- Check queue status
SELECT execution_id, status, processing_time_ms
FROM etl_processing_queue
WHERE execution_id = 185839;

-- Expected: status=completed, processing_time_ms > 0
```

### 5.3 Test Automatic Trigger

Trigger a real n8n execution (webhook + Ollama + Telegram).

The trigger will automatically fire and both stages will process it:

1. Stage 1 inserts execution immediately (< 100ms)
2. Trigger on executions table queues it for Stage 2
3. Stage 2 processes within 5 seconds

Monitor logs in real-time:
```bash
journalctl -u sai-dashboard-api.service -f
```

---

## Step 6: Monitor Queue Health

### Check Queue Status

```sql
-- View queue health
SELECT * FROM etl_queue_health;
```

**Fields:**
- `pending_count`: Executions waiting for Stage 2
- `processing_count`: Currently being processed
- `completed_count`: Successfully processed
- `failed_count`: Failed after max retries
- `avg_processing_time_ms`: Average Stage 2 time
- `oldest_pending`: Oldest unprocessed execution

### Check Failed Items

```sql
-- View failed extractions
SELECT * FROM etl_failed_items
ORDER BY queued_at DESC
LIMIT 10;
```

**Retry failed items manually:**
```sql
-- Reset failed item to pending for retry
UPDATE etl_processing_queue
SET status = 'pending',
    attempts = 0,
    priority = 1
WHERE execution_id = <failed_execution_id>;
```

### Monitor via API

```bash
# Get ETL metrics
curl http://localhost:3001/dashboard/api/health

# Expected response includes:
{
  "status": "healthy",
  "etl": {
    "stage1": {
      "processed": 100,
      "avgProcessingTimeMs": 45
    },
    "stage2": {
      "processed": 95,
      "avgProcessingTimeMs": 1234
    },
    "pipeline": {
      "pending_deep_extraction": 5
    }
  }
}
```

---

## Troubleshooting

### Stage 1 Not Receiving Notifications

**Check trigger is installed:**
```sql
-- n8n database
SELECT tgname FROM pg_trigger WHERE tgname = 'trigger_sai_execution_stage1';
```

**Check LISTEN is active:**
```sql
-- n8n database
SELECT * FROM pg_stat_activity
WHERE query LIKE '%LISTEN%';
```

**Test notification manually:**
```sql
SELECT pg_notify('sai_execution_stage1', '{"execution_id": 12345}'::text);
```

### Stage 2 Not Processing Queue

**Check queue has pending items:**
```sql
-- sai_dashboard database
SELECT COUNT(*) FROM etl_processing_queue WHERE status = 'pending';
```

**Check Stage 2 service is running:**
```bash
# Backend logs should show:
# "Stage 2: Polling processing queue (deep extraction)"
```

**Manually trigger Stage 2 batch:**
Restart the backend service - Stage 2 processes immediately on start.

### NULL Fields in Analysis

**This is expected!** NULL means "data not available at source".

Check extraction logs:
```bash
journalctl -u sai-dashboard-api.service | grep "extraction failed"
```

Common reasons for NULL:
- Field not present in n8n execution_data JSON
- Ollama didn't provide model version metadata
- Analysis text doesn't contain parseable risk level

**See:** [DATA_INTEGRITY_PRINCIPLES.md](./DATA_INTEGRITY_PRINCIPLES.md)

### High Queue Depth

If `pending_count` keeps growing:

1. **Check Stage 2 processing time:**
   ```sql
   SELECT AVG(processing_time_ms) FROM etl_processing_queue WHERE status = 'completed';
   ```

2. **Increase Stage 2 batch size** (edit `stage2-etl-service.ts`):
   ```typescript
   private readonly BATCH_SIZE = 20; // Increase from 10
   ```

3. **Decrease poll interval** (edit `stage2-etl-service.ts`):
   ```typescript
   private readonly POLL_INTERVAL_MS = 2000; // Decrease from 5000
   ```

---

## Data Quality Metrics

### Check Extraction Completeness

```sql
-- How many executions have each field?
SELECT
  COUNT(*) as total_executions,
  COUNT(node_id) as with_node_id,
  COUNT(camera_id) as with_camera_id,
  ROUND(100.0 * COUNT(node_id) / COUNT(*), 2) as node_id_pct,
  ROUND(100.0 * COUNT(camera_id) / COUNT(*), 2) as camera_id_pct
FROM executions;

-- Analysis field completeness
SELECT
  COUNT(*) as total_analysis,
  COUNT(model_version) as with_model,
  COUNT(risk_level) as with_risk,
  COUNT(confidence_score) as with_confidence,
  ROUND(100.0 * COUNT(model_version) / COUNT(*), 2) as model_completeness_pct,
  ROUND(100.0 * COUNT(risk_level) / COUNT(*), 2) as risk_completeness_pct
FROM execution_analysis;
```

**Interpretation:**
- Low completeness % = source data doesn't contain that field
- Review n8n workflow to ensure fields are being output
- Improve extraction logic in Stage 2 if fields exist but not extracted

### Backfill Historical Executions (Optional)

**⚠️ WARNING:** Only backfill if you know the executions have execution_data in n8n!

Most historical executions (older than ~1 week) won't have execution_data because n8n cleans it up. Queuing them will result in failed processing attempts.

**Recommended: Backfill RECENT executions only (last 7 days):**

```sql
-- Queue recent executions without analysis (last 7 days)
INSERT INTO etl_processing_queue (execution_id, stage, status, priority)
SELECT e.id, 'stage2', 'pending', 10
FROM executions e
WHERE e.execution_timestamp > NOW() - INTERVAL '7 days'
  AND NOT EXISTS (
    SELECT 1 FROM execution_analysis ea WHERE ea.execution_id = e.id
  )
ON CONFLICT (execution_id, stage) DO NOTHING;

-- Check how many were queued
SELECT COUNT(*) FROM etl_processing_queue WHERE priority = 10;
```

**To verify executions have data before backfilling:**
```sql
-- Check how many recent executions have execution_data in n8n
SELECT COUNT(*)
FROM n8n.execution_data ed
JOIN n8n.execution_entity ee ON ed."executionId" = ee.id
WHERE ee."workflowId"::text = 'yDbfhooKemfhMIkC'
  AND ee."startedAt" > NOW() - INTERVAL '7 days';
```

Stage 2 will process them in priority order (10 = low priority, backfill).

---

## Rollback to Simple ETL

If you need to revert to the legacy simple ETL:

**1. Update `.env`:**
```bash
USE_TWO_STAGE_ETL=false
```

**2. Restart backend:**
```bash
systemctl restart sai-dashboard-api
```

**3. (Optional) Remove Stage 1 trigger:**
```sql
-- n8n database
DROP TRIGGER IF EXISTS trigger_sai_execution_stage1 ON execution_entity;
DROP FUNCTION IF EXISTS notify_sai_execution_stage1();
```

**4. (Optional) Drop queue table:**
```sql
-- sai_dashboard database (CAUTION: loses queue history)
DROP TABLE IF EXISTS etl_processing_queue CASCADE;
```

---

## Production Deployment

### systemd Service Configuration

Update `/etc/systemd/system/sai-dashboard-api.service`:

```ini
[Unit]
Description=SAI Dashboard API with Two-Stage ETL
After=postgresql.service

[Service]
Type=simple
User=dashboard-user
WorkingDirectory=/path/to/sai-dashboard/backend
Environment=NODE_ENV=production
Environment=USE_TWO_STAGE_ETL=true
Environment=ENABLE_ETL_SERVICE=true
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

Reload and restart:
```bash
sudo systemctl daemon-reload
sudo systemctl restart sai-dashboard-api
sudo systemctl status sai-dashboard-api
```

### Monitoring

Add to your monitoring stack:

```bash
# Alert if Stage 2 queue depth > 1000
SELECT COUNT(*) FROM etl_processing_queue WHERE status = 'pending';

# Alert if avg processing time > 10 seconds
SELECT AVG(processing_time_ms) FROM etl_processing_queue WHERE status = 'completed';

# Alert if failed rate > 5%
SELECT
  COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*) as failed_pct
FROM etl_processing_queue;
```

---

## Next Steps

- Review [DATA_INTEGRITY_PRINCIPLES.md](./DATA_INTEGRITY_PRINCIPLES.md) to understand NULL handling
- Review [TWO_STAGE_ETL_ARCHITECTURE.md](./TWO_STAGE_ETL_ARCHITECTURE.md) for design details
- Implement Stage 3 (ML reprocessing) if needed for model version upgrades

---

## Support

Issues? Check logs:
```bash
journalctl -u sai-dashboard-api.service -f --since "10 minutes ago"
```

Common patterns to grep for:
```bash
# Stage 1 activity
journalctl -u sai-dashboard-api | grep "Stage 1:"

# Stage 2 activity
journalctl -u sai-dashboard-api | grep "Stage 2:"

# Errors
journalctl -u sai-dashboard-api | grep "❌"

# Extraction failures
journalctl -u sai-dashboard-api | grep "extraction failed"
```
