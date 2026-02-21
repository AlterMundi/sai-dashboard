# Access Queue + Role Rename (SAI_*) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename roles to SAI_ADMIN/SAI_OPERATOR/SAI_VIEWER and implement a pending-approval access queue with Zitadel Management API role assignment.

**Architecture:** Role rename is a string find-and-replace across 6 files. The access queue adds a `pending_users` DB table, a Zitadel Management API client (client_credentials flow), a backend admin controller, a frontend PendingApproval page, and an AdminPanel component gated to SAI_ADMIN.

**Tech Stack:** TypeScript, Express, PostgreSQL (pg pool), React 18, Zitadel Management API v1, openid-client already installed.

**Design doc:** `docs/plans/2026-02-21-access-queue-role-rename-design.md`

---

## Pre-requisites (manual — must be done before Task 4)

In Zitadel (`https://auth.altermundi.net`):
1. Rename project roles: `ADMIN→SAI_ADMIN`, `OPERATOR→SAI_OPERATOR`, `VIEWER→SAI_VIEWER`
2. Re-assign existing users to the new role names
3. Create a **Service Account** (type: Machine) in the org
4. Assign it **Manager** role in the SAI Dashboard project (Projects → SAI Dashboard → Authorizations)
5. Create **Client Credentials** for the service account (Client ID + Secret)
6. Note down: `ZITADEL_PROJECT_ID` (visible in Projects → SAI Dashboard → General, field "Resource ID")

---

## Task 1: Role rename across codebase

**Files:**
- Modify: `backend/src/types/index.ts`
- Modify: `backend/src/auth/roles.ts`
- Modify: `backend/src/middleware/auth.ts`
- Modify: `backend/src/routes/index.ts`
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/hooks/useAuth.ts`

**Step 1: Update backend DashboardRole type**

In `backend/src/types/index.ts`, line ~149:
```typescript
// Before:
export type DashboardRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

// After:
export type DashboardRole = 'SAI_ADMIN' | 'SAI_OPERATOR' | 'SAI_VIEWER';
```

**Step 2: Update roles.ts extraction logic**

In `backend/src/auth/roles.ts`, replace the three includes/return lines:
```typescript
// Before:
if (roleNames.includes('ADMIN')) return 'ADMIN';
if (roleNames.includes('OPERATOR')) return 'OPERATOR';
if (roleNames.includes('VIEWER')) return 'VIEWER';

// After:
if (roleNames.includes('SAI_ADMIN')) return 'SAI_ADMIN';
if (roleNames.includes('SAI_OPERATOR')) return 'SAI_OPERATOR';
if (roleNames.includes('SAI_VIEWER')) return 'SAI_VIEWER';
```

Also update the comment on line 9:
```typescript
// Before: { "ADMIN": { "<orgId>": "<orgName>" } }
// After:  { "SAI_ADMIN": { "<orgId>": "<orgName>" } }
```

**Step 3: Update middleware defaults**

In `backend/src/middleware/auth.ts`, replace all 4 occurrences of `'VIEWER'` default:
```typescript
// Every line like:
role: decoded.role || 'VIEWER',
// becomes:
role: decoded.role || 'SAI_VIEWER',
```

**Step 4: Update requireRole calls in routes**

In `backend/src/routes/index.ts`:
```typescript
// Line ~182:
requireRole('SAI_ADMIN', 'SAI_OPERATOR')   // was ADMIN, OPERATOR
// Line ~187:
requireRole('SAI_ADMIN')                    // was ADMIN
// Line ~190:
requireRole('SAI_ADMIN', 'SAI_OPERATOR')   // was ADMIN, OPERATOR
// Line ~242:
requireRole('SAI_ADMIN', 'SAI_OPERATOR')   // was ADMIN, OPERATOR
// Line ~296:
requireRole('SAI_ADMIN', 'SAI_OPERATOR')   // was ADMIN, OPERATOR
```

**Step 5: Update frontend DashboardRole type**

In `frontend/src/types/api.ts`, line ~10:
```typescript
// Before:
export type DashboardRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';

// After:
export type DashboardRole = 'SAI_ADMIN' | 'SAI_OPERATOR' | 'SAI_VIEWER';
```

**Step 6: Update frontend default in useAuth**

In `frontend/src/hooks/useAuth.ts`, line ~116:
```typescript
// Before:
? { id: userId, email: userEmail || '', role: userRole || 'VIEWER' }

