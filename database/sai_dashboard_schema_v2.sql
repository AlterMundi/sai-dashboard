-- ============================================================================
-- SAI DASHBOARD SCHEMA V2 - Optimal Event-Sourced Design
-- ============================================================================
-- Design Principles:
--   1. Immutable core execution log (mirrors n8n)
--   2. JSONB for flexible metadata evolution
--   3. Separate enrichment tables (optional, indexed)
--   4. Semantic separation (execution vs camera vs node vs environmental)
--   5. Performance-first (GIN indexes, generated columns, partitioning ready)
-- ============================================================================

-- Drop old database if exists and create fresh
-- DROP DATABASE IF EXISTS sai_dashboard;
-- CREATE DATABASE sai_dashboard;
-- \c sai_dashboard;

-- ============================================================================
-- TIER 1: IMMUTABLE EXECUTION LOG (core, mirrors n8n execution_entity)
-- ============================================================================

CREATE TABLE sai_executions (
    -- Identity (immutable, matches n8n)
    execution_id BIGINT PRIMARY KEY,              -- n8n execution_entity.id
    workflow_id VARCHAR(36) NOT NULL              -- Always 'yDbfhooKemfhMIkC'
        CHECK (workflow_id = 'yDbfhooKemfhMIkC'),

    -- Timestamps (immutable)
    started_at TIMESTAMPTZ NOT NULL,              -- n8n startedAt
    completed_at TIMESTAMPTZ NOT NULL,            -- n8n stoppedAt
    duration_ms INTEGER NOT NULL                  -- Calculated: (completed_at - started_at)
        CHECK (duration_ms >= 0),

    -- Status (immutable once completed)
    status VARCHAR(20) NOT NULL                   -- 'success' | 'error'
        CHECK (status IN ('success', 'error')),
    mode VARCHAR(20) DEFAULT 'webhook'            -- Always 'webhook' for SAI
        CHECK (mode = 'webhook'),

    -- Camera Metadata (JSONB for flexible schema evolution)
    -- Structure: { id, node_id, gps: {lat, lng}, settings, health, view_angle, ... }
    camera_metadata JSONB,

    -- Image Storage Paths (new partitioned structure)
    -- Format: /mnt/raid1/n8n-backup/images/{type}/{partition}/{execution_id}.{ext}
    -- Example: /mnt/raid1/n8n-backup/images/original/185/185839.jpg
    image_original_path VARCHAR(500),
    image_webp_path VARCHAR(500),
    image_thumb_path VARCHAR(500),
    image_size_bytes INTEGER CHECK (image_size_bytes > 0),

    -- ETL Metadata
    etl_version VARCHAR(10) DEFAULT '2.0',        -- Track ETL schema version
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX idx_sai_exec_timestamp ON sai_executions(started_at DESC);
CREATE INDEX idx_sai_exec_status ON sai_executions(status, started_at DESC);
CREATE INDEX idx_sai_exec_completed ON sai_executions(completed_at DESC) WHERE status = 'success';

-- JSONB Indexes for metadata queries
CREATE INDEX idx_sai_exec_camera_id ON sai_executions((camera_metadata->>'id'))
    WHERE camera_metadata->>'id' IS NOT NULL;
CREATE INDEX idx_sai_exec_node_id ON sai_executions((camera_metadata->>'node_id'))
    WHERE camera_metadata->>'node_id' IS NOT NULL;

-- GIN index for flexible metadata search
CREATE INDEX idx_sai_exec_metadata_gin ON sai_executions USING GIN(camera_metadata jsonb_path_ops);

-- Table comment
COMMENT ON TABLE sai_executions IS
'Immutable execution log mirroring n8n execution_entity. Core table for all SAI workflow executions.';

-- ============================================================================
-- TIER 2: AI INFERENCE RESULTS (one-to-one with executions)
-- ============================================================================

CREATE TABLE sai_inference_results (
    execution_id BIGINT PRIMARY KEY
        REFERENCES sai_executions(execution_id) ON DELETE CASCADE,

    -- Model Metadata
    model_name VARCHAR(50) NOT NULL,              -- 'yolov8', 'yolov11', 'qwen2.5vl:7b'
    model_version VARCHAR(50),                    -- Specific version/checkpoint
    inference_timestamp TIMESTAMPTZ DEFAULT NOW(),
    processing_time_ms INTEGER CHECK (processing_time_ms >= 0),

    -- Detection Results (structured JSONB)
    -- Format: [{class, confidence, bbox: [x,y,w,h], ...}]
    detections JSONB NOT NULL DEFAULT '[]'::jsonb,
    detection_count INTEGER GENERATED ALWAYS AS (
        jsonb_array_length(detections)
    ) STORED,

    -- Risk Assessment (for LLM models like qwen)
    risk_level VARCHAR(20)
        CHECK (risk_level IN ('critical', 'high', 'medium', 'low', 'none')),
    confidence_score DECIMAL(5,4)                 -- 0.0000-1.0000
        CHECK (confidence_score BETWEEN 0 AND 1),

    -- Raw Model Output (for dataset training and debugging)
    raw_response TEXT,
    raw_response_hash VARCHAR(64),                -- SHA256 for deduplication

    -- Quick Filter Flags (generated columns for performance)
    has_smoke BOOLEAN GENERATED ALWAYS AS (
        detections @> '[{"class": "smoke"}]' OR
        (raw_response IS NOT NULL AND raw_response ILIKE '%smoke%')
    ) STORED,
    has_fire BOOLEAN GENERATED ALWAYS AS (
        detections @> '[{"class": "fire"}]' OR
        detections @> '[{"class": "flame"}]' OR
        (raw_response IS NOT NULL AND (raw_response ILIKE '%fire%' OR raw_response ILIKE '%flame%'))
    ) STORED,
    has_vehicle BOOLEAN GENERATED ALWAYS AS (
        detections @> '[{"class": "vehicle"}]' OR
        detections @> '[{"class": "car"}]' OR
        detections @> '[{"class": "truck"}]'
    ) STORED,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX idx_sai_infer_model ON sai_inference_results(model_name, model_version);
CREATE INDEX idx_sai_infer_risk ON sai_inference_results(risk_level, confidence_score DESC NULLS LAST);
CREATE INDEX idx_sai_infer_detection_count ON sai_inference_results(detection_count) WHERE detection_count > 0;
CREATE INDEX idx_sai_infer_flags ON sai_inference_results(has_smoke, has_fire, has_vehicle);
CREATE INDEX idx_sai_infer_timestamp ON sai_inference_results(inference_timestamp DESC);

-- GIN index for detection search
CREATE INDEX idx_sai_infer_detections ON sai_inference_results USING GIN(detections jsonb_path_ops);

COMMENT ON TABLE sai_inference_results IS
'AI model inference results. One-to-one with sai_executions. Stores detections and risk assessment.';

-- ============================================================================
-- TIER 3: NOTIFICATION DELIVERY (one-to-one, optional)
-- ============================================================================

CREATE TABLE sai_notifications (
    execution_id BIGINT PRIMARY KEY
        REFERENCES sai_executions(execution_id) ON DELETE CASCADE,

    -- Telegram Delivery
    telegram_sent BOOLEAN DEFAULT FALSE,
    telegram_message_id BIGINT,
    telegram_chat_id VARCHAR(50),
    telegram_sent_at TIMESTAMPTZ,
    telegram_error TEXT,

    -- Future Channels (email, sms, push)
    email_sent BOOLEAN DEFAULT FALSE,
    email_sent_at TIMESTAMPTZ,
    email_error TEXT,

    sms_sent BOOLEAN DEFAULT FALSE,
    sms_sent_at TIMESTAMPTZ,
    sms_error TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sai_notif_telegram ON sai_notifications(telegram_sent, telegram_sent_at);
CREATE INDEX idx_sai_notif_failed ON sai_notifications(telegram_sent, execution_id)
    WHERE telegram_sent = FALSE AND telegram_error IS NOT NULL;

COMMENT ON TABLE sai_notifications IS
'Notification delivery tracking. Optional enrichment for executions with alerts.';

-- ============================================================================
-- TIER 4: EXPERT REVIEW & GROUND TRUTH (many-to-one, ML dataset gold!)
-- ============================================================================

CREATE TABLE sai_expert_reviews (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id BIGINT NOT NULL
        REFERENCES sai_executions(execution_id) ON DELETE CASCADE,

    -- Assignment
    expert_id UUID NOT NULL,                      -- FK to users table (not created yet)
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID,                             -- Admin who assigned
    priority INTEGER DEFAULT 3                    -- 1=critical, 5=low
        CHECK (priority BETWEEN 1 AND 5),

    -- Review Lifecycle
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'escalated')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    review_duration_minutes INTEGER GENERATED ALWAYS AS (
        CASE
            WHEN started_at IS NOT NULL AND completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (completed_at - started_at)) / 60
            ELSE NULL
        END
    ) STORED,

    -- Ground Truth Labels (THE VALUE FOR ML DATASET!)
    ground_truth_label VARCHAR(20)
        CHECK (ground_truth_label IN ('fire', 'smoke', 'false_positive', 'unclear', 'vehicle', 'people')),
    ground_truth_confidence DECIMAL(3,2)          -- Expert confidence 0.00-1.00
        CHECK (ground_truth_confidence BETWEEN 0 AND 1),
    agrees_with_ai BOOLEAN,

    -- Structured Annotations (bounding boxes, segmentation, etc.)
    annotations JSONB,                            -- Format: [{type, bbox, polygon, label}]

    -- Quality Metrics
    detection_difficulty INTEGER                  -- 1-5 scale
        CHECK (detection_difficulty BETWEEN 1 AND 5),
    image_quality INTEGER                         -- 1-5 scale
        CHECK (image_quality BETWEEN 1 AND 5),

    -- Expert Notes
    expert_notes TEXT,
    expert_tags TEXT[],                           -- Array: ['vegetation_fire', 'daytime', 'clear_sky']

    -- Training Dataset Flags
    use_for_training BOOLEAN DEFAULT TRUE,
    training_weight DECIMAL(3,2) DEFAULT 1.0
        CHECK (training_weight BETWEEN 0 AND 2),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX idx_sai_review_execution ON sai_expert_reviews(execution_id);
CREATE INDEX idx_sai_review_expert ON sai_expert_reviews(expert_id, status);
CREATE INDEX idx_sai_review_ground_truth ON sai_expert_reviews(ground_truth_label, ground_truth_confidence DESC);
CREATE INDEX idx_sai_review_training ON sai_expert_reviews(use_for_training, training_weight DESC)
    WHERE use_for_training = TRUE;
CREATE INDEX idx_sai_review_status ON sai_expert_reviews(status, priority, assigned_at);

-- GIN index for tags and annotations
CREATE INDEX idx_sai_review_tags ON sai_expert_reviews USING GIN(expert_tags);
CREATE INDEX idx_sai_review_annotations ON sai_expert_reviews USING GIN(annotations jsonb_path_ops);

COMMENT ON TABLE sai_expert_reviews IS
'Expert human review and ground truth labels. Critical for ML dataset and model improvement.';

-- ============================================================================
-- TIER 5: CAMERA & NODE REGISTRY (reference data, evolves slowly)
-- ============================================================================

CREATE TABLE sai_nodes (
    node_id VARCHAR(50) PRIMARY KEY,              -- 'NODE_001'
    node_name VARCHAR(100) NOT NULL,
    region VARCHAR(50),

    -- Location
    gps_lat DECIMAL(10,7),
    gps_lng DECIMAL(10,7),
    elevation_m INTEGER,
    coverage_radius_m INTEGER CHECK (coverage_radius_m > 0),

    -- Status
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'maintenance', 'offline', 'testing')),
    last_health_check TIMESTAMPTZ,

    -- Metadata
    metadata JSONB,                               -- Flexible for node-specific config

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sai_nodes_location ON sai_nodes(gps_lat, gps_lng)
    WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL;
CREATE INDEX idx_sai_nodes_status ON sai_nodes(status, region);

CREATE TABLE sai_cameras (
    camera_id VARCHAR(50) PRIMARY KEY,            -- 'CAM_NODE001_01'
    node_id VARCHAR(50) NOT NULL
        REFERENCES sai_nodes(node_id) ON DELETE CASCADE,
    camera_name VARCHAR(100),

    -- Static Configuration (changes rarely)
    gps_lat DECIMAL(10,7),
    gps_lng DECIMAL(10,7),
    elevation_m INTEGER,
    direction_degrees INTEGER CHECK (direction_degrees BETWEEN 0 AND 359),
    field_of_view_degrees INTEGER CHECK (field_of_view_degrees BETWEEN 1 AND 180),

    -- Hardware Specs
    hardware_model VARCHAR(100),
    firmware_version VARCHAR(50),
    resolution_width INTEGER CHECK (resolution_width > 0),
    resolution_height INTEGER CHECK (resolution_height > 0),

    -- Status (updated by health checks or executions)
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'maintenance', 'offline', 'error')),
    last_seen_at TIMESTAMPTZ,

    -- Metadata
    metadata JSONB,                               -- Flexible for camera-specific config

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sai_cameras_node ON sai_cameras(node_id);
CREATE INDEX idx_sai_cameras_location ON sai_cameras(gps_lat, gps_lng)
    WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL;
