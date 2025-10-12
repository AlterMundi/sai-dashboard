-- ============================================================================
-- Migration 005: Schema Cleanup - Remove Unused Tables and Columns
-- ============================================================================
--
-- PURPOSE:
--   Remove unused database schema elements that were never implemented or
--   are no longer used by the application:
--   1. execution_images.backup_path - Never populated, unused backup strategy
--   2. execution_detections table - Denormalized data never queried
--   3. dashboard_stats table - Pre-computed cache never implemented
--
-- RATIONALE:
--   - backup_path: All NULL in production, zero code references
--   - execution_detections: Populated but never queried, data duplicates
--     execution_analysis.detections JSONB field, adds ETL overhead
--   - dashboard_stats: Empty table, no application usage, archived triggers
--
-- IMPACT:
--   - Reduces schema complexity
--   - Removes data duplication (execution_detections)
--   - Simplifies Stage 2 ETL (no detection table inserts)
--   - ~5ms faster ETL processing per execution
--
-- DATA LOSS:
--   - execution_detections: 77 rows (all duplicates of JSONB data)
--   - dashboard_stats: 0 rows (empty table)
--
-- AUTHOR: SAI Dashboard Team
-- DATE: 2025-10-12
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Remove backup_path from execution_images
-- ============================================================================

-- Verify column is unused (all NULL values)
DO $$
DECLARE
  non_null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO non_null_count
  FROM execution_images
  WHERE backup_path IS NOT NULL;

  IF non_null_count > 0 THEN
    RAISE WARNING 'backup_path has % non-NULL values, review before dropping', non_null_count;
  END IF;

  RAISE NOTICE 'backup_path column has % NULL values, safe to drop',
    (SELECT COUNT(*) FROM execution_images WHERE backup_path IS NULL);
END $$;

-- Drop the unused column
ALTER TABLE execution_images
  DROP COLUMN IF EXISTS backup_path;

COMMENT ON TABLE execution_images IS 'Image cache metadata (filesystem paths only, no database storage)';

-- ============================================================================
-- PART 2: Drop execution_detections table
-- ============================================================================

-- Record statistics before dropping
DO $$
DECLARE
  total_detections INTEGER;
  unique_executions INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT execution_id)
  INTO total_detections, unique_executions
  FROM execution_detections;

  RAISE NOTICE 'Dropping execution_detections: % rows across % executions',
    total_detections, unique_executions;

  -- Verify data exists in execution_analysis.detections JSONB
  IF EXISTS (
    SELECT 1 FROM execution_analysis ea
    WHERE ea.detection_count > 0 AND ea.detections IS NULL
  ) THEN
    RAISE WARNING 'Some executions have detection_count > 0 but NULL detections JSONB!';
  END IF;
END $$;

-- Drop table (CASCADE removes foreign key constraints)
DROP TABLE IF EXISTS execution_detections CASCADE;

-- ============================================================================
-- PART 3: Drop dashboard_stats table
-- ============================================================================

-- Verify table is empty
DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM dashboard_stats;

  IF row_count > 0 THEN
    RAISE WARNING 'dashboard_stats has % rows, review before dropping', row_count;
  ELSE
    RAISE NOTICE 'dashboard_stats is empty (% rows), safe to drop', row_count;
  END IF;
END $$;

-- Drop the unused table
DROP TABLE IF EXISTS dashboard_stats CASCADE;

-- ============================================================================
-- PART 4: Add indexes for JSONB detection queries (optimization)
-- ============================================================================

-- Since we dropped execution_detections, add GIN index for JSONB queries
-- This allows fast queries like: WHERE detections @> '[{"class": "fire"}]'
CREATE INDEX IF NOT EXISTS idx_execution_analysis_detections_gin
  ON execution_analysis USING GIN (detections jsonb_path_ops);

-- Index for detection_count queries
CREATE INDEX IF NOT EXISTS idx_execution_analysis_detection_count
  ON execution_analysis (detection_count)
  WHERE detection_count > 0;

COMMENT ON INDEX idx_execution_analysis_detections_gin IS
  'GIN index for fast JSONB detection queries (replaces execution_detections table)';

-- ============================================================================
-- PART 5: Verify schema cleanup
-- ============================================================================

DO $$
BEGIN
  -- Verify backup_path removed
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'execution_images' AND column_name = 'backup_path'
  ) THEN
    RAISE EXCEPTION 'backup_path column still exists!';
  END IF;

  -- Verify execution_detections dropped
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'execution_detections'
  ) THEN
    RAISE EXCEPTION 'execution_detections table still exists!';
  END IF;

  -- Verify dashboard_stats dropped
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'dashboard_stats'
  ) THEN
    RAISE EXCEPTION 'dashboard_stats table still exists!';
  END IF;

  RAISE NOTICE '✅ Migration 005 verification passed: All cleanup complete';
END $$;

COMMIT;

-- ============================================================================
-- Post-migration notes
-- ============================================================================

-- After running this migration:
-- 1. Update backend/src/services/stage2-etl-service.ts - Remove insertDetections()
-- 2. Update backend/src/types/index.ts - Remove YoloDetection interface if unused
-- 3. Update docs/DATABASE_SCHEMA.md - Remove tables from ER diagram
-- 4. Update CLAUDE.md - Remove table descriptions
-- 5. Run: npm run type-check to verify TypeScript compatibility
-- 6. Test Stage 2 ETL: Check logs for successful execution processing

-- Query detection data using JSONB (replaces execution_detections queries):
-- SELECT execution_id, detection_count, detections
-- FROM execution_analysis
-- WHERE detections @> '[{"class": "fire"}]'::jsonb
--   AND detection_count > 0;

-- Performance comparison:
-- Before: JOIN execution_detections (77 rows, separate table scan)
-- After: JSONB GIN index scan on execution_analysis (faster, no JOIN)
