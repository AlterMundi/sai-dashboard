# Zitadel Auth Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corregir tres problemas en la integración Zitadel: (1) cross-project role bleed por uso del scope genérico, (2) página de pending-approval sin feedback al usuario, (3) falta del `sub` en el redirect a pending-approval.

**Architecture:** El scope OIDC se cambia de genérico a project-scoped (`urn:zitadel:iam:org:project:id:<projectId>:roles`), eliminando el contaminado cruzado entre apps en la instancia Zitadel compartida. Se agrega un endpoint público de status polling, y la página PendingApproval hace polling cada 30s para detectar aprobación y disparar re-login automático.

**Tech Stack:** Node.js + Express + TypeScript (backend), React 18 + TypeScript (frontend), openid-client v5

---

## Contexto crítico antes de empezar

- `ZITADEL_PROJECT_ID` ya existe en `appConfig.oidc.projectId` — se usa en Management API. Aquí lo reutilizamos para el scope.
- El claim project-scoped genera una clave distinta en el token: `urn:zitadel:iam:org:project:id:<projectId>:roles` (no el genérico `urn:zitadel:iam:org:project:roles`).
- No se requieren cambios en la UI de Zitadel — el scope es nativo y Zitadel lo reconoce automáticamente.
- El endpoint de status NO requiere auth (usuario en pending-approval no tiene JWT).
- Verificar con `npm run type-check` después de cada tarea de backend.

---

## Task 1: Scope project-scoped en buildAuthorizationUrl

**Files:**
- Modify: `backend/src/auth/oidc.ts`

**Contexto:** `buildAuthorizationUrl` construye la URL de autorización OIDC. Actualmente usa el scope genérico `urn:zitadel:iam:org:project:roles`. Hay que reemplazarlo con el scope dinámico que incluye el project ID.

**Step 1: Agregar `projectId` como parámetro y construir el scope dinámico**

En `backend/src/auth/oidc.ts`, modificar `buildAuthorizationUrl`:

```typescript
// Agregar import de appConfig si no está ya
import { appConfig } from '@/config';

export function buildAuthorizationUrl(params: {
  state: string;
  codeChallenge: string;
}): URL {
  const client = getOIDCClient();
  const projectId = appConfig.oidc.projectId;

  // Build project-scoped roles scope. Falls back to generic only if projectId is not configured.
  const rolesScope = projectId
    ? `urn:zitadel:iam:org:project:id:${projectId}:roles`
    : 'urn:zitadel:iam:org:project:roles';

  const authUrl = client.authorizationUrl({
    scope: `openid email profile ${rolesScope}`,
    redirect_uri: appConfig.oidc.redirectUri,
    response_type: 'code',
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  });

  return new URL(authUrl);
}
```

**Step 2: Type-check**

```bash
npm run type-check:backend
```
Expected: sin errores.

**Step 3: Commit**

```bash
git add backend/src/auth/oidc.ts
git commit -m "fix(auth): use project-scoped roles scope in OIDC authorization URL"
```

---

## Task 2: Actualizar extractRole para leer el claim project-scoped

**Files:**
- Modify: `backend/src/auth/roles.ts`

**Contexto:** `extractRole` actualmente lee `claims[appConfig.oidc.rolesClaim]` que apunta al claim genérico. Debe leer primero el claim project-scoped (`urn:zitadel:iam:org:project:id:<projectId>:roles`) y hacer fallback al genérico solo si `projectId` no está configurado.

**Step 1: Reemplazar el cuerpo de `extractRole`**

```typescript
import { DashboardRole } from '@/types';
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';

/**
 * Extract the DashboardRole from Zitadel OIDC token claims.
 *
 * Uses the project-scoped claim `urn:zitadel:iam:org:project:id:<projectId>:roles`
 * when ZITADEL_PROJECT_ID is configured, preventing cross-project role bleed
 * in shared Zitadel instances.
 *
 * Falls back to the generic `urn:zitadel:iam:org:project:roles` claim only if
 * ZITADEL_PROJECT_ID is not set.
 */
export function extractRole(claims: Record<string, unknown>): DashboardRole {
  const projectId = appConfig.oidc.projectId;
  const genericClaimKey = 'urn:zitadel:iam:org:project:roles';
  const projectClaimKey = projectId
    ? `urn:zitadel:iam:org:project:id:${projectId}:roles`
    : null;

  // Prefer project-scoped claim; fall back to generic if projectId not configured
  const claimKey = projectClaimKey ?? genericClaimKey;
  const projectRoles = claims[claimKey] ?? (projectClaimKey ? claims[genericClaimKey] : undefined);

  if (!projectRoles || typeof projectRoles !== 'object') {
    logger.warn('OIDC: No roles claim found in token', {
      claimsKeys: Object.keys(claims),
      claimKeyAttempted: claimKey,
    });
    throw new Error('USER_NO_ROLE');
  }

  const roleNames = Object.keys(projectRoles as Record<string, unknown>);
  logger.debug('OIDC: Found roles in claim', { roleNames, claimKey });

  // Highest-privilege wins
  if (roleNames.includes('SAI_ADMIN')) return 'SAI_ADMIN';
  if (roleNames.includes('SAI_OPERATOR')) return 'SAI_OPERATOR';
  if (roleNames.includes('SAI_VIEWER')) return 'SAI_VIEWER';

  logger.warn('OIDC: User has roles but none are recognized for this project', {
    roleNames,
    claimKey,
  });
  throw new Error('USER_NO_ROLE');
}
```

