-- Migration 004: Remove Legacy Fields
-- Date: 2025-10-10
-- Description: Remove all Ollama/legacy compatibility fields from execution_analysis table
-- This migration completes the YOLO schema redesign by removing backward compatibility

BEGIN;

-- ============================================================================
-- Remove legacy Ollama-era fields from execution_analysis
-- ============================================================================

ALTER TABLE execution_analysis
  -- Legacy analysis fields (replaced by YOLO fields)
  DROP COLUMN IF EXISTS risk_level,
  DROP COLUMN IF EXISTS smoke_detected,
  DROP COLUMN IF EXISTS flame_detected,
  DROP COLUMN IF EXISTS alert_priority,
  DROP COLUMN IF EXISTS response_required,

  -- Duplicate device/location fields (moved to executions table)
  DROP COLUMN IF EXISTS node_id,
  DROP COLUMN IF EXISTS camera_id,
  DROP COLUMN IF EXISTS camera_location,
  DROP COLUMN IF EXISTS location_lat,
  DROP COLUMN IF EXISTS location_lng,

  -- Deprecated processing fields
  DROP COLUMN IF EXISTS processing_time_ms,

  -- Unused/deprecated fields
  DROP COLUMN IF EXISTS raw_response,
  DROP COLUMN IF EXISTS has_telegram_confirmation;

-- ============================================================================
-- Verify critical YOLO fields still exist
-- ============================================================================

DO $$
BEGIN
  -- Ensure YOLO fields are present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'execution_analysis' AND column_name = 'alert_level'
  ) THEN
    RAISE EXCEPTION 'Critical field alert_level missing! Run migration 003 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'execution_analysis' AND column_name = 'has_fire'
  ) THEN
    RAISE EXCEPTION 'Critical field has_fire missing! Run migration 003 first.';
  END IF;
END $$;

-- ============================================================================
-- Update comments
-- ============================================================================

COMMENT ON TABLE execution_analysis IS 'YOLO fire detection analysis results - Pure YOLO schema (no legacy fields)';

COMMENT ON COLUMN execution_analysis.alert_level IS 'YOLO alert level: none, low, medium, high, critical';
COMMENT ON COLUMN execution_analysis.detection_mode IS 'YOLO detection mode: smoke-only, fire-only, both';
COMMENT ON COLUMN execution_analysis.has_fire IS 'Fire detected by YOLO (boolean)';
COMMENT ON COLUMN execution_analysis.has_smoke IS 'Smoke detected by YOLO (boolean)';
COMMENT ON COLUMN execution_analysis.detection_count IS 'Total number of detections from YOLO';

-- ============================================================================
-- Verify migration
-- ============================================================================

SELECT
  'Migration 004 completed successfully' as status,
  COUNT(*) as remaining_columns
FROM information_schema.columns
WHERE table_name = 'execution_analysis';

COMMIT;

-- ============================================================================
-- Rollback Instructions (if needed)
-- ============================================================================

-- To rollback this migration, you would need to restore the legacy columns:
--
-- ALTER TABLE execution_analysis
--   ADD COLUMN risk_level VARCHAR(20),
--   ADD COLUMN smoke_detected BOOLEAN DEFAULT false,
--   ADD COLUMN flame_detected BOOLEAN DEFAULT false,
--   ADD COLUMN alert_priority VARCHAR(20) DEFAULT 'normal',
--   ADD COLUMN response_required BOOLEAN DEFAULT false,
--   ADD COLUMN node_id VARCHAR(50),
--   ADD COLUMN camera_id VARCHAR(50),
--   ADD COLUMN camera_location VARCHAR(100),
--   ADD COLUMN location_lat NUMERIC,
--   ADD COLUMN location_lng NUMERIC,
--   ADD COLUMN processing_time_ms INTEGER,
--   ADD COLUMN raw_response TEXT,
--   ADD COLUMN has_telegram_confirmation BOOLEAN DEFAULT false;
--
-- However, data cannot be recovered after dropping these columns!
