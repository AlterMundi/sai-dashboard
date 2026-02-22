# PROJ-10: Deploy Zitadel OIDC to production + fix audit findings

Deploy the Zitadel OIDC implementation (commit 6a677c8) to production. Includes: fix 3 security issues from ia-bridge audit, configure production .env, apply migration 012, deploy + verify, rollback plan.

---

## Estado actual (auditoría ia-bridge: 2026-02-21)

### Código (master, commit 6a677c8)
- TypeScript type-check: PASS
- Flujo PKCE: correctamente implementado
- Extracción de roles: correcta para claim `urn:zitadel:iam:org:project:roles`
- RoleGate + RBAC backend: implementados

### Hallazgos del audit (ordenados por severidad)

| # | Severidad | Problema |
|---|-----------|---------|
| 1 | CRITICAL | Cookies `oidc_state`/`oidc_pkce` NO firmadas — `signed: true` ausente en `COOKIE_OPTS`, se leen de `req.cookies` en vez de `req.signedCookies` |
| 2 | HIGH | Token JWT pasado via `?token=` en URL — aparece en nginx logs y posible fuga via `Referer` |
| 3 | HIGH | Logout sin `id_token_hint` — sesión en Zitadel puede no cerrarse |
| 4 | MEDIUM | `clearCookie` sin opciones matching — browser puede no eliminar cookies |
| 5 | MEDIUM | Check de expiración redundante en `authenticateToken` (jwt.verify ya lo hace) |

### Estado producción
- Servicio: INACTIVO (sai-dashboard-api.service: dead)
- `.env` producción: INCOMPLETA — faltan `AUTH_ZITADEL_ISSUER`, `AUTH_ZITADEL_ID`, `AUTH_REDIRECT_URI`, `AUTH_POST_LOGOUT_URI`
- Frontend: NO deployado (`/opt/sai-dashboard/` solo tiene `backend/` y `logs/`)
- Migración 012: NO aplicada en producción

---

## Plan de ejecución

### Fase 0 — Pre-requisito: configuración Zitadel (BLOQUEANTE — requiere acción manual)
En https://auth.altermundi.net:
1. Crear aplicación OIDC tipo `Web Application`, grant type: `Authorization Code` + PKCE
2. Redirect URI: `https://sai.altermundi.net/dashboard/api/auth/callback`
3. Post-logout URI: `https://sai.altermundi.net/dashboard/`
4. Asignar roles ADMIN/OPERATOR/VIEWER a usuarios en el proyecto
5. Obtener `CLIENT_ID` (cliente público — sin secret)

### Fase 1 — Fixes de seguridad del audit (código local, paralela con Fase 0)

**Fix 1 (CRITICAL): Cookie signing**
`backend/src/controllers/auth.ts`:
- Agregar `signed: true` a `COOKIE_OPTS` (y `path: '/'`)
- Leer de `req.signedCookies` (no `req.cookies`)
- Pasar opciones matching (sin `maxAge`) a `clearCookie`

**Fix 2 (HIGH): Referrer-Policy en callback**
`backend/src/controllers/auth.ts`:
- Agregar header `Referrer-Policy: no-referrer` en redirect del callback

**Fix 3 (HIGH): id_token_hint en logout**
`backend/src/auth/oidc.ts` + `backend/src/controllers/auth.ts`:
- Incluir `idToken` en el JWT payload (tokenSet.id_token está disponible)
- Pasarlo como hint a `buildLogoutUrl()` en el handler de logout

**Fix 4 (MEDIUM): Remover check redundante de expiración**
`backend/src/middleware/auth.ts`: eliminar verificación manual de `decoded.exp`

Post-fixes: `npm run type-check` debe pasar.

### Fase 2 — Configurar .env en producción
SSH inference-public, editar `/opt/sai-dashboard/.env`:
```
AUTH_ZITADEL_ISSUER=https://auth.altermundi.net
AUTH_ZITADEL_ID=<client-id-de-fase-0>
AUTH_REDIRECT_URI=https://sai.altermundi.net/dashboard/api/auth/callback
AUTH_POST_LOGOUT_URI=https://sai.altermundi.net/dashboard/
ZITADEL_ROLES_CLAIM=urn:zitadel:iam:org:project:roles
ENFORCE_HTTPS=true
```
Conservar existentes: `SESSION_SECRET`, `SESSION_DURATION`.
Eliminar: `DASHBOARD_PASSWORD` si existía.

### Fase 3 — Deploy
```bash
# En inference-public:
cd /opt/sai-dashboard
git pull origin master
./install-production.sh
```
El script: instala deps, build backend+frontend, aplica migración 012, reinicia servicio, verifica.

### Fase 4 — Verificación post-deploy
```bash
# Servicio activo
sudo systemctl status sai-dashboard-api

# OIDC redirige a Zitadel (302)
curl -s -o /dev/null -w "%{http_code}" https://sai.altermundi.net/dashboard/api/auth/login

# Frontend carga (200)
curl -s -o /dev/null -w "%{http_code}" https://sai.altermundi.net/dashboard/

# Health API
curl -s https://sai.altermundi.net/dashboard/api/health | jq .

# Migración aplicada
psql -U postgres -d sai_dashboard -c "\d execution_analysis" | grep marked_by

# Flujo manual completo
# Abrir browser → https://sai.altermundi.net/dashboard/
# → redirige a Zitadel → login → volver autenticado
```

### Fase 5 — Plan de rollback
**Trigger:** servicio no arranca, login loop, error 500 en callback.

```bash
# En inference-public:
cd /opt/sai-dashboard
git checkout 9fb7b10 -- backend/src/ frontend/src/ install-production.sh
# Restaurar DASHBOARD_PASSWORD en .env, quitar vars AUTH_ZITADEL_*
npm run build:backend && npm run build:frontend
sudo systemctl restart sai-dashboard-api
```

Migración 012 rollback (solo si necesario — columnas nullable no rompen nada):
```sql
ALTER TABLE execution_analysis
  DROP COLUMN IF EXISTS marked_by_user_id,
  DROP COLUMN IF EXISTS marked_by_email;
DROP INDEX IF EXISTS idx_execution_analysis_marked_by_user;
```

---

## Criterios de aceptación
- [ ] Fase 0: CLIENT_ID obtenido de Zitadel
- [ ] Fase 1: 4 fixes aplicados, type-check OK, commit en master
- [ ] Fase 2: .env producción actualizada con vars Zitadel
- [ ] Fase 3: install-production.sh sin errores
- [ ] Fase 4: login completo funciona en producción
- [ ] Fase 4: roles ADMIN/OPERATOR/VIEWER verificados
- [ ] Fase 4: migración 012 confirmada en DB
