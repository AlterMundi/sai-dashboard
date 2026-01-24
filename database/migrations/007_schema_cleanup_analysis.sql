-- Migration 007: Schema Cleanup Based on Critical Analysis
-- Date: 2025-01-23
-- Source: Supabase Postgres Best Practices analysis
--
-- Changes:
-- 1. CRITICAL: Convert all timestamp -> timestamptz
-- 2. HIGH: Drop unused indexes (verified 0 scans)
-- 3. MEDIUM: Drop redundant idx_executions_timestamp
-- 4. MEDIUM: Add composite index for alert filtering
-- 5. LOW: Add CHECK constraints for confidence scores

-- ============================================================================
-- Phase 1: CRITICAL - Convert timestamp to timestamptz
-- ============================================================================
-- Without timezone info, timestamps become ambiguous if server TZ changes

-- First, drop views that depend on the columns we're altering
DROP VIEW IF EXISTS etl_failed_items;

-- executions table
ALTER TABLE executions
  ALTER COLUMN execution_timestamp TYPE timestamptz
    USING execution_timestamp AT TIME ZONE 'UTC',
  ALTER COLUMN completion_timestamp TYPE timestamptz
    USING completion_timestamp AT TIME ZONE 'UTC',
  ALTER COLUMN capture_timestamp TYPE timestamptz
    USING capture_timestamp AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz
    USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz
    USING updated_at AT TIME ZONE 'UTC';

-- Recreate the etl_failed_items view
CREATE OR REPLACE VIEW etl_failed_items AS
SELECT
  q.execution_id,
  q.attempts,
  q.max_attempts,
  q.last_error,
  q.queued_at,
  e.execution_timestamp,
  e.status as execution_status
FROM etl_processing_queue q
JOIN executions e ON e.id = q.execution_id
WHERE q.status = 'failed'
ORDER BY q.queued_at DESC;

-- execution_analysis table
ALTER TABLE execution_analysis
  ALTER COLUMN analysis_timestamp TYPE timestamptz
    USING analysis_timestamp AT TIME ZONE 'UTC';

-- execution_images table (if has timestamp columns)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'execution_images'
    AND column_name = 'extracted_at'
    AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE execution_images
      ALTER COLUMN extracted_at TYPE timestamptz
        USING extracted_at AT TIME ZONE 'UTC';
  END IF;
END $$;

-- execution_notifications table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'execution_notifications'
    AND column_name = 'telegram_sent_at'
    AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE execution_notifications
      ALTER COLUMN telegram_sent_at TYPE timestamptz
        USING telegram_sent_at AT TIME ZONE 'UTC';
  END IF;
END $$;

COMMENT ON COLUMN executions.execution_timestamp IS 'When n8n started executing (timezone-aware)';
COMMENT ON COLUMN executions.completion_timestamp IS 'When n8n finished executing (timezone-aware)';

-- ============================================================================
-- Phase 2: HIGH - Drop unused indexes (0 scans in production)
-- ============================================================================
-- These indexes consume disk space and slow down writes without being used

-- executions table - unused filter indexes
DROP INDEX IF EXISTS idx_executions_camera_type;
DROP INDEX IF EXISTS idx_executions_completion;
DROP INDEX IF EXISTS idx_executions_device_id;
DROP INDEX IF EXISTS idx_executions_location;

-- execution_analysis table - unused boolean indexes
-- Note: has_fire/has_smoke partial indexes may be useful for future dashboard filtering
-- Keeping them but dropping detection_count (covered by alert_level queries)
-- DROP INDEX IF EXISTS idx_execution_analysis_detection_count;

-- execution_images table - unused path index
DROP INDEX IF EXISTS idx_execution_images_path;

-- ============================================================================
-- Phase 3: MEDIUM - Drop redundant index
-- ============================================================================
-- idx_executions_timestamp is fully covered by idx_executions_timestamp_id

DROP INDEX IF EXISTS idx_executions_timestamp;

-- ============================================================================
-- Phase 4: MEDIUM - Add composite index for alert + timestamp filtering
-- ============================================================================
-- Dashboard commonly filters by alert_level then sorts by timestamp
-- This index allows efficient "show me all high alerts" queries

CREATE INDEX IF NOT EXISTS idx_analysis_alert_execution
ON execution_analysis(alert_level, execution_id DESC)
WHERE alert_level IS NOT NULL AND alert_level != 'none';

