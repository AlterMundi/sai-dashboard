-- Expert Users Table Migration
-- Creates user management for expert review system
--
-- Usage: psql -d n8n -f 002_create_expert_users_table.sql
-- Rollback: DROP TABLE expert_users CASCADE;

BEGIN;

-- Create expert users table
CREATE TABLE IF NOT EXISTS expert_users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    certification VARCHAR(50),
    specialization VARCHAR(50) NOT NULL DEFAULT 'general',
    experience_years INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    max_caseload INTEGER DEFAULT 20,
    accuracy_score DECIMAL(3,2) DEFAULT 0.85,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Validation constraints
    CONSTRAINT valid_experience_years CHECK (experience_years >= 0 AND experience_years <= 50),
    CONSTRAINT valid_max_caseload CHECK (max_caseload > 0 AND max_caseload <= 100),
    CONSTRAINT valid_accuracy_score CHECK (accuracy_score >= 0 AND accuracy_score <= 1),
    CONSTRAINT valid_specialization CHECK (specialization IN ('general', 'wildfire', 'industrial', 'residential', 'urban'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_expert_users_active ON expert_users(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_expert_users_specialization ON expert_users(specialization);
CREATE INDEX IF NOT EXISTS idx_expert_users_accuracy ON expert_users(accuracy_score);

-- Insert sample expert users for testing
INSERT INTO expert_users (id, name, email, certification, specialization, experience_years, max_caseload, accuracy_score) VALUES
('expert_001', 'Dr. Sarah Johnson', 'sarah.johnson@example.com', 'Fire Marshal', 'wildfire', 15, 25, 0.92),
('expert_002', 'Michael Chen', 'michael.chen@example.com', 'Certified Fire Inspector', 'industrial', 8, 20, 0.88),
('expert_003', 'Dr. Maria Rodriguez', 'maria.rodriguez@example.com', 'Fire Safety Engineer', 'residential', 12, 30, 0.90),
('expert_004', 'James Thompson', 'james.thompson@example.com', 'Fire Captain', 'general', 20, 15, 0.94),
('expert_005', 'Dr. Lisa Park', 'lisa.park@example.com', 'Forest Fire Specialist', 'wildfire', 10, 20, 0.89),
('admin_001', 'System Administrator', 'admin@example.com', 'System Admin', 'general', 5, 50, 0.95)
ON CONFLICT (id) DO NOTHING;

-- Grant permissions
GRANT SELECT ON expert_users TO sai_dashboard_readonly;

-- Add comment
COMMENT ON TABLE expert_users IS 'Expert users for fire detection analysis review system';

COMMIT;

\echo 'Expert users table created successfully!'
\echo 'Sample users: 6 experts added for testing';