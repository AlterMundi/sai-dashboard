-- Migration: Add 2-Stage ETL Processing Queue
-- Purpose: Support async Stage 2 processing with priority queue and retry logic
-- Date: 2025-01-08

-- ============================================================================
-- ETL Processing Queue Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS etl_processing_queue (
  id BIGSERIAL PRIMARY KEY,
  execution_id BIGINT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,

  -- Processing stage and status
  stage VARCHAR(20) NOT NULL DEFAULT 'stage2',  -- Future: 'stage3' for ML reprocessing
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'

  -- Priority and retry management
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),  -- 1 = critical, 5 = normal, 10 = low
  attempts INTEGER DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,

  -- Timestamps for tracking
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Metadata for debugging
  processing_time_ms INTEGER,
  worker_id VARCHAR(50),  -- Which worker processed this

  -- Constraints
  CONSTRAINT unique_execution_stage UNIQUE (execution_id, stage),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped'))
);

-- ============================================================================
-- Indexes for Queue Performance
-- ============================================================================

-- Index for fetching next pending items (most important query)
CREATE INDEX idx_etl_queue_pending ON etl_processing_queue(status, priority, queued_at)
  WHERE status = 'pending';

-- Index for monitoring failed items
CREATE INDEX idx_etl_queue_failed ON etl_processing_queue(status, attempts)
  WHERE status = 'failed';

-- Index for execution lookup
CREATE INDEX idx_etl_queue_execution ON etl_processing_queue(execution_id);

-- Index for stage-based queries
CREATE INDEX idx_etl_queue_stage ON etl_processing_queue(stage, status);

-- ============================================================================
-- Functions for Queue Management
-- ============================================================================

-- Function to automatically queue new executions for Stage 2
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
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-queue executions after Stage 1 insert
CREATE TRIGGER trigger_queue_stage2
  AFTER INSERT ON executions
  FOR EACH ROW
  EXECUTE FUNCTION queue_stage2_processing();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to mark queue item as processing
CREATE OR REPLACE FUNCTION etl_start_processing(
  p_execution_id BIGINT,
  p_worker_id VARCHAR(50)
) RETURNS BOOLEAN AS $$
DECLARE
  updated_rows INTEGER;
BEGIN
  UPDATE etl_processing_queue
  SET
    status = 'processing',
    started_at = NOW(),
    attempts = attempts + 1,
    worker_id = p_worker_id
  WHERE
    execution_id = p_execution_id
    AND stage = 'stage2'
    AND status = 'pending';

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows > 0;
END;
$$ LANGUAGE plpgsql;

-- Function to mark queue item as completed
CREATE OR REPLACE FUNCTION etl_mark_completed(
  p_execution_id BIGINT,
  p_processing_time_ms INTEGER
) RETURNS VOID AS $$
BEGIN
  UPDATE etl_processing_queue
  SET
    status = 'completed',
    completed_at = NOW(),
    processing_time_ms = p_processing_time_ms,
    last_error = NULL
  WHERE
    execution_id = p_execution_id
    AND stage = 'stage2';
END;
$$ LANGUAGE plpgsql;

-- Function to mark queue item as failed
CREATE OR REPLACE FUNCTION etl_mark_failed(
  p_execution_id BIGINT,
  p_error_message TEXT
) RETURNS VOID AS $$
DECLARE
  current_attempts INTEGER;
  max_retries INTEGER;
BEGIN
  -- Get current attempt count
  SELECT attempts, max_attempts
  INTO current_attempts, max_retries
  FROM etl_processing_queue
  WHERE execution_id = p_execution_id AND stage = 'stage2';

  -- If we've exhausted retries, mark as failed permanently
  IF current_attempts >= max_retries THEN
    UPDATE etl_processing_queue
    SET
      status = 'failed',
      last_error = p_error_message,
      completed_at = NOW()
    WHERE
      execution_id = p_execution_id
      AND stage = 'stage2';
  ELSE
    -- Otherwise, reset to pending for retry with lower priority
    UPDATE etl_processing_queue
    SET
      status = 'pending',
      priority = LEAST(priority + 2, 10),  -- Lower priority after failure
      last_error = p_error_message,
      started_at = NULL
    WHERE
      execution_id = p_execution_id
      AND stage = 'stage2';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Backfill Existing Executions (OPTIONAL - DO NOT RUN AUTOMATICALLY)
