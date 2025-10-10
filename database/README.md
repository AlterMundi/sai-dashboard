# SAI Dashboard Database Documentation

**Last Updated:** October 10, 2025
**Current Schema:** Pure YOLO (Migration 004 Complete)
**Database:** PostgreSQL 14+

---

## 📋 Quick Reference

### Active Files

```
database/
├── README.md                          ← This file
├── queries.sql                        ← Useful query examples
├── migrations/
│   ├── README.md                      ← Migration guide
│   ├── 002_two_stage_etl_queue.sql   ← ETL queue system
│   ├── 003_yolo_schema_redesign.sql  ← YOLO schema migration
│   └── 004_remove_legacy_fields.sql  ← Legacy field removal
├── triggers/
│   ├── README.md                      ← Trigger documentation
│   └── n8n_stage1_trigger.sql        ← Stage 1 ETL trigger
└── archive/                           ← Historical SQL files
    └── README.md                      ← Archive documentation
```

---

## 🗄️ Current Database Schema

### Two Database Architecture

**1. n8n Database** (Source - Read-Only Access)
- `execution_entity` - n8n workflow executions
- `execution_data` - n8n execution payload (JSONB)
- `workflow_entity` - n8n workflow definitions

**2. sai_dashboard Database** (Analytics - Read/Write)
- `executions` - Core execution records
- `execution_analysis` - YOLO fire/smoke detection results
- `execution_detections` - Bounding box data
- `execution_images` - Image cache metadata
- `execution_notifications` - Telegram alerts
- `etl_processing_queue` - ETL pipeline queue

See [docs/DATABASE_SCHEMA.md](../docs/DATABASE_SCHEMA.md) for complete ER diagram.

---

## 🔄 Migration History

### Applied Migrations (In Order)

| # | File | Date | Description | Status |
|---|------|------|-------------|--------|
| 002 | `002_two_stage_etl_queue.sql` | 2025-09 | ETL queue for async processing | ✅ Applied |
| 003 | `003_yolo_schema_redesign.sql` | 2025-10-10 | YOLO schema, detections table | ✅ Applied |
| 004 | `004_remove_legacy_fields.sql` | 2025-10-10 | Removed all legacy Ollama fields | ✅ Applied |

### Archived Migrations

| # | File | Reason | Location |
|---|------|--------|----------|
| 001 | `001_create_sai_execution_analysis.sql` | Ollama era schema | `archive/migrations/` |
| 002 | `002_create_expert_users_table.sql` | Expert system disabled | `archive/migrations/` |

**Note:** Migration 001 was superseded by migrations 003 and 004. The schema evolved from Ollama-based to pure YOLO.

---

## 🔧 Common Operations

### Apply a Migration

```bash
# Connect to sai_dashboard database
psql -U sai_dashboard_user -d sai_dashboard

# Apply migration
\i database/migrations/003_yolo_schema_redesign.sql
```

### Check Migration Status

```sql
-- Check if tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Check execution_analysis columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'execution_analysis'
ORDER BY ordinal_position;
```

### Useful Queries

See [queries.sql](queries.sql) for:
- ETL queue health monitoring
- Execution statistics
- Data quality checks
- Performance analysis

---

## 🔍 Database Structure

### Core Tables

#### executions
Primary table for workflow execution records.
- **Populated by:** Stage 1 ETL (fast path)
- **Speed:** < 20ms per record
- **Source:** n8n `execution_entity` metadata

#### execution_analysis
YOLO fire/smoke detection analysis results.
- **Populated by:** Stage 2 ETL (deep extraction)
- **Speed:** 50-300ms per record
- **Source:** n8n `execution_data` JSONB (YOLO node output)

**Pure YOLO Fields:**
- `alert_level` - none/low/medium/high/critical
- `has_fire`, `has_smoke` - Boolean detection flags
- `detection_count` - Number of objects detected
- `confidence_fire`, `confidence_smoke` - Confidence scores (0.0-1.0)
- `detections` - Full JSONB array from YOLO
- `yolo_model_version` - Model version used

