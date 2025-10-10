-- SAI Dashboard Database Schema
-- Optimized structure for real-time monitoring and expert review system
-- Designed for performance with proper indexing and tiered updates

CREATE DATABASE sai_dashboard;
USE sai_dashboard;

-- ============================================================================
-- CORE EXECUTION TRACKING
-- ============================================================================

-- Main execution table (lightweight, optimized for queries)
CREATE TABLE executions (
    id BIGINT PRIMARY KEY,                    -- Same as n8n execution_entity.id
    workflow_id VARCHAR(36) NOT NULL,        -- n8n workflow identifier
    execution_timestamp TIMESTAMP NOT NULL,  -- When execution started
    completion_timestamp TIMESTAMP,          -- When execution completed
    duration_ms INTEGER,                     -- Execution duration
    status VARCHAR(20) NOT NULL,             -- success, error, canceled, running
    mode VARCHAR(20) DEFAULT 'webhook',      -- webhook, manual, trigger, retry
    retry_of BIGINT,                         -- Reference to original execution if retry
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes for performance
    INDEX idx_timestamp (execution_timestamp DESC),
    INDEX idx_completion (completion_timestamp DESC),
    INDEX idx_status_timestamp (status, execution_timestamp DESC),
    INDEX idx_workflow_status (workflow_id, status),
    FOREIGN KEY (retry_of) REFERENCES executions(id)
);

-- ============================================================================
-- IMAGE MANAGEMENT
-- ============================================================================

