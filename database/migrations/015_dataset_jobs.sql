-- 015_dataset_jobs.sql
-- Async job tracking for dataset image copy operations.
-- Datasets themselves live on the filesystem; this table only tracks in-flight work.

CREATE TABLE IF NOT EXISTS dataset_jobs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_name   VARCHAR     NOT NULL,
  split          VARCHAR     NOT NULL CHECK (split IN ('train', 'val')),
  execution_ids  BIGINT[]    NOT NULL,
  status         VARCHAR     NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','processing','completed','failed')),
  progress       INTEGER     NOT NULL DEFAULT 0,
  total          INTEGER     NOT NULL,
  created_by     VARCHAR,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  error          TEXT
);

CREATE INDEX idx_dataset_jobs_status   ON dataset_jobs(status);
CREATE INDEX idx_dataset_jobs_dataset  ON dataset_jobs(dataset_name);
CREATE INDEX idx_dataset_jobs_created  ON dataset_jobs(created_at DESC);

-- Grant access to the application user (sai_user on production)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sai_user') THEN
    EXECUTE 'GRANT ALL ON dataset_jobs TO sai_user';
  END IF;
END $$;
