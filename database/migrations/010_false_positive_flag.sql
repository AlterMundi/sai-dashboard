-- Migration 010: Add false positive flagging
-- Date: 2025-02-03
-- Purpose: Allow users to mark detections as false positives for training data quality
--
-- Changes:
-- 1. Add is_false_positive boolean column to execution_analysis
-- 2. Add false_positive_reason for optional notes
-- 3. Add marked_false_positive_at timestamp
-- 4. Create partial index for efficient false positive queries

-- ============================================================================
-- Phase 1: Add false positive columns to execution_analysis
-- ============================================================================

ALTER TABLE execution_analysis
  ADD COLUMN IF NOT EXISTS is_false_positive BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS false_positive_reason VARCHAR(255),
  ADD COLUMN IF NOT EXISTS marked_false_positive_at TIMESTAMPTZ;

-- ============================================================================
-- Phase 2: Create partial index for false positive queries
-- ============================================================================
-- Efficient index only for rows marked as false positives

CREATE INDEX IF NOT EXISTS idx_analysis_false_positives
ON execution_analysis(execution_id DESC)
WHERE is_false_positive = true;

COMMENT ON INDEX idx_analysis_false_positives IS
  'Partial index for efficiently querying false positive detections';

-- ============================================================================
-- Phase 3: Add comments for documentation
-- ============================================================================

COMMENT ON COLUMN execution_analysis.is_false_positive IS
  'Flag indicating this detection was marked as incorrect by a human reviewer';
COMMENT ON COLUMN execution_analysis.false_positive_reason IS
  'Optional reason why the detection was marked as false positive';
COMMENT ON COLUMN execution_analysis.marked_false_positive_at IS
  'Timestamp when the false positive flag was set';

-- ============================================================================
-- Phase 4: Update statistics
-- ============================================================================

ANALYZE execution_analysis;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  fp_column_exists BOOLEAN;
  fp_index_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'execution_analysis'
    AND column_name = 'is_false_positive'
  ) INTO fp_column_exists;

  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_analysis_false_positives'
  ) INTO fp_index_exists;

  RAISE NOTICE '============================================';
  RAISE NOTICE 'Migration 010 completed:';
  RAISE NOTICE '   - is_false_positive column: %', fp_column_exists;
  RAISE NOTICE '   - False positives index: %', fp_index_exists;
  RAISE NOTICE '============================================';
END $$;

-- ============================================================================
-- Rollback instructions
-- ============================================================================
--
-- DROP INDEX IF EXISTS idx_analysis_false_positives;
-- ALTER TABLE execution_analysis DROP COLUMN IF EXISTS marked_false_positive_at;
-- ALTER TABLE execution_analysis DROP COLUMN IF EXISTS false_positive_reason;
-- ALTER TABLE execution_analysis DROP COLUMN IF EXISTS is_false_positive;