// After:
? { id: userId, email: userEmail || '', role: userRole || 'SAI_VIEWER' }
```

**Step 7: Update RoleGate usages (if any hardcoded role strings exist in components)**

Search for any remaining hardcoded role strings:
```bash
grep -rn "'ADMIN'\|'OPERATOR'\|'VIEWER'" frontend/src/ backend/src/
```
Fix any remaining occurrences.

**Step 8: Verify type-check passes**
```bash
npm run type-check
```
Expected: no errors.

**Step 9: Commit**
```bash
git add backend/src/types/index.ts backend/src/auth/roles.ts \
        backend/src/middleware/auth.ts backend/src/routes/index.ts \
        frontend/src/types/api.ts frontend/src/hooks/useAuth.ts
git commit -m "feat(auth): rename roles to SAI_ADMIN/SAI_OPERATOR/SAI_VIEWER"
```

---

## Task 2: DB Migration 013 — pending_users table

**Files:**
- Create: `database/migrations/013_pending_users.sql`

**Step 1: Create migration file**

```sql
-- Migration 013: Pending users access queue
-- Tracks login attempts from users without an assigned role.
-- status: 'pending' | 'approved' | 'rejected'

CREATE TABLE IF NOT EXISTS pending_users (
  id              SERIAL PRIMARY KEY,
  zitadel_sub     TEXT        NOT NULL UNIQUE,
  email           TEXT        NOT NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count   INT         NOT NULL DEFAULT 1,
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_pending_users_status
  ON pending_users (status)
  WHERE status = 'pending';

COMMENT ON TABLE pending_users IS
  'Users who authenticated via Zitadel but have no project role assigned yet.';
```

**Step 2: Verify file is correctly formed (no syntax errors)**
```bash
psql -U postgres -d sai_dashboard -f database/migrations/013_pending_users.sql
```
Expected: `CREATE TABLE`, `CREATE INDEX` — no errors.

**Step 3: Verify table exists**
```bash
psql -U postgres -d sai_dashboard -c "\d pending_users"
```
Expected: columns id, zitadel_sub, email, first_seen_at, last_attempt_at, attempt_count, status.

**Step 4: Commit**
```bash
git add database/migrations/013_pending_users.sql
git commit -m "feat(db): migration 013 — pending_users access queue table"
```

---

## Task 3: Backend config — Zitadel management env vars

**Files:**
- Modify: `backend/src/config/index.ts`
- Modify: `.env.example`

**Step 1: Read current config structure**

Open `backend/src/config/index.ts` and locate the `oidc` config section. It currently has `issuer`, `clientId`, `clientSecret`, `redirectUri`, `postLogoutUri`, `rolesClaim`.

**Step 2: Add management credentials to config**

In the `oidc` section, add after `rolesClaim`:
```typescript
projectId: process.env.ZITADEL_PROJECT_ID || '',
mgmtClientId: process.env.ZITADEL_MGMT_CLIENT_ID || '',
mgmtClientSecret: process.env.ZITADEL_MGMT_CLIENT_SECRET || '',
```

**Step 3: Update .env.example**

Add a new section after the existing Zitadel block:
```bash
# Zitadel Management API (for programmatic role assignment)
# Project ID: visible in Zitadel → Projects → SAI Dashboard → General → Resource ID
ZITADEL_PROJECT_ID=<project-resource-id>
# Service account with Manager role in the project
ZITADEL_MGMT_CLIENT_ID=<service-account-client-id>
ZITADEL_MGMT_CLIENT_SECRET=<service-account-client-secret>
```

**Step 4: Verify type-check**
```bash
npm run type-check:backend
```
Expected: no errors.

**Step 5: Commit**
```bash
git add backend/src/config/index.ts .env.example
git commit -m "feat(config): add Zitadel management API credentials config"
```

---

## Task 4: Zitadel Management API service

**Files:**
- Create: `backend/src/services/zitadel-mgmt.ts`

**Step 1: Create the service**

```typescript
/**
 * Zitadel Management API client.
 *
 * Uses client_credentials grant to obtain a short-lived access token,
 * then calls the Management API to assign project roles (user grants).
 *
 * Docs: https://zitadel.com/docs/apis/resources/mgmt
 */
import axios from 'axios';
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getMgmtToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && cachedToken.expiresAt > now + 30) {
    return cachedToken.value;
  }

  const issuer = appConfig.oidc.issuer;
  const tokenUrl = `${issuer}/oauth/v2/token`;

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: [
      'openid',
      'urn:zitadel:iam:org:project:id:zitadel:aud',
    ].join(' '),
  });

  const response = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    auth: {
      username: appConfig.oidc.mgmtClientId,
      password: appConfig.oidc.mgmtClientSecret,
    },
  });

  const { access_token, expires_in } = response.data;

  cachedToken = {
    value: access_token,
    expiresAt: now + (expires_in as number),
  };

  return access_token;
}

