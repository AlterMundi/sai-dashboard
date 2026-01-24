-- Migration: ETL Improvements for Concurrency and Performance
-- Purpose: Add SKIP LOCKED support, LISTEN/NOTIFY, stale worker cleanup, optimized indexes
-- Date: 2025-01-23
--
-- Changes:
-- 1. New optimized index with INCLUDE clause for Stage 2 pending items
-- 2. Function to cleanup stale workers (stuck in 'processing' state)
-- 3. Update trigger to add NOTIFY for immediate Stage 2 processing
-- 4. New atomic batch claim function with SKIP LOCKED
-- 5. Aggressive autovacuum settings for high-churn queue table
-- 6. Index for cursor-based pagination on executions

-- ============================================================================
-- Phase 1: New Optimized Index for Stage 2 Queue
-- ============================================================================

-- Drop the old partial index (less specific)
DROP INDEX IF EXISTS idx_etl_queue_pending;

-- Create new covering index that includes execution_id to avoid table lookups
-- Only indexes rows that are actually eligible for processing
CREATE INDEX idx_etl_queue_ready ON etl_processing_queue(priority, queued_at)
  INCLUDE (execution_id)
  WHERE status = 'pending' AND stage = 'stage2' AND attempts < max_attempts;

COMMENT ON INDEX idx_etl_queue_ready IS 'Covering index for Stage 2 queue fetch - includes execution_id to avoid table lookups';

-- ============================================================================
-- Phase 2: Stale Worker Cleanup Function
-- ============================================================================

-- Clean up workers that have been stuck in 'processing' for too long
-- This handles cases where a worker crashed or was terminated unexpectedly
CREATE OR REPLACE FUNCTION etl_cleanup_stale_workers(
  stale_threshold INTERVAL DEFAULT '5 minutes'
) RETURNS INTEGER AS $$
DECLARE
  stale_count INTEGER;
BEGIN
  UPDATE etl_processing_queue
  SET
    status = 'pending',
    last_error = format('Worker timeout after %s - requeued automatically at %s', stale_threshold, NOW()),
    started_at = NULL,
    worker_id = NULL
  WHERE status = 'processing'
    AND stage = 'stage2'
    AND started_at < NOW() - stale_threshold;

  GET DIAGNOSTICS stale_count = ROW_COUNT;

  IF stale_count > 0 THEN
    RAISE NOTICE 'ETL cleanup: Requeued % stale items', stale_count;
  END IF;

  RETURN stale_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION etl_cleanup_stale_workers(INTERVAL) IS
  'Resets processing items that have been stuck for too long. Call periodically (e.g., every 60s) to recover from worker crashes.';

-- ============================================================================
-- Phase 3: Update Trigger to Add NOTIFY
-- ============================================================================

-- Replace the existing trigger function to add pg_notify
-- This allows Stage 2 workers to wake up immediately when new work arrives
CREATE OR REPLACE FUNCTION queue_stage2_processing()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue successful executions for deep processing
  IF NEW.status = 'success' THEN
    INSERT INTO etl_processing_queue (
      execution_id,
      stage,
      status,
      priority,
      queued_at
    ) VALUES (
      NEW.id,
      'stage2',
      'pending',
      1,  -- High priority for new executions
      NOW()
    )
    ON CONFLICT (execution_id, stage) DO NOTHING;

    -- NOTIFY Stage 2 workers immediately (no polling delay)
    PERFORM pg_notify('stage2_queue', NEW.id::text);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: Trigger itself doesn't need to be recreated - function update is sufficient

-- ============================================================================
-- Phase 4: Atomic Batch Claim with SKIP LOCKED
-- ============================================================================

