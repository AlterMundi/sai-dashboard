# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## 🎯 Project Overview

SAI Dashboard is a **real-time fire monitoring system** for the SAI (Sistema de Alerta de Incendios) network. Processes images from distributed camera nodes with instant fire detection analysis.

**Stack**: React 18 + TypeScript, Node.js + Express, PostgreSQL, hybrid image storage (JPEG + WebP)

## 🚀 Development

```bash
# Production deployment
./install-production.sh
```

## 📊 Architecture

- **Monorepo** with npm workspaces (backend + frontend)
- **Dual databases**: n8n (read-only) + sai_dashboard (optimized)
- **ETL Pipeline**: PostgreSQL NOTIFY/LISTEN for real-time data processing
- **API**: Self-contained under `/dashboard/api/*`
- **SSE** for real-time updates
- **JWT** authentication
- **Image cache**: `/mnt/raid1/n8n/backup/images/`

## 🌐 Production

- Frontend: https://sai.altermundi.net/dashboard/
- API: https://sai.altermundi.net/dashboard/api/
- nginx reverse proxy with SSH tunnels

## 🔑 Key Files

**Backend**:
- `backend/src/index.ts` - Express server
- `backend/src/routes/index.ts` - API endpoints
- `backend/src/middleware/auth.ts` - JWT auth

**Frontend**:
- `frontend/src/main.tsx` - React app
- `frontend/src/App.tsx` - Router
- `frontend/src/contexts/SSEContext.tsx` - Real-time

**Config**:
- `.env.example` - Environment variables
- `install-production.sh` - Deploy script

## 📝 Notes

- Always use `./install-production.sh` for production (never manual builds)
- Backend port: 3001, Frontend port: 3000
- Path aliases (`@/`) resolved via `tsc-alias`
- See `.env.example` for all configuration options

## ⚠️ ETL Implementation Lessons (September 2025)

**Critical Issue Resolution**: ETL pipeline not processing new executions

**Root Cause**: Missing database columns and PostgreSQL connection setup
- `execution_analysis.alert_priority` and `response_required` columns missing
- `execution_notifications` table required for service queries
- ETL notification listener needs separate PostgreSQL client connection

**Fix Applied**:
```sql
-- Add missing columns
ALTER TABLE execution_analysis ADD COLUMN alert_priority VARCHAR(20) DEFAULT 'normal';
ALTER TABLE execution_analysis ADD COLUMN response_required BOOLEAN DEFAULT FALSE;

-- Verify table exists
CREATE TABLE IF NOT EXISTS execution_notifications (...);
```

**Validation Steps**:
1. Check service status: `systemctl status sai-dashboard-api.service`
2. Test NOTIFY: `NOTIFY sai_execution_ready, '{"execution_id": 99999}'`
3. Verify logs: `journalctl -u sai-dashboard-api.service | grep notification`
4. Expected: `📬 Received notification for execution 99999`

**Status**: ✅ ETL pipeline operational, processing live executions via PostgreSQL triggers