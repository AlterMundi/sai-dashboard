-- N8N Database ETL Triggers
-- Automatically processes new executions and populates sai_dashboard database
-- These triggers are installed on the n8n database to monitor execution_entity changes

-- ============================================================================
-- ETL TRIGGER FUNCTIONS
-- ============================================================================

-- Main ETL processing function
CREATE OR REPLACE FUNCTION process_sai_execution() 
RETURNS TRIGGER AS $$
DECLARE
    sai_workflow_id VARCHAR(36) := 'yDbfhooKemfhMIkC';
    execution_data_record RECORD;
    parsed_data JSON;
    image_base64 TEXT;
    image_size INTEGER;
    analysis_text TEXT;
    risk_level TEXT;
    confidence DECIMAL(4,3);
    telegram_status BOOLEAN;
    processing_time INTEGER;
BEGIN
    -- Only process SAI workflow executions that are completed successfully
    IF NEW."workflowId"::text != sai_workflow_id OR NEW.status != 'success' THEN
        RETURN NEW;
    END IF;
    
    -- Skip if already processed (avoid duplicate processing on updates)
    IF EXISTS (SELECT 1 FROM sai_dashboard.executions WHERE id = NEW.id) THEN
        RETURN NEW;
    END IF;
    
    -- Log processing start
    RAISE NOTICE 'Processing SAI execution %', NEW.id;
    
    BEGIN
        -- Get execution data payload
        SELECT data INTO execution_data_record 
        FROM execution_data 
        WHERE "executionId" = NEW.id;
        
        IF execution_data_record.data IS NULL THEN
            RAISE NOTICE 'No execution data found for execution %', NEW.id;
            RETURN NEW;
        END IF;
        
        -- Parse JSON data
        parsed_data := execution_data_record.data::JSON;
        
        -- Extract processing time
        processing_time := EXTRACT(EPOCH FROM (NEW."stoppedAt" - NEW."startedAt")) * 1000;
        
        -- Extract image data from webhook input
        image_base64 := parsed_data->'nodeInputData'->'Webhook'->0->'json'->'body'->>'image';
        IF image_base64 IS NULL THEN
            image_base64 := parsed_data->'nodeInputData'->'Ollama'->0->'json'->>'image';
        END IF;
        
        -- Calculate image size if found
        image_size := CASE 
            WHEN image_base64 IS NOT NULL THEN LENGTH(image_base64) * 3 / 4  -- Approximate base64 to bytes
            ELSE NULL
        END;
        
        -- Extract Ollama analysis response
        analysis_text := parsed_data->'nodeOutputData'->'Ollama'->0->'json'->>'response';
        
        -- Parse risk level from analysis text
        risk_level := CASE 
            WHEN analysis_text ILIKE '%risk%high%' OR analysis_text ILIKE '%high%risk%' THEN 'high'
            WHEN analysis_text ILIKE '%risk%medium%' OR analysis_text ILIKE '%medium%risk%' THEN 'medium'
            WHEN analysis_text ILIKE '%risk%low%' OR analysis_text ILIKE '%low%risk%' THEN 'low'
            WHEN analysis_text ILIKE '%no%risk%' OR analysis_text ILIKE '%risk%none%' THEN 'none'
            ELSE 'none'
        END;
        
        -- Extract confidence score
        confidence := CASE 
            WHEN analysis_text ~ 'confidence[:\s]+([0-9]*\.?[0-9]+)' THEN 
                (regexp_matches(analysis_text, 'confidence[:\s]+([0-9]*\.?[0-9]+)', 'i'))[1]::DECIMAL(4,3)
            WHEN analysis_text ~ '([0-9]+)%' THEN
                (regexp_matches(analysis_text, '([0-9]+)%'))[1]::DECIMAL(4,3) / 100
            ELSE NULL
        END;
        
        -- Check Telegram delivery status
        telegram_status := COALESCE(
            (parsed_data->'nodeOutputData'->'Telegram'->0->'json'->>'success')::BOOLEAN,
            FALSE
        );
        
        -- Insert into sai_dashboard.executions
        INSERT INTO sai_dashboard.executions (
            id, workflow_id, execution_timestamp, completion_timestamp, 
            duration_ms, status, mode, retry_of
        ) VALUES (
            NEW.id,
            NEW."workflowId"::text,
            NEW."startedAt",
            NEW."stoppedAt", 
            processing_time,
            NEW.status,
            NEW.mode,
            NEW."retryOf"
        );
        
        -- Insert image metadata if image exists
        IF image_base64 IS NOT NULL THEN
            INSERT INTO sai_dashboard.execution_images (
                execution_id, original_path, size_bytes, format, extracted_at
            ) VALUES (
                NEW.id,
                '/mnt/raid1/n8n/backup/images/by-execution/' || NEW.id || '/original.jpg',
                image_size,
                'jpeg',
                NOW()
            );
            
            -- Trigger async image processing
            PERFORM pg_notify('process_image', json_build_object(
                'execution_id', NEW.id,
                'image_data', LEFT(image_base64, 100) || '...[truncated]'  -- Don't send full image via notify
            )::text);
        END IF;
        
        -- Insert analysis results
        INSERT INTO sai_dashboard.execution_analysis (
            execution_id, risk_level, confidence_score, overall_assessment,
            model_version, processing_time_ms, raw_response, analysis_timestamp,
            smoke_detected, flame_detected, heat_signature_detected,
            alert_priority, response_required
        ) VALUES (
            NEW.id,
            risk_level::sai_dashboard.execution_analysis_risk_level_enum,
            confidence,
            analysis_text,
            'qwen2.5vl:7b',  -- Default model version
            processing_time,
            parsed_data->'nodeOutputData'->'Ollama'->0->'json'::text,
            NEW."startedAt",
            analysis_text ILIKE ANY(ARRAY['%smoke%', '%smog%', '%haze%']),
            analysis_text ILIKE ANY(ARRAY['%flame%', '%fire%', '%burn%']),
            analysis_text ILIKE ANY(ARRAY['%heat%', '%thermal%', '%hot%']),
            CASE 
                WHEN risk_level = 'high' AND confidence >= 0.9 THEN 'critical'
                WHEN risk_level = 'high' THEN 'high'
                WHEN risk_level = 'medium' AND confidence >= 0.8 THEN 'high'
                WHEN risk_level = 'medium' THEN 'normal'
                ELSE 'low'
            END::sai_dashboard.execution_analysis_alert_priority_enum,
            risk_level IN ('high', 'critical') AND COALESCE(confidence, 0) >= 0.85
        );
        
        -- Insert notification status
        INSERT INTO sai_dashboard.execution_notifications (
            execution_id, telegram_sent, telegram_message_id, telegram_sent_at
        ) VALUES (
            NEW.id,
            telegram_status,
            (parsed_data->'nodeOutputData'->'Telegram'->0->'json'->>'message_id')::BIGINT,
            CASE WHEN telegram_status THEN NEW."stoppedAt" ELSE NULL END
        );
        
        -- Update dashboard statistics
        PERFORM update_dashboard_stats();
        
        -- Send SSE notification for high-priority executions
        IF risk_level IN ('high', 'critical') THEN
            PERFORM pg_notify('high_priority_execution', json_build_object(
                'execution_id', NEW.id,
                'risk_level', risk_level,
                'confidence', confidence,
                'timestamp', NEW."startedAt"
            )::text);
        END IF;
        
        -- Send regular SSE notification
        PERFORM pg_notify('new_execution', json_build_object(
            'execution_id', NEW.id,
            'status', NEW.status,
            'risk_level', risk_level,
            'has_image', image_base64 IS NOT NULL,
            'timestamp', NEW."startedAt"
        )::text);
        
        RAISE NOTICE 'Successfully processed SAI execution %', NEW.id;
        
    EXCEPTION WHEN OTHERS THEN
        -- Log error but don't fail the original transaction
        RAISE WARNING 'Failed to process SAI execution %: %', NEW.id, SQLERRM;
        
        -- Insert minimal record to prevent reprocessing
        INSERT INTO sai_dashboard.executions (
            id, workflow_id, execution_timestamp, status
        ) VALUES (
            NEW.id, NEW."workflowId"::text, NEW."startedAt", 'error'
        ) ON CONFLICT (id) DO NOTHING;
        
        -- Notify about processing error
        PERFORM pg_notify('etl_error', json_build_object(
            'execution_id', NEW.id,
            'error', SQLERRM,
            'timestamp', NOW()
        )::text);
    END;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DASHBOARD STATISTICS UPDATE FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION update_dashboard_stats()
