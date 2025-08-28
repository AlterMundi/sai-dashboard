# SAI Image Analysis Dashboard

**Focused MVP for visual management of SAI's primary n8n workflow**

## 🎯 Project Overview

This dashboard specifically targets the management and analysis of the **"Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto"** workflow, which handles 99.9% of the SAI n8n system activity (4,893 of 4,895 total executions).

### Core Problem Solved
The native n8n UI is inefficient for daily operational tasks related to image processing workflows:
- ❌ Can't efficiently browse image execution history
- ❌ Hard to see actual images and analysis results together  
- ❌ Payload inspection is clunky for visual data
- ❌ No quick way to identify pattern failures
- ❌ Difficult to track analysis quality over time

### Solution: Visual Workflow Dashboard
✅ **Image Gallery View**: See actual processed images with results at a glance  
✅ **Quick Failure ID**: Instantly spot and retry failed analyses  
✅ **Analysis Tracking**: Monitor Ollama's risk assessment patterns  
✅ **Delivery Status**: Confirm Telegram notifications were sent  
✅ **Payload Inspector**: Full-size image viewer with analysis overlay  

## 🏗️ Architecture

```
SAI Dashboard (Read-Only Consumer)
├── Frontend (React SPA)
│   ├── Image Gallery Component
│   ├── Execution Detail Viewer  
│   ├── Filter & Search Interface
│   └── Analysis Overlay Display
├── Backend API (Node.js)
│   ├── PostgreSQL Queries (Read-Only)
│   ├── Image Data Extraction
│   ├── Execution Status Tracking
│   └── Ollama Results Parsing
└── Database Integration
    ├── Direct connection to n8n PostgreSQL
    ├── Focus on execution_entity + execution_data
    └── No write operations (safety first)
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

## 🚀 Implementation Phases

### Phase 1: MVP Core (Week 1-2)
- [ ] Basic image gallery with execution status
- [ ] Direct PostgreSQL integration (read-only)
- [ ] Image extraction from execution payloads
- [ ] Simple filtering (date, status)
- [ ] Responsive grid layout

### Phase 2: Enhanced Details (Week 3-4)  
- [ ] Full-screen image viewer with analysis overlay
- [ ] Ollama confidence scores and reasoning display
- [ ] Telegram delivery confirmation tracking
- [ ] Execution timing and performance metrics
- [ ] Error details and retry functionality

### Phase 3: Pattern Recognition (Future)
- [ ] Risk level filtering and analysis
- [ ] Similar image detection
- [ ] Analysis quality trending
- [ ] Automated anomaly detection
- [ ] Advanced search capabilities

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
- **CORS** enabled for development
- **Helmet** for security headers

### Database
- **Read-only access** to existing n8n PostgreSQL 17.5
- **Connection pooling** for performance
- **Query optimization** for image data extraction
- **No modifications** to existing schema

### Deployment
- **Docker** containers for consistency
- **Environment-based** configuration
- **Reverse proxy** integration ready
- **Health checks** and monitoring

## 🔐 Security Considerations

### Database Access
- **Read-only user** with minimal privileges
- **Connection through existing n8n database**
- **No write operations** allowed
- **Query timeout limits** for safety

### API Security  
- **CORS** configuration for domain restrictions
- **Rate limiting** on API endpoints
- **Input validation** and sanitization
- **Error handling** without data exposure

### Image Handling
- **Base64 extraction** from JSON payloads
- **Size limits** for image processing
- **Memory management** for large datasets
- **Secure image serving** with proper headers

## 📁 Project Structure

```
sai-dashboard/
├── README.md
├── docker-compose.yml
├── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   ├── package.json
│   └── Dockerfile
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
    ├── DEPLOYMENT.md
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

## 🔄 Integration with SAI Infrastructure

### n8n Integration
- **Database Connection**: Direct read access to existing PostgreSQL
- **Webhook Awareness**: Understanding of trigger endpoints and payloads  
- **Credential Safety**: No access to sensitive credential data
- **Service Harmony**: No interference with existing n8n operations

### Deployment Alignment
- **Port Management**: Avoid conflicts with n8n (5678) and system services
- **Resource Usage**: Minimal CPU/memory impact on production workloads
- **Backup Compatibility**: Works with existing backup and maintenance scripts
- **Monitoring Integration**: Compatible with current health check systems

## 📚 Development Resources

### Database Analysis
- **Complete schema documentation** available in `/root/sai-n8n/docs/N8N_DATABASE_OPERATIVE_MANUAL.md`
- **Operational queries** and performance patterns documented
- **Safety protocols** for read-only operations established

### n8n Context
- **Service configuration** in `/root/sai-n8n/configs/n8n.service`
- **Maintenance scripts** in `/root/sai-n8n/scripts/`
- **API documentation** in `/root/sai-n8n/docs/N8N_API_REFERENCE.md`

### Workflow Templates
- **2,053 workflow examples** in `/root/sai-n8n/n8n-workflows/`
- **Pattern library** for understanding common n8n structures
- **Integration examples** for various service types

---

*Project Initialized: August 28, 2025*  
*Target MVP: September 15, 2025*  
*Focus: SAI Image Analysis Workflow Management*