-- This function atomically claims a batch of items for processing
-- Uses SKIP LOCKED to allow multiple workers to claim different items concurrently
-- without blocking each other
CREATE OR REPLACE FUNCTION etl_claim_batch(
  p_worker_id VARCHAR(50),
  p_batch_size INTEGER DEFAULT 10
) RETURNS TABLE(execution_id BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT eq.execution_id
    FROM etl_processing_queue eq
    WHERE eq.status = 'pending'
      AND eq.stage = 'stage2'
      AND eq.attempts < eq.max_attempts
    ORDER BY eq.priority ASC, eq.queued_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE etl_processing_queue q
  SET
    status = 'processing',
    started_at = NOW(),
    attempts = q.attempts + 1,
    worker_id = p_worker_id
  FROM claimed c
  WHERE q.execution_id = c.execution_id
    AND q.stage = 'stage2'
  RETURNING q.execution_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION etl_claim_batch(VARCHAR, INTEGER) IS
  'Atomically claim a batch of pending items for processing using SKIP LOCKED. Returns list of claimed execution_ids.';

-- ============================================================================
-- Phase 5: Aggressive Autovacuum for Queue Table
-- ============================================================================

-- The queue table has high churn (frequent inserts, updates, deletes)
-- Aggressive autovacuum prevents bloat and keeps performance optimal
ALTER TABLE etl_processing_queue SET (
  autovacuum_vacuum_scale_factor = 0.02,      -- Vacuum when 2% of table is dead (default: 20%)
  autovacuum_analyze_scale_factor = 0.01,     -- Analyze when 1% changed (default: 10%)
  autovacuum_vacuum_cost_delay = 0            -- No throttling for this table
);

COMMENT ON TABLE etl_processing_queue IS
  'Queue for Stage 2 ETL processing. High-churn table with aggressive autovacuum. Tracks which executions need deep data extraction from n8n.';

-- ============================================================================
-- Phase 6: Index for Cursor-Based Pagination on Executions
-- ============================================================================

-- Support efficient cursor-based pagination for the dashboard
-- Uses (timestamp, id) for stable cursor ordering
CREATE INDEX IF NOT EXISTS idx_executions_timestamp_id
ON executions(execution_timestamp DESC, id DESC);

COMMENT ON INDEX idx_executions_timestamp_id IS
  'Index for efficient cursor-based pagination in dashboard. Combines timestamp and id for stable ordering.';

-- ============================================================================
-- Phase 7: Batch Fetch Helper (for execution_data)
-- ============================================================================

-- Note: This is a helper function for TypeScript code to batch-fetch from n8n database.
-- The actual batch query will be done in TypeScript, but we document the pattern here:
--
-- SELECT "executionId", data
-- FROM execution_data
-- WHERE "executionId" = ANY($1::bigint[])
--
-- This fetches all execution_data in a single query instead of N queries.

-- ============================================================================
-- Phase 8: Update Queue Health View
-- ============================================================================

-- Drop and recreate the view to add stale_processing_count column
DROP VIEW IF EXISTS etl_queue_health;
CREATE VIEW etl_queue_health AS
SELECT
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE status = 'processing') as processing_count,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
  COUNT(*) FILTER (WHERE status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes') as stale_processing_count,
  AVG(processing_time_ms) FILTER (WHERE status = 'completed') as avg_processing_time_ms,
  MAX(processing_time_ms) FILTER (WHERE status = 'completed') as max_processing_time_ms,
  MIN(queued_at) FILTER (WHERE status = 'pending') as oldest_pending,
  MAX(completed_at) FILTER (WHERE status = 'completed') as latest_completed,
  COUNT(*) FILTER (WHERE status = 'failed' AND attempts >= max_attempts) as permanently_failed
FROM etl_processing_queue
WHERE stage = 'stage2';

-- ============================================================================
-- Grants
-- ============================================================================

-- Grant execute permissions on new functions (skip if role doesn't exist in dev)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_user') THEN
    GRANT EXECUTE ON FUNCTION etl_cleanup_stale_workers(INTERVAL) TO n8n_user;
    GRANT EXECUTE ON FUNCTION etl_claim_batch(VARCHAR, INTEGER) TO n8n_user;
    RAISE NOTICE 'Grants applied to n8n_user';
  ELSE
    RAISE NOTICE 'Skipping grants: n8n_user role does not exist (development environment)';
  END IF;
END $$;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  idx_ready_exists BOOLEAN;
  idx_timestamp_exists BOOLEAN;
  func_cleanup_exists BOOLEAN;
  func_claim_exists BOOLEAN;
BEGIN
  -- Check index existence
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_etl_queue_ready'
  ) INTO idx_ready_exists;

  SELECT EXISTS(
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_executions_timestamp_id'
  ) INTO idx_timestamp_exists;

  -- Check function existence
  SELECT EXISTS(
    SELECT 1 FROM pg_proc WHERE proname = 'etl_cleanup_stale_workers'
  ) INTO func_cleanup_exists;

  SELECT EXISTS(
    SELECT 1 FROM pg_proc WHERE proname = 'etl_claim_batch'
  ) INTO func_claim_exists;

  -- Report results
  IF idx_ready_exists AND idx_timestamp_exists AND func_cleanup_exists AND func_claim_exists THEN
    RAISE NOTICE '✅ Migration 006 completed successfully:';
    RAISE NOTICE '   - idx_etl_queue_ready: created';
    RAISE NOTICE '   - idx_executions_timestamp_id: created';
    RAISE NOTICE '   - etl_cleanup_stale_workers(): created';
    RAISE NOTICE '   - etl_claim_batch(): created';
    RAISE NOTICE '   - queue_stage2_processing(): updated with NOTIFY';
    RAISE NOTICE '   - Autovacuum settings: configured';
  ELSE
    RAISE WARNING '⚠️ Some migration components may not have been created:';
    RAISE WARNING '   idx_etl_queue_ready: %', CASE WHEN idx_ready_exists THEN 'OK' ELSE 'MISSING' END;
    RAISE WARNING '   idx_executions_timestamp_id: %', CASE WHEN idx_timestamp_exists THEN 'OK' ELSE 'MISSING' END;
    RAISE WARNING '   etl_cleanup_stale_workers: %', CASE WHEN func_cleanup_exists THEN 'OK' ELSE 'MISSING' END;
    RAISE WARNING '   etl_claim_batch: %', CASE WHEN func_claim_exists THEN 'OK' ELSE 'MISSING' END;
  END IF;
END $$;

-- ============================================================================
-- Migration Complete
-- ============================================================================