CREATE INDEX idx_sai_cameras_status ON sai_cameras(status, last_seen_at);

COMMENT ON TABLE sai_nodes IS 'Physical monitoring node locations. Regional deployment tracking.';
COMMENT ON TABLE sai_cameras IS 'Camera hardware registry. Linked to nodes for regional organization.';

-- ============================================================================
-- TIER 6: ENVIRONMENTAL DATA (time-series, node-level, future)
-- ============================================================================

CREATE TABLE sai_environmental_conditions (
    id BIGSERIAL PRIMARY KEY,
    node_id VARCHAR(50) NOT NULL
        REFERENCES sai_nodes(node_id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL,

    -- Weather
    temperature_c DECIMAL(4,1),
    humidity_percent INTEGER CHECK (humidity_percent BETWEEN 0 AND 100),
    wind_speed_kmh DECIMAL(4,1) CHECK (wind_speed_kmh >= 0),
    wind_direction_degrees INTEGER CHECK (wind_direction_degrees BETWEEN 0 AND 359),
    precipitation_mm DECIMAL(5,2) CHECK (precipitation_mm >= 0),

    -- Astronomical
    is_daylight BOOLEAN,
    sun_elevation_degrees DECIMAL(5,2),

    -- Fire Risk Indices
    fire_weather_index DECIMAL(5,2),              -- Canadian FWI or similar
    drought_code INTEGER,

    -- Data Source
    data_source VARCHAR(50),                      -- 'weather_api' | 'local_sensor'

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sai_env_node_time ON sai_environmental_conditions(node_id, recorded_at DESC);
CREATE INDEX idx_sai_env_daylight ON sai_environmental_conditions(is_daylight, recorded_at DESC);
CREATE INDEX idx_sai_env_fire_risk ON sai_environmental_conditions(fire_weather_index, drought_code);

COMMENT ON TABLE sai_environmental_conditions IS
'Time-series environmental data per node. For correlation with fire detections.';

-- ============================================================================
-- TIER 7: INCIDENT CORRELATION (many-to-many enrichment, future)
-- ============================================================================

CREATE TABLE sai_incidents (
    incident_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Temporal Bounds
    first_detection_at TIMESTAMPTZ NOT NULL,
    last_detection_at TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (last_detection_at - first_detection_at)) / 60
    ) STORED,

    -- Severity
    max_risk_level VARCHAR(20),
    max_confidence DECIMAL(5,4),

    -- Spatial Correlation
    center_lat DECIMAL(10,7),
    center_lng DECIMAL(10,7),
    radius_m INTEGER,
    cameras_involved INTEGER CHECK (cameras_involved > 0),
    executions_count INTEGER CHECK (executions_count > 0),

    -- Status
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'resolved', 'false_positive', 'investigating')),
    response_triggered BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sai_incident_executions (
    incident_id UUID REFERENCES sai_incidents(incident_id) ON DELETE CASCADE,
    execution_id BIGINT REFERENCES sai_executions(execution_id) ON DELETE CASCADE,
    sequence_order INTEGER NOT NULL,              -- Order in incident timeline
    PRIMARY KEY (incident_id, execution_id)
);

