-- Simplified N8N Database ETL Triggers
-- Uses PostgreSQL NOTIFY to signal ETL service for cross-database processing

-- ============================================================================
-- SIMPLE ETL NOTIFICATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_sai_execution() 
RETURNS TRIGGER AS $$
DECLARE
    sai_workflow_id VARCHAR(36) := 'yDbfhooKemfhMIkC';
BEGIN
    -- Only process SAI workflow executions that are completed successfully
    IF NEW."workflowId"::text != sai_workflow_id OR NEW.status != 'success' THEN
        RETURN NEW;
    END IF;
    
    -- Send notification to ETL service with execution details
    PERFORM pg_notify('sai_execution_ready', json_build_object(
        'execution_id', NEW.id,
        'workflow_id', NEW."workflowId"::text,
        'status', NEW.status,
        'started_at', NEW."startedAt",
        'stopped_at', NEW."stoppedAt",
        'processing_time_ms', EXTRACT(EPOCH FROM (NEW."stoppedAt" - NEW."startedAt")) * 1000
    )::text);
    
    RAISE NOTICE 'Notified ETL service about SAI execution %', NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER INSTALLATION
-- ============================================================================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS sai_execution_notify_trigger ON execution_entity;

-- Create the notification trigger on execution_entity
CREATE TRIGGER sai_execution_notify_trigger
    AFTER INSERT OR UPDATE OF status ON execution_entity
    FOR EACH ROW
    WHEN (NEW."workflowId"::text = 'yDbfhooKemfhMIkC' AND NEW.status IN ('success', 'error'))
    EXECUTE FUNCTION notify_sai_execution();

-- ============================================================================
-- TEST FUNCTION
-- ============================================================================

-- Test function to verify trigger functionality
CREATE OR REPLACE FUNCTION test_sai_triggers()
RETURNS TEXT AS $$
DECLARE
    test_result TEXT;
    trigger_count INTEGER;
    recent_executions INTEGER;
BEGIN
    test_result := 'SAI Trigger Test Results:' || E'\n';
    
    -- Check if trigger exists
    SELECT COUNT(*) INTO trigger_count
    FROM pg_trigger 
    WHERE tgname = 'sai_execution_notify_trigger';
    
    IF trigger_count > 0 THEN
        test_result := test_result || '✓ sai_execution_notify_trigger is installed' || E'\n';
    ELSE
        test_result := test_result || '✗ sai_execution_notify_trigger is NOT installed' || E'\n';
    END IF;
    
    -- Check recent SAI executions
    SELECT COUNT(*) INTO recent_executions
    FROM execution_entity
    WHERE "workflowId"::text = 'yDbfhooKemfhMIkC'
    AND "stoppedAt" >= NOW() - INTERVAL '24 hours';
    
    test_result := test_result || '📊 Recent SAI executions (24h): ' || recent_executions || E'\n';
    
    -- Test notification (this won't actually trigger NOTIFY in a function)
    test_result := test_result || '⚠️  To test NOTIFY, create a new SAI execution' || E'\n';
    test_result := test_result || '📡 ETL service should be listening on ''sai_execution_ready'' channel' || E'\n';
    
    RETURN test_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- INSTALLATION VERIFICATION
-- ============================================================================

-- Run the test after installation
SELECT test_sai_triggers();