RETURNS VOID AS $$
DECLARE
    total_count INTEGER;
    success_count INTEGER;
    success_rate DECIMAL(5,2);
    avg_processing_time DECIMAL(8,3);
    high_risk_today INTEGER;
    pending_reviews INTEGER;
BEGIN
    -- Calculate total executions
    SELECT COUNT(*) INTO total_count FROM sai_dashboard.executions;
    
    -- Calculate success rate
    SELECT COUNT(*) INTO success_count FROM sai_dashboard.executions WHERE status = 'success';
    success_rate := CASE WHEN total_count > 0 THEN (success_count::DECIMAL / total_count) * 100 ELSE 0 END;
    
    -- Calculate average processing time (last 100 executions)
    SELECT AVG(duration_ms) / 1000.0 INTO avg_processing_time 
    FROM (
        SELECT duration_ms FROM sai_dashboard.executions 
        WHERE duration_ms IS NOT NULL 
        ORDER BY execution_timestamp DESC 
        LIMIT 100
    ) recent;
    
    -- Count high-risk detections today
    SELECT COUNT(*) INTO high_risk_today 
    FROM sai_dashboard.execution_analysis 
    WHERE risk_level IN ('high', 'critical') 
    AND DATE(analysis_timestamp) = CURRENT_DATE;
    
    -- Count pending expert reviews
    SELECT COUNT(*) INTO pending_reviews 
    FROM sai_dashboard.expert_reviews 
    WHERE status = 'pending';
    
    -- Update statistics table
    INSERT INTO sai_dashboard.dashboard_stats (metric_name, metric_value, last_updated) VALUES
        ('total_executions', total_count, NOW()),
        ('success_rate', success_rate, NOW()),
        ('average_processing_time', COALESCE(avg_processing_time, 0), NOW()),
        ('high_risk_detections_today', high_risk_today, NOW()),
        ('pending_expert_reviews', pending_reviews, NOW())
    ON CONFLICT (metric_name) DO UPDATE SET
        metric_value = EXCLUDED.metric_value,
        last_updated = EXCLUDED.last_updated;
    
    -- Send SSE notification about updated stats
    PERFORM pg_notify('stats_updated', json_build_object(
        'total_executions', total_count,
        'success_rate', success_rate,
        'high_risk_today', high_risk_today,
        'updated_at', NOW()
    )::text);
    
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- INCIDENT CORRELATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION check_incident_correlation()
RETURNS TRIGGER AS $$
DECLARE
    recent_executions RECORD;
    incident_uuid UUID;
    similar_count INTEGER;