#### execution_detections
Individual bounding boxes for detected fires/smoke.
- **Structure:** One row per detection
- **Bounding Box:** JSONB `{x, y, width, height}`
- **Classes:** 'fire' or 'smoke'

---

## 🚀 Triggers

### n8n Stage 1 Trigger

**File:** [triggers/n8n_stage1_trigger.sql](triggers/n8n_stage1_trigger.sql)

**Purpose:** Notify SAI Dashboard when n8n executions complete

**Installed in:** n8n database
**Trigger on:** n8n.execution_entity (AFTER UPDATE)
**Notification:** PostgreSQL NOTIFY 'sai_execution_stage1'

**Install:**
```bash
psql -U n8n_user -d n8n -f database/triggers/n8n_stage1_trigger.sql
```

**Verify:**
```sql
-- Check trigger exists
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name LIKE '%sai_stage1%';
```

---

## 📊 Data Integrity Principles

The SAI Dashboard follows strict data integrity rules:

### NULL = "Not Available"
- Never use fake default values
- NULL means data was not extractable from source
- Example: `model_version = NULL` (not extracted) vs `model_version = 'last.pt'` (extracted from YOLO)

### Progressive Extraction
- Stage 1: Fast metadata (always available)
- Stage 2: Deep analysis (best-effort extraction)

### No Assumptions
- Don't assume YOLO model version
- Don't default alert levels
- Don't fabricate confidence scores

See [docs/DATA_INTEGRITY_PRINCIPLES.md](../docs/DATA_INTEGRITY_PRINCIPLES.md) for complete philosophy.

---

## 🗂️ Archive

Historical and deprecated SQL files are preserved in `archive/`:

- **archive/migrations/** - Superseded migrations (001, 002-expert)
- **archive/schemas/** - Pre-migration schema files
- **archive/triggers/** - Old trigger implementations
- **archive/one-time/** - One-time fixes and test files

See [archive/README.md](archive/README.md) for details.

---

## 📚 Related Documentation

- **[Database Schema](../docs/DATABASE_SCHEMA.md)** - Complete ER diagram
- **[ETL Architecture](../docs/TWO_STAGE_ETL_ARCHITECTURE.md)** - ETL pipeline details
- **[Consolidated Docs](../docs/CONSOLIDATED_DOCUMENTATION.md)** - Complete system guide

---

## 🔐 Database Access

### sai_dashboard Database

**User:** `sai_dashboard_user`
**Permissions:** Read/Write on all sai_dashboard tables

### n8n Database (Read-Only)

**User:** `sai_dashboard_readonly`
**Permissions:** SELECT on `execution_entity`, `execution_data`, `workflow_entity`

**Security:** Separate read-only user prevents accidental modifications to n8n data.

---

## 🚨 Troubleshooting

### ETL Not Processing

```sql
-- Check queue health
SELECT * FROM etl_queue_health;

-- Check pending items
SELECT COUNT(*) FROM etl_processing_queue WHERE status = 'pending';

-- Check failed items
SELECT execution_id, last_error, attempts
FROM etl_processing_queue
WHERE status = 'failed'
ORDER BY queued_at DESC LIMIT 10;
```

### Missing Trigger

```bash
# Reinstall Stage 1 trigger
psql -U n8n_user -d n8n -f database/triggers/n8n_stage1_trigger.sql

# Verify
psql -U n8n_user -d n8n -c "SELECT trigger_name FROM information_schema.triggers WHERE trigger_name LIKE '%sai%';"
```

### Data Quality Check

```sql
-- Check YOLO data extraction rate
SELECT
  COUNT(*) as total_executions,
  COUNT(has_fire) as with_yolo_analysis,
  ROUND(100.0 * COUNT(has_fire) / COUNT(*), 2) as extraction_rate_pct
FROM execution_analysis;
```

---

**Database Schema Version:** 2.0 (Pure YOLO)
**Maintainer:** SAI Dashboard Team
**Support:** See [../docs/CONSOLIDATED_DOCUMENTATION.md](../docs/CONSOLIDATED_DOCUMENTATION.md)