**Step 2: Type-check**

```bash
npm run type-check:backend
```
Expected: sin errores.

**Step 3: Commit**

```bash
git add backend/src/auth/roles.ts
git commit -m "fix(auth): read project-scoped roles claim to prevent cross-app role bleed"
```

---

## Task 3: Incluir `sub` en el redirect a pending-approval

**Files:**
- Modify: `backend/src/controllers/auth.ts`

**Contexto:** Actualmente el callback redirige a `pending-approval?email=...`. El endpoint de status polling necesita el `sub` (Zitadel user ID) para identificar al usuario en la DB. Hay que agregarlo al redirect.

**Step 1: Localizar la línea del redirect en `handleCallback` y agregar `sub`**

Buscar en `backend/src/controllers/auth.ts` el bloque que redirige a `pending-approval`. Cambiar:

```typescript
// ANTES:
res.redirect(
  `${frontendBase}pending-approval?email=${encodeURIComponent(email)}`
);

// DESPUÉS:
res.redirect(
  `${frontendBase}pending-approval?email=${encodeURIComponent(email)}&sub=${encodeURIComponent(userId)}`
);
```

**Step 2: Type-check**

```bash
npm run type-check:backend
```
Expected: sin errores.

**Step 3: Commit**

```bash
git add backend/src/controllers/auth.ts
git commit -m "fix(auth): include sub in pending-approval redirect for status polling"
```

---

## Task 4: Endpoint público `GET /auth/pending/status`

**Files:**
- Modify: `backend/src/controllers/auth.ts` — agregar el handler `getPendingStatus`
- Modify: `backend/src/routes/index.ts` — registrar la ruta pública

**Contexto:** Los usuarios en pending-approval no tienen JWT. El endpoint debe ser público (sin `authenticateToken`), solo rate-limited por IP. Recibe `?sub=<zitadel_sub>` y devuelve `{ status: 'pending' | 'approved' | 'rejected' | 'not_found' }`.

**Step 1: Agregar el handler en `backend/src/controllers/auth.ts`**

Al final del archivo, agregar:

```typescript
import { getPendingUserBySub } from '@/services/pending-users-service';

/**
 * GET /auth/pending/status?sub=<zitadel_sub>
 * Public endpoint (no auth). Returns the approval status for a pending user.
 * Used by the frontend PendingApproval page to poll for status changes.
 */
export const getPendingStatus = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { sub } = req.query as { sub?: string };

    if (!sub) {
      res.status(400).json({
        error: { message: 'sub query parameter is required', code: 'MISSING_SUB' },
      });
      return;
    }

    const user = await getPendingUserBySub(sub);

    if (!user) {
      res.json({ data: { status: 'not_found' } });
      return;
    }

    res.json({ data: { status: user.status } });
  }
);
```

**Step 2: Registrar la ruta en `backend/src/routes/index.ts`**

Localizar el `authRouter` donde están las rutas públicas (antes del middleware `authenticateToken`). Agregar:

```typescript
// Public: pending approval status check (no auth required)
authRouter.get('/pending/status', getPendingStatus);
```

Asegurarse de que esta ruta quede ANTES de los middlewares de auth, o en una sección de rutas públicas. Verificar también que `getPendingStatus` esté importado desde `@/controllers/auth`.

**Step 3: Type-check**

```bash
npm run type-check:backend
```
Expected: sin errores.

**Step 4: Probar el endpoint manualmente**

```bash
# Requiere que el backend esté corriendo localmente
curl "http://localhost:3001/dashboard/api/auth/pending/status?sub=FAKE_SUB"
# Expected: { "data": { "status": "not_found" } }
```

**Step 5: Commit**

```bash
git add backend/src/controllers/auth.ts backend/src/routes/index.ts
git commit -m "feat(auth): add public GET /auth/pending/status endpoint for approval polling"
```

---

## Task 5: Polling en PendingApproval + auto-redirect

**Files:**
- Modify: `frontend/src/services/api.ts` — agregar `authApi.getPendingStatus(sub)`
- Modify: `frontend/src/pages/PendingApproval.tsx` — polling + auto-redirect + botón manual

**Step 1: Agregar `getPendingStatus` a `authApi` en `frontend/src/services/api.ts`**

Localizar el objeto `authApi` y agregar el método:

```typescript
async getPendingStatus(sub: string): Promise<{ status: 'pending' | 'approved' | 'rejected' | 'not_found' }> {
  try {
    const response = await api.get<ApiResponse<{ status: string }>>(`/auth/pending/status?sub=${encodeURIComponent(sub)}`);
    return response.data.data as { status: 'pending' | 'approved' | 'rejected' | 'not_found' };
  } catch {
    return { status: 'pending' }; // fail-safe: keep polling on network errors
  }
},
```

