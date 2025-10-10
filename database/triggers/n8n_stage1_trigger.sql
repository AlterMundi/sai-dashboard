-- ============================================================================
-- Stage 1 ETL Trigger for N8N Database
-- ============================================================================
--
-- PURPOSE: Immediately notify Stage 1 ETL service when SAI executions complete
--
-- INSTALL: Run this in the N8N database (not sai_dashboard)
--
-- PHILOSOPHY:
-- - Trigger fires on execution_entity INSERT/UPDATE
-- - Only processes SAI workflow executions
-- - Sends lightweight notification (no JSON parsing)
-- - Stage 1 service extracts minimal metadata immediately
-- - Stage 2 handles deep extraction asynchronously
--
-- See: docs/TWO_STAGE_ETL_ARCHITECTURE.md
-- See: docs/DATA_INTEGRITY_PRINCIPLES.md
-- ============================================================================

-- ============================================================================
-- Function: Notify Stage 1 ETL Service
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_sai_execution_stage1()
RETURNS TRIGGER AS $$
DECLARE
  sai_workflow_id TEXT := 'yDbfhooKemfhMIkC';  -- SAI workflow ID
  notification_payload JSON;
BEGIN
  -- Only process SAI workflow executions
  IF NEW."workflowId"::text != sai_workflow_id THEN
    RETURN NEW;
  END IF;

  -- Only notify when execution is finished
  IF NEW."finished" = FALSE THEN
    RETURN NEW;
  END IF;

  -- Build Stage 1 notification payload
  -- Contains ONLY data from execution_entity (no JSON parsing)
  notification_payload := json_build_object(
    'execution_id', NEW.id,
    'workflow_id', NEW."workflowId",
    'started_at', NEW."startedAt",
    'stopped_at', NEW."stoppedAt",
    'status', CASE
      WHEN NEW."finished" = TRUE AND NEW."stoppedAt" IS NOT NULL THEN 'success'
      WHEN NEW."waitTill" IS NOT NULL THEN 'waiting'
      ELSE 'running'
    END,
    'mode', NEW.mode
  );

  -- Send notification to Stage 1 ETL service
  PERFORM pg_notify('sai_execution_stage1', notification_payload::text);

  -- Log notification (optional - for debugging)
  RAISE DEBUG 'Stage 1 notification sent for execution %', NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Trigger: Fire on SAI Execution Completion
-- ============================================================================

-- Drop old trigger if it exists
DROP TRIGGER IF EXISTS trigger_sai_execution_stage1 ON execution_entity;

-- Create new trigger
CREATE TRIGGER trigger_sai_execution_stage1
  AFTER INSERT OR UPDATE ON execution_entity
  FOR EACH ROW
  WHEN (NEW."finished" = TRUE AND NEW."stoppedAt" IS NOT NULL)
  EXECUTE FUNCTION notify_sai_execution_stage1();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION notify_sai_execution_stage1() IS
  'Stage 1 ETL: Sends immediate notification when SAI execution completes. '
  'Payload contains only execution_entity metadata (no JSON parsing). '
  'Stage 1 service inserts minimal record and queues for Stage 2 deep processing.';

COMMENT ON TRIGGER trigger_sai_execution_stage1 ON execution_entity IS
  'Fires when SAI workflow execution finishes. Sends PostgreSQL notification to Stage 1 ETL service.';

-- ============================================================================
-- Verify Installation
-- ============================================================================

DO $$
DECLARE
  trigger_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trigger_sai_execution_stage1'
  ) INTO trigger_exists;

  IF trigger_exists THEN
    RAISE NOTICE '✅ Stage 1 trigger installed successfully';
  ELSE
    RAISE WARNING '⚠️ Stage 1 trigger installation failed';
  END IF;
END $$;

-- ============================================================================
-- Test Stage 1 Trigger (Optional)
-- ============================================================================

-- Test by sending a manual notification:
-- SELECT pg_notify('sai_execution_stage1', '{"execution_id": 99999, "workflow_id": "yDbfhooKemfhMIkC", "started_at": "2025-01-08T10:00:00Z", "stopped_at": "2025-01-08T10:00:05Z", "status": "success", "mode": "webhook"}');

-- Check if Stage 1 service receives the notification and processes it
