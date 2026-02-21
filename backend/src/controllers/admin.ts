import { Request, Response } from 'express';
import { asyncHandler } from '@/utils';
import { logger } from '@/utils/logger';
import {
  listPendingUsers,
  approvePendingUser,
  rejectPendingUser,
} from '@/services/pending-users-service';
import { assignRole } from '@/services/zitadel-mgmt';
import { DashboardRole } from '@/types';

const VALID_ROLES: DashboardRole[] = ['SAI_ADMIN', 'SAI_OPERATOR', 'SAI_VIEWER'];

/**
 * GET /auth/admin/pending
 * Returns all users with status = 'pending'.
 */
export const getPendingUsers = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    const users = await listPendingUsers();
    res.json({ data: users });
  }
);

/**
 * POST /auth/admin/users/:sub/approve
 * Body: { role: 'SAI_VIEWER' | 'SAI_OPERATOR' | 'SAI_ADMIN' }
 * Assigns role in Zitadel, then marks user as approved in DB.
 */
export const approveUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sub } = req.params;
    const { role } = req.body as { role: DashboardRole };

    if (!role || !VALID_ROLES.includes(role)) {
      res.status(400).json({
        error: { message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, code: 'INVALID_ROLE' }
      });
      return;
    }

    await assignRole(sub, role);
    await approvePendingUser(sub);

    logger.info('Admin: user approved', {
      sub,
      role,
      approvedBy: req.session?.userId,
    });

    res.json({ data: { approved: true, sub, role } });
  }
);

/**
 * POST /auth/admin/users/:sub/reject
 * Marks user as rejected — no Zitadel changes needed.
 */
export const rejectUser = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sub } = req.params;

    await rejectPendingUser(sub);

    logger.info('Admin: user rejected', {
      sub,
      rejectedBy: req.session?.userId,
    });

    res.json({ data: { rejected: true, sub } });
  }
);
