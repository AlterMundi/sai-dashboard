-- Migration 014: Create etl_cleanup_stale_workers function
-- Recovers queue items stuck in 'processing' state beyond the stale threshold

CREATE OR REPLACE FUNCTION etl_cleanup_stale_workers(stale_threshold interval)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  recovered integer;
BEGIN
  UPDATE etl_processing_queue
  SET status = 'pending',
      worker_id = NULL,
      started_at = NULL
  WHERE status = 'processing'
    AND started_at < NOW() - stale_threshold
    AND attempts < max_attempts;

  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$;
