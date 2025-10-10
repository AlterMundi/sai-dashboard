# Archived Database Files

**Archived:** October 10, 2025
**Reason:** Historical preservation after schema consolidation

---

## 📋 Archive Contents

This directory contains historical SQL files from SAI Dashboard development that have been superseded or are no longer actively used.

### Directory Structure

```
archive/
├── README.md                              ← This file
├── migrations/                            ← Superseded migrations
│   ├── 001_create_sai_execution_analysis.sql (13K) - Ollama era
│   └── 002_create_expert_users_table.sql     (2.6K) - Expert system
├── schemas/                               ← Pre-migration schemas
│   ├── sai_dashboard_schema.sql          (24K) - Legacy v1
│   └── sai_dashboard_schema_v2.sql       (21K) - Pre-migration v2
├── triggers/                              ← Old trigger implementations
│   ├── n8n_etl_triggers.sql              (21K) - Complex triggers
│   └── n8n_simple_triggers.sql           (3.5K) - Simple triggers
└── one-time/                              ← One-time fixes & utilities
    ├── fix_duplicate_triggers.sql        (1.8K)
    ├── test-enhanced-analysis.sql        (4.3K)
    ├── create_node_tables_postgresql.sql (6.0K)
    └── create-views.sql                  (7.6K)
```

---

## 📁 Migrations (Superseded)

### 001_create_sai_execution_analysis.sql
**Date:** August-September 2025
**Status:** ❌ Superseded by 003 + 004

**Original Purpose:**
Create initial `sai_execution_analysis` table for Ollama-based AI analysis.

**Why Archived:**
- Schema was designed for Ollama AI (not YOLO)
- Included fields like `overall_assessment`, `raw_response`, `risk_level`
- Completely redesigned in migration 003 (YOLO schema)
- Legacy fields removed in migration 004

**Current Equivalent:**
- Migration 003: YOLO schema redesign
- Migration 004: Legacy field removal

---

### 002_create_expert_users_table.sql
**Date:** September 2025
**Status:** ❌ Not Applicable

**Original Purpose:**
Create expert user management system for manual fire detection review.

**Why Archived:**
- Expert review system was disabled
- Feature not implemented in production
- TypeScript services excluded from build (see `backend/tsconfig.json`)

**Note:**
This is **different** from the active `002_two_stage_etl_queue.sql` migration (unfortunate numbering collision).

---

## 📁 Schemas (Pre-Migration Era)

### sai_dashboard_schema.sql
**Date:** August 2025
**Status:** ❌ Obsolete

**Original Purpose:**
Initial complete database schema with Ollama analysis.

**Why Archived:**
- Pre-migration monolithic schema file
- Ollama-era field definitions
- Replaced by incremental migrations (002, 003, 004)

**Tables Defined:**
- `executions`
- `execution_images`
- `execution_analysis` (Ollama version)
- `execution_notifications`
- `execution_events`
- `dashboard_stats`

---

### sai_dashboard_schema_v2.sql
**Date:** September 2025
**Status:** ❌ Obsolete

**Original Purpose:**
Improved schema design with JSONB and event-sourced architecture.

**Why Archived:**
- Pre-migration experimental schema
- Never fully implemented
- Replaced by migration-based approach

**Design Principles (preserved for reference):**
- Event-sourced immutable log
- JSONB for flexible metadata
- Semantic separation (execution vs camera vs environmental)
- GIN indexes, generated columns

**Note:** Some design principles influenced final YOLO schema.

---

## 📁 Triggers (Legacy Implementations)

### n8n_etl_triggers.sql
**Date:** August-September 2025
**Status:** ❌ Replaced

**Original Purpose:**
Complex multi-stage trigger system for n8n → SAI Dashboard data sync.

**Why Archived:**
- Too complex (21K file)
- Mixed ETL logic with trigger logic
- Replaced by simple Stage 1 trigger + separate ETL services

**Current Equivalent:**
`../triggers/n8n_stage1_trigger.sql` (4.4K - much simpler)

**What Changed:**
- Trigger only sends notification (no data processing)
- ETL logic moved to application layer (Stage 1 + Stage 2 services)
- Better separation of concerns

