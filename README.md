# SAI Dashboard

**Real-time fire detection monitoring system with YOLO-based image analysis**

## 🎯 Project Overview

SAI Dashboard is a data analysis tool for the **SAI (Sistema de Alerta de Incendios)** - a real-time fire monitoring system that processes images from distributed camera nodes with YOLO-based fire detection.

### Core Features
✅ **Image Gallery View** - Browse processed images with YOLO fire/smoke detection results
✅ **Real-time Updates** - Server-Sent Events for instant execution notifications
✅ **Two-Stage ETL** - Fast metadata extraction (<20ms) + deep analysis (50-300ms)
✅ **Efficient Caching** - Filesystem-based image cache with WebP conversion
✅ **Pure YOLO Schema** - Direct integration with YOLO Inference service

### Quick Stats
- **Total Executions:** 143,473
- **Success Rate:** 98.05%
- **ETL Performance:** Stage 1: ~15ms, Stage 2: ~120ms
- **Production URL:** https://sai.altermundi.net/dashboard/

---

## 🚀 Quick Start

### Development
```bash
# Clone repository
git clone https://github.com/your-org/sai-dashboard.git
cd sai-dashboard

# Setup environment
cp .env.example .env
# Edit .env with your database credentials

# Install dependencies
npm install

# Start development servers
cd backend && npm run dev    # Terminal 1: API on :3001
cd frontend && npm run dev   # Terminal 2: UI on :3000
```

### Production Deployment
```bash
# Use the automated deployment script
./install-production.sh

# This handles:
# - Dependency installation
# - Backend/frontend builds
# - Database migrations
# - Quality checks
# - Service restart
```

---

## 🏗️ Architecture

**Stack:** React 18 + TypeScript, Node.js + Express, PostgreSQL, SSH Tunnel + nginx

### Two-Stage ETL Pipeline
```
n8n Workflow (YOLO Fire Detection)
         ↓
[STAGE 1] Fast metadata extraction (<20ms)
    → Dashboard shows execution immediately
         ↓
[STAGE 2] Deep YOLO analysis extraction (50-300ms)
    → Images, detections, bounding boxes, alerts
         ↓
[SSE Broadcast] Real-time UI updates
```

### Deployment Architecture
```
Public Server (sai.altermundi.net:443)
    ↓ [nginx reverse proxy]
    ↓ [SSH Tunnel]
    ↓
Private Server
    ├── Dashboard Frontend :3000
    ├── Dashboard API :3001
    ├── n8n Database (PostgreSQL)
    └── Image Cache (RAID: /mnt/raid1/n8n-backup/images/)
```

---

## 🗄️ Database Schema (Pure YOLO)

**Status:** ✅ Migration 004 Complete - All legacy Ollama fields removed

### Primary Tables
- `executions` - Core execution records (Stage 1 ETL)
- `execution_analysis` - YOLO fire/smoke detection results (Stage 2 ETL)
- `execution_detections` - Bounding boxes for detected fires/smoke
- `execution_images` - Image cache metadata and paths
- `execution_notifications` - Telegram alert status
- `etl_processing_queue` - ETL pipeline management

**Key Fields:** `alert_level`, `has_fire`, `has_smoke`, `detection_count`, `confidence_fire`, `confidence_smoke`

See [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) for complete ER diagram.

---

## 📚 Documentation

### Essential Docs (in `/docs`)
- **[CONSOLIDATED_DOCUMENTATION.md](docs/CONSOLIDATED_DOCUMENTATION.md)** ← **START HERE** - Complete system guide
- **[API.md](docs/API.md)** - REST API reference and examples
- **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** - Production deployment procedures
- **[DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)** - Database ER diagram and schema
- **[TWO_STAGE_ETL_ARCHITECTURE.md](docs/TWO_STAGE_ETL_ARCHITECTURE.md)** - ETL pipeline deep dive
- **[DATA_INTEGRITY_PRINCIPLES.md](docs/DATA_INTEGRITY_PRINCIPLES.md)** - Data philosophy (NULL = "not available")
- **[SSE_IMPLEMENTATION.md](docs/SSE_IMPLEMENTATION.md)** - Real-time updates troubleshooting

### Historical Docs
Archived analysis and migration docs available in `/docs/archive/`

---

## 🔧 Operational Commands

```bash
# Check system health
curl https://sai.altermundi.net/dashboard/api/health

# View logs
docker logs -f sai-dashboard

# Restart container
docker restart sai-dashboard

# Check ETL queue
psql -U sai_dashboard_user -d sai_dashboard -c "SELECT * FROM etl_queue_health"

# SSH tunnel status
sudo systemctl status sai-tunnels
```

---

## 🚨 Troubleshooting

See [CONSOLIDATED_DOCUMENTATION.md](docs/CONSOLIDATED_DOCUMENTATION.md#troubleshooting) for detailed solutions to:
- Dashboard not loading
- SSE connection issues
- ETL processing failures
- Image loading problems
- Performance issues

---

## 📞 Support

- **Documentation:** [docs/CONSOLIDATED_DOCUMENTATION.md](docs/CONSOLIDATED_DOCUMENTATION.md)
- **Issues:** GitHub Issues
- **Health Check:** https://sai.altermundi.net/dashboard/api/health

---

**Version:** 2.0 (Pure YOLO Schema)
**Last Updated:** October 10, 2025
**Status:** ✅ Production Ready