-- ============================================================================

-- WARNING: Backfilling all historical executions will queue 100K+ items!
-- Most old executions don't have execution_data in n8n (cleaned up).
-- Only backfill if you know the executions have data available.
--
-- To manually backfill RECENT executions only (last 7 days):
--
-- INSERT INTO etl_processing_queue (execution_id, stage, status, priority, queued_at)
-- SELECT
--   e.id,
--   'stage2',
--   'pending',
--   10,  -- Low priority for backfill
--   NOW()
-- FROM executions e
-- WHERE
--   e.status = 'success'
--   AND e.execution_timestamp > NOW() - INTERVAL '7 days'
--   AND NOT EXISTS (
--     SELECT 1
--     FROM execution_analysis ea
--     WHERE ea.execution_id = e.id
--   )
-- ON CONFLICT (execution_id, stage) DO NOTHING;
--
-- NOTE: Automatic backfill removed to prevent queue overload on first install.

-- ============================================================================
-- Views for Monitoring
-- ============================================================================

-- View for queue health monitoring
CREATE OR REPLACE VIEW etl_queue_health AS
SELECT
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE status = 'processing') as processing_count,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
  AVG(processing_time_ms) FILTER (WHERE status = 'completed') as avg_processing_time_ms,
  MAX(processing_time_ms) FILTER (WHERE status = 'completed') as max_processing_time_ms,
  MIN(queued_at) FILTER (WHERE status = 'pending') as oldest_pending,
  COUNT(*) FILTER (WHERE status = 'failed' AND attempts >= max_attempts) as permanently_failed
FROM etl_processing_queue
WHERE stage = 'stage2';

-- View for failed items needing attention
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

-- ============================================================================
-- Grants (adjust as needed for your user setup)
-- ============================================================================

-- Grant permissions to application user
GRANT SELECT, INSERT, UPDATE, DELETE ON etl_processing_queue TO n8n_user;
GRANT USAGE, SELECT ON SEQUENCE etl_processing_queue_id_seq TO n8n_user;
GRANT SELECT ON etl_queue_health TO n8n_user;
GRANT SELECT ON etl_failed_items TO n8n_user;

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE etl_processing_queue IS 'Queue for Stage 2 ETL processing. Tracks which executions need deep data extraction from n8n execution_data JSON.';
COMMENT ON COLUMN etl_processing_queue.priority IS '1=critical (immediate), 5=normal, 10=low (backfill). Lower number = higher priority.';
COMMENT ON COLUMN etl_processing_queue.attempts IS 'Number of processing attempts. Incremented on each retry.';
COMMENT ON COLUMN etl_processing_queue.max_attempts IS 'Maximum retry attempts before marking as permanently failed.';
COMMENT ON FUNCTION queue_stage2_processing() IS 'Automatically queues new executions for Stage 2 processing after Stage 1 insert.';
COMMENT ON FUNCTION etl_start_processing(BIGINT, VARCHAR) IS 'Marks a queue item as processing and increments attempt counter. Returns true if successful.';
COMMENT ON FUNCTION etl_mark_completed(BIGINT, INTEGER) IS 'Marks a queue item as completed with processing time.';
COMMENT ON FUNCTION etl_mark_failed(BIGINT, TEXT) IS 'Marks a queue item as failed. Requeues for retry if attempts < max_attempts, otherwise marks permanently failed.';

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Verify migration
DO $$
DECLARE
  queue_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO queue_count FROM etl_processing_queue;
  RAISE NOTICE 'ETL queue table created successfully. Queued items: % (should be 0 - backfill disabled)', queue_count;

  IF queue_count = 0 THEN
    RAISE NOTICE '✅ Queue is empty - ready for new executions via Stage 1 trigger';
  ELSE
    RAISE WARNING '⚠️ Queue has % items - check if backfill was run accidentally', queue_count;
  END IF;
END $$;
