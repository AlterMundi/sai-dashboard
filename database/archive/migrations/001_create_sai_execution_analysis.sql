-- SAI Dashboard Enhanced Analysis Table Migration
-- Creates comprehensive precomputed analysis table with expert review capabilities
-- 
-- Usage: psql -d n8n -f 001_create_sai_execution_analysis.sql
-- Rollback: psql -d n8n -f 001_rollback_sai_execution_analysis.sql

BEGIN;

-- Create main analysis table
CREATE TABLE IF NOT EXISTS sai_execution_analysis (
    -- Primary Key & References
    execution_id INTEGER PRIMARY KEY,
    
    -- Node & Device Context  
    node_id VARCHAR(100),
    node_name VARCHAR(200),
    node_type VARCHAR(50),
    camera_id VARCHAR(50),
    camera_location VARCHAR(100),
    
    -- Core Risk Analysis (AI Generated)
    risk_level VARCHAR(10) NOT NULL DEFAULT 'none',
    confidence_score DECIMAL(3,2),
    has_image BOOLEAN NOT NULL DEFAULT false,
    
    -- Detailed Detection Flags
    smoke_detected BOOLEAN DEFAULT false,
    flame_detected BOOLEAN DEFAULT false,
    heat_signature_detected BOOLEAN DEFAULT false,
    motion_detected BOOLEAN DEFAULT false,
    
    -- Image Quality Metrics
    image_width INTEGER,
    image_height INTEGER,
    image_size_bytes INTEGER,
    image_format VARCHAR(10),
    image_quality_score DECIMAL(3,2),
    
    -- AI/ML Context
    model_version VARCHAR(20),
    processing_time_ms INTEGER,
    features_detected JSONB DEFAULT '[]'::jsonb,
    color_analysis JSONB,
    
    -- Alert & Response
    alert_priority VARCHAR(10) DEFAULT 'normal',
    response_required BOOLEAN DEFAULT false,
    false_positive_flag BOOLEAN DEFAULT false,
    verified_by_human BOOLEAN DEFAULT false,
    human_verifier VARCHAR(100),
    
    -- Communication Status
    telegram_delivered BOOLEAN NOT NULL DEFAULT false,
    telegram_message_id BIGINT,
    telegram_chat_id VARCHAR(50),
    email_sent BOOLEAN DEFAULT false,
    sms_sent BOOLEAN DEFAULT false,
    
    -- Geographic Context
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    elevation INTEGER,
    fire_zone_risk VARCHAR(10),
    
    -- Temporal Context
    detection_timestamp TIMESTAMP,
    is_daylight BOOLEAN,
    weather_conditions VARCHAR(50),
    temperature_celsius INTEGER,
    humidity_percent INTEGER,
    wind_speed_kmh INTEGER,
    
    -- Correlation & Incidents
    incident_id UUID,
    related_execution_ids JSONB DEFAULT '[]'::jsonb,
    duplicate_of INTEGER,
    
    -- Analysis Content
    ollama_analysis_text TEXT,
    raw_analysis_json JSONB,
    confidence_breakdown JSONB,
    
    -- Expert Review Status
    expert_review_status VARCHAR(20) DEFAULT 'pending',
    expert_review_priority INTEGER DEFAULT 3,
    assigned_expert_id VARCHAR(50),
    expert_review_deadline TIMESTAMP,
    
    -- Expert Judgment
    expert_risk_assessment VARCHAR(10),
    expert_confidence DECIMAL(3,2),
    expert_agrees_with_ai BOOLEAN,
    expert_notes TEXT,
    expert_reasoning TEXT,
    
    -- Tagging System
    expert_tags JSONB DEFAULT '[]'::jsonb,
    fire_type VARCHAR(30),
    fire_stage VARCHAR(20),
    fire_cause VARCHAR(30),
    
    -- Validation Metadata
    reviewed_at TIMESTAMP,
    review_duration_minutes INTEGER,
    expert_name VARCHAR(100),
    expert_certification VARCHAR(50),
    expert_experience_years INTEGER,
    
    -- Quality Assurance
    needs_second_opinion BOOLEAN DEFAULT false,
    second_reviewer_id VARCHAR(50),
    second_expert_agrees BOOLEAN,
    consensus_reached BOOLEAN,
    escalated_to_supervisor BOOLEAN DEFAULT false,
    
    -- Training & Learning
    use_for_training BOOLEAN DEFAULT true,
    training_weight DECIMAL(3,2) DEFAULT 1.0,
    image_clarity_rating INTEGER,
    detection_difficulty INTEGER,
    
    -- Feedback Loop
    ai_improvement_suggestions TEXT,
    feedback_category VARCHAR(30),
    recommended_camera_adjustment TEXT,
    
    -- Legal & Compliance
    legal_evidence_quality VARCHAR(20) DEFAULT 'standard',
    chain_of_custody_maintained BOOLEAN DEFAULT true,
    expert_signature_hash VARCHAR(64),
    
    -- Performance Tracking
    expert_accuracy_score DECIMAL(3,2),
    review_complexity_score INTEGER,
    expert_specialization VARCHAR(50),
    
    -- Processing Metadata
    processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    processing_version VARCHAR(10) NOT NULL DEFAULT '2.0',
    extraction_method VARCHAR(20) NOT NULL DEFAULT 'enhanced',
    
    -- Foreign Key Constraint
    CONSTRAINT fk_sai_analysis_execution 
        FOREIGN KEY (execution_id) 
        REFERENCES execution_entity(id) 
        ON DELETE CASCADE,
    
    -- Self-referencing foreign key for duplicates
    CONSTRAINT fk_sai_analysis_duplicate 
        FOREIGN KEY (duplicate_of) 
        REFERENCES sai_execution_analysis(execution_id)
        ON DELETE SET NULL,
    
    -- Value Constraints
    CONSTRAINT valid_risk_level 
        CHECK (risk_level IN ('high', 'medium', 'low', 'none')),
    CONSTRAINT valid_expert_risk 
        CHECK (expert_risk_assessment IS NULL OR expert_risk_assessment IN ('high', 'medium', 'low', 'none')),
    CONSTRAINT valid_alert_priority 
        CHECK (alert_priority IN ('critical', 'high', 'normal', 'low')),
    CONSTRAINT valid_expert_review_status 
        CHECK (expert_review_status IN ('pending', 'in_review', 'completed', 'disputed')),
    CONSTRAINT valid_confidence 
        CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
    CONSTRAINT valid_expert_confidence 
        CHECK (expert_confidence IS NULL OR (expert_confidence >= 0 AND expert_confidence <= 1)),
    CONSTRAINT valid_review_priority 
        CHECK (expert_review_priority BETWEEN 1 AND 5),
    CONSTRAINT valid_clarity_rating 
        CHECK (image_clarity_rating IS NULL OR image_clarity_rating BETWEEN 1 AND 5),
    CONSTRAINT valid_difficulty_rating 
        CHECK (detection_difficulty IS NULL OR detection_difficulty BETWEEN 1 AND 5),
    CONSTRAINT valid_coordinates 
        CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)),
    CONSTRAINT valid_training_weight 
        CHECK (training_weight IS NULL OR (training_weight >= 0.1 AND training_weight <= 2.0))
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_sai_analysis_risk_level 
    ON sai_execution_analysis(risk_level);