BEGIN
    -- Only check for high-risk detections
    IF NEW.risk_level NOT IN ('high', 'critical') THEN
        RETURN NEW;
    END IF;
    
    -- Look for similar high-risk detections in the last 30 minutes
    SELECT COUNT(*) INTO similar_count
    FROM sai_dashboard.execution_analysis ea
    JOIN sai_dashboard.executions e ON ea.execution_id = e.id
    WHERE ea.risk_level IN ('high', 'critical')
    AND e.execution_timestamp > NOW() - INTERVAL '30 minutes'
    AND ea.execution_id != NEW.execution_id;
    
    -- If multiple high-risk detections, create or update incident
    IF similar_count >= 1 THEN
        -- Try to find existing active incident
        SELECT id INTO incident_uuid
        FROM sai_dashboard.incidents
        WHERE status = 'active'
        AND last_detection > NOW() - INTERVAL '1 hour'
        ORDER BY created_at DESC
        LIMIT 1;
        
        -- Create new incident if none exists
        IF incident_uuid IS NULL THEN
            INSERT INTO sai_dashboard.incidents (
                incident_type, severity, first_detection, last_detection, 
                status, escalation_level
            ) VALUES (
                'multiple_cameras', 
                NEW.risk_level::sai_dashboard.incidents_severity_enum,
                NOW(), 
                NOW(),
                'active', 
                CASE WHEN NEW.risk_level = 'critical' THEN 3 ELSE 2 END
            ) RETURNING id INTO incident_uuid;
        ELSE
            -- Update existing incident
            UPDATE sai_dashboard.incidents 
            SET last_detection = NOW(),
                updated_at = NOW()
            WHERE id = incident_uuid;
        END IF;
        
        -- Link execution to incident
        INSERT INTO sai_dashboard.incident_executions (
            incident_id, execution_id, contribution_weight
        ) VALUES (
            incident_uuid, 
            NEW.execution_id, 
            CASE WHEN NEW.risk_level = 'critical' THEN 1.0 ELSE 0.7 END
        ) ON CONFLICT (incident_id, execution_id) DO NOTHING;
        
        -- Notify about incident
        PERFORM pg_notify('incident_update', json_build_object(
            'incident_id', incident_uuid,
            'execution_id', NEW.execution_id,
            'severity', NEW.risk_level,
            'type', 'correlation_detected'
        )::text);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER INSTALLATION
