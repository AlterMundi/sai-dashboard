-- Migration 013: Access Queue — pending_users table
-- Date: 2026-02-21
-- New users who log in without a Zitadel role are held here until an SAI_ADMIN approves them.

CREATE TABLE IF NOT EXISTS pending_users (
  id              SERIAL PRIMARY KEY,
  zitadel_sub     TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count   INT NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending'
  -- status values: 'pending' | 'approved' | 'rejected'
);

-- Index for fast listing of pending approvals (most common admin query)
CREATE INDEX IF NOT EXISTS idx_pending_users_status
  ON pending_users(status)
  WHERE status = 'pending';
