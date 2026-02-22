# Remove Systemd Deployment References Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminar todas las referencias al deployment mediante systemd (`sai-dashboard-api.service`) en favor de Docker + GitHub CI/CD, manteniendo solo las referencias relevantes a nginx y SSH tunnels (que siguen usando systemd).

**Architecture:** El deployment del API ahora es 100% Docker (`docker run sai-dashboard`). El workflow `.github/workflows/deploy.yml` ya hace el trabajo y hasta deshabilita el viejo servicio systemd. Los scripts, docs y tests que siguen instruyendo usar `systemctl`/`journalctl` para el API son misleading y deben actualizarse a los equivalentes Docker. Los SSH tunnels y nginx *sí* siguen usando systemd — no tocar esas referencias.

**Tech Stack:** bash, markdown, Docker CLI (`docker logs`, `docker ps`, `docker restart`), eliminación de archivos

---

## Regla general de reemplazo

| Antes (systemd) | Después (Docker) |
|---|---|
| `sudo systemctl status sai-dashboard-api` | `docker ps -f name=sai-dashboard` |
| `sudo systemctl restart sai-dashboard-api` | `docker restart sai-dashboard` |
| `sudo systemctl stop sai-dashboard-api` | `docker stop sai-dashboard` |
| `sudo journalctl -u sai-dashboard-api -f` | `docker logs -f sai-dashboard` |
| `journalctl -u sai-dashboard-api \| grep "Stage 1:"` | `docker logs sai-dashboard \| grep "Stage 1:"` |

**No tocar:**
- `sudo systemctl reload nginx` — nginx sigue siendo systemd
- `systemctl is-active nginx` — nginx sigue siendo systemd
- `systemd/sai-dashboard-tunnel.service` (el archivo) — SSH tunnels siguen usando systemd, pero se actualiza su dependencia
- Referencias en `docs/archive/` — son historia, dejarlas

---

## Task 1: Eliminar `install-production.sh`

**Contexto:** Script de 1.130 líneas que instala el servicio systemd. El CI/CD de GitHub ya reemplaza toda su funcionalidad. Nadie debería usarlo.

**Files:**
- Delete: `install-production.sh`
- Modify: `package.json` (eliminar script `deploy:verify` que referencia install-production.sh si existe)
- Modify: `CLAUDE.md` (proyecto) — sección "Production Deployment"

**Step 1: Verificar que `package.json` no depende de install-production.sh**

```bash
grep -n "install-production" package.json
```
Expected: sin resultados, o si los hay, identificarlos para el siguiente paso.

**Step 2: Eliminar el archivo**

```bash
git rm install-production.sh
```
Expected: `rm 'install-production.sh'`

**Step 3: Actualizar la sección "Production Deployment" de `CLAUDE.md`**

Reemplazar el bloque existente:
```markdown
### Production Deployment

```bash
# ALWAYS use this script for production
./install-production.sh

# This handles:
# - Dependency installation
# - Backend/frontend builds
# - Database migrations (if needed)
# - Quality checks
# - Service restart (systemd)

# Verify deployment
npm run deploy:verify
```
```

Con:
```markdown
### Production Deployment

Deployment is fully automated via GitHub Actions (`.github/workflows/deploy.yml`).

Push to the `release` branch to trigger:
1. Docker image build → pushed to `ghcr.io/altermundi/sai-dashboard`
2. SSH deploy to production: pulls image, runs container

To deploy manually (emergency only):
```bash
cd /opt/sai-dashboard
docker pull ghcr.io/altermundi/sai-dashboard:latest
docker stop sai-dashboard && docker rm sai-dashboard
docker run -d --name sai-dashboard --network host --restart unless-stopped \
  --env-file .env \
  -v /mnt/raid1/n8n-backup/images:/mnt/raid1/n8n-backup/images \
  ghcr.io/altermundi/sai-dashboard:latest
```
```

**Step 4: Actualizar la sección "System Operations" de `CLAUDE.md`**

Reemplazar:
```markdown
```bash
# Check service status
sudo systemctl status sai-dashboard-api

# View logs (real-time)
sudo journalctl -u sai-dashboard-api -f

# Restart service
sudo systemctl restart sai-dashboard-api

# Check ETL health
psql -U postgres -d sai_dashboard -c "SELECT * FROM etl_queue_health"
```
```

Con:
```markdown
```bash
# Check container status
docker ps -f name=sai-dashboard

# View logs (real-time)
docker logs -f sai-dashboard

# Restart container
docker restart sai-dashboard