CREATE INDEX IF NOT EXISTS idx_sai_analysis_camera_id 
    ON sai_execution_analysis(camera_id);

CREATE INDEX IF NOT EXISTS idx_sai_analysis_detection_time 
    ON sai_execution_analysis(detection_timestamp);

CREATE INDEX IF NOT EXISTS idx_sai_analysis_incident_id 
    ON sai_execution_analysis(incident_id);

-- Expert workflow indexes
CREATE INDEX IF NOT EXISTS idx_sai_analysis_review_status 
    ON sai_execution_analysis(expert_review_status);

CREATE INDEX IF NOT EXISTS idx_sai_analysis_assigned_expert 
    ON sai_execution_analysis(assigned_expert_id) 
    WHERE assigned_expert_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sai_analysis_review_deadline 
    ON sai_execution_analysis(expert_review_deadline) 
    WHERE expert_review_deadline IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sai_analysis_needs_review 
    ON sai_execution_analysis(expert_review_priority, expert_review_deadline) 
    WHERE expert_review_status = 'pending';

-- Quality assurance indexes
CREATE INDEX IF NOT EXISTS idx_sai_analysis_disputed 
    ON sai_execution_analysis(expert_review_status) 
    WHERE expert_review_status = 'disputed';

CREATE INDEX IF NOT EXISTS idx_sai_analysis_second_opinion 
    ON sai_execution_analysis(needs_second_opinion) 
    WHERE needs_second_opinion = true;

CREATE INDEX IF NOT EXISTS idx_sai_analysis_consensus 
    ON sai_execution_analysis(consensus_reached) 
    WHERE consensus_reached = false;

-- Emergency response indexes
CREATE INDEX IF NOT EXISTS idx_sai_analysis_response_required 
    ON sai_execution_analysis(response_required) 
    WHERE response_required = true;

CREATE INDEX IF NOT EXISTS idx_sai_analysis_unverified 
    ON sai_execution_analysis(verified_by_human) 
    WHERE verified_by_human = false;

CREATE INDEX IF NOT EXISTS idx_sai_analysis_false_positives 
    ON sai_execution_analysis(false_positive_flag) 
    WHERE false_positive_flag = true;

-- Geographic indexes (requires PostGIS extension for full spatial queries)
CREATE INDEX IF NOT EXISTS idx_sai_analysis_coordinates 
    ON sai_execution_analysis(latitude, longitude) 
    WHERE latitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sai_analysis_fire_zone 
    ON sai_execution_analysis(fire_zone_risk);

-- Multi-column analytics indexes
CREATE INDEX IF NOT EXISTS idx_sai_analysis_camera_risk_time 
    ON sai_execution_analysis(camera_id, risk_level, detection_timestamp);