CREATE INDEX idx_sai_incidents_temporal ON sai_incidents(first_detection_at DESC, status);
CREATE INDEX idx_sai_incidents_severity ON sai_incidents(max_risk_level, max_confidence DESC);
CREATE INDEX idx_sai_incidents_location ON sai_incidents(center_lat, center_lng);
CREATE INDEX idx_sai_incident_exec ON sai_incident_executions(execution_id);

COMMENT ON TABLE sai_incidents IS
'Multi-camera incident correlation. Groups related fire detections across time and space.';

-- ============================================================================
-- MATERIALIZED VIEWS FOR DASHBOARD PERFORMANCE
-- ============================================================================

-- Daily Statistics (refresh every 5 minutes)
CREATE MATERIALIZED VIEW sai_daily_stats AS
SELECT
    DATE(started_at) as date,
    COUNT(*) as total_executions,
    COUNT(*) FILTER (WHERE status = 'success') as successful_executions,
    COUNT(*) FILTER (WHERE status = 'error') as failed_executions,
    AVG(duration_ms) as avg_duration_ms,
    COUNT(DISTINCT (camera_metadata->>'id')) as unique_cameras,
    COUNT(DISTINCT (camera_metadata->>'node_id')) as unique_nodes
FROM sai_executions
GROUP BY DATE(started_at)
ORDER BY date DESC;

