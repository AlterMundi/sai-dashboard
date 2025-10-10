-- ============================================================================
-- FIX DUPLICATE TRIGGERS - Remove race condition and duplicate notifications
-- ============================================================================
-- Problem: Two triggers both send pg_notify('sai_execution_ready')
--   1. sai_etl_trigger (old, redundant)
--   2. sai_execution_notify_trigger (newer, better)
-- Solution: Drop old trigger, fix new one to only fire on status CHANGE
-- ============================================================================

\c n8n

-- Step 1: Drop the old redundant trigger
DROP TRIGGER IF EXISTS sai_etl_trigger ON execution_entity;
DROP FUNCTION IF EXISTS sai_etl_trigger_function();

-- Step 2: Drop the current notification trigger (we'll recreate it properly)
DROP TRIGGER IF EXISTS sai_execution_notify_trigger ON execution_entity;

-- Step 3: Recreate the trigger function (keep it, it's good)
-- No changes needed to notify_sai_execution function, it's already correct

-- Step 4: Recreate trigger to ONLY fire on status UPDATE (not INSERT)
CREATE TRIGGER sai_execution_notify_trigger
    AFTER UPDATE OF status ON execution_entity
    FOR EACH ROW
    WHEN (
        NEW."workflowId"::text = 'yDbfhooKemfhMIkC'
        AND NEW.status = 'success'
        AND OLD.status IS DISTINCT FROM NEW.status  -- Only when status CHANGES
    )
    EXECUTE FUNCTION notify_sai_execution();

-- Add helpful comment
COMMENT ON TRIGGER sai_execution_notify_trigger ON execution_entity IS
'Fires ONCE when SAI workflow status changes to success. Prevents duplicate notifications.';

-- Step 5: Verify triggers
SELECT
    tgname as trigger_name,
    pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger
WHERE tgrelid = 'execution_entity'::regclass
AND tgname LIKE '%sai%';
