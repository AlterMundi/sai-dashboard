/**
 * Service for managing the pending_users access queue.
 *
 * Users who authenticate via Zitadel but are not yet approved land in
 * the pending_users table. Admins can then approve or reject them.
 */

import { PendingUser } from '@/types';
import { logger } from '@/utils/logger';
import { dualDb } from '@/database/dual-pool';

function rowToUser(row: any): PendingUser {
  return {
    id: row.id,
    zitadelSub: row.zitadel_sub,
    email: row.email,
    firstSeenAt: row.first_seen_at,
    lastAttemptAt: row.last_attempt_at,
    attemptCount: row.attempt_count,
    status: row.status,
  };
}

/**
 * Insert or update a pending user record.
 *
 * On first login the row is created with status='pending'.
 * On subsequent logins the attempt_count and last_attempt_at are bumped,
 * and the stored email is refreshed in case it changed in Zitadel.
 */
export async function upsertPendingUser(sub: string, email: string): Promise<void> {
  await dualDb.query(
    `INSERT INTO pending_users (zitadel_sub, email)
     VALUES ($1, $2)
     ON CONFLICT (zitadel_sub) DO UPDATE
       SET last_attempt_at = NOW(),
           attempt_count = pending_users.attempt_count + 1,
           email = EXCLUDED.email`,
    [sub, email]
  );
  logger.info('Pending user upserted', { sub, email });
}

/**
 * Return all users currently in the pending state, newest first.
 */
export async function listPendingUsers(): Promise<PendingUser[]> {
  const rows = await dualDb.query(
    `SELECT * FROM pending_users WHERE status = 'pending' ORDER BY first_seen_at DESC`
  );
  return rows.map(rowToUser);
}

/**
 * Return all users regardless of status (admin view).
 */
export async function listAllPendingUsers(): Promise<PendingUser[]> {
  const rows = await dualDb.query(
    `SELECT * FROM pending_users ORDER BY first_seen_at DESC`
  );
  return rows.map(rowToUser);
}

/**
 * Look up a single record by Zitadel subject claim.
 */
export async function getPendingUserBySub(sub: string): Promise<PendingUser | null> {
  const rows = await dualDb.query(
    `SELECT * FROM pending_users WHERE zitadel_sub = $1`,
    [sub]
  );
  return rows.length > 0 ? rowToUser(rows[0]) : null;
}

/**
 * Mark a pending user as approved.
 */
export async function approvePendingUser(sub: string): Promise<void> {
  await dualDb.query(
    `UPDATE pending_users SET status = 'approved' WHERE zitadel_sub = $1`,
    [sub]
  );
  logger.info('Pending user approved', { sub });
}

/**
 * Mark a pending user as rejected.
 */
export async function rejectPendingUser(sub: string): Promise<void> {
  await dualDb.query(
    `UPDATE pending_users SET status = 'rejected' WHERE zitadel_sub = $1`,
    [sub]
  );
  logger.info('Pending user rejected', { sub });
}