COMMENT ON INDEX idx_analysis_alert_execution IS
  'Composite index for filtering by alert_level with execution ordering';

-- ============================================================================
-- Phase 5: LOW - Add CHECK constraints for data integrity
-- ============================================================================

-- Confidence scores should be 0.0 to 1.0
DO $$
BEGIN
  -- Add constraint if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_confidence_score_range'
  ) THEN
    ALTER TABLE execution_analysis
      ADD CONSTRAINT check_confidence_score_range
      CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_confidence_fire_range'
  ) THEN
    ALTER TABLE execution_analysis
      ADD CONSTRAINT check_confidence_fire_range
      CHECK (confidence_fire IS NULL OR (confidence_fire >= 0 AND confidence_fire <= 1));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_confidence_smoke_range'
  ) THEN
    ALTER TABLE execution_analysis
      ADD CONSTRAINT check_confidence_smoke_range
      CHECK (confidence_smoke IS NULL OR (confidence_smoke >= 0 AND confidence_smoke <= 1));
  END IF;
END $$;

-- Alert level should be a known value
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_alert_level_valid'
  ) THEN
    ALTER TABLE execution_analysis
      ADD CONSTRAINT check_alert_level_valid
      CHECK (alert_level IS NULL OR alert_level IN ('none', 'low', 'medium', 'high', 'critical'));
  END IF;
END $$;

-- Detection count should be non-negative
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_detection_count_positive'
  ) THEN
    ALTER TABLE execution_analysis
      ADD CONSTRAINT check_detection_count_positive
      CHECK (detection_count IS NULL OR detection_count >= 0);
  END IF;
END $$;

-- ============================================================================
-- Phase 6: Update statistics after schema changes
-- ============================================================================

ANALYZE executions;
ANALYZE execution_analysis;
ANALYZE execution_images;
ANALYZE etl_processing_queue;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  timestamptz_count INTEGER;
  dropped_indexes INTEGER;
  new_index_exists BOOLEAN;
  constraints_added INTEGER;
BEGIN
  -- Count timestamptz columns in executions
  SELECT COUNT(*) INTO timestamptz_count
  FROM information_schema.columns
  WHERE table_name = 'executions'
  AND data_type = 'timestamp with time zone';

  -- Check if redundant index was dropped
  SELECT COUNT(*) INTO dropped_indexes
  FROM pg_indexes
  WHERE indexname IN (
    'idx_executions_timestamp',
    'idx_executions_camera_type',
    'idx_executions_completion',
    'idx_executions_device_id',
    'idx_executions_location',
    'idx_execution_images_path'
  );

  -- Check if new composite index exists
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_analysis_alert_execution'
  ) INTO new_index_exists;

  -- Count new constraints
  SELECT COUNT(*) INTO constraints_added
  FROM pg_constraint
  WHERE conname LIKE 'check_%'
  AND conrelid = 'execution_analysis'::regclass;

  RAISE NOTICE '============================================';
  RAISE NOTICE '✅ Migration 007 completed:';
  RAISE NOTICE '   - timestamptz columns in executions: %', timestamptz_count;
  RAISE NOTICE '   - Remaining dropped indexes: % (should be 0)', dropped_indexes;
  RAISE NOTICE '   - New composite index created: %', new_index_exists;
  RAISE NOTICE '   - CHECK constraints added: %', constraints_added;
  RAISE NOTICE '============================================';

  IF dropped_indexes > 0 THEN
    RAISE WARNING 'Some indexes were not dropped - check manually';
  END IF;
END $$;

-- ============================================================================
-- Rollback instructions (manual)
-- ============================================================================
--
-- To rollback timestamptz changes:
-- ALTER TABLE executions ALTER COLUMN execution_timestamp TYPE timestamp;
-- (repeat for other columns)
--
-- To recreate dropped indexes:
-- CREATE INDEX idx_executions_timestamp ON executions(execution_timestamp DESC);
-- CREATE INDEX idx_executions_camera_type ON executions(camera_type);
-- etc.
--
-- To drop new index:
-- DROP INDEX idx_analysis_alert_execution;
--
-- To drop constraints:
-- ALTER TABLE execution_analysis DROP CONSTRAINT check_confidence_score_range;
-- etc.
