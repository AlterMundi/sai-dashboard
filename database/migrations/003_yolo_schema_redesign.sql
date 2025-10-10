-- ============================================================================
-- Migration 003: YOLO Schema Redesign
-- ============================================================================
--
-- PURPOSE:
--   Remove all Ollama-based AI analysis references and restructure schema
--   to match the actual SAI fire detection system which uses a custom YOLO
--   inference service.
--
-- CHANGES:
--   1. Remove Ollama-specific columns
--   2. Add YOLO-specific fields (detections, alert levels, confidence per class)
--   3. Add device/location metadata to executions table
--   4. Create execution_detections table for bounding box storage
--   5. Rename/repurpose columns to match YOLO output
--
-- DATA INTEGRITY:
--   - All new fields are nullable (NULL = data not available)
--   - Existing data preserved where semantic mapping is clear
--   - No fake defaults, following DATA_INTEGRITY_PRINCIPLES.md
--
-- AUTHOR: SAI Dashboard Team
-- DATE: 2025-10-10
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Update execution_analysis table
-- ============================================================================

-- Add YOLO-specific fields (all nullable per data integrity principles)
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS request_id UUID;
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS detection_count INTEGER;
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS has_fire BOOLEAN DEFAULT false;
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS has_smoke BOOLEAN DEFAULT false;
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS alert_level VARCHAR(20);
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS detection_mode VARCHAR(50);
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS active_classes TEXT[];
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS image_width INTEGER;
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS image_height INTEGER;
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS yolo_processing_time_ms NUMERIC(10,2);
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS detections JSONB;
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS confidence_fire NUMERIC(4,3);
ALTER TABLE execution_analysis ADD COLUMN IF NOT EXISTS confidence_smoke NUMERIC(4,3);

-- Rename model_version to be explicit about YOLO
ALTER TABLE execution_analysis RENAME COLUMN model_version TO yolo_model_version;

-- Backfill has_fire/has_smoke from existing flame_detected/smoke_detected (best effort)
UPDATE execution_analysis
SET has_fire = COALESCE(flame_detected, false),
    has_smoke = COALESCE(smoke_detected, false)
WHERE has_fire IS NULL OR has_smoke IS NULL;

-- Drop Ollama-specific columns (no longer relevant)
ALTER TABLE execution_analysis DROP COLUMN IF EXISTS ollama_response;
ALTER TABLE execution_analysis DROP COLUMN IF EXISTS has_ollama_analysis;
ALTER TABLE execution_analysis DROP COLUMN IF EXISTS overall_assessment;

-- Drop detection columns that don't apply to YOLO fire detection
ALTER TABLE execution_analysis DROP COLUMN IF EXISTS heat_signature_detected;
ALTER TABLE execution_analysis DROP COLUMN IF EXISTS motion_detected;
ALTER TABLE execution_analysis DROP COLUMN IF EXISTS vehicle_detected;
ALTER TABLE execution_analysis DROP COLUMN IF EXISTS people_detected;

-- Add indexes for new fields
CREATE INDEX IF NOT EXISTS idx_execution_analysis_alert_level ON execution_analysis(alert_level);
CREATE INDEX IF NOT EXISTS idx_execution_analysis_has_fire ON execution_analysis(has_fire) WHERE has_fire = true;
CREATE INDEX IF NOT EXISTS idx_execution_analysis_has_smoke ON execution_analysis(has_smoke) WHERE has_smoke = true;
CREATE INDEX IF NOT EXISTS idx_execution_analysis_detection_count ON execution_analysis(detection_count) WHERE detection_count > 0;

-- Add comments for new columns
COMMENT ON COLUMN execution_analysis.request_id IS 'UUID from YOLO inference request';
COMMENT ON COLUMN execution_analysis.detection_count IS 'Total number of detections (fire + smoke)';
COMMENT ON COLUMN execution_analysis.has_fire IS 'Boolean flag: true if any fire detection';
COMMENT ON COLUMN execution_analysis.has_smoke IS 'Boolean flag: true if any smoke detection';
COMMENT ON COLUMN execution_analysis.alert_level IS 'Alert level from YOLO: none/low/medium/high/critical';
COMMENT ON COLUMN execution_analysis.detection_mode IS 'Detection mode: smoke-only, fire-only, fire-and-smoke';
COMMENT ON COLUMN execution_analysis.active_classes IS 'Array of active detection classes';
COMMENT ON COLUMN execution_analysis.detections IS 'JSONB array of detection objects with bounding boxes';
COMMENT ON COLUMN execution_analysis.confidence_fire IS 'Confidence score for fire class (0.000-1.000)';
COMMENT ON COLUMN execution_analysis.confidence_smoke IS 'Confidence score for smoke class (0.000-1.000)';
COMMENT ON COLUMN execution_analysis.yolo_model_version IS 'YOLO model version (e.g., last.pt, yolov8-fire-v2.pt)';