-- ============================================================================

-- Create the main ETL trigger on execution_entity
DROP TRIGGER IF EXISTS sai_etl_trigger ON execution_entity;
CREATE TRIGGER sai_etl_trigger
    AFTER INSERT OR UPDATE OF status ON execution_entity
    FOR EACH ROW
    WHEN (NEW."workflowId"::text = 'yDbfhooKemfhMIkC' AND NEW.status IN ('success', 'error'))
    EXECUTE FUNCTION process_sai_execution();

-- Create incident correlation trigger on analysis table
DROP TRIGGER IF EXISTS incident_correlation_trigger ON sai_dashboard.execution_analysis;
CREATE TRIGGER incident_correlation_trigger
    AFTER INSERT ON sai_dashboard.execution_analysis
    FOR EACH ROW
    EXECUTE FUNCTION check_incident_correlation();

-- ============================================================================
-- NOTIFICATION CHANNELS SETUP
-- ============================================================================

-- Create notification channels for real-time updates
-- These will be listened to by the ETL service

-- Channel for new executions (all)
-- Payload: {"execution_id": 123, "status": "success", "risk_level": "high", "timestamp": "2025-09-01T10:30:00Z"}

-- Channel for high-priority executions (immediate processing)
-- Payload: {"execution_id": 123, "risk_level": "critical", "confidence": 0.95}

-- Channel for image processing requests
-- Payload: {"execution_id": 123, "image_data": "base64..."}

-- Channel for incident updates
-- Payload: {"incident_id": "uuid", "execution_id": 123, "severity": "high", "type": "correlation_detected"}

-- Channel for statistics updates
-- Payload: {"total_executions": 5000, "success_rate": 99.5, "high_risk_today": 3}

-- Channel for ETL errors
-- Payload: {"execution_id": 123, "error": "Failed to parse JSON", "timestamp": "2025-09-01T10:30:00Z"}

-- ============================================================================
-- MONITORING AND MAINTENANCE
-- ============================================================================

-- Function to clean up old notifications (run daily)
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS VOID AS $$
BEGIN
    -- Clean up old activity logs (keep 90 days)
    DELETE FROM sai_dashboard.activity_log 
    WHERE created_at < NOW() - INTERVAL '90 days';
    
    -- Clean up old query performance logs (keep 30 days)
    DELETE FROM sai_dashboard.query_performance 
    WHERE executed_at < NOW() - INTERVAL '30 days';
    
    -- Clean up old stats history (keep 1 year)
    DELETE FROM sai_dashboard.stats_history 
    WHERE recorded_at < NOW() - INTERVAL '1 year';
    
    -- Archive resolved incidents (move to archive table - create if needed)
    -- This would be implemented based on archival requirements
    
    RAISE NOTICE 'Completed cleanup of old data';
