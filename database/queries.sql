-- SAI Image Analysis Dashboard - Database Queries
-- Read-only queries for extracting image workflow data from n8n PostgreSQL

-- ==================================================================
-- CORE DATA EXTRACTION QUERIES
-- ==================================================================

-- 1. Get SAI Image Workflow Executions (Primary Query)
-- Extracts execution data for the main image analysis workflow
-- SAFETY: READ-ONLY - No modifications to database
SELECT 
    e.id as execution_id,
    e.status,
    e.mode,
    e."startedAt",
    e."stoppedAt",
    e.finished,
    EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt")) as duration_seconds,
    w.name as workflow_name,
    ed.data as execution_payload,
    ed."workflowData"
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
LEFT JOIN execution_data ed ON e.id = ed."executionId"
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e."deletedAt" IS NULL
  AND e."startedAt" > CURRENT_DATE - INTERVAL '30 days'  -- Last 30 days
ORDER BY e."startedAt" DESC
LIMIT 100;

-- 2. Get Recent Image Executions with Status Summary
-- Quick overview of recent activity
SELECT 
    DATE(e."startedAt") as execution_date,
    COUNT(*) as total_executions,
    COUNT(CASE WHEN e.status = 'success' THEN 1 END) as successful,
    COUNT(CASE WHEN e.status = 'error' THEN 1 END) as failed,
    COUNT(CASE WHEN e.status = 'canceled' THEN 1 END) as canceled,
    ROUND(AVG(EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))), 2) as avg_duration_seconds
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e."deletedAt" IS NULL
  AND e."startedAt" > CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(e."startedAt")
ORDER BY execution_date DESC;

-- 3. Get Failed Executions with Details
-- Identify and analyze failed image processing attempts
SELECT 
    e.id,
    e."startedAt",
    e."stoppedAt",
    e.status,
    e."retryOf",
    EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt")) as duration_seconds,
    ed.data as execution_data
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
LEFT JOIN execution_data ed ON e.id = ed."executionId"
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e.status = 'error'
  AND e."deletedAt" IS NULL
  AND e."startedAt" > CURRENT_DATE - INTERVAL '30 days'
ORDER BY e."startedAt" DESC
LIMIT 50;

-- ==================================================================
-- WORKFLOW ANALYSIS QUERIES
-- ==================================================================

-- 4. Get Workflow Configuration and Metadata
-- Understanding the workflow structure and configuration
SELECT 
    w.id as workflow_id,
    w.name,
    w.active,
    w."createdAt",
    w."updatedAt", 
    w."triggerCount",
    json_array_length(w.nodes) as node_count,
    w.settings,
    w.meta
FROM workflow_entity w
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto';

-- 5. Get Webhook Configuration for Image Workflow
-- Understand the trigger endpoint configuration
SELECT 
    we."webhookPath",
    we.method,
    we.node as trigger_node,
    w.name as workflow_name,
    w.active
FROM webhook_entity we
JOIN workflow_entity w ON we."workflowId" = w.id
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto';

