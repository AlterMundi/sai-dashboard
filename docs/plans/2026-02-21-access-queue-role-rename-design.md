# Design: Access Queue + Role Rename (SAI_*)

**Date:** 2026-02-21
**Status:** Approved

---

## Problem

1. Role literals `ADMIN`/`OPERATOR`/`VIEWER` are too generic for a multi-project Zitadel org — collide with roles from other projects.
2. New users who log in without a role get a raw error redirect (`?auth_error=...`) with no path forward.

---

## Solution

Two changes delivered together:

### 1. Role Rename
`ADMIN` → `SAI_ADMIN`, `OPERATOR` → `SAI_OPERATOR`, `VIEWER` → `SAI_VIEWER`

Affected files (string literals + type):
- `backend/src/types/index.ts` — `DashboardRole` union type
- `backend/src/auth/roles.ts` — `includes()` checks and return values
- `backend/src/middleware/auth.ts` — default fallback `'VIEWER'` → `'SAI_VIEWER'`
- `backend/src/routes/index.ts` — `requireRole(...)` calls
- `frontend/src/types/api.ts` — `DashboardRole` union type
- `frontend/src/hooks/useAuth.ts` — default fallback

Also requires manual rename in Zitadel project roles.

### 2. Access Queue (semi-restricted model)

New users can create a Zitadel account and authenticate, but get no access until a `SAI_ADMIN` explicitly approves them and assigns a role via the dashboard.

---

## User Flow

```
New user → login Zitadel → callback → no role found
  → upsert into pending_users (status=pending)
  → redirect to /pending-approval
  → page: "Tu solicitud está siendo revisada por un administrador"

SAI_ADMIN → Admin Panel → Pending Users queue
  → selects role (SAI_VIEWER / SAI_OPERATOR / SAI_ADMIN)
  → clicks Approve
  → backend calls Zitadel Management API → assigns role
  → pending_users.status = 'approved'

User → logs in again → role found → access granted
```

---

## Database

**Migration 013** — new table `pending_users`:

```sql
CREATE TABLE pending_users (
  id              SERIAL PRIMARY KEY,
  zitadel_sub     TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count   INT NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending'
  -- status values: 'pending' | 'approved' | 'rejected'
);
CREATE INDEX idx_pending_users_status ON pending_users(status)
  WHERE status = 'pending';
```

---

## Backend Architecture

### New files
- `backend/src/services/zitadel-mgmt.ts` — Zitadel Management API client
  - `getManagementToken()`: client_credentials flow with `ZITADEL_MGMT_CLIENT_ID`/`SECRET`
  - `assignRole(userId, roleKey, projectId)`: `POST /management/v1/users/{id}/grants`
- `backend/src/services/pending-users-service.ts` — CRUD on `pending_users`
  - `upsert(sub, email)`: insert or increment attempt_count + update last_attempt_at
  - `listPending()`: all rows with status=pending
  - `approve(sub, role)`: set status=approved
  - `reject(sub)`: set status=rejected
- `backend/src/controllers/admin.ts` — admin-only endpoints
  - `GET /auth/admin/pending` — requireRole('SAI_ADMIN')
  - `POST /auth/admin/users/:sub/approve` — body: { role }
  - `POST /auth/admin/users/:sub/reject`

### Modified files
- `backend/src/controllers/auth.ts` — `handleCallback`: catch `USER_NO_ROLE`
  → call `pendingUsersService.upsert(sub, email)`
  → redirect to `${frontendBase}pending-approval`
- `backend/src/types/index.ts` — add `PendingUser` interface, rename `DashboardRole`
- `backend/src/config/index.ts` — add `oidc.projectId`, `oidc.mgmtClientId`, `oidc.mgmtClientSecret`

### New env vars
```
ZITADEL_PROJECT_ID=<project-id>
ZITADEL_MGMT_CLIENT_ID=<service-account-client-id>
ZITADEL_MGMT_CLIENT_SECRET=<service-account-secret>
```

---

## Frontend Architecture

### New files
- `frontend/src/pages/PendingApproval.tsx` — static page shown after login without role
  - Shows user email if available in URL params
  - "Tu cuenta está pendiente de aprobación. Contactá al administrador."
  - Link to try logging in again
- `frontend/src/components/AdminPanel.tsx` — pending users queue
  - Table: email, first_seen_at, attempt_count
  - Per-row: role dropdown (SAI_VIEWER/SAI_OPERATOR/SAI_ADMIN) + Approve + Reject
  - Only visible to SAI_ADMIN (wrapped in RoleGate)

### Modified files
- `frontend/src/App.tsx` — add `/pending-approval` route, add AdminPanel somewhere accessible to SAI_ADMIN
- `frontend/src/services/api.ts` — add `adminApi` with pending users endpoints
- `frontend/src/types/api.ts` — add `PendingUser` type, rename `DashboardRole`

---

## Zitadel Pre-requisites (manual)

1. **Create service account** in Zitadel org
2. **Assign Manager role** to service account in the SAI Dashboard project
3. **Generate client credentials** (client_id + client_secret)
4. **Rename project roles**: ADMIN→SAI_ADMIN, OPERATOR→SAI_OPERATOR, VIEWER→SAI_VIEWER
5. Add `ZITADEL_PROJECT_ID`, `ZITADEL_MGMT_CLIENT_ID`, `ZITADEL_MGMT_CLIENT_SECRET` to production `.env` and GitHub `PRODUCTION_ENV` secret

---

## Acceptance Criteria

- [ ] Role rename applied in all 6 source files
- [ ] `DashboardRole` type updated in backend + frontend
- [ ] Migration 013 applied: `pending_users` table exists
- [ ] New user login without role → redirected to `/pending-approval` (not error)
- [ ] `pending_users` row created on each roleless login attempt
- [ ] SAI_ADMIN sees pending users in admin panel
- [ ] Approve flow: Zitadel API assigns role, DB updates to 'approved'
- [ ] Reject flow: DB updates to 'rejected', user stays blocked
- [ ] All existing `requireRole` guards still work with new SAI_* names
- [ ] type-check passes after all changes
