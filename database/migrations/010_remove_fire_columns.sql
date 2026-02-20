-- Migration 010: Remove fire detection columns
-- The YOLO inference model only detects smoke. Fire detection was never implemented.
-- All has_fire and confidence_fire data is effectively dead (always false / NULL).
-- This migration cleans up the schema to reflect reality.

-- Drop fire-related constraint
ALTER TABLE execution_analysis DROP CONSTRAINT IF EXISTS check_confidence_fire_range;

-- Drop fire-related indexes
DROP INDEX IF EXISTS idx_execution_analysis_has_fire;
DROP INDEX IF EXISTS idx_analysis_fire;

-- Drop fire columns
ALTER TABLE execution_analysis DROP COLUMN IF EXISTS has_fire;
ALTER TABLE execution_analysis DROP COLUMN IF EXISTS confidence_fire;