-- 6. Execution Performance Analysis
-- Analyze execution patterns and performance metrics
SELECT 
    DATE_TRUNC('hour', e."startedAt") as execution_hour,
    COUNT(*) as executions_count,
    MIN(EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as min_duration,
    MAX(EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as max_duration,
    AVG(EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as avg_duration,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as p95_duration
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e.status = 'success'
  AND e."deletedAt" IS NULL
  AND e."startedAt" > CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', e."startedAt")
ORDER BY execution_hour DESC;

-- ==================================================================
-- CREDENTIAL AND INTEGRATION QUERIES  
-- ==================================================================

-- 7. Get Relevant Credentials for Image Workflow
-- Understand which services are integrated (READ-ONLY - no credential data)
SELECT 
    c.id,
    c.name,
    c.type,
    c."createdAt",
    c."updatedAt",
    c."isManaged"
FROM credentials_entity c
WHERE c.type IN (
    'telegramApi',
    'ollamaApi', 
    'googleSheetsOAuth2Api',
    'googleDriveOAuth2Api'
)
ORDER BY c.type, c.name;

-- 8. System Health Overview
-- General system health metrics for context
SELECT 
    'Total Workflows' as metric,
    COUNT(*)::text as value
FROM workflow_entity
UNION ALL
SELECT 
    'Active Workflows',
    COUNT(*)::text
FROM workflow_entity WHERE active = true
UNION ALL
SELECT 
    'Total Executions (30 days)',
    COUNT(*)::text
FROM execution_entity 
WHERE "startedAt" > CURRENT_DATE - INTERVAL '30 days' 
  AND "deletedAt" IS NULL
UNION ALL
SELECT 
    'Success Rate % (30 days)',
    ROUND((COUNT(CASE WHEN status = 'success' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0)), 2)::text
FROM execution_entity 
WHERE "startedAt" > CURRENT_DATE - INTERVAL '30 days'
  AND "deletedAt" IS NULL;

-- ==================================================================
-- DATA EXTRACTION UTILITIES
-- ==================================================================

-- 9. Sample Execution Data Structure Analysis
-- Understand the JSON payload structure for parsing
SELECT 
    e.id,
    e."startedAt",
    LENGTH(ed.data) as payload_size_bytes,
    ed.data::json->'nodeInputData' as input_data_sample,
    ed.data::json->'nodeOutputData' as output_data_sample
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
JOIN execution_data ed ON e.id = ed."executionId"
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e.status = 'success'
  AND e."deletedAt" IS NULL
ORDER BY e."startedAt" DESC
LIMIT 5;

-- 10. Execution Payload Size Analysis
-- Monitor payload sizes for performance optimization
SELECT 
    DATE(e."startedAt") as execution_date,
    COUNT(*) as executions,
    MIN(LENGTH(ed.data)) as min_payload_bytes,
    MAX(LENGTH(ed.data)) as max_payload_bytes,
    AVG(LENGTH(ed.data)) as avg_payload_bytes,
    pg_size_pretty(SUM(LENGTH(ed.data))::bigint) as total_data_size
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
JOIN execution_data ed ON e.id = ed."executionId"
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e."deletedAt" IS NULL
  AND e."startedAt" > CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(e."startedAt")
ORDER BY execution_date DESC;

-- ==================================================================
-- DASHBOARD-SPECIFIC QUERIES
-- ==================================================================

-- 11. Gallery View Data Query (Main Dashboard Query)
-- Optimized query for the image gallery interface
WITH execution_summary AS (
  SELECT 
    e.id,
    e.status,
    e."startedAt",
    e."stoppedAt",
    EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt")) as duration,
    ed.data::json as payload
  FROM execution_entity e
  JOIN workflow_entity w ON e."workflowId" = w.id
  LEFT JOIN execution_data ed ON e.id = ed."executionId"
  WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
    AND e."deletedAt" IS NULL
    AND e."startedAt" > CURRENT_DATE - INTERVAL '$1 days'  -- Parameter placeholder
  ORDER BY e."startedAt" DESC
  LIMIT $2  -- Parameter placeholder
)
SELECT 
  id as execution_id,
  status,
  "startedAt" as timestamp,
  duration,
  payload->'nodeOutputData' as node_outputs,
  payload->'nodeInputData' as node_inputs,
  -- Extract specific data points for dashboard
  CASE 
    WHEN status = 'success' THEN 'completed'
    WHEN status = 'error' THEN 'failed'
    ELSE status
  END as display_status
FROM execution_summary;

-- 12. Real-time Status Query (for live updates)
-- Quick query for checking recent activity
SELECT 
    COUNT(*) as total_today,
    COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_today,
    COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_today,
    MAX("startedAt") as last_execution,
    MIN("startedAt") as first_execution_today
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e."deletedAt" IS NULL
  AND DATE(e."startedAt") = CURRENT_DATE;

-- 13. Error Pattern Analysis  
-- Identify common error patterns for troubleshooting
SELECT 
    LEFT(ed.data::text, 200) as error_snippet,
    COUNT(*) as occurrence_count,
    MAX(e."startedAt") as last_occurrence,
    MIN(e."startedAt") as first_occurrence
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
JOIN execution_data ed ON e.id = ed."executionId"
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e.status = 'error'
  AND e."deletedAt" IS NULL
  AND e."startedAt" > CURRENT_DATE - INTERVAL '30 days'
GROUP BY LEFT(ed.data::text, 200)
ORDER BY occurrence_count DESC, last_occurrence DESC
LIMIT 10;

-- ==================================================================
-- MAINTENANCE AND MONITORING QUERIES
-- ==================================================================

-- 14. Database Health Check for Dashboard
-- Verify database connectivity and basic metrics
SELECT 
    'Database Connection' as check_name,
    'OK' as status,
    NOW() as timestamp
UNION ALL
SELECT 
    'Workflow Exists',
    CASE 
      WHEN COUNT(*) > 0 THEN 'OK' 
      ELSE 'ERROR' 
    END,
    NOW()
FROM workflow_entity 
WHERE name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
UNION ALL
SELECT 
    'Recent Executions',
    CASE 
      WHEN COUNT(*) > 0 THEN 'OK'
      ELSE 'WARN'
    END,
    NOW()
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e."startedAt" > NOW() - INTERVAL '1 hour'
  AND e."deletedAt" IS NULL;

-- 15. Performance Baseline Query
-- Establish performance baselines for monitoring
SELECT 
    'avg_execution_time_seconds' as metric,
    ROUND(AVG(EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))), 2) as value,
    'last_7_days' as period
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e.status = 'success'
  AND e."deletedAt" IS NULL
  AND e."startedAt" > CURRENT_DATE - INTERVAL '7 days'
UNION ALL
SELECT 
    'success_rate_percent',
    ROUND((COUNT(CASE WHEN e.status = 'success' THEN 1 END) * 100.0 / COUNT(*)), 2),
    'last_7_days'
FROM execution_entity e
JOIN workflow_entity w ON e."workflowId" = w.id
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e."deletedAt" IS NULL
  AND e."startedAt" > CURRENT_DATE - INTERVAL '7 days';

-- ==================================================================
-- USAGE NOTES AND SAFETY REMINDERS
-- ==================================================================

/*
SAFETY PROTOCOLS:
1. All queries are READ-ONLY - no INSERT, UPDATE, DELETE operations
2. Always include "deletedAt IS NULL" to exclude soft-deleted records
3. Use date ranges to limit query scope and improve performance
4. Parameterized queries ($1, $2) for dynamic filtering in application code
5. LIMIT clauses to prevent excessive data retrieval

PERFORMANCE CONSIDERATIONS:
1. execution_entity has indexes on workflowId, startedAt, status
2. Use DATE() functions carefully - they can prevent index usage
3. JOIN execution_data only when payload content is needed (large table)
4. Consider pagination for large result sets

INTEGRATION PATTERNS:
1. Primary workflow identification by name (more stable than ID)
2. Status mapping for user-friendly display
3. Duration calculations for performance monitoring
4. JSON payload parsing for extracting specific data points

MONITORING INTEGRATION:
1. Health check queries for system status
2. Performance baseline establishment
3. Error pattern recognition for proactive maintenance
4. Resource usage tracking for capacity planning
*/