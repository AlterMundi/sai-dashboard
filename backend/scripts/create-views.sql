-- SAI Dashboard Database Views
-- Create read-only views for secure access to n8n execution data
-- Run as PostgreSQL superuser

-- =================================================================
-- Create dedicated read-only user
-- =================================================================

-- Create user (if not exists)
DO $$ BEGIN
  CREATE USER sai_dashboard_readonly WITH PASSWORD 'CHANGE_THIS_PASSWORD';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'User sai_dashboard_readonly already exists';
END $$;

-- Grant connection permissions
GRANT CONNECT ON DATABASE n8n TO sai_dashboard_readonly;
GRANT USAGE ON SCHEMA public TO sai_dashboard_readonly;

-- =================================================================
-- SAI Executions View - Main execution data without large payloads
-- =================================================================

CREATE OR REPLACE VIEW sai_executions AS
SELECT 
  e.id::text as id,
  e."workflowId"::text as workflow_id,
  e.status,
  e."startedAt" as started_at,
  e."stoppedAt" as stopped_at,
  e.mode,
  e.finished,
  e."retryOf"::text as retry_of,
  e."retrySuccessId"::text as retry_success_id,
  w.name as workflow_name
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
WHERE 
  w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e.status IS NOT NULL
  AND e."deletedAt" IS NULL
ORDER BY e."startedAt" DESC;

-- Grant read access
GRANT SELECT ON sai_executions TO sai_dashboard_readonly;

-- =================================================================
-- SAI Execution Data View - Payload data with size protection
-- =================================================================

CREATE OR REPLACE VIEW sai_execution_data AS
SELECT 
  ed."executionId"::text as execution_id,
  ed."nodeId" as node_id,
  ed.data,
  LENGTH(ed.data::text) as data_size_bytes,
  ed."createdAt" as created_at
FROM execution_data ed
JOIN execution_entity e ON ed."executionId" = e.id
JOIN workflow_entity w ON e."workflowId" = w.id
WHERE 
  w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e.status = 'success'
  AND e."deletedAt" IS NULL
  AND ed.data IS NOT NULL
  -- Size limit: exclude payloads larger than 10MB to prevent memory issues
  AND LENGTH(ed.data::text) < 10485760
ORDER BY ed."createdAt" DESC;

-- Grant read access
GRANT SELECT ON sai_execution_data TO sai_dashboard_readonly;

-- =================================================================
-- SAI Dashboard Executions - Optimized view with computed fields
-- =================================================================

CREATE OR REPLACE VIEW sai_dashboard_executions AS
WITH execution_images AS (
  SELECT 
    ed.execution_id,
    -- Extract image data from webhook node
    CASE 
      WHEN ed.data::jsonb ? 'main' 
       AND (ed.data::jsonb -> 'main' -> 0 -> 'binary' ? 'data')
      THEN ed.data::jsonb -> 'main' -> 0 -> 'binary' ->> 'mimeType'
      ELSE NULL
    END as image_mime_type,
    
    -- Check if image data exists
    CASE 
      WHEN ed.data::jsonb ? 'main' 
       AND (ed.data::jsonb -> 'main' -> 0 -> 'binary' ? 'data')
      THEN true
      ELSE false
    END as has_image,
    
    -- Extract Ollama analysis
    CASE 
      WHEN ed.data::jsonb ? 'main'
       AND (ed.data::jsonb -> 'main' -> 0 -> 'json' ? 'response')
      THEN ed.data::jsonb -> 'main' -> 0 -> 'json' ->> 'response'
      ELSE NULL
    END as ollama_analysis,
    
    ed.data_size_bytes
  FROM sai_execution_data ed
  WHERE ed.node_id IN ('Webhook', 'Ollama Chat Model', 'HTTP Request')
),
telegram_status AS (
  SELECT 
    ed.execution_id,
    -- Check Telegram delivery status
    CASE 
      WHEN ed.data::jsonb -> 'main' -> 0 -> 'json' ? 'message_id'
      THEN true
      ELSE false
    END as telegram_delivered,
    
    ed.data::jsonb -> 'main' -> 0 -> 'json' ->> 'message_id' as telegram_message_id
  FROM sai_execution_data ed
  WHERE ed.node_id LIKE '%Telegram%'
)
SELECT 
  e.*,
  ei.image_mime_type,
  ei.has_image,
  ei.ollama_analysis,
  ei.data_size_bytes as total_payload_size,
  ts.telegram_delivered,
  ts.telegram_message_id,
  
  -- Computed fields for API
  CASE 
    WHEN e.status = 'success' AND ei.has_image THEN 
      '/api/executions/' || e.id || '/image'
    ELSE NULL
  END as image_url,
  
  CASE 
    WHEN e.status = 'success' AND ei.has_image THEN 
      '/api/executions/' || e.id || '/image?thumbnail=true'
    ELSE NULL
  END as thumbnail_url,
  
  -- Execution duration
  CASE 
    WHEN e.stopped_at IS NOT NULL AND e.started_at IS NOT NULL THEN 
      EXTRACT(EPOCH FROM (e.stopped_at - e.started_at))
    ELSE NULL
  END as duration_seconds

