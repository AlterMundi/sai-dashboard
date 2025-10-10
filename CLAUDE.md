# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## 🎯 Project Overview

SAI Dashboard is a data analysis tool for the SAI (Sistema de Alerta de Incendios), a **real-time fire monitoring system** that processes images from distributed camera nodes with **YOLO-based fire detection**.

The system uses a custom YOLO inference service (NOT Ollama) that provides:
- Fire and smoke detection with bounding boxes
- Alert levels (none/low/medium/high/critical)
- Confidence scores per detection class
- Annotated images with detection overlays

**Stack**: React 18 + TypeScript, Node.js + Express, PostgreSQL, hybrid image storage (JPEG + WebP)

## 🚀 Development

```bash
# Production deployment
./install-production.sh
```

## 📊 Architecture

- **Monorepo** with npm workspaces (backend + frontend)
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

## ⚠️ ETL Implementation History

### October 2025: YOLO Schema Redesign

**Issue**: ETL extraction was designed for Ollama AI analysis but SAI uses custom YOLO inference service. Stage 2 ETL had 0% extraction success due to incorrect data structure assumptions.

**Root Causes**:
1. **Wrong AI system**: Code looked for Ollama nodes but workflow uses YOLO Inference
2. **Wrong data format**: n8n uses compact reference-based format, not direct JSON
3. **Schema mismatch**: Database had Ollama-specific columns instead of YOLO fields

**Fix Applied** (Migration 003):
- Removed all Ollama references (`ollama_response`, `has_ollama_analysis`)
- Added YOLO fields: `alert_level`, `detection_count`, `has_fire`, `has_smoke`, `confidence_fire`, `confidence_smoke`
- Added device/location metadata: `device_id`, `location`, `camera_type`, `capture_timestamp`
- Created `execution_detections` table for bounding boxes
- Completely rewrote Stage 2 ETL with n8n compact format parser

**N8N Data Format**:
- Data is an array with string-indexed references (e.g., `"69"` points to `data[69]`)
- Must recursively resolve references to access actual values
- Node outputs accessed via runData mapping

**Status**: ✅ YOLO extraction implemented, ready for deployment

### September 2025: Initial ETL Setup

**Issue**: ETL pipeline not processing new executions

**Fix**: Added missing database columns and PostgreSQL NOTIFY/LISTEN setup

**Status**: ✅ ETL pipeline operational