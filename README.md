# SAI Image Analysis Dashboard

**Streamlined visual interface for monitoring SAI's primary n8n workflow**

## 🎯 Project Overview

This dashboard specifically targets the management and analysis of the **"Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto"** workflow, which handles 99.9% of the SAI n8n system activity (4,893 of 4,895 total executions).

### Core Problem Solved
The native n8n UI is inefficient for daily operational tasks related to image processing workflows:
- ❌ Can't efficiently browse image execution history
- ❌ Hard to see actual images and analysis results together  
- ❌ Payload inspection is clunky for visual data
- ❌ No quick way to identify pattern failures
- ❌ Difficult to track analysis quality over time

### Solution: Focused Visual Dashboard
✅ **Image Gallery View**: Browse processed images with results  
✅ **Real-time Updates**: Server-Sent Events for new executions  
✅ **Efficient Caching**: Filesystem-based image cache at `/mnt/raid1/n8n/backup/images/`  
✅ **Simple Authentication**: Password-protected for public access  
✅ **Performance Optimized**: Handles base64 images from database efficiently  

## 🏗️ Architecture

```
SAI Dashboard (Autonomous Read-Only Consumer)
├── Frontend (React SPA)
│   ├── Image Gallery with Lazy Loading
│   ├── Authentication Layer  
│   ├── Server-Sent Events Client
│   └── Responsive Grid Layout
├── Backend API (Node.js/Express)
│   ├── Simple Password Authentication
│   ├── PostgreSQL Read-Only Access
│   ├── Filesystem Image Cache
│   ├── SSE Event Stream
│   └── Rate Limiting & Security
├── Cache Layer
│   ├── Filesystem: /mnt/raid1/n8n/backup/images/
│   ├── Structure: by-date, by-execution, by-status
│   └── Future: Redis for hot data
└── Database Integration
    ├── Read-only PostgreSQL user
    ├── Restricted views for security
    └── Two-phase query pattern
```

## 📊 Data Sources & Context

### Primary n8n Database Tables
- **`workflow_entity`**: Workflow definitions (37 total, 4 active)
- **`execution_entity`**: Execution lifecycle (4,895 total, 99.96% success rate)  
- **`execution_data`**: Runtime data with image payloads
- **`credentials_entity`**: 29 credential sets (Telegram, Ollama, etc.)

### SAI Workflow Specifics
**Target Workflow ID**: `yDbfhooKemfhMIkC`  
**Node Count**: 10 nodes  
**Execution Pattern**: Webhook-triggered (POST to `/e861ad7c-8160-4964-8953-5e3a02657293`)  
**Primary Flow**: Image Upload → Ollama Analysis → Telegram Notification  
**Success Rate**: 99.96% (4,892 successful / 4,893 total)  

### Integration Points
- **Ollama API**: `qwen2.5vl:7b` model for image analysis
- **Telegram Bot**: Multiple bot configurations for notifications  
- **Google Services**: Sheets, Drive for potential data storage
- **Webhook Endpoint**: `https://ai.altermundi.net/pipelines/e861ad7c-8160-4964-8953-5e3a02657293`


## 🛠️ Technology Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development
- **Tailwind CSS** for responsive design
- **React Query** for server state management
- **React Image Gallery** for image viewing

### Backend  
- **Node.js** with Express
- **TypeScript** for type safety
- **PostgreSQL client** (pg) for database access
- **Sharp** for image processing and thumbnails
- **Express Rate Limit** for API protection
- **Helmet** for security headers
- **bcrypt** for password hashing

### Database
- **Read-only user** with restricted views
- **Connection pooling** (5-10 connections)
- **Two-phase queries** to avoid memory issues
- **No modifications** to n8n schema
- **Parameterized queries** for security

### Deployment
- **Direct Node.js** deployment via systemd service
- **HTTPS required** for public access
- **Nginx reverse proxy** with SSL termination
- **Health checks** at `/dashboard/api/health`
- **Filesystem cache** persisted on RAID at `/mnt/raid1/n8n/backup/images/`

## 🔐 Security Considerations

### Database Access
- **Read-only user** with minimal privileges
- **Connection through existing n8n database**
- **No write operations** allowed
- **Query timeout limits** for safety

### API Security  
- **Password authentication** for browser access
- **Rate limiting**: 60 req/min general, 5 login attempts/15min
- **Input validation** with parameterized queries
- **Session management** with token expiration
- **HTTPS enforced** for production

### Image Handling
- **Base64 extraction** from n8n database (already stored)
- **Filesystem caching** to avoid repeated extraction
- **Thumbnail generation** for gallery performance
- **Lazy loading** to manage memory usage
- **Direct image URLs** instead of JSON embedding

## 📁 Project Structure

```
sai-dashboard/
├── README.md
├── install-production.sh   # Production deployment script with quality checks
├── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   ├── package.json
│   └── Dockerfile
├── database/
│   ├── queries.sql
│   ├── schema-analysis.md
│   └── test-data.json
└── docs/
    ├── API.md
    ├── ARCHITECTURE_ANALYSIS.md
    ├── DECISIONS.md
    └── DEVELOPMENT.md
```

## 🎯 Success Metrics

### MVP Success Criteria
- [ ] Display last 100 image executions in under 2 seconds
- [ ] Show actual images with analysis results
- [ ] Filter by date, status, and risk level
- [ ] Identify and display failed executions
- [ ] Confirm Telegram delivery status

### User Experience Goals
- [ ] Reduce time to identify issues from 5+ minutes to 30 seconds
- [ ] Enable visual pattern recognition across executions
- [ ] Provide quick access to execution payloads and details
- [ ] Support daily operational workflows efficiently
ith current health check systems

## 📚 Development Resources

### Database Analysis
- **Complete schema documentation** available in `/root/sai-n8n/docs/N8N_DATABASE_OPERATIVE_MANUAL.md`
- **Operational queries** and performance patterns documented
- **Safety protocols** for read-only operations established

### n8n Context
- **Service configuration** in `/root/sai-n8n/configs/n8n.service`
- **Maintenance scripts** in `/root/sai-n8n/scripts/`
- **API documentation** in `/root/sai-n8n/docs/N8N_API_REFERENCE.md`

---

*Project Initialized: August 28, 2025*  
*Target MVP: September 7, 2025 (10 days)*  
*Production Ready: September 14, 2025*  
*Focus: Efficient visual monitoring with public access capability*