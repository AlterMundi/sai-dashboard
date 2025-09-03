-- PostgreSQL Node Tables for SAI Dashboard
-- Create monitoring_nodes and node_cameras tables in existing n8n database

-- Monitoring nodes (physical locations with multiple cameras)
CREATE TABLE IF NOT EXISTS monitoring_nodes (
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
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'offline', 'testing')),
    installation_date DATE,
    last_maintenance DATE,
    next_maintenance_due DATE,
    
    -- Contact Information
    contact_person VARCHAR(100),
    contact_phone VARCHAR(20),
    contact_email VARCHAR(100),
    
    -- Technical Specifications
    power_source VARCHAR(20) DEFAULT 'grid' CHECK (power_source IN ('grid', 'solar', 'battery', 'hybrid')),
    connectivity VARCHAR(20) DEFAULT 'fiber' CHECK (connectivity IN ('fiber', 'cellular', 'satellite', 'wifi')),
    backup_power_hours INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cameras associated with monitoring nodes
CREATE TABLE IF NOT EXISTS node_cameras (
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
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'error')),
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Key Constraint
    CONSTRAINT fk_node_cameras_node_id FOREIGN KEY (node_id) REFERENCES monitoring_nodes(node_id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_monitoring_nodes_region ON monitoring_nodes(region);
CREATE INDEX IF NOT EXISTS idx_monitoring_nodes_status_region ON monitoring_nodes(status, region);
CREATE INDEX IF NOT EXISTS idx_monitoring_nodes_location ON monitoring_nodes(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_monitoring_nodes_coverage ON monitoring_nodes(coverage_radius_meters);
CREATE INDEX IF NOT EXISTS idx_monitoring_nodes_next_maintenance ON monitoring_nodes(next_maintenance_due);

CREATE INDEX IF NOT EXISTS idx_node_cameras_node_id ON node_cameras(node_id);
CREATE INDEX IF NOT EXISTS idx_node_cameras_status_node ON node_cameras(status, node_id);
CREATE INDEX IF NOT EXISTS idx_node_cameras_last_image ON node_cameras(last_image_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_node_cameras_quality ON node_cameras(image_quality_score DESC);

-- Add sample data for testing
INSERT INTO monitoring_nodes (node_id, node_name, region, latitude, longitude, coverage_radius_meters, status) 
VALUES 
    ('NODE_001', 'Córdoba Centro', 'Córdoba', -31.4135000, -64.1811000, 5000, 'active'),
    ('NODE_002', 'Villa Carlos Paz', 'Córdoba', -31.4240000, -64.4970000, 3000, 'active'),
    ('NODE_003', 'La Falda Norte', 'Córdoba', -31.0890000, -64.4830000, 4000, 'maintenance'),
    ('NODE_004', 'Capilla del Monte', 'Córdoba', -30.8590000, -64.5280000, 6000, 'active'),
    ('NODE_005', 'Mina Clavero', 'Córdoba', -31.7200000, -65.0100000, 4500, 'active')
ON CONFLICT (node_id) DO NOTHING;

INSERT INTO node_cameras (camera_id, node_id, camera_name, direction_degrees, resolution_width, resolution_height, status)
VALUES 
    ('CAM_NODE001_01', 'NODE_001', 'Centro Norte', 0, 1920, 1080, 'active'),
    ('CAM_NODE001_02', 'NODE_001', 'Centro Este', 90, 1920, 1080, 'active'),
    ('CAM_NODE002_01', 'NODE_002', 'Carlos Paz Sur', 180, 2560, 1440, 'active'),
    ('CAM_NODE002_02', 'NODE_002', 'Carlos Paz Lago', 270, 1920, 1080, 'active'),
    ('CAM_NODE003_01', 'NODE_003', 'La Falda Panorámica', 45, 1920, 1080, 'maintenance'),
    ('CAM_NODE004_01', 'NODE_004', 'Capilla Valle', 135, 2560, 1440, 'active'),
    ('CAM_NODE004_02', 'NODE_004', 'Capilla Cerro', 315, 1920, 1080, 'active'),
    ('CAM_NODE005_01', 'NODE_005', 'Mina Clavero Vista', 90, 1920, 1080, 'active')
ON CONFLICT (camera_id) DO NOTHING;