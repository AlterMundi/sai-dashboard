-- ============================================================================
-- Migration 011: Filter Options Indexes
-- Purpose: Support fast SELECT DISTINCT queries for dynamic filter dropdowns
-- Date: 2026-02-20
--
-- NOTE: CONCURRENTLY cannot run inside a transaction block.
-- Run outside a transaction (psql \i or standalone connection).
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exec_distinct_location
  ON executions(location)
  WHERE location IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exec_distinct_node_id
  ON executions(node_id)
  WHERE node_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exec_distinct_device_id
  ON executions(device_id)
  WHERE device_id IS NOT NULL;

-- camera_id already indexed via idx_executions_camera; add dedicated partial for DISTINCT
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_exec_distinct_camera_id
  ON executions(camera_id)
  WHERE camera_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ea_distinct_yolo_model
  ON execution_analysis(yolo_model_version)
  WHERE yolo_model_version IS NOT NULL;

ANALYZE executions;
ANALYZE execution_analysis;

DO $$
BEGIN
  RAISE NOTICE '=== Migration 011 complete: Filter-options indexes created ===';
END $$;