END;
$$ LANGUAGE plpgsql;

-- Schedule daily cleanup (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-old-data', '0 2 * * *', 'SELECT cleanup_old_data();');

-- ============================================================================
-- TESTING AND VERIFICATION
-- ============================================================================

-- Test function to verify trigger functionality
CREATE OR REPLACE FUNCTION test_etl_triggers()
RETURNS TEXT AS $$
DECLARE
    test_result TEXT;
    test_execution_id INTEGER;
BEGIN
    -- This function can be used to test the ETL process
    -- It should be called after a real execution to verify processing
    
    test_result := 'ETL Trigger Test Results:' || E'\n';
    
    -- Check if sai_dashboard database is accessible
    BEGIN
        PERFORM 1 FROM sai_dashboard.executions LIMIT 1;
        test_result := test_result || '✓ sai_dashboard database accessible' || E'\n';
    EXCEPTION WHEN OTHERS THEN
        test_result := test_result || '✗ sai_dashboard database not accessible: ' || SQLERRM || E'\n';
        RETURN test_result;
    END;
    
    -- Check recent executions processing
    SELECT MAX(id) INTO test_execution_id FROM sai_dashboard.executions;
    
    IF test_execution_id IS NOT NULL THEN
        test_result := test_result || '✓ Latest execution processed: ' || test_execution_id || E'\n';
        
        -- Check if analysis exists
        IF EXISTS (SELECT 1 FROM sai_dashboard.execution_analysis WHERE execution_id = test_execution_id) THEN
            test_result := test_result || '✓ Analysis data processed' || E'\n';
        ELSE
            test_result := test_result || '✗ Analysis data missing' || E'\n';
        END IF;
        
        -- Check if image metadata exists
        IF EXISTS (SELECT 1 FROM sai_dashboard.execution_images WHERE execution_id = test_execution_id) THEN
            test_result := test_result || '✓ Image metadata processed' || E'\n';
        ELSE
            test_result := test_result || '- No image data (may be normal)' || E'\n';
        END IF;
        
    ELSE
        test_result := test_result || '✗ No executions found in sai_dashboard' || E'\n';
    END IF;
    
    -- Check statistics updates
    IF EXISTS (SELECT 1 FROM sai_dashboard.dashboard_stats WHERE metric_name = 'total_executions' AND metric_value > 0) THEN
        test_result := test_result || '✓ Dashboard statistics updated' || E'\n';
    ELSE
        test_result := test_result || '✗ Dashboard statistics not updated' || E'\n';
    END IF;
    
    RETURN test_result;
END;
$$ LANGUAGE plpgsql;

-- Usage: SELECT test_etl_triggers();

-- ============================================================================
-- INSTALLATION NOTES
-- ============================================================================

/*
INSTALLATION INSTRUCTIONS:

1. First, create the sai_dashboard database and schema:
   psql -U postgres -f sai_dashboard_schema.sql

2. Then, install these triggers on the n8n database:
   psql -U postgres -d n8n -f n8n_etl_triggers.sql

3. Grant necessary permissions:
   GRANT USAGE ON SCHEMA sai_dashboard TO n8n_user;
   GRANT INSERT, SELECT ON ALL TABLES IN SCHEMA sai_dashboard TO n8n_user;
   GRANT USAGE ON ALL SEQUENCES IN SCHEMA sai_dashboard TO n8n_user;

4. Test the installation:
   SELECT test_etl_triggers();

5. Monitor the logs for trigger activity:
   -- Check PostgreSQL logs for NOTICE messages
   -- Monitor pg_notify channels in the ETL service

NOTIFICATION CHANNELS:
- new_execution: All new SAI executions
- high_priority_execution: Critical/high-risk detections
- process_image: Image processing requests
- incident_update: Incident correlation updates
- stats_updated: Dashboard statistics updates
- etl_error: Processing errors

The ETL service should LISTEN to these channels for real-time processing.
*/