# Check ETL health
psql -U postgres -d sai_dashboard -c "SELECT * FROM etl_queue_health"
```
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove install-production.sh, update deployment docs to Docker"
```

---

## Task 2: Actualizar `systemd/sai-dashboard-tunnel.service`

**Contexto:** El archivo de la unidad del tunnel SSH tiene `After=` y `Wants=` que dependen de `sai-dashboard-api.service` (el servicio systemd eliminado). El API ahora corre en Docker, no como servicio systemd.

**Files:**
- Modify: `systemd/sai-dashboard-tunnel.service`

**Step 1: Editar las dependencias de la unit**

Cambiar:
```ini
After=network.target sai-dashboard-api.service nginx.service
Wants=sai-dashboard-api.service nginx.service
```

Por:
```ini
After=network.target docker.service nginx.service
Wants=docker.service nginx.service
```

**Step 2: Verificar que el resto del archivo está bien**

```bash
cat systemd/sai-dashboard-tunnel.service
```
Expected: no menciona `sai-dashboard-api` en ningún otro lugar.

**Step 3: Commit**

```bash
git add systemd/sai-dashboard-tunnel.service
git commit -m "chore: update tunnel service to depend on docker instead of sai-dashboard-api"
```

---

## Task 3: Actualizar `README.md`

**Files:**
- Modify: `README.md`

**Step 1: Leer el archivo para ubicar las líneas**

Buscar las líneas ~132-141 que contienen:
```
sudo journalctl -u sai-dashboard-api -f
sudo systemctl restart sai-dashboard-api
sudo systemctl status sai-tunnels
```

**Step 2: Reemplazar los comandos del API por Docker**

Cambiar los comandos del API:
- `sudo journalctl -u sai-dashboard-api -f` → `docker logs -f sai-dashboard`
- `sudo systemctl restart sai-dashboard-api` → `docker restart sai-dashboard`

Mantener sin cambios cualquier referencia a `sai-tunnels` (nginx/tunnel siguen siendo systemd).

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README service commands to Docker"
```

---

## Task 4: Actualizar `docs/DEPLOYMENT.md`

**Contexto:** El archivo tiene secciones extensas explicando la instalación del servicio systemd. Reemplazar por instrucciones Docker.

**Files:**
- Modify: `docs/DEPLOYMENT.md`

**Step 1: Leer el archivo**

```bash
wc -l docs/DEPLOYMENT.md
```

**Step 2: Identificar y remover/reemplazar las secciones systemd del API**

Las secciones a buscar:
- Cualquier bloque que instale `/etc/systemd/system/sai-dashboard-api.service`
- `systemctl enable/start/restart sai-dashboard-api`
- `journalctl -u sai-dashboard-api`

Reemplazar con equivalentes Docker. El patrón de reemplazo es la tabla de la sección "Regla general" al inicio del plan.

**Mantener intactas:**
- Secciones sobre `nginx` (reload nginx, nginx config)
- Secciones sobre `sai-tunnels` (SSH reverse tunnel services)

**Step 3: Agregar una sección "Deployment" al inicio que explique el CI/CD**

Agregar antes de las secciones de configuración manual:
```markdown
## Automated Deployment (CI/CD)

Production deployments are triggered automatically by pushing to the `release` branch.
See `.github/workflows/deploy.yml` for the full pipeline.

The pipeline:
1. Builds a Docker image and pushes to `ghcr.io/altermundi/sai-dashboard`
2. SSHs into the production server and runs the new container
```

**Step 4: Commit**

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: update DEPLOYMENT.md to reflect Docker-based deployment"
```

---

## Task 5: Actualizar scripts de validación/test

**Contexto:** Tres scripts verifican el estado del servicio systemd. Deben verificar el contenedor Docker.

**Files:**
- Modify: `scripts/validate-production.sh`
- Modify: `scripts/quick-test.sh`
- Modify: `tests/deployment/production-verification.sh`
- Modify: `tests/deployment/ssh-tunnel-verification.sh`

### Task 5a: `scripts/validate-production.sh`

**Step 1: Leer el archivo y ubicar las referencias al servicio**

Buscar: `systemctl is-active`, `systemctl show`, `journalctl -u sai-dashboard-api`

**Step 2: Reemplazar verificación de servicio por Docker**

Patrón de cambio para verificación de estado:
```bash
# Antes:
systemctl is-active sai-dashboard-api.service

# Después:
docker ps -q -f name=sai-dashboard -f status=running | grep -q .
```

