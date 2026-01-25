-- ============================================================================
-- Migration 009: Performance Indexes
-- Purpose: Add missing indexes for common dashboard query patterns
-- Date: 2026-01-24
--
-- NOTE: CONCURRENTLY indexes cannot run inside a transaction.
-- Run this script outside of a transaction block.
-- ============================================================================

-- 1. Covering index for main executions query
-- Avoids heap fetches for most columns used in SELECT
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_executions_main_query
  ON executions(execution_timestamp DESC)
  INCLUDE (workflow_id, status, mode, camera_id, location, device_id, node_id, camera_type);

-- 2. Index for camera filtering (very common use case)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_executions_camera
  ON executions(camera_id, execution_timestamp DESC)
  WHERE camera_id IS NOT NULL;

-- 3. Index for status filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_executions_status
  ON executions(status, execution_timestamp DESC);

-- 4. Partial index for fire detections (hot path in dashboard)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analysis_fire
  ON execution_analysis(execution_id)
  WHERE has_fire = true;

-- 5. Partial index for smoke detections
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analysis_smoke
  ON execution_analysis(execution_id)
  WHERE has_smoke = true;

-- 6. Index for high priority alerts (common filter)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analysis_high_alert
  ON execution_analysis(execution_id, alert_level)
  WHERE alert_level IN ('high', 'critical');

-- 7. Index for confidence ranking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analysis_confidence
  ON execution_analysis(confidence_score DESC NULLS LAST)
  WHERE confidence_score IS NOT NULL;

-- Update planner statistics
ANALYZE executions;
ANALYZE execution_analysis;
ANALYZE execution_images;
ANALYZE execution_notifications;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '=== Migration 009 complete: Performance indexes created ===';
END $$;