CREATE INDEX IF NOT EXISTS idx_sai_analysis_priority_response 
    ON sai_execution_analysis(alert_priority, response_required);

CREATE INDEX IF NOT EXISTS idx_sai_analysis_detection_flags 
    ON sai_execution_analysis(smoke_detected, flame_detected, heat_signature_detected);

-- Training dataset indexes
CREATE INDEX IF NOT EXISTS idx_sai_analysis_training 
    ON sai_execution_analysis(use_for_training) 
    WHERE use_for_training = true;

-- JSONB indexes for flexible querying
CREATE INDEX IF NOT EXISTS idx_sai_analysis_expert_tags 
    ON sai_execution_analysis USING gin(expert_tags);

CREATE INDEX IF NOT EXISTS idx_sai_analysis_features 
    ON sai_execution_analysis USING gin(features_detected);

CREATE INDEX IF NOT EXISTS idx_sai_analysis_related_executions 
    ON sai_execution_analysis USING gin(related_execution_ids);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_sai_analysis_search 
    ON sai_execution_analysis USING gin(to_tsvector('english', 
        COALESCE(ollama_analysis_text, '') || ' ' || 
        COALESCE(expert_notes, '') || ' ' || 
        COALESCE(expert_reasoning, '')
    ));

-- Performance tracking index
CREATE INDEX IF NOT EXISTS idx_sai_analysis_expert_performance 
    ON sai_execution_analysis(assigned_expert_id, expert_accuracy_score);

-- Create materialized view for training dataset
CREATE MATERIALIZED VIEW IF NOT EXISTS sai_ml_training_dataset AS
SELECT 
    ea.execution_id,
    ea.camera_id,
    ea.camera_location,
    ea.risk_level as ai_prediction,
    ea.confidence_score as ai_confidence,
    ea.expert_risk_assessment as ground_truth,
    ea.expert_confidence,
    ea.expert_agrees_with_ai,
    ea.expert_tags,
    ea.fire_type,
    ea.fire_stage,
    ea.fire_cause,
    ea.training_weight,
    ea.detection_difficulty,
    ea.image_clarity_rating,
    ea.features_detected,
    ea.smoke_detected,
    ea.flame_detected,
    ea.heat_signature_detected,
    ea.motion_detected,
    ea.is_daylight,
    ea.weather_conditions,
    e."startedAt" as execution_timestamp
FROM sai_execution_analysis ea
JOIN execution_entity e ON ea.execution_id = e.id
WHERE ea.expert_review_status = 'completed'
    AND ea.use_for_training = true
    AND (ea.consensus_reached IS NULL OR ea.consensus_reached = true);

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_sai_ml_training_camera 
    ON sai_ml_training_dataset(camera_id);

CREATE INDEX IF NOT EXISTS idx_sai_ml_training_labels 
    ON sai_ml_training_dataset(ai_prediction, ground_truth);

-- Create view for expert dashboard
CREATE OR REPLACE VIEW sai_expert_dashboard AS
SELECT 
    ea.execution_id,
    ea.expert_review_priority,
    ea.expert_review_deadline,
    ea.camera_id,
    ea.camera_location,
    ea.risk_level as ai_assessment,
    ea.confidence_score as ai_confidence,
    ea.detection_timestamp,
    ea.ollama_analysis_text,
    ea.assigned_expert_id,
    ea.expert_review_status,
    CASE 
        WHEN ea.expert_review_deadline < NOW() THEN 'OVERDUE'
        WHEN ea.expert_review_deadline < NOW() + INTERVAL '2 hours' THEN 'URGENT' 
        ELSE 'ON_TIME'
    END as deadline_status,
    e.status as execution_status,
    e."startedAt" as execution_started_at
FROM sai_execution_analysis ea
JOIN execution_entity e ON ea.execution_id = e.id
WHERE ea.expert_review_status IN ('pending', 'in_review');

-- Add comment for documentation
COMMENT ON TABLE sai_execution_analysis IS 'Precomputed analysis data with expert review capabilities for SAI fire detection workflow';
COMMENT ON COLUMN sai_execution_analysis.execution_id IS 'Foreign key to execution_entity.id';
COMMENT ON COLUMN sai_execution_analysis.expert_review_priority IS '1=urgent, 2=high, 3=normal, 4=low, 5=training';
COMMENT ON COLUMN sai_execution_analysis.incident_id IS 'UUID to group related detections across multiple cameras';
COMMENT ON COLUMN sai_execution_analysis.training_weight IS 'Weight for ML training, 0.1-2.0 scale';

-- Grant permissions (assuming read-only user exists)
GRANT SELECT ON sai_execution_analysis TO sai_dashboard_readonly;
GRANT SELECT ON sai_ml_training_dataset TO sai_dashboard_readonly;
GRANT SELECT ON sai_expert_dashboard TO sai_dashboard_readonly;

COMMIT;

-- Success message
\echo 'SAI execution analysis table created successfully!'
\echo 'Indexes: 23 created for optimal query performance'
\echo 'Views: 2 created (ML training dataset, expert dashboard)'
\echo 'Ready for enhanced analysis processing!'