/**
 * Assign a project role to a user via the Zitadel Management API.
 * Creates a user grant for the configured project.
 */
export async function assignRole(userId: string, roleKey: string): Promise<void> {
  const token = await getMgmtToken();
  const issuer = appConfig.oidc.issuer;
  const projectId = appConfig.oidc.projectId;

  const url = `${issuer}/management/v1/users/${userId}/grants`;

  try {
    await axios.post(
      url,
      { projectId, roleKeys: [roleKey] },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info('Zitadel: role assigned', { userId, roleKey, projectId });
  } catch (err: any) {
    logger.error('Zitadel: failed to assign role', {
      userId,
      roleKey,
      status: err?.response?.status,
      data: err?.response?.data,
    });
    throw new Error(`Failed to assign role in Zitadel: ${err?.response?.data?.message || err.message}`);
  }
}
```

**Step 2: Verify type-check**
```bash
npm run type-check:backend
```
Expected: no errors.

**Step 3: Commit**
```bash
git add backend/src/services/zitadel-mgmt.ts
git commit -m "feat(auth): Zitadel Management API service for role assignment"
```

---

## Task 5: Pending users DB service

**Files:**
- Create: `backend/src/services/pending-users-service.ts`

**Step 1: Add PendingUser type to backend types**

In `backend/src/types/index.ts`, append:
```typescript
export interface PendingUser {
  id: number;
  zitadelSub: string;
  email: string;
  firstSeenAt: Date;
  lastAttemptAt: Date;
  attemptCount: number;
  status: 'pending' | 'approved' | 'rejected';
}
```

**Step 2: Create the service**

```typescript
/**
 * Service for managing the pending_users access queue.
 */
import { dualDb } from '@/database/dual-pool';
import { PendingUser } from '@/types';
import { logger } from '@/utils/logger';

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
 * Insert a new pending user or increment their attempt count.
 */
export async function upsertPendingUser(sub: string, email: string): Promise<void> {
  const pool = dualDb.getSaiPool();
  await pool.query(
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
 * List all users with status = 'pending', newest first.
 */
export async function listPendingUsers(): Promise<PendingUser[]> {
  const pool = dualDb.getSaiPool();
  const result = await pool.query(
    `SELECT * FROM pending_users WHERE status = 'pending'
     ORDER BY first_seen_at DESC`
  );
  return result.rows.map(rowToUser);
}

/**
 * Mark a pending user as approved (does NOT call Zitadel — caller must do that).
 */
export async function approvePendingUser(sub: string): Promise<void> {
  const pool = dualDb.getSaiPool();
  await pool.query(
    `UPDATE pending_users SET status = 'approved' WHERE zitadel_sub = $1`,
    [sub]
  );
}

/**
 * Mark a pending user as rejected.
 */
export async function rejectPendingUser(sub: string): Promise<void> {
  const pool = dualDb.getSaiPool();
  await pool.query(
    `UPDATE pending_users SET status = 'rejected' WHERE zitadel_sub = $1`,
    [sub]
  );
}
```

**Step 3: Check how `dualDb.getSaiPool()` is called elsewhere to confirm method name**
```bash
grep -n "getSaiPool\|saiPool\|dualDb\." backend/src/services/ -r | head -5
```
Adjust method name if different.

**Step 4: Verify type-check**
```bash
npm run type-check:backend
```

**Step 5: Commit**
```bash
git add backend/src/types/index.ts backend/src/services/pending-users-service.ts
git commit -m "feat(auth): pending users DB service + PendingUser type"
```

---

## Task 6: Update auth callback to redirect pending users

**Files:**
- Modify: `backend/src/controllers/auth.ts`

**Step 1: Import the pending users service**

At the top of `controllers/auth.ts`, add:
```typescript
import { upsertPendingUser } from '@/services/pending-users-service';
```

**Step 2: Replace the USER_NO_ROLE error redirect**

Find the catch block after `extractRole()` (currently redirects with `auth_error=Tu cuenta no tiene rol asignado...`). Replace it:

```typescript
  } catch (err) {
    // User authenticated successfully but has no role in this project.
    // Register them in the access queue and show the pending-approval page.
    try {
      await upsertPendingUser(userId, email);
    } catch (dbErr) {
      logger.error('Failed to upsert pending user', { userId, email, dbErr });
    }

    logger.info('OIDC: user has no role, added to pending queue', {
      sub: userId,
      email,
      ip: req.ip,
    });

    const frontendBase = appConfig.oidc.postLogoutUri || '/';
    res.redirect(
      `${frontendBase}pending-approval?email=${encodeURIComponent(email)}`
    );
    return;
  }
```

**Step 3: Verify type-check**
```bash
npm run type-check:backend
```

**Step 4: Commit**
```bash
git add backend/src/controllers/auth.ts
git commit -m "feat(auth): redirect roleless users to pending-approval queue"
```

---

## Task 7: Admin controller and routes

**Files:**
- Create: `backend/src/controllers/admin.ts`
- Modify: `backend/src/routes/index.ts`

**Step 1: Create admin controller**

```typescript
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
```

**Step 2: Register routes in routes/index.ts**

Find the `authRouter` section (around line 57) and add after the existing auth routes:
```typescript
// Import at top of file:
import { getPendingUsers, approveUser, rejectUser } from '@/controllers/admin';

// Admin routes (SAI_ADMIN only)
authRouter.get(
  '/admin/pending',
  authenticateToken, requireAuth, requireRole('SAI_ADMIN'),
  getPendingUsers
);
authRouter.post(
  '/admin/users/:sub/approve',
  authenticateToken, requireAuth, requireRole('SAI_ADMIN'),
  approveUser
);
authRouter.post(
  '/admin/users/:sub/reject',
  authenticateToken, requireAuth, requireRole('SAI_ADMIN'),
  rejectUser
);
```

**Step 3: Verify type-check**
```bash
npm run type-check:backend
```

**Step 4: Commit**
```bash
git add backend/src/controllers/admin.ts backend/src/routes/index.ts
git commit -m "feat(auth): admin endpoints for pending user approval/rejection"
```

---

## Task 8: Frontend types + API service

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/services/api.ts`

**Step 1: Add PendingUser type to frontend**

In `frontend/src/types/api.ts`, append:
```typescript
export interface PendingUser {
  id: number;
  zitadelSub: string;
  email: string;
  firstSeenAt: string;   // ISO string from API
  lastAttemptAt: string;
  attemptCount: number;
  status: 'pending' | 'approved' | 'rejected';
}
```

**Step 2: Add adminApi to api.ts**

Find where `authApi` is defined and append a new `adminApi` object:
```typescript
export const adminApi = {
  async getPendingUsers(): Promise<PendingUser[]> {
    const response = await api.get<ApiResponse<PendingUser[]>>('/auth/admin/pending');
    return response.data.data;
  },

  async approveUser(sub: string, role: DashboardRole): Promise<void> {
    await api.post(`/auth/admin/users/${encodeURIComponent(sub)}/approve`, { role });
  },

  async rejectUser(sub: string): Promise<void> {
    await api.post(`/auth/admin/users/${encodeURIComponent(sub)}/reject`);
  },
};
```

Make sure `PendingUser` and `DashboardRole` are imported at the top of the file.

**Step 3: Verify type-check**
```bash
npm run type-check:frontend
```

**Step 4: Commit**
```bash
git add frontend/src/types/api.ts frontend/src/services/api.ts
git commit -m "feat(frontend): PendingUser type + adminApi service methods"
```

---

## Task 9: PendingApproval page

**Files:**
- Create: `frontend/src/pages/PendingApproval.tsx`

**Step 1: Create the page**

```tsx
import { useEffect, useState } from 'react';
import { authApi } from '@/services/api';

export function PendingApproval() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get('email');
    if (e) setEmail(e);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="text-6xl mb-6">🔐</div>
        <h1 className="text-2xl font-semibold text-gray-800 mb-3">
          Acceso pendiente de aprobación
        </h1>
        {email && (
          <p className="text-sm text-gray-500 mb-2">
            Cuenta: <span className="font-medium text-gray-700">{email}</span>
          </p>
        )}
        <p className="text-gray-600 mb-8">
          Tu cuenta fue autenticada correctamente, pero todavía no tiene un rol
          asignado en este sistema. Un administrador revisará tu solicitud y te
          asignará acceso.
        </p>
        <p className="text-sm text-gray-400 mb-6">
          Una vez aprobado, podés iniciar sesión nuevamente para acceder al dashboard.
        </p>
        <button
          onClick={() => authApi.login()}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          Intentar iniciar sesión
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify type-check**
```bash
npm run type-check:frontend
```

**Step 3: Commit**
```bash
git add frontend/src/pages/PendingApproval.tsx
git commit -m "feat(frontend): PendingApproval page for roleless users"
```

---

## Task 10: AdminPanel component

**Files:**
- Create: `frontend/src/components/AdminPanel.tsx`

**Step 1: Create the component**

```tsx
import { useEffect, useState } from 'react';
import { adminApi } from '@/services/api';
import { PendingUser, DashboardRole } from '@/types/api';

const ROLES: DashboardRole[] = ['SAI_VIEWER', 'SAI_OPERATOR', 'SAI_ADMIN'];

export function AdminPanel() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, DashboardRole>>({});
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await adminApi.getPendingUsers();
      setUsers(data);
      const defaults: Record<string, DashboardRole> = {};
      data.forEach(u => { defaults[u.zitadelSub] = 'SAI_VIEWER'; });
      setSelectedRoles(prev => ({ ...defaults, ...prev }));
    } catch {
      setError('Error cargando usuarios pendientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (sub: string) => {
    setProcessing(p => ({ ...p, [sub]: true }));
    try {
      await adminApi.approveUser(sub, selectedRoles[sub] || 'SAI_VIEWER');
      setUsers(u => u.filter(x => x.zitadelSub !== sub));
    } catch {
      setError(`Error aprobando usuario ${sub}`);
    } finally {
      setProcessing(p => ({ ...p, [sub]: false }));
    }
  };

  const handleReject = async (sub: string) => {
    setProcessing(p => ({ ...p, [sub]: true }));
    try {
      await adminApi.rejectUser(sub);
      setUsers(u => u.filter(x => x.zitadelSub !== sub));
    } catch {
      setError(`Error rechazando usuario ${sub}`);
    } finally {
      setProcessing(p => ({ ...p, [sub]: false }));
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Cargando...</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">
        Solicitudes de acceso pendientes
        {users.length > 0 && (
          <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-normal">
            {users.length}
          </span>
        )}
      </h2>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
      )}

      {users.length === 0 ? (
        <p className="text-sm text-gray-500">No hay solicitudes pendientes.</p>
      ) : (
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
          {users.map(user => (
            <div key={user.zitadelSub} className="flex items-center gap-4 px-4 py-3 bg-white">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{user.email}</p>
                <p className="text-xs text-gray-400">
                  Primer intento: {new Date(user.firstSeenAt).toLocaleString('es')}
                  {user.attemptCount > 1 && ` · ${user.attemptCount} intentos`}
                </p>
              </div>

              <select
                value={selectedRoles[user.zitadelSub] || 'SAI_VIEWER'}
                onChange={e =>
                  setSelectedRoles(r => ({ ...r, [user.zitadelSub]: e.target.value as DashboardRole }))
                }
                className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
                disabled={processing[user.zitadelSub]}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>

              <button
                onClick={() => handleApprove(user.zitadelSub)}
                disabled={processing[user.zitadelSub]}
                className="text-sm px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                Aprobar
              </button>

              <button
                onClick={() => handleReject(user.zitadelSub)}
                disabled={processing[user.zitadelSub]}
                className="text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
              >
                Rechazar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify type-check**
```bash
npm run type-check:frontend
```

**Step 3: Commit**
```bash
git add frontend/src/components/AdminPanel.tsx
git commit -m "feat(frontend): AdminPanel component for pending user approval"
```

---

## Task 11: Wire routes and show AdminPanel

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Read current App.tsx to understand routing structure**

Open `frontend/src/App.tsx` and identify:
- Where routes are defined (React Router)
- Where `AuthCallback` route was added (recent)
- Where authenticated content is rendered

**Step 2: Add /pending-approval route**

Find the `<Routes>` block and add the pending-approval route (public — no auth needed):
```tsx
import { PendingApproval } from '@/pages/PendingApproval';

// Inside <Routes>, alongside the AuthCallback route:
<Route path="/pending-approval" element={<PendingApproval />} />
```

**Step 3: Add AdminPanel to authenticated view**

Find where the main authenticated content renders (likely inside a layout or Dashboard).
Add the AdminPanel gated by RoleGate:
```tsx
import { AdminPanel } from '@/components/AdminPanel';
import { RoleGate } from '@/components/RoleGate';

// Inside authenticated view, somewhere accessible to admins.
// A simple approach: add below the main content as a section:
<RoleGate roles={['SAI_ADMIN']}>
  <div className="mt-8 px-4">
    <AdminPanel />
  </div>
</RoleGate>
```

If the dashboard has tabs or a sidebar, prefer placing it there. If unclear, add it as a floating section at the bottom of the main page for now.

**Step 4: Verify type-check**
```bash
npm run type-check
```
Expected: no errors.

**Step 5: Commit**
```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): wire /pending-approval route and AdminPanel to app"
```

---

## Task 12: Update production env + deploy

**Step 1: Get the Zitadel management credentials**

By now you should have (from the pre-requisites):
- `ZITADEL_PROJECT_ID` — Resource ID of the SAI Dashboard project
- `ZITADEL_MGMT_CLIENT_ID` — Service account client ID
- `ZITADEL_MGMT_CLIENT_SECRET` — Service account client secret

**Step 2: Update production .env on inference-public**
```bash
ssh inference-public
# Edit /opt/sai-dashboard/.env and add:
# ZITADEL_PROJECT_ID=...
# ZITADEL_MGMT_CLIENT_ID=...
# ZITADEL_MGMT_CLIENT_SECRET=...
```

**Step 3: Update GitHub PRODUCTION_ENV secret**
```bash
gh secret set PRODUCTION_ENV -R AlterMundi/sai-dashboard \
  --body "$(ssh inference-public 'cat /opt/sai-dashboard/.env')"
```

**Step 4: Apply migration 013 on production DB**
```bash
ssh inference-public
sudo -u postgres psql -d sai_dashboard -c "
CREATE TABLE IF NOT EXISTS pending_users (
  id SERIAL PRIMARY KEY,
  zitadel_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS idx_pending_users_status
  ON pending_users (status) WHERE status = 'pending';
"
```

**Step 5: Deploy via CI/CD**
```bash
# From local:
git checkout release && git merge master --no-edit
git push master release
git checkout master

# Monitor:
gh run watch $(gh run list -R AlterMundi/sai-dashboard --limit 1 --json databaseId -q '.[0].databaseId') -R AlterMundi/sai-dashboard
```

**Step 6: Verify end-to-end**
```bash
# Health
curl -s https://sai.altermundi.net/dashboard/api/health | python3 -m json.tool

# OIDC redirect still works
curl -s -o /dev/null -w "%{http_code}" https://sai.altermundi.net/dashboard/api/auth/login
# Expected: 302

# Pending users endpoint (needs SAI_ADMIN token)
curl -s -H "Authorization: Bearer <admin-token>" \
  https://sai.altermundi.net/dashboard/api/auth/admin/pending | python3 -m json.tool
# Expected: { "data": [] }

# Manual flow: log in with a new Zitadel account (no role)
# Expected: redirected to /pending-approval page
# Expected: row appears in pending_users table
```

---

## Acceptance Criteria Checklist

- [ ] `npm run type-check` passes with no errors
- [ ] `DashboardRole` is `'SAI_ADMIN' | 'SAI_OPERATOR' | 'SAI_VIEWER'` in both backend and frontend
- [ ] `requireRole` calls in routes use new names
- [ ] Zitadel project roles renamed (manual)
- [ ] Migration 013 applied: `pending_users` table with CHECK constraint
- [ ] User without role → `/pending-approval` page (not `?auth_error=`)
- [ ] Row upserted in `pending_users` on each roleless login
- [ ] `GET /auth/admin/pending` returns pending users (SAI_ADMIN only)
- [ ] `POST /auth/admin/users/:sub/approve` calls Zitadel API + updates DB
- [ ] AdminPanel visible to SAI_ADMIN, hidden to others
- [ ] Approve flow removes user from pending queue in UI
- [ ] Production deployed and health check passing