---

### n8n_simple_triggers.sql
**Date:** September 2025
**Status:** ❌ Replaced

**Original Purpose:**
Simplified trigger for basic ETL notifications.

**Why Archived:**
- Intermediate implementation between complex and current
- Lacked priority queue support
- No retry logic

**Current Equivalent:**
`../triggers/n8n_stage1_trigger.sql`

---

## 📁 One-Time Files

### fix_duplicate_triggers.sql
**Date:** September 2025
**Type:** One-time Fix

**Purpose:**
Remove duplicate triggers that were causing multiple notifications per execution.

**Why Archived:**
- Problem was fixed
- One-time operation
- Preserved for reference if issue recurs

**Usage:**
```bash
psql -U n8n_user -d n8n -f fix_duplicate_triggers.sql
```

---

### test-enhanced-analysis.sql
**Date:** September 2025
**Type:** Testing Queries

**Purpose:**
Test queries for enhanced analysis features and expert review system.

**Why Archived:**
- Expert review system disabled
- Testing queries no longer relevant
- Preserved for reference

---

### create_node_tables_postgresql.sql
**Date:** August 2025
**Type:** Unused Design

**Purpose:**
Create tables for camera node management and device registry.

**Why Archived:**
- Never implemented
- Node/device metadata stored in JSONB instead
- Preserved for potential future use

**Tables Defined:**
- `camera_nodes`
- `node_health_log`
- `node_configurations`

---

### create-views.sql
**Date:** September 2025
**Type:** Unused Design
**Location:** Originally `backend/scripts/create-views.sql`

**Purpose:**
Create database views for common query patterns.

**Why Archived:**
- Never implemented
- Application uses direct queries instead
- Views add complexity without clear benefit

**Views Defined:**
- Recent executions with analysis
- Fire detection statistics
- Performance metrics

---

## 🔍 Using Archived Files

### Reference Only

These files are **not** meant to be applied to current databases. They are preserved for:

1. **Historical Context:** Understanding schema evolution
2. **Design Reference:** Reviewing past architectural decisions
3. **Troubleshooting:** If similar issues arise in future
4. **Documentation:** Explaining why current design choices were made

### Migration Path Reference

```
Initial State (Aug 2025)
    ↓
sai_dashboard_schema.sql (Ollama v1)
    ↓
sai_dashboard_schema_v2.sql (Event-sourced experiment)
    ↓
001_create_sai_execution_analysis.sql (Ollama migration)
    ↓
002_two_stage_etl_queue.sql ✅ (Active)
    ↓
003_yolo_schema_redesign.sql ✅ (Active)
    ↓
004_remove_legacy_fields.sql ✅ (Active)
    ↓
Current: Pure YOLO Schema (Oct 2025)
```

---

## ⚠️ Important Notes

### Do NOT Apply These Files

Archived migrations will:
- Conflict with current schema
- Create duplicate tables
- Restore obsolete columns
- Break current application code

### If You Need Old Schema

For development/testing with old schema:

1. Create separate database: `CREATE DATABASE sai_dashboard_historical;`
2. Apply archived schema: `psql -d sai_dashboard_historical -f archive/schemas/sai_dashboard_schema.sql`
3. Use old application code version

### Version Compatibility

| Schema File | Compatible App Version | Git Commit |
|-------------|------------------------|------------|
| `sai_dashboard_schema.sql` | Pre-YOLO (Aug 2025) | Before 003 migration |
| `001_create_sai_execution_analysis.sql` | Ollama era | Before 003 migration |
| Current migrations (002, 003, 004) | Post-YOLO (Oct 2025+) | Current `main` branch |

---

## 📚 Related Documentation

- **[Database README](../README.md)** - Current database documentation
- **[Migration History](../migrations/README.md)** - Active migrations
- **[Database Schema](../../docs/DATABASE_SCHEMA.md)** - Current ER diagram
- **[Legacy Removal Status](../../docs/archive/LEGACY_REMOVAL_STATUS.md)** - Migration 004 details

---

**Archive Created:** October 10, 2025
**Total Files:** 10
**Total Size:** ~130K
**Reason:** Schema consolidation and cleanup