-- Image metadata and filesystem references (no base64 storage)
CREATE TABLE execution_images (
    execution_id BIGINT PRIMARY KEY,
    original_path VARCHAR(500) NOT NULL,     -- /mnt/raid1/n8n/backup/images/by-execution/{id}/original.jpg
    thumbnail_path VARCHAR(500),             -- /mnt/raid1/n8n/backup/images/by-execution/{id}/thumb.jpg
    size_bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    format VARCHAR(10) DEFAULT 'jpeg',
    quality_score DECIMAL(3,2),              -- Image quality assessment (0.0-1.0)
    extracted_at TIMESTAMP DEFAULT NOW(),
    
    -- Additional filesystem references
    cached_path VARCHAR(500),                -- Fast access cache location
    backup_path VARCHAR(500),                -- Archive backup location
    
    INDEX idx_path (original_path),
    INDEX idx_size (size_bytes),
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

-- ============================================================================
-- STRUCTURED ANALYSIS RESULTS
-- ============================================================================

-- Core analysis results (extracted from n8n Ollama responses)
CREATE TABLE execution_analysis (
    execution_id BIGINT PRIMARY KEY,
    
    -- Risk Assessment
    risk_level ENUM('critical', 'high', 'medium', 'low', 'none') NOT NULL DEFAULT 'none',
    confidence_score DECIMAL(4,3),           -- 0.000-1.000
    overall_assessment TEXT,                 -- Human-readable analysis
    
    -- Detection Results
    smoke_detected BOOLEAN DEFAULT FALSE,
    flame_detected BOOLEAN DEFAULT FALSE,
    heat_signature_detected BOOLEAN DEFAULT FALSE,
    motion_detected BOOLEAN DEFAULT FALSE,
    vehicle_detected BOOLEAN DEFAULT FALSE,
    people_detected BOOLEAN DEFAULT FALSE,
    
    -- Technical Metadata
    model_version VARCHAR(50),               -- qwen2.5vl:7b
    processing_time_ms INTEGER,
    analysis_timestamp TIMESTAMP DEFAULT NOW(),
    raw_response TEXT,                       -- Original Ollama response
    
    -- Environmental Context
    camera_id VARCHAR(50),
    camera_location VARCHAR(100),
    location_lat DECIMAL(10,7),
    location_lng DECIMAL(10,7),
    elevation_meters INTEGER,
    is_daylight BOOLEAN,
    weather_conditions VARCHAR(50),
    temperature_celsius DECIMAL(4,1),
    humidity_percent INTEGER,
    wind_speed_kmh DECIMAL(4,1),
    
    -- Alert Management
    alert_priority ENUM('critical', 'high', 'normal', 'low') DEFAULT 'normal',
    response_required BOOLEAN DEFAULT FALSE,
    false_positive_flag BOOLEAN DEFAULT FALSE,
    incident_id UUID,                        -- Link related detections
    
    INDEX idx_risk_level (risk_level),
    INDEX idx_confidence (confidence_score DESC),
    INDEX idx_camera (camera_id),
    INDEX idx_location (location_lat, location_lng),
    INDEX idx_alert_priority (alert_priority, analysis_timestamp DESC),
    INDEX idx_incident (incident_id),
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

-- ============================================================================
-- NOTIFICATION & DELIVERY TRACKING
-- ============================================================================

-- Notification delivery status
CREATE TABLE execution_notifications (
    execution_id BIGINT PRIMARY KEY,
    
    -- Telegram Integration
    telegram_sent BOOLEAN DEFAULT FALSE,
    telegram_message_id BIGINT,
    telegram_chat_id VARCHAR(50),
    telegram_sent_at TIMESTAMP,
    telegram_error TEXT,
    
    -- Email Integration (future)
    email_sent BOOLEAN DEFAULT FALSE,
    email_recipients TEXT,                   -- JSON array of recipients
    email_sent_at TIMESTAMP,
    email_error TEXT,
    
    -- SMS Integration (future)
    sms_sent BOOLEAN DEFAULT FALSE,
    sms_recipients TEXT,                     -- JSON array of phone numbers
    sms_sent_at TIMESTAMP,
    sms_error TEXT,
    
    -- Push Notifications (future)
    push_sent BOOLEAN DEFAULT FALSE,
    push_devices TEXT,                       -- JSON array of device tokens
    push_sent_at TIMESTAMP,
    push_error TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_telegram_status (telegram_sent, telegram_sent_at),
    INDEX idx_delivery_timestamp (created_at DESC),
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

-- ============================================================================
-- EXPERT REVIEW SYSTEM
-- ============================================================================

-- User management for expert access
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'expert', 'viewer') DEFAULT 'viewer',
    
    -- Expert Profile
    full_name VARCHAR(100),
    certification VARCHAR(100),           -- Fire safety certification
    experience_years INTEGER,
    specialization VARCHAR(100),          -- Forest fires, industrial, etc.
    accuracy_score DECIMAL(4,3),          -- Historical accuracy (0.000-1.000)
    
    -- Access Control
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_role (role),
    INDEX idx_active (is_active),
    INDEX idx_accuracy (accuracy_score DESC)
);

-- Expert review assignments and results
CREATE TABLE expert_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id BIGINT NOT NULL,
    expert_id UUID NOT NULL,
    
    -- Review Assignment
    assigned_at TIMESTAMP DEFAULT NOW(),
    assigned_by UUID,                        -- Admin who assigned
    deadline TIMESTAMP,
    priority INTEGER DEFAULT 3,             -- 1=critical, 5=low
    
    -- Review Status
    status ENUM('pending', 'in_progress', 'completed', 'escalated') DEFAULT 'pending',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    review_duration_minutes INTEGER,
    
    -- Expert Assessment
    expert_risk_level ENUM('critical', 'high', 'medium', 'low', 'none'),
    expert_confidence DECIMAL(4,3),         -- Expert's confidence in assessment
    agrees_with_ai BOOLEAN,                 -- Does expert agree with AI?
    ai_improvement_suggestions TEXT,
    
    -- Detection Corrections
    smoke_detected_expert BOOLEAN,
    flame_detected_expert BOOLEAN,
    heat_signature_detected_expert BOOLEAN,
    motion_detected_expert BOOLEAN,
    
    -- Additional Analysis
    fire_type VARCHAR(50),                  -- Vegetation, structural, vehicle, etc.
    fire_stage VARCHAR(50),                 -- Ignition, growth, fully developed, decay
    fire_cause VARCHAR(50),                 -- Natural, human, electrical, etc.
    expert_notes TEXT,
    expert_reasoning TEXT,
    expert_tags JSON,                       -- Flexible tagging system
    
    -- Quality Assurance
    needs_second_opinion BOOLEAN DEFAULT FALSE,
    second_reviewer_id UUID,
    second_expert_agrees BOOLEAN,
    consensus_reached BOOLEAN DEFAULT FALSE,
    escalated_to_supervisor BOOLEAN DEFAULT FALSE,
    
    -- Training Data
    use_for_training BOOLEAN DEFAULT TRUE,
    training_weight DECIMAL(3,2) DEFAULT 1.0, -- Importance for AI training
    image_clarity_rating INTEGER,           -- 1-5 scale
    detection_difficulty INTEGER,           -- 1-5 scale
    
    -- Legal & Compliance
    legal_evidence_quality ENUM('inadmissible', 'standard', 'high', 'court_ready'),
    chain_of_custody_maintained BOOLEAN DEFAULT TRUE,
    expert_signature_hash VARCHAR(255),    -- Digital signature
    
    -- Performance Metrics
    review_complexity_score INTEGER,       -- For workload balancing
    feedback_category VARCHAR(50),         -- For continuous improvement
    recommended_camera_adjustment TEXT,
    
    INDEX idx_expert_status (expert_id, status),
    INDEX idx_execution_review (execution_id),
    INDEX idx_assignment_date (assigned_at DESC),
    INDEX idx_priority_status (priority, status),
    INDEX idx_training_data (use_for_training, training_weight),
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
    FOREIGN KEY (expert_id) REFERENCES users(id),
    FOREIGN KEY (assigned_by) REFERENCES users(id),
    FOREIGN KEY (second_reviewer_id) REFERENCES users(id)
);

