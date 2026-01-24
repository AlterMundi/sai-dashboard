-- Migration 008: Convert to Relative Image Paths
-- Date: 2025-01-24
--
-- Problem: Absolute paths stored in execution_images table are non-portable
-- Solution: Store relative paths, resolve with IMAGE_BASE_PATH at runtime
--
-- Before: /mnt/raid1/n8n-backup/images/original/410/410000.jpg
-- After:  original/410/410000.jpg
--
-- The application will prepend IMAGE_BASE_PATH at runtime:
--   IMAGE_BASE_PATH + relative_path = full filesystem path

-- ============================================================================
-- Phase 1: Convert existing absolute paths to relative paths
-- ============================================================================

-- Convert original_path: remove any known base path prefixes
UPDATE execution_images
SET original_path =
  CASE
    -- Production path
    WHEN original_path LIKE '/mnt/raid1/n8n-backup/images/%'
      THEN SUBSTRING(original_path FROM '/mnt/raid1/n8n-backup/images/(.*)$')
    -- Development path (./image-cache/)
    WHEN original_path LIKE './image-cache/%'
      THEN SUBSTRING(original_path FROM './image-cache/(.*)$')
    -- Already relative (no leading /)
    WHEN original_path NOT LIKE '/%'
      THEN original_path
    -- Unknown absolute path - extract from last known structure
    ELSE original_path
  END
WHERE original_path IS NOT NULL;

-- Convert thumbnail_path
UPDATE execution_images
SET thumbnail_path =
  CASE
    WHEN thumbnail_path LIKE '/mnt/raid1/n8n-backup/images/%'
      THEN SUBSTRING(thumbnail_path FROM '/mnt/raid1/n8n-backup/images/(.*)$')
    WHEN thumbnail_path LIKE './image-cache/%'
      THEN SUBSTRING(thumbnail_path FROM './image-cache/(.*)$')
    WHEN thumbnail_path NOT LIKE '/%'
      THEN thumbnail_path
    ELSE thumbnail_path
  END
WHERE thumbnail_path IS NOT NULL;

-- Convert cached_path (webp)
UPDATE execution_images
SET cached_path =
  CASE
    WHEN cached_path LIKE '/mnt/raid1/n8n-backup/images/%'
      THEN SUBSTRING(cached_path FROM '/mnt/raid1/n8n-backup/images/(.*)$')
    WHEN cached_path LIKE './image-cache/%'
      THEN SUBSTRING(cached_path FROM './image-cache/(.*)$')
    WHEN cached_path NOT LIKE '/%'
      THEN cached_path
    ELSE cached_path
  END
WHERE cached_path IS NOT NULL;

-- ============================================================================
-- Phase 2: Add CHECK constraint to prevent absolute paths in future
-- ============================================================================

-- Ensure paths don't start with / (absolute) or contain base path prefixes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_relative_original_path'
  ) THEN
    ALTER TABLE execution_images
      ADD CONSTRAINT check_relative_original_path
      CHECK (original_path IS NULL OR (
        original_path NOT LIKE '/%' AND
        original_path NOT LIKE './%'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_relative_thumbnail_path'
  ) THEN
    ALTER TABLE execution_images
      ADD CONSTRAINT check_relative_thumbnail_path
      CHECK (thumbnail_path IS NULL OR (
        thumbnail_path NOT LIKE '/%' AND
        thumbnail_path NOT LIKE './%'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_relative_cached_path'
  ) THEN
    ALTER TABLE execution_images
      ADD CONSTRAINT check_relative_cached_path
      CHECK (cached_path IS NULL OR (
        cached_path NOT LIKE '/%' AND
        cached_path NOT LIKE './%'
      ));
  END IF;
END $$;

-- ============================================================================
-- Phase 3: Add comments documenting the path strategy
-- ============================================================================

COMMENT ON COLUMN execution_images.original_path IS
  'Relative path to original JPEG image. Resolve with IMAGE_BASE_PATH config. Format: original/{partition}/{execution_id}.jpg';

COMMENT ON COLUMN execution_images.thumbnail_path IS
  'Relative path to thumbnail WebP image. Resolve with IMAGE_BASE_PATH config. Format: thumb/{partition}/{execution_id}.webp';

COMMENT ON COLUMN execution_images.cached_path IS
  'Relative path to high-quality WebP image. Resolve with IMAGE_BASE_PATH config. Format: webp/{partition}/{execution_id}.webp';

COMMENT ON TABLE execution_images IS
  'Image metadata and relative paths for execution images. All paths are relative to IMAGE_BASE_PATH environment variable. Never store absolute filesystem paths.';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  absolute_count INTEGER;
  relative_count INTEGER;
BEGIN
  -- Count any remaining absolute paths
  SELECT COUNT(*) INTO absolute_count
  FROM execution_images
  WHERE original_path LIKE '/%'
     OR thumbnail_path LIKE '/%'
     OR cached_path LIKE '/%';

  -- Count relative paths
  SELECT COUNT(*) INTO relative_count
  FROM execution_images
  WHERE original_path IS NOT NULL
    AND original_path NOT LIKE '/%';

  RAISE NOTICE '============================================';
  RAISE NOTICE '✅ Migration 008 completed:';
  RAISE NOTICE '   - Relative paths: %', relative_count;
  RAISE NOTICE '   - Remaining absolute paths: % (should be 0)', absolute_count;
  RAISE NOTICE '   - CHECK constraints added for path validation';
  RAISE NOTICE '============================================';

  IF absolute_count > 0 THEN
    RAISE WARNING '⚠️ Some absolute paths remain - manual review needed';
  END IF;
END $$;