Patrón para logs:
```bash
# Antes:
journalctl -u sai-dashboard-api.service --since "1 hour ago" | grep "Stage 1:"

# Después:
docker logs --since 1h sai-dashboard 2>&1 | grep "Stage 1:"
```

**Step 3: Commit parcial**

```bash
git add scripts/validate-production.sh
git commit -m "chore: update validate-production.sh to use Docker"
```

### Task 5b: `scripts/quick-test.sh`

**Step 1: Leer el archivo**

Buscar línea ~104: `systemctl is-active nginx`

**Step 2: Evaluar si hay referencias al API (no a nginx)**

Si solo hay referencias a nginx: no tocar.
Si hay referencias a `sai-dashboard-api`: reemplazar según la tabla de equivalencias.

**Step 3: Commit si hubo cambios**

```bash
git add scripts/quick-test.sh
git commit -m "chore: update quick-test.sh service checks to Docker"
```

### Task 5c: `tests/deployment/production-verification.sh`

**Step 1: Leer el archivo y ubicar `test_service_configuration()`**

El bloque empieza cerca de la línea 113:
```bash
SYSTEMD_SERVICE="/etc/systemd/system/sai-dashboard-api.service"
```

**Step 2: Reemplazar la función para verificar Docker**

La nueva función debe:
```bash
test_service_configuration() {
    log_info "Testing container configuration..."

    # Check Docker is running
    if ! command -v docker >/dev/null 2>&1; then
        log_fail "Docker not found"
        return 1
    fi

    # Check container exists and is running
    if docker ps -q -f name=sai-dashboard -f status=running | grep -q .; then
        log_pass "Container sai-dashboard is running"
    else
        log_fail "Container sai-dashboard is not running"
        log_info "Debug: docker ps -a -f name=sai-dashboard"
        docker ps -a -f name=sai-dashboard
        return 1
    fi

    # Check restart policy
    local restart_policy
    restart_policy=$(docker inspect sai-dashboard --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null)
    if [ "$restart_policy" = "unless-stopped" ]; then
        log_pass "Container restart policy: $restart_policy"
    else
        log_warn "Container restart policy is '$restart_policy' (expected 'unless-stopped')"
    fi
}
```

Reemplazar también cualquier `journalctl -u sai-dashboard-api` por `docker logs sai-dashboard`.

**Step 3: Actualizar la variable `SYSTEMD_SERVICE`**

Eliminar la línea `SYSTEMD_SERVICE=...` o reemplazarla con:
```bash
CONTAINER_NAME="sai-dashboard"
```

**Step 4: Commit**

```bash
git add tests/deployment/production-verification.sh
git commit -m "chore: update production-verification.sh to check Docker container"
```

### Task 5d: `tests/deployment/ssh-tunnel-verification.sh`

**Step 1: Leer el archivo**

Buscar líneas ~82-89 que verifican `tunnel-dashboard.service` y `tunnel-dashboard-api.service`.

**Step 2: Evaluar cambios necesarios**

Los tunnels SSH *sí* siguen siendo servicios systemd — mantener esas verificaciones. Solo remover si hay verificaciones de `sai-dashboard-api.service` (el API service, no los tunnel services).

**Step 3: Commit si hubo cambios**

```bash
git add tests/deployment/ssh-tunnel-verification.sh
git commit -m "chore: remove API systemd checks from tunnel verification"
```

---

## Task 6: Actualizar `tests/README.md` y `tests/test-runner.sh`

**Files:**
- Modify: `tests/README.md`
- Modify: `tests/test-runner.sh`

**Step 1: Actualizar `tests/README.md`**

Cambios en:
- Línea 108: "Service configuration and systemd testing" → "Service configuration and Docker testing"
- Línea 145: Reemplazar "systemd" por "docker" en la lista de herramientas
- Líneas 211, 214: Reemplazar comandos systemctl/journalctl del API por Docker
- Línea 223: Mantener `sudo systemctl reload nginx` (nginx sigue siendo systemd)

**Step 2: Actualizar `tests/test-runner.sh`**

Buscar el comentario de la línea 162: `# Test 4: Service Configuration and systemd`
Cambiar a: `# Test 4: Service Configuration and Docker`

Actualizar la función para llamar a la verificación Docker en vez de systemd.

**Step 3: Commit**

```bash
git add tests/README.md tests/test-runner.sh
git commit -m "docs: update test docs and runner to reference Docker instead of systemd"
```

---

## Task 7: Actualizar docs restantes

**Files:**
- Modify: `docs/SSE_IMPLEMENTATION.md`
- Modify: `database/triggers/README.md`
- Modify: `database/migrations/README.md`
- Modify: `nginx/sai-altermundi-net.conf` (comentario de línea 173)