CREATE UNIQUE INDEX idx_sai_daily_stats_date ON sai_daily_stats(date DESC);

-- Camera Activity Summary (refresh every 10 minutes)
CREATE MATERIALIZED VIEW sai_camera_activity AS
SELECT
    camera_metadata->>'id' as camera_id,
    camera_metadata->>'node_id' as node_id,
    COUNT(*) as execution_count,
    COUNT(*) FILTER (WHERE ir.has_fire OR ir.has_smoke) as detection_count,
    MAX(e.started_at) as last_execution,
    AVG(e.duration_ms) as avg_duration_ms
FROM sai_executions e
LEFT JOIN sai_inference_results ir ON e.execution_id = ir.execution_id
WHERE camera_metadata->>'id' IS NOT NULL
GROUP BY camera_metadata->>'id', camera_metadata->>'node_id';

CREATE INDEX idx_sai_camera_activity_camera ON sai_camera_activity(camera_id);
CREATE INDEX idx_sai_camera_activity_node ON sai_camera_activity(node_id);
CREATE INDEX idx_sai_camera_activity_detections ON sai_camera_activity(detection_count DESC);

COMMENT ON MATERIALIZED VIEW sai_daily_stats IS
'Daily aggregated statistics. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY sai_daily_stats;';
COMMENT ON MATERIALIZED VIEW sai_camera_activity IS
'Per-camera activity summary. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY sai_camera_activity;';

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update_at trigger to all tables with updated_at column
CREATE TRIGGER update_sai_executions_updated_at BEFORE UPDATE ON sai_executions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sai_inference_updated_at BEFORE UPDATE ON sai_inference_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sai_notifications_updated_at BEFORE UPDATE ON sai_notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sai_reviews_updated_at BEFORE UPDATE ON sai_expert_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sai_nodes_updated_at BEFORE UPDATE ON sai_nodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sai_cameras_updated_at BEFORE UPDATE ON sai_cameras
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sai_incidents_updated_at BEFORE UPDATE ON sai_incidents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Grant read/write to n8n_user (ETL process user)
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO n8n_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO n8n_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO n8n_user;

-- ============================================================================
-- SCHEMA COMPLETE
-- ============================================================================
-- Next steps:
-- 1. Apply this schema: psql -U postgres -d sai_dashboard < sai_dashboard_schema_v2.sql
-- 2. Implement new ETL service with idempotent inserts
-- 3. Migrate existing data from old schema (optional)
-- 4. Update dashboard API to use new schema
-- ============================================================================
