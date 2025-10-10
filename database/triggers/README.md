# Database Triggers

**Active Triggers:** 1
**Database:** n8n (PostgreSQL)

---

## 📋 Active Triggers

### n8n Stage 1 Trigger
**File:** `n8n_stage1_trigger.sql`
**Database:** n8n
**Table:** execution_entity
**Event:** AFTER UPDATE
**Status:** ✅ Active in Production

**Purpose:**
Automatically notify SAI Dashboard when n8n workflow executions complete, triggering Stage 1 ETL processing.

**Flow:**
```
n8n Execution Completes
    ↓
execution_entity.finished = TRUE
    ↓
TRIGGER: execution_entity_sai_stage1_trigger
    ↓
PostgreSQL NOTIFY 'sai_execution_stage1'
    ↓
SAI Dashboard Stage 1 ETL Service (listening)
    ↓
Fast metadata extraction (<20ms)
```

---

## 🔧 Installation

### Install Trigger

```bash
# Install to n8n database
psql -U n8n_user -d n8n -f database/triggers/n8n_stage1_trigger.sql
```

### Verify Installation

```sql
-- Connect to n8n database
psql -U n8n_user -d n8n

-- Check trigger exists
SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'execution_entity'
  AND trigger_name LIKE '%sai%';

-- Expected output:
--  trigger_name                        | event_manipulation | event_object_table | action_timing
-- -------------------------------------+--------------------+--------------------+---------------
--  execution_entity_sai_stage1_trigger | UPDATE             | execution_entity   | AFTER
```

### Test Trigger

```sql
-- Monitor PostgreSQL notifications (in separate terminal)
psql -U n8n_user -d n8n

LISTEN sai_execution_stage1;
-- Wait for notifications (Ctrl+C to stop)

-- Trigger manually (in another terminal)
UPDATE execution_entity
SET finished = TRUE
WHERE id = (
  SELECT id FROM execution_entity
  WHERE "workflowId"::text = 'yDbfhooKemfhMIkC'
    AND finished = FALSE
  LIMIT 1
);
```

---

## 📊 Trigger Details

### Trigger Function: `notify_sai_stage1()`

**Logic:**
1. Fires only on UPDATE when `finished` changes to TRUE
2. Filters for SAI workflow (`workflowId = 'yDbfhooKemfhMIkC'`)
3. Extracts execution metadata
4. Sends PostgreSQL NOTIFY with JSON payload

**Notification Payload:**
```json
{
  "execution_id": 186320,
  "workflow_id": "yDbfhooKemfhMIkC",
  "started_at": "2025-10-10T15:30:00Z",
  "stopped_at": "2025-10-10T15:30:05Z",
  "status": "success",
  "mode": "webhook"
}
```

---

## 🔍 Monitoring

### Check Trigger Activity

```sql
-- Monitor PostgreSQL notifications
LISTEN sai_execution_stage1;

-- In SAI Dashboard logs:
sudo journalctl -u sai-dashboard-api | grep "Stage 1:"
```

### Trigger Performance

- **Overhead:** < 1ms per execution
- **Notification Delivery:** Near-instant (PostgreSQL internal)
- **Impact on n8n:** Negligible (async notification)

---

## 🚨 Troubleshooting

### Trigger Not Firing

**Symptoms:** No Stage 1 notifications in SAI Dashboard logs

**Checks:**
```sql
-- 1. Verify trigger exists
SELECT trigger_name
FROM information_schema.triggers
WHERE event_object_table = 'execution_entity'
  AND trigger_name LIKE '%sai%';

-- 2. Check trigger function exists
SELECT routine_name
FROM information_schema.routines
WHERE routine_name = 'notify_sai_stage1';

-- 3. Test trigger manually
UPDATE execution_entity
SET finished = TRUE
WHERE id = 186320 AND finished = FALSE;
```

**Fix:**
```bash
# Reinstall trigger
psql -U n8n_user -d n8n -f database/triggers/n8n_stage1_trigger.sql
```

### Duplicate Notifications

**Symptoms:** Stage 1 ETL processing same execution multiple times

**Cause:** Multiple triggers installed

**Fix:**
```sql
-- Drop duplicate triggers
DROP TRIGGER IF EXISTS execution_entity_sai_stage1_trigger ON execution_entity;
DROP TRIGGER IF EXISTS execution_entity_sai_trigger ON execution_entity;

-- Reinstall single trigger
\i database/triggers/n8n_stage1_trigger.sql
```

See also: `../archive/one-time/fix_duplicate_triggers.sql`

### Stage 1 Service Not Listening

**Symptoms:** Trigger fires but no Stage 1 processing

**Checks:**
```bash
# 1. Check service is running
sudo systemctl status sai-dashboard-api

# 2. Check logs for LISTEN
sudo journalctl -u sai-dashboard-api | grep "LISTEN"
# Should see: "Stage 1 ETL: Listening on channel 'sai_execution_stage1'"

# 3. Check ETL is enabled
grep "ENABLE_ETL_SERVICE" /root/REPOS/sai-dashboard/.env
grep "USE_TWO_STAGE_ETL" /root/REPOS/sai-dashboard/.env
```

---

## 📝 Trigger Maintenance

### Recreate Trigger

```bash
# Drop and recreate
psql -U n8n_user -d n8n -c "DROP TRIGGER IF EXISTS execution_entity_sai_stage1_trigger ON execution_entity; DROP FUNCTION IF EXISTS notify_sai_stage1();"

# Reinstall
psql -U n8n_user -d n8n -f database/triggers/n8n_stage1_trigger.sql
```

### Disable Trigger Temporarily

```sql
-- Disable without dropping
ALTER TABLE execution_entity DISABLE TRIGGER execution_entity_sai_stage1_trigger;

-- Re-enable
ALTER TABLE execution_entity ENABLE TRIGGER execution_entity_sai_stage1_trigger;
```

---

## 🗂️ Archived Triggers

Historical trigger implementations (replaced by current trigger):

### Old ETL Triggers (ARCHIVED)
**Location:** `../archive/triggers/`

**Files:**
- `n8n_etl_triggers.sql` (21K) - Complex multi-stage trigger system
- `n8n_simple_triggers.sql` (3.5K) - Simple trigger implementation

**Reason Archived:**
- Replaced by streamlined Stage 1 trigger
- Simplified notification payload
- Better separation of concerns (trigger vs ETL logic)

---

## 📚 Related Documentation

- **[ETL Architecture](../../docs/TWO_STAGE_ETL_ARCHITECTURE.md)** - Two-stage ETL pipeline
- **[Database Schema](../../docs/DATABASE_SCHEMA.md)** - Complete schema reference
- **[Consolidated Docs](../../docs/CONSOLIDATED_DOCUMENTATION.md)** - System guide

---

**Last Updated:** October 10, 2025
**Active Triggers:** 1 (n8n Stage 1)
**Status:** ✅ Production Ready
