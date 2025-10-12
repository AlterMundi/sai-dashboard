# Database Migrations

**Current Schema Version:** 2.1 (Optimized YOLO)
**Last Migration:** 005 (October 12, 2025)

---

## 📋 Active Migrations

These migrations have been applied to the production database and define the current schema.

### Migration 002: Two-Stage ETL Queue
**File:** `002_two_stage_etl_queue.sql`
**Date:** September 2025
**Status:** ✅ Applied

**Purpose:**
- Add `etl_processing_queue` table for Stage 2 async processing
- Enable priority queue management
- Add retry logic for failed extractions

**Tables Created:**
- `etl_processing_queue` - Queue for Stage 2 ETL processing
- `etl_queue_health` - View for monitoring queue status

**Apply:**
```bash
psql -U sai_dashboard_user -d sai_dashboard -f 002_two_stage_etl_queue.sql
```

---

### Migration 003: YOLO Schema Redesign
**File:** `003_yolo_schema_redesign.sql`
**Date:** October 10, 2025
**Status:** ✅ Applied

**Purpose:**
- Transition from Ollama AI to YOLO fire detection schema
- Add YOLO-specific fields (`alert_level`, `has_fire`, `has_smoke`, etc.)
- Create `execution_detections` table for bounding boxes
- Add device/location metadata to `executions` table

**Major Changes:**
- **Added Tables:** `execution_detections`
- **Added Columns to `execution_analysis`:**
  - `request_id`, `yolo_model_version`, `detection_count`
  - `has_fire`, `has_smoke`, `alert_level`, `detection_mode`
  - `active_classes`, `detections` (JSONB)
  - `confidence_fire`, `confidence_smoke`, `confidence_score`
  - `image_width`, `image_height`, `yolo_processing_time_ms`
- **Added Columns to `executions`:**
  - `device_id`, `location`, `camera_type`, `capture_timestamp`

**Apply:**
```bash
psql -U sai_dashboard_user -d sai_dashboard -f 003_yolo_schema_redesign.sql
```

---

### Migration 004: Remove Legacy Fields
**File:** `004_remove_legacy_fields.sql`
**Date:** October 10, 2025
**Status:** ✅ Applied

**Purpose:**
- Remove all Ollama-era legacy fields
- Complete transition to pure YOLO schema
- Clean up backward compatibility columns

**Removed Columns from `execution_analysis`:**
- `risk_level` (replaced by `alert_level`)
- `smoke_detected` (replaced by `has_smoke`)
- `flame_detected` (replaced by `has_fire`)
- `alert_priority`, `response_required` (obsolete)
- `overall_assessment`, `raw_response` (Ollama-specific)
- `node_name`, `node_type`, `processing_time_ms` (metadata cleanup)
- `has_telegram_confirmation` (unused)

**Schema Reduction:** 31 columns → 18 columns in `execution_analysis`

**Apply:**
```bash
psql -U sai_dashboard_user -d sai_dashboard -f 004_remove_legacy_fields.sql
```

**Rollback:**
Migration includes rollback script if needed.

---

### Migration 005: Schema Cleanup
**File:** `005_schema_cleanup.sql`
**Date:** October 12, 2025
**Status:** ✅ Applied

**Purpose:**
- Remove unused database schema elements
- Optimize detection data storage (JSONB vs separate table)
- Clean up never-implemented features

**Removed:**
- **Tables Dropped:**
  - `execution_detections` - Denormalized bounding boxes (77 rows, duplicate of JSONB data)
  - `dashboard_stats` - Pre-computed metrics cache (never implemented, 0 rows)
- **Columns Dropped:**
  - `execution_images.backup_path` - Unused backup path field (all NULL)

**Added:**
- GIN index on `execution_analysis.detections` for fast JSONB queries
- Index on `execution_analysis.detection_count` for filtering

**Benefits:**
- Simplified schema (no duplicate detection data)
- Faster Stage 2 ETL (~5ms improvement per execution)
- Cleaner codebase (removed insertDetections function)
- Better query performance with JSONB GIN index

**Data Loss:**
- None (execution_detections data preserved in execution_analysis.detections JSONB)

**Apply:**
```bash
psql -U sai_dashboard_user -d sai_dashboard -f 005_schema_cleanup.sql
```