-- ============================================================================
-- INCIDENT CORRELATION & TRACKING
-- ============================================================================

-- Multi-execution incident tracking
CREATE TABLE incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_type ENUM('single_detection', 'multiple_cameras', 'temporal_sequence', 'false_positive_cluster'),
    severity ENUM('critical', 'high', 'medium', 'low') DEFAULT 'medium',
    
    -- Spatial Information
    center_lat DECIMAL(10,7),
    center_lng DECIMAL(10,7),
    radius_meters INTEGER,
    affected_cameras JSON,                  -- Array of camera IDs
    
    -- Temporal Information
    first_detection TIMESTAMP,
    last_detection TIMESTAMP,
    duration_minutes INTEGER,
    
    -- Status
    status ENUM('active', 'resolved', 'false_positive', 'under_investigation') DEFAULT 'active',
    escalation_level INTEGER DEFAULT 1,
    emergency_response_triggered BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by UUID,                        -- System or user ID
    
    INDEX idx_severity_status (severity, status),
    INDEX idx_location (center_lat, center_lng),
    INDEX idx_temporal (first_detection, last_detection),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Link executions to incidents
CREATE TABLE incident_executions (
    incident_id UUID,
    execution_id BIGINT,
    sequence_order INTEGER,                 -- Order in incident timeline
    contribution_weight DECIMAL(3,2),      -- How much this execution contributes (0.0-1.0)
    added_at TIMESTAMP DEFAULT NOW(),
    
    PRIMARY KEY (incident_id, execution_id),
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

-- ============================================================================
-- SYSTEM MONITORING & STATISTICS
-- ============================================================================

-- Real-time dashboard statistics (updated by triggers)
CREATE TABLE dashboard_stats (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(50) UNIQUE NOT NULL,
    metric_value DECIMAL(15,4) NOT NULL,
    metric_unit VARCHAR(20),                -- seconds, percentage, count, etc.
    last_updated TIMESTAMP DEFAULT NOW(),
    update_frequency_seconds INTEGER DEFAULT 60,
    
    INDEX idx_metric_name (metric_name),
    INDEX idx_last_updated (last_updated DESC)
);

-- Historical statistics for trending
CREATE TABLE stats_history (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(50) NOT NULL,
    metric_value DECIMAL(15,4) NOT NULL,
    recorded_at TIMESTAMP DEFAULT NOW(),
    period_type ENUM('minute', 'hour', 'day') DEFAULT 'hour',
    
    INDEX idx_metric_period (metric_name, period_type, recorded_at DESC),
    FOREIGN KEY (metric_name) REFERENCES dashboard_stats(metric_name)
);

-- System health monitoring
CREATE TABLE system_health (
    id SERIAL PRIMARY KEY,
    component VARCHAR(50) NOT NULL,        -- database, filesystem, n8n_connection, etc.
    status ENUM('healthy', 'warning', 'critical') DEFAULT 'healthy',
    message TEXT,
    details JSON,                          -- Flexible diagnostic information
    checked_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_component_status (component, status),
    INDEX idx_checked_at (checked_at DESC)
);

-- ============================================================================
-- AUDIT & LOGGING
-- ============================================================================

-- System activity logging
CREATE TABLE activity_log (
    id SERIAL PRIMARY KEY,
    user_id UUID,
    action VARCHAR(100) NOT NULL,          -- login, review_assigned, analysis_completed, etc.
    entity_type VARCHAR(50),               -- execution, review, incident, user, etc.
    entity_id VARCHAR(100),                -- ID of affected entity
    details JSON,                          -- Additional context
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_user_action (user_id, action),
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_created_at (created_at DESC),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Performance monitoring for queries
CREATE TABLE query_performance (
    id SERIAL PRIMARY KEY,
    endpoint VARCHAR(100),
    query_type VARCHAR(50),                -- select, insert, update, delete
    execution_time_ms INTEGER,
    row_count INTEGER,
    cache_hit BOOLEAN DEFAULT FALSE,
    executed_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_endpoint_time (endpoint, execution_time_ms),
    INDEX idx_executed_at (executed_at DESC)
);

-- ============================================================================
-- INITIAL DATA POPULATION
-- ============================================================================

-- Insert initial dashboard statistics
INSERT INTO dashboard_stats (metric_name, metric_value, metric_unit) VALUES
('total_executions', 0, 'count'),
('success_rate', 0, 'percentage'),
('average_processing_time', 0, 'seconds'),
('high_risk_detections_today', 0, 'count'),
('active_incidents', 0, 'count'),
('pending_expert_reviews', 0, 'count'),
('system_uptime', 0, 'seconds'),
('cache_hit_rate', 0, 'percentage');

-- Create default admin user (password: admin123 - should be changed)
INSERT INTO users (username, email, password_hash, role, full_name) VALUES
('admin', 'admin@sai-dashboard.local', '$2b$12$LQv3c1yqBwEHxkVxMJzU5.MZ4hOJnPmKmKCjjqgqYQZ5qhcQ9jP5m', 'admin', 'System Administrator');

-- ============================================================================
-- NODE-BASED REGIONAL MONITORING SYSTEM
-- ============================================================================

-- Monitoring nodes (physical locations with multiple cameras)
CREATE TABLE monitoring_nodes (
    node_id VARCHAR(50) PRIMARY KEY,            -- NODE_001, NODE_002, etc.
    node_name VARCHAR(100) NOT NULL,            -- "Córdoba Centro", "Villa Carlos Paz"
    region VARCHAR(50) NOT NULL,                -- "Córdoba", "Buenos Aires", "Mendoza"
    node_type VARCHAR(30) DEFAULT 'fixed',      -- fixed, mobile, temporary
    
    -- Geographic Location
    latitude DECIMAL(10,7) NOT NULL,            -- -31.4135000
    longitude DECIMAL(10,7) NOT NULL,           -- -64.1811000
    elevation_meters INTEGER,                   -- Altitude above sea level
    coverage_radius_meters INTEGER DEFAULT 5000, -- Monitoring radius
    
    -- Node Status
    status ENUM('active', 'maintenance', 'offline', 'testing') DEFAULT 'active',
    installation_date DATE,
    last_maintenance DATE,
    next_maintenance_due DATE,
    
    -- Contact Information
    contact_person VARCHAR(100),
    contact_phone VARCHAR(20),
    contact_email VARCHAR(100),
    
    -- Technical Specifications
    power_source ENUM('grid', 'solar', 'battery', 'hybrid') DEFAULT 'grid',
    connectivity ENUM('fiber', 'cellular', 'satellite', 'wifi') DEFAULT 'fiber',
    backup_power_hours INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Performance Indexes
    INDEX idx_region (region),
    INDEX idx_status_region (status, region),
    INDEX idx_location (latitude, longitude),
    INDEX idx_coverage (coverage_radius_meters),
    INDEX idx_next_maintenance (next_maintenance_due)
);

-- Cameras associated with monitoring nodes
CREATE TABLE node_cameras (
    camera_id VARCHAR(50) PRIMARY KEY,          -- CAM_NODE001_01, CAM_NODE001_02
    node_id VARCHAR(50) NOT NULL,               -- References monitoring_nodes
    camera_name VARCHAR(100) NOT NULL,          -- "North Tower Cam", "East Valley View"
    
    -- Camera Position (relative to node)
    direction_degrees INTEGER,                   -- 0-359, North = 0
    tilt_degrees INTEGER,                        -- -90 to +90, 0 = horizontal
    zoom_level DECIMAL(4,2),                     -- 1.00 to 50.00
    field_of_view_degrees INTEGER,               -- Horizontal FOV
    
    -- Camera Specifications
    resolution_width INTEGER DEFAULT 1920,
    resolution_height INTEGER DEFAULT 1080,
    max_fps INTEGER DEFAULT 30,
    night_vision_capable BOOLEAN DEFAULT FALSE,
    ptz_capable BOOLEAN DEFAULT FALSE,           -- Pan/Tilt/Zoom capability
    
    -- Camera Status
    status ENUM('active', 'inactive', 'maintenance', 'error') DEFAULT 'active',
    last_image_timestamp TIMESTAMP,
    image_quality_score DECIMAL(3,2),           -- 0.00-1.00, recent average
    uptime_percent DECIMAL(5,2),                -- 0.00-100.00
    
    -- Detection Configuration
    fire_detection_enabled BOOLEAN DEFAULT TRUE,
    smoke_detection_enabled BOOLEAN DEFAULT TRUE,
    motion_detection_enabled BOOLEAN DEFAULT TRUE,
    vehicle_detection_enabled BOOLEAN DEFAULT FALSE,
    people_detection_enabled BOOLEAN DEFAULT FALSE,
    
    -- Alert Settings
    alert_threshold_confidence DECIMAL(3,2) DEFAULT 0.70, -- Min confidence for alerts
    cooldown_minutes INTEGER DEFAULT 5,         -- Minutes between alerts
    priority_multiplier DECIMAL(3,2) DEFAULT 1.00, -- Alert priority adjustment
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Performance Indexes
    INDEX idx_node_id (node_id),
    INDEX idx_status_node (status, node_id),
    INDEX idx_last_image (last_image_timestamp DESC),
    INDEX idx_quality (image_quality_score DESC),
    FOREIGN KEY (node_id) REFERENCES monitoring_nodes(node_id) ON DELETE CASCADE
);

-- Add node references to existing tables
ALTER TABLE executions ADD COLUMN node_id VARCHAR(50);
ALTER TABLE executions ADD COLUMN camera_id VARCHAR(50);
ALTER TABLE execution_analysis ADD COLUMN node_id VARCHAR(50);

-- Add indexes for node-based queries
ALTER TABLE executions ADD INDEX idx_node_timestamp (node_id, execution_timestamp DESC);
ALTER TABLE executions ADD INDEX idx_camera_timestamp (camera_id, execution_timestamp DESC);
ALTER TABLE execution_analysis ADD INDEX idx_node_risk (node_id, risk_level);

-- Foreign key constraints for node references
ALTER TABLE executions ADD FOREIGN KEY (node_id) REFERENCES monitoring_nodes(node_id);
ALTER TABLE executions ADD FOREIGN KEY (camera_id) REFERENCES node_cameras(camera_id);
ALTER TABLE execution_analysis ADD FOREIGN KEY (node_id) REFERENCES monitoring_nodes(node_id);

-- Regional coverage statistics view
CREATE OR REPLACE VIEW regional_coverage_stats AS
SELECT 
    mn.region,
    COUNT(mn.node_id) as total_nodes,
    COUNT(nc.camera_id) as total_cameras,
    COUNT(CASE WHEN mn.status = 'active' THEN 1 END) as active_nodes,
    COUNT(CASE WHEN nc.status = 'active' THEN 1 END) as active_cameras,
    AVG(nc.image_quality_score) as avg_image_quality,
    AVG(nc.uptime_percent) as avg_uptime_percent,
    SUM(mn.coverage_radius_meters) / COUNT(mn.node_id) as avg_coverage_radius
FROM monitoring_nodes mn
LEFT JOIN node_cameras nc ON mn.node_id = nc.node_id
GROUP BY mn.region
ORDER BY mn.region;

-- Node performance statistics view
CREATE OR REPLACE VIEW node_performance_stats AS
SELECT 
    mn.node_id,
    mn.node_name,
    mn.region,
    mn.status as node_status,
    COUNT(nc.camera_id) as camera_count,
    COUNT(CASE WHEN nc.status = 'active' THEN 1 END) as active_cameras,
    AVG(nc.image_quality_score) as avg_image_quality,
    AVG(nc.uptime_percent) as avg_uptime,
    COUNT(e.id) as total_executions_24h,
    COUNT(CASE WHEN ea.risk_level IN ('high', 'critical') THEN 1 END) as high_risk_detections_24h,
    MAX(e.execution_timestamp) as last_detection
FROM monitoring_nodes mn
LEFT JOIN node_cameras nc ON mn.node_id = nc.node_id
LEFT JOIN executions e ON mn.node_id = e.node_id 
    AND e.execution_timestamp >= NOW() - INTERVAL '24 HOURS'
LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
GROUP BY mn.node_id, mn.node_name, mn.region, mn.status
ORDER BY high_risk_detections_24h DESC, total_executions_24h DESC;

-- Insert sample monitoring nodes for testing
INSERT INTO monitoring_nodes (node_id, node_name, region, latitude, longitude, coverage_radius_meters, status) VALUES
('NODE_001', 'Córdoba Centro', 'Córdoba', -31.4135000, -64.1811000, 8000, 'active'),
('NODE_002', 'Villa Carlos Paz', 'Córdoba', -31.4241000, -64.4987000, 6000, 'active'),
('NODE_003', 'La Calera', 'Córdoba', -31.3476000, -64.3316000, 5000, 'active'),
('NODE_004', 'Sierras Chicas Norte', 'Córdoba', -31.2500000, -64.2500000, 12000, 'active'),
('NODE_005', 'Valle de Punilla', 'Córdoba', -31.4000000, -64.5000000, 15000, 'maintenance'),
('NODE_006', 'Mendoza Este', 'Mendoza', -32.8895000, -68.8458000, 10000, 'active'),
('NODE_007', 'San Rafael', 'Mendoza', -34.6177000, -68.3301000, 8000, 'testing');

-- Insert sample cameras for testing
INSERT INTO node_cameras (camera_id, node_id, camera_name, direction_degrees, resolution_width, resolution_height, status) VALUES
('CAM_NODE001_01', 'NODE_001', 'Centro Norte', 0, 1920, 1080, 'active'),
('CAM_NODE001_02', 'NODE_001', 'Centro Este', 90, 1920, 1080, 'active'),
('CAM_NODE001_03', 'NODE_001', 'Centro Sur', 180, 1920, 1080, 'active'),
('CAM_NODE001_04', 'NODE_001', 'Centro Oeste', 270, 1920, 1080, 'active'),
('CAM_NODE002_01', 'NODE_002', 'VCP Panorámica', 45, 2560, 1440, 'active'),
('CAM_NODE002_02', 'NODE_002', 'VCP Valle', 180, 1920, 1080, 'active'),
('CAM_NODE003_01', 'NODE_003', 'La Calera Principal', 0, 1920, 1080, 'active'),
('CAM_NODE004_01', 'NODE_004', 'Sierras Norte Alto', 315, 1920, 1080, 'active'),
('CAM_NODE004_02', 'NODE_004', 'Sierras Norte Bajo', 135, 1920, 1080, 'active'),
('CAM_NODE006_01', 'NODE_006', 'Mendoza Este Panorámica', 0, 2560, 1440, 'active');

-- ============================================================================
-- DATABASE OPTIMIZATION
-- ============================================================================

-- Enable query performance monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Set optimal configuration for dashboard workload
-- These would be set in postgresql.conf
/*
shared_preload_libraries = 'pg_stat_statements'
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 64MB
maintenance_work_mem = 256MB
max_connections = 100
random_page_cost = 1.1
effective_io_concurrency = 200
*/