**Step 1: `docs/SSE_IMPLEMENTATION.md` línea ~239**

```bash
# Antes:
sudo journalctl -u sai-dashboard-api.service --since '5 minutes ago' | grep "SSE client"

# Después:
docker logs --since 5m sai-dashboard 2>&1 | grep "SSE client"
```

**Step 2: `database/triggers/README.md` líneas ~191,194**

```bash
# Antes:
sudo systemctl status sai-dashboard-api
sudo journalctl -u sai-dashboard-api | grep "LISTEN"

# Después:
docker ps -f name=sai-dashboard
docker logs sai-dashboard 2>&1 | grep "LISTEN"
```

**Step 3: `database/migrations/README.md` línea ~228**

```bash
# Antes:
sudo systemctl restart sai-dashboard-api

# Después:
docker restart sai-dashboard
```

**Step 4: `nginx/sai-altermundi-net.conf` línea ~173**

Si hay un comentario que referencie `systemd/sai-dashboard-tunnel.service`, actualizarlo para indicar que el archivo está en `systemd/sai-dashboard-tunnel.service` en el repositorio (la referencia en sí puede ser válida si apunta al archivo correcto).

**Step 5: Commit**

```bash
git add docs/SSE_IMPLEMENTATION.md database/triggers/README.md \
        database/migrations/README.md nginx/sai-altermundi-net.conf
git commit -m "docs: replace systemd API references with Docker commands in remaining docs"
```

---

## Task 8: Limpiar `scripts/claude-dev-sudoers`

**Contexto:** El archivo configura permisos sudo para el agente Claude en desarrollo. Permitir `systemctl restart sai-dashboard-api` ya no tiene sentido (el API es Docker).

**Files:**
- Modify: `scripts/claude-dev-sudoers`

**Step 1: Leer el archivo**

Verificar las líneas 15-21 que permiten systemctl/journalctl para `sai-dashboard-api`.

**Step 2: Reemplazar con permisos Docker**

```
# Antes:
/usr/bin/systemctl status *
/usr/bin/systemctl restart sai-dashboard-api
/usr/bin/systemctl stop sai-dashboard-api
/usr/bin/systemctl start sai-dashboard-api
/usr/bin/journalctl -u sai-dashboard-api *

# Después:
/usr/bin/systemctl status *
/usr/bin/docker restart sai-dashboard
/usr/bin/docker stop sai-dashboard
/usr/bin/docker start sai-dashboard
/usr/bin/docker logs *
```

**Step 3: Commit**

```bash
git add scripts/claude-dev-sudoers
git commit -m "chore: update sudoers to grant Docker permissions instead of systemd API service"
```

---

## Task 9: Verificación final

**Step 1: Buscar referencias remanentes**

```bash
grep -r "sai-dashboard-api\|journalctl.*sai-dashboard\|systemctl.*sai-dashboard-api" \
  --include="*.{md,sh,ts,js,json,yml,yaml}" \
  --exclude-dir=".git" \
  --exclude-dir=".worktrees" \
  --exclude-dir="docs/archive" \
  .
```
Expected: cero resultados (o solo en `docs/archive/` que se preservan intencionalmente).

**Step 2: Verificar que deploy.yml sigue funcionando conceptualmente**

```bash
cat .github/workflows/deploy.yml
```
Expected: el workflow hace `systemctl stop sai-dashboard-api 2>/dev/null || true` (cleanup de migración) seguido de `docker run`. Esto es correcto y se puede mantener algunos releases más hasta confirmar que no quedan instancias con el viejo servicio.

**Step 3: Commit final si hubo ajustes**

```bash
git add -A
git commit -m "chore: final cleanup of systemd deployment references"
```

---

## Archivos que NO se tocan

| Archivo | Razón |
|---|---|
| `docs/archive/TWO_STAGE_ETL_SUMMARY.md` | Archivo histórico/archivado, no se actualiza |
| `nginx/README.md` y nginx configs | nginx sigue usando systemd |
| `systemd/sai-dashboard-tunnel.service` (excepto Task 2) | SSH tunnels siguen siendo systemd |
| `.github/workflows/deploy.yml` líneas 60-62 | El `systemctl stop ... || true` es cleanup de migración, correcto mantener |
| `backend/package.json` `"name": "sai-dashboard-api"` | Nombre del paquete npm, no relacionado a systemd |
| `.lattice/` | Tracking interno, no documentación operativa |