FROM sai_executions e
LEFT JOIN execution_images ei ON e.id = ei.execution_id
LEFT JOIN telegram_status ts ON e.id = ts.execution_id
ORDER BY e.started_at DESC;

-- Grant read access
GRANT SELECT ON sai_dashboard_executions TO sai_dashboard_readonly;

-- =================================================================
-- Daily Summary View - Aggregated statistics
-- =================================================================

CREATE OR REPLACE VIEW sai_daily_summary AS
SELECT 
  DATE(started_at) as execution_date,
  COUNT(*) as total_executions,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_executions,
  COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_executions,
  ROUND(
    (COUNT(CASE WHEN status = 'success' THEN 1 END)::numeric / COUNT(*)::numeric * 100), 2
  ) as success_rate_percent,
  ROUND(AVG(duration_seconds), 2) as avg_duration_seconds,
  COUNT(CASE WHEN has_image THEN 1 END) as executions_with_images,
  COUNT(CASE WHEN telegram_delivered THEN 1 END) as telegram_delivered_count
FROM sai_dashboard_executions
WHERE started_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(started_at)
ORDER BY execution_date DESC;

-- Grant read access
GRANT SELECT ON sai_daily_summary TO sai_dashboard_readonly;

-- =================================================================
-- Indexes for performance optimization
-- =================================================================

-- Index on execution_entity for SAI workflow queries
CREATE INDEX IF NOT EXISTS idx_execution_sai_workflow 
ON execution_entity ("workflowId", "startedAt" DESC, status) 
WHERE "deletedAt" IS NULL;

-- Index on execution_data for efficient payload lookups
CREATE INDEX IF NOT EXISTS idx_execution_data_lookup
ON execution_data ("executionId", "nodeId")
WHERE data IS NOT NULL;

-- =================================================================
-- Security and monitoring
-- =================================================================

-- Revoke any unwanted permissions
REVOKE ALL ON execution_entity FROM sai_dashboard_readonly;
REVOKE ALL ON execution_data FROM sai_dashboard_readonly;
REVOKE ALL ON workflow_entity FROM sai_dashboard_readonly;

-- Only allow access through views
GRANT SELECT ON sai_executions TO sai_dashboard_readonly;
GRANT SELECT ON sai_execution_data TO sai_dashboard_readonly;
GRANT SELECT ON sai_dashboard_executions TO sai_dashboard_readonly;
GRANT SELECT ON sai_daily_summary TO sai_dashboard_readonly;

-- Connection limits
ALTER USER sai_dashboard_readonly CONNECTION LIMIT 10;

-- =================================================================
-- Test queries to verify views work correctly
-- =================================================================

-- Test basic execution list (should return recent SAI executions)
-- SELECT id, status, started_at, has_image FROM sai_dashboard_executions LIMIT 10;

-- Test daily summary (should return aggregated data)
-- SELECT * FROM sai_daily_summary LIMIT 7;

-- Test execution data lookup (should return payload for specific execution)
-- SELECT execution_id, node_id, data_size_bytes FROM sai_execution_data WHERE execution_id = 'some-id';

COMMENT ON VIEW sai_executions IS 'Main execution data without large payloads - optimized for listing';
COMMENT ON VIEW sai_execution_data IS 'Full execution payloads with size protection - for detail queries';
COMMENT ON VIEW sai_dashboard_executions IS 'Optimized view with computed fields for dashboard display';
COMMENT ON VIEW sai_daily_summary IS 'Daily aggregated statistics for performance monitoring';

-- Grant usage on sequences if needed for any future operations
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sai_dashboard_readonly;

-- Log the setup completion
DO $$ BEGIN
  RAISE NOTICE 'SAI Dashboard database views created successfully';
  RAISE NOTICE 'User: sai_dashboard_readonly';
  RAISE NOTICE 'Views: sai_executions, sai_execution_data, sai_dashboard_executions, sai_daily_summary';
  RAISE NOTICE 'Remember to update the password in .env file!';
END $$;