**Verification:**
```sql
-- Verify tables dropped
\dt execution_detections
\dt dashboard_stats

-- Verify column removed
\d execution_images

-- Verify GIN index created
\di idx_execution_analysis_detections_gin
```

---

## 🔄 Migration History Timeline

```
Initial State (Aug 2025)
    ↓
[Migration 001] - Ollama-based schema (ARCHIVED - superseded)
    ↓
[Migration 002] - Two-Stage ETL Queue ✅
    ↓
[Migration 003] - YOLO Schema Redesign ✅
    ↓
[Migration 004] - Remove Legacy Fields ✅
    ↓
[Migration 005] - Schema Cleanup ✅
    ↓
Current State: Optimized YOLO Schema (Oct 2025)
```

---

## 📝 Applying New Migrations

### Pre-Migration Checklist

1. **Backup database:**
   ```bash
   pg_dump -U sai_dashboard_user sai_dashboard > backup_$(date +%Y%m%d).sql
   ```

2. **Review migration file:**
   - Check for rollback script
   - Understand schema changes
   - Verify compatible with application code

3. **Test in development:**
   ```bash
   # Apply to dev database first
   psql -U sai_dashboard_user -d sai_dashboard_dev -f new_migration.sql
   ```

### Migration Process

```bash
# 1. Connect to database
psql -U sai_dashboard_user -d sai_dashboard

# 2. Begin transaction (for safety)
BEGIN;

# 3. Apply migration
\i database/migrations/XXX_migration_name.sql

# 4. Verify changes
\dt  -- List tables
\d table_name  -- Describe table

# 5. Commit if successful
COMMIT;

# If errors occur:
ROLLBACK;
```

### Post-Migration

1. **Verify schema:**
   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'execution_analysis'
   ORDER BY ordinal_position;
   ```

2. **Run data quality checks:**
   ```sql
   -- Check for NULL rates
   SELECT
     COUNT(*) as total,
     COUNT(alert_level) as with_alert,
     COUNT(has_fire) as with_fire_flag
   FROM execution_analysis;
   ```

3. **Restart application:**
   ```bash
   sudo systemctl restart sai-dashboard-api
   ```

---

## 🗂️ Archived Migrations

Historical migrations that have been superseded:

### Migration 001: Create SAI Execution Analysis (ARCHIVED)
**Location:** `../archive/migrations/001_create_sai_execution_analysis.sql`
**Reason:** Superseded by migrations 003 and 004
**Era:** Ollama-based analysis system

### Migration 002: Create Expert Users Table (ARCHIVED)
**Location:** `../archive/migrations/002_create_expert_users_table.sql`
**Reason:** Expert review system disabled
**Note:** Not related to current 002_two_stage_etl_queue.sql

---

## 📊 Current Schema Summary

**Tables:** 5 main tables (reduced from 7 in initial design)
- `executions` (Core records)
- `execution_analysis` (YOLO results with detections JSONB - 18 columns)
- `execution_images` (Image cache - 10 columns)
- `execution_notifications` (Telegram alerts)
- `etl_processing_queue` (ETL management)

**Indexes:** Optimized for query performance (including GIN for JSONB)
**Partitioning:** Image storage partitioned by execution ID
**Data Integrity:** NULL = "not available", no fake defaults
**Detection Storage:** JSONB with GIN index (faster than separate table + JOIN)

---

## 🚨 Rollback Procedures

Each migration includes rollback instructions in comments.

**General Rollback:**
```sql
BEGIN;

-- Restore from backup
\i backup_YYYYMMDD.sql

COMMIT;
```

**Migration 004 Specific Rollback:**
```sql
-- See rollback section in 004_remove_legacy_fields.sql
-- Adds back legacy columns (empty/NULL values)
```

---

## 📚 Related Documentation

- **[Database README](../README.md)** - Main database documentation
- **[Database Schema](../../docs/DATABASE_SCHEMA.md)** - Complete ER diagram
- **[ETL Architecture](../../docs/TWO_STAGE_ETL_ARCHITECTURE.md)** - ETL pipeline

---

**Last Updated:** October 12, 2025
**Schema Version:** 2.1 (Optimized YOLO)
