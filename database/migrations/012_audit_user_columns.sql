-- Migration 012: Add audit user columns for false-positive tracking
-- These columns record who marked an execution as a false positive (OIDC user identity)

ALTER TABLE execution_analysis
  ADD COLUMN IF NOT EXISTS marked_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS marked_by_email    TEXT;

-- Index for audit queries by user
CREATE INDEX IF NOT EXISTS idx_execution_analysis_marked_by_user
  ON execution_analysis (marked_by_user_id)
  WHERE marked_by_user_id IS NOT NULL;

COMMENT ON COLUMN execution_analysis.marked_by_user_id IS
  'Zitadel OIDC sub of the user who marked as false-positive';
COMMENT ON COLUMN execution_analysis.marked_by_email IS
  'Email of the user who marked as false-positive (denormalized for readability)';