**Step 2: Reescribir `PendingApproval.tsx` con polling**

```typescript
import { useEffect, useState, useRef } from 'react';
import { authApi } from '@/services/api';

const POLL_INTERVAL_MS = 30_000;

export function PendingApproval() {
  const [email, setEmail] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'not_found'>('pending');
  const [checking, setChecking] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEmail(params.get('email'));
    setSub(params.get('sub'));
  }, []);

  const checkStatus = async (currentSub: string) => {
    setChecking(true);
    try {
      const result = await authApi.getPendingStatus(currentSub);
      setStatus(result.status);

      if (result.status === 'approved') {
        // Stop polling and trigger re-login to obtain token with new role
        if (intervalRef.current) clearInterval(intervalRef.current);
        setTimeout(() => authApi.login(), 1500);
      } else if (result.status === 'rejected') {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!sub) return;

    // Initial check
    checkStatus(sub);

    // Poll every 30s
    intervalRef.current = setInterval(() => checkStatus(sub), POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [sub]);

  if (status === 'approved') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-6">✅</div>
          <h1 className="text-2xl font-semibold text-gray-800 mb-3">¡Acceso aprobado!</h1>
          <p className="text-gray-600">Iniciando sesión…</p>
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-6">🚫</div>
          <h1 className="text-2xl font-semibold text-gray-800 mb-3">Solicitud rechazada</h1>
          <p className="text-gray-600">
            Tu solicitud de acceso no fue aprobada. Contactá al administrador del sistema
            si creés que esto es un error.
          </p>
        </div>
      </div>
    );
  }

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
        <p className="text-gray-600 mb-6">
          Tu cuenta fue autenticada correctamente, pero todavía no tiene un rol
          asignado en este sistema. Un administrador revisará tu solicitud.
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-6">
          <span
            className={`inline-block w-2 h-2 rounded-full ${checking ? 'bg-blue-400 animate-pulse' : 'bg-gray-300'}`}
          />
          {checking ? 'Verificando estado…' : 'Verificación automática cada 30 segundos'}
        </div>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => sub && checkStatus(sub)}
            disabled={checking || !sub}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Comprobar ahora
          </button>
          <button
            onClick={() => authApi.login()}
            className="px-5 py-2.5 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-sm"
          >
            Intentar iniciar sesión manualmente
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Type-check frontend**

```bash
npm run type-check:frontend
```
Expected: sin errores.

**Step 4: Commit**

```bash
git add frontend/src/services/api.ts frontend/src/pages/PendingApproval.tsx
git commit -m "feat(auth): add 30s polling + auto-redirect to PendingApproval page"
```

---

## Task 6: Verificación integral y deploy

**Step 1: Type-check completo**

```bash
npm run type-check
```
Expected: sin errores en backend ni frontend.

**Step 2: Verificar el flujo completo en producción (post-deploy)**

Checklist de verificación:

```
[ ] Login de usuario sin rol → redirige a /pending-approval?email=...&sub=...
    (verificar que sub está en la URL)

[ ] GET /dashboard/api/auth/pending/status?sub=<sub_conocido>
    → { "data": { "status": "pending" } }

[ ] GET /dashboard/api/auth/pending/status?sub=SUB_INEXISTENTE
    → { "data": { "status": "not_found" } }

[ ] Admin aprueba al usuario desde AdminPanel
    → logs del container: "Zitadel: role assigned" o "Zitadel: existing grant updated"
    → logs: "Pending user approved"

[ ] Dentro de 30s en /pending-approval, la página detecta "approved"
    → muestra "¡Acceso aprobado!" y redirige a login automáticamente

[ ] Después del re-login, usuario entra al dashboard con su rol asignado

[ ] Decodificar el nuevo JWT en logs:
    → claim key es `urn:zitadel:iam:org:project:id:<projectId>:roles`
    → NO aparece "ADMIN" ni roles de otras apps en el claim
```

**Step 3: Merge y deploy**

```bash
# Merge a main / release según el proceso del proyecto
git checkout release
git merge feat/zitadel-oidc   # o el branch actual
git push origin release
# CI/CD despliega automáticamente
```

---

## Rollback

Si el paso a project-scoped scope rompe el login (usuarios no reciben roles):

1. Revertir Task 1 y Task 2 al estado anterior
2. Verificar en logs qué claim key está llegando: `Object.keys(claims)` en el callback
3. Ajustar `ZITADEL_PROJECT_ID` o el parsing según lo que Zitadel efectivamente envíe
4. Como diagnóstico temporal (no producción), restaurar el scope genérico para comparar tokens

**Causa más común de falla:** `ZITADEL_PROJECT_ID` incorrecto o vacío → scope malformado → Zitadel ignora el scope y no incluye el claim project-scoped. Verificar que sea el Resource ID del proyecto (Zitadel → Projects → General), no el nombre ni el ID numérico.