-- ============================================================================
-- PART 2: Update executions table (add device/location metadata)
-- ============================================================================

ALTER TABLE executions ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
ALTER TABLE executions ADD COLUMN IF NOT EXISTS location VARCHAR(200);
ALTER TABLE executions ADD COLUMN IF NOT EXISTS camera_type VARCHAR(50);
ALTER TABLE executions ADD COLUMN IF NOT EXISTS capture_timestamp TIMESTAMP;

-- Add indexes for device/location queries
CREATE INDEX IF NOT EXISTS idx_executions_device_id ON executions(device_id);
CREATE INDEX IF NOT EXISTS idx_executions_location ON executions(location);
CREATE INDEX IF NOT EXISTS idx_executions_camera_type ON executions(camera_type);

-- Add comments
COMMENT ON COLUMN executions.device_id IS 'Device ID from camera metadata (e.g., sai-cam-node-07)';
COMMENT ON COLUMN executions.location IS 'Camera location from metadata (e.g., Molinari)';
COMMENT ON COLUMN executions.camera_type IS 'Camera type: rtsp, usb, ip, etc.';
COMMENT ON COLUMN executions.capture_timestamp IS 'Image capture timestamp from camera metadata';

-- ============================================================================
-- PART 3: Create execution_detections table (for bounding boxes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS execution_detections (
  id SERIAL PRIMARY KEY,
  execution_id BIGINT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  detection_class VARCHAR(50) NOT NULL,
  confidence NUMERIC(4,3) NOT NULL,
  bounding_box JSONB NOT NULL,
  detection_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT valid_detection_class CHECK (detection_class IN ('fire', 'smoke'))
);

CREATE INDEX IF NOT EXISTS idx_execution_detections_execution ON execution_detections(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_detections_class ON execution_detections(detection_class);
CREATE INDEX IF NOT EXISTS idx_execution_detections_confidence ON execution_detections(confidence DESC);

COMMENT ON TABLE execution_detections IS 'Individual YOLO detections with bounding boxes (one row per detection)';
COMMENT ON COLUMN execution_detections.detection_class IS 'Detection class: fire or smoke';
COMMENT ON COLUMN execution_detections.confidence IS 'Detection confidence (0.000-1.000)';
COMMENT ON COLUMN execution_detections.bounding_box IS 'JSONB: {x, y, width, height} in pixels';
COMMENT ON COLUMN execution_detections.detection_index IS 'Index in original detections array (0-based)';

-- ============================================================================
-- PART 4: Data migration and cleanup
-- ============================================================================

-- Mark all existing execution_analysis records as needing reprocessing
-- (They were analyzed with wrong extraction logic)
UPDATE execution_analysis
SET updated_at = NULL
WHERE yolo_model_version IS NULL
   OR alert_level IS NULL
   OR detection_count IS NULL;

-- Optional: Queue all existing executions for Stage 2 reprocessing
-- (Only if you want to backfill with new extraction logic)
--
-- INSERT INTO etl_processing_queue (execution_id, stage, status, priority, queued_at)
-- SELECT e.id, 'stage2', 'pending', 5, NOW()
-- FROM executions e
-- WHERE NOT EXISTS (
--   SELECT 1 FROM execution_analysis ea
--   WHERE ea.execution_id = e.id
--     AND ea.alert_level IS NOT NULL
-- )
-- ON CONFLICT (execution_id, stage) DO NOTHING;

COMMIT;

-- ============================================================================
-- Post-migration verification queries
-- ============================================================================

-- Verify new columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'execution_analysis'
  AND column_name IN ('request_id', 'detection_count', 'has_fire', 'has_smoke', 'alert_level', 'yolo_model_version')
ORDER BY column_name;

-- Check data distribution
SELECT
  COUNT(*) as total,
  COUNT(alert_level) as with_alert_level,
  COUNT(yolo_model_version) as with_model,
  COUNT(detection_count) as with_detections,
  SUM(CASE WHEN has_fire THEN 1 ELSE 0 END) as fire_detections,
  SUM(CASE WHEN has_smoke THEN 1 ELSE 0 END) as smoke_detections
FROM execution_analysis;

-- Verify execution_detections table
SELECT COUNT(*) as detection_rows FROM execution_detections;
