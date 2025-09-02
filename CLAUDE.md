# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🎯 Project Overview

SAI Dashboard is a **real-time fire monitoring system** that provides comprehensive visual monitoring for the SAI (Sistema de Alerta de Incendios) network. The system processes images from distributed camera nodes across different geographical regions and provides instant fire detection analysis with expert review capabilities.

**New Architecture (September 2025 - Optimized ETL System)**:
- **Separate sai_dashboard database** with optimized schema for performance
- **PostgreSQL trigger-based ETL** for immediate processing after n8n execution
- **Hybrid image storage**: JPEG originals + WebP variants for optimal performance
- **Node-based regional aggregation** for geographical coverage monitoring
- **Tiered real-time updates** via SSE with granular frequency control (10s-60s intervals)
- **Expert review system** for curated dataset development and quality assurance
- **Side-by-side deployment** maintaining full backward compatibility during migration

**Legacy Architecture (Pre-September 2025)**:
- Images extracted from n8n database base64 payloads
- Filesystem cache at `/mnt/raid1/n8n/backup/images/` for persistence  
- Two-phase query pattern to avoid memory issues (now obsolete)

## 🏗️ New Optimized Architecture (September 2025)

**Stack**: React 18 + TypeScript frontend, Node.js + Express API backend, dual PostgreSQL databases (n8n + sai_dashboard), hybrid image storage.

**Core Components**:
- **Frontend**: React SPA with real-time SSE updates, expert review interface, node-based filtering
- **Backend**: Express API with JWT authentication, ETL service, tiered SSE manager
- **Databases**: 
  - `n8n` database (source, read-only triggers)
  - `sai_dashboard` database (optimized schema, expert reviews, incidents)
- **ETL Service**: PostgreSQL LISTEN/NOTIFY driven processing with image optimization
- **Image Storage**: Hybrid approach - JPEG originals + WebP variants for performance
- **Regional Organization**: Node-based aggregation for geographical coverage monitoring

**New Image Storage Structure**:
```
/mnt/raid1/n8n/backup/images/
├── by-execution/{id}/
│   ├── original.jpg         # JPEG original (legal/archival)
│   ├── high.webp           # 1200x800 WebP (detail analysis)
│   ├── medium.webp         # 800x600 WebP (dashboard grid)  
│   ├── thumb.webp          # 400x300 WebP (preview)
│   ├── micro.webp          # 150x100 WebP (live strip)
│   └── metadata.json       # Quality scores, color analysis
├── by-node/
│   ├── NODE_001/           # Regional node grouping
│   │   ├── CAM_001/        # Individual cameras per node
│   │   ├── CAM_002/        # Shared geographical location
│   │   └── latest_high.webp → ../by-execution/{latest}/high.webp
│   └── NODE_002/
├── by-status/              # Risk-level organization
│   ├── critical/           # High-priority incidents  
│   ├── high/               # Elevated risk detections
│   └── medium/             # Standard monitoring
└── by-date/                # Temporal organization
    └── 2025/09/01/         # Daily archives
```

**Node-Based Regional Coverage**:
- **Node Identification**: Each camera node covers specific geographical area
- **Regional Filtering**: Quick access to specific coverage zones
- **Camera Aggregation**: Multiple cameras per node sharing location coordinates
- **Coverage Analysis**: Regional monitoring gaps and overlaps detection
- **Alert Escalation**: Node-based emergency response routing

## 🚀 Development Commands

### New System Setup (September 2025)
```bash
# Environment setup (includes new sai_dashboard database)
cp .env.example .env
# Edit .env with both n8n and sai_dashboard database connections

# Create sai_dashboard database and schema
psql -U postgres -c "CREATE DATABASE sai_dashboard;"
psql -U postgres -d sai_dashboard -f database/sai_dashboard_schema.sql

# Install ETL triggers on n8n database
psql -U postgres -d n8n -f database/n8n_etl_triggers.sql

# Create optimized image cache structure
sudo mkdir -p /mnt/raid1/n8n/backup/images/{by-execution,by-node,by-status,by-date,optimized/webp}
sudo chown -R $(whoami) /mnt/raid1/n8n/backup/images

# Populate historical data (4,893+ executions)
node scripts/populate-sai-dashboard.js

# Backend development with new ETL service
cd backend && npm install && npm run dev

# Frontend development with enhanced SSE and node filtering
cd frontend && npm install
VITE_BASE_PATH=/dashboard/ VITE_API_URL=/dashboard/api npm run dev
```

### Legacy System Setup (Pre-September 2025)
```bash
# Environment setup (secure credentials!)
cp .env.example .env
# Edit .env with proper database connection and DASHBOARD_PASSWORD

# Create cache directory structure
sudo mkdir -p /mnt/raid1/n8n/backup/images/{by-date,by-execution,by-status}
sudo chown -R $(whoami) /mnt/raid1/n8n/backup/images

# Backend development
cd backend && npm install && npm run dev

# Frontend development (CRITICAL: Must include API URL for production routing)
cd frontend && npm install
VITE_BASE_PATH=/dashboard/ VITE_API_URL=/dashboard/api npm run dev
```

## 🌐 Production Deployment (TESTED & WORKING)

### Production Setup
```bash
# installation script
./install-production.sh

# Test enhanced statistics endpoint with proper auth
# Get auth token first
curl -s "https://sai.altermundi.net/dashboard/api/auth/login" -H "Content-Type:application/json" -d '{"password":"SaiDash2025SecureProd"}' > /tmp/token.json
# Extract token
jq -r '.data.token' /tmp/token.json > /tmp/token.txt
# Or better
curl -s -X POST http://localhost:3001/dashboard/api/auth/login   -H "Content-Type: application/json"   -d '{"password":"SaiDash2025SecureProd"}'  | grep -o '"token":"[^"]*"' | cut -d'"' -f4  > /tmp/token.txt
# Test desired endpoint (example)
curl -s "https://sai.altermundi.net/dashboard/api/executions/stats/enhanced" -H "Authorization: Bearer $(cat /tmp/token.txt)"
```

### Critical Production Configuration

**Server Status (Reverse Tunnel Architecture):**
- Frontend: nginx port 80 (tunneled via remote port 3000 to sai.altermundi.net)
- Backend: API port 3001 (tunneled via remote port 3001 to sai.altermundi.net)  
- Database: 7,721+ SAI workflow executions successfully connected
- Tunnels: tunnel-dashboard.service and tunnel-dashboard-api.service (active)

**nginx Configuration Requirements:**
The following locations must be added to the existing sai.altermundi.net server block:

```nginx
# Dashboard - Exact redirect for trailing slash
location = /dashboard {
    return 301 $scheme://$server_name/dashboard/;
}

# Dashboard API - Backend routing (URL rewrite required)
location /dashboard/api/ {
    rewrite ^/dashboard/api/(.*) /api/$1 break;
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Dashboard Assets - Must come BEFORE general static assets location
location ~* ^/dashboard/.*\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    proxy_pass http://127.0.0.1:3000;  # Remote port via reverse tunnel
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}

# Dashboard Frontend - All other dashboard routes  
location /dashboard/ {
    proxy_pass http://127.0.0.1:3000/dashboard/;  # Remote port via reverse tunnel
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

**⚠️ Critical nginx Ordering Rules:**
1. Dashboard asset location MUST come before general `~* \.(js|css|...)$` location
2. API location requires URL rewrite: `/dashboard/api/xxx` → `/api/xxx` 
3. No `try_files` with `proxy_pass` - causes nginx errors
4. No URI parts in named locations - causes configuration failures

## 🏢 Monorepo Structure & Workspaces

This is a **monorepo** using npm workspaces. Key workspace understanding:

```bash
# Root-level commands affect all workspaces
npm install          # Installs all dependencies for all workspaces
npm run dev          # Runs both backend and frontend concurrently
npm test             # Runs tests in both backend and frontend
npm run lint         # Lints both backend and frontend
npm run type-check   # TypeScript validation for both apps

# Workspace-specific commands
npm run dev:backend  # Only backend development server
npm run dev:frontend # Only frontend development server (with proper env vars)
```

**Critical Workspace Rules**:
- Dependencies in individual `backend/package.json` and `frontend/package.json`
- Shared devDependencies (like concurrently) in root `package.json`
- Path aliases (`@/`) work independently in each workspace
- Build outputs: `backend/dist/` and `frontend/dist/`

### Development Workflow
```bash
# Full stack development (recommended)
npm run dev          # Runs both backend and frontend concurrently

# Backend API development (port 3001)
cd backend
npm run dev          # Start with hot reload (tsx watch)
npm run lint         # ESLint code checking with --fix
npm run type-check   # TypeScript validation without emit
npm test             # Jest test suite
npm run test:watch   # Jest in watch mode
npm run db:setup     # Initialize database views

# Frontend development (port 3000)
cd frontend  
npm run dev          # Vite dev server with hot reload
npm run lint         # ESLint + TypeScript checking with --fix
npm run type-check   # TypeScript validation without emit
npm test             # Vitest test suite
npm test:ui          # Vitest UI mode
npm test:coverage    # Test coverage report

# Running tests across the stack
npm test             # Run all tests (backend + frontend)
npm run test:watch   # Watch mode for all tests
npm run test:coverage # Coverage report for both apps
npm run test:quick   # Quick test script
npm run test:integration # Integration test suite
```

**Key Development Notes**:
- Backend uses `tsx` for TypeScript execution with hot reload in development
- Frontend uses Vite with React plugin and proxy configuration
- Path aliases: `@/` points to `src/` in both backend and frontend (via tsconfig.json)
- TypeScript: Strict mode enabled with path resolution and decorators
- Build process: `tsc && tsc-alias` for backend, Vite for frontend
- ESLint configured for TypeScript + React with auto-fix capabilities
- Testing: Jest with Supertest (backend), Vitest with React Testing Library (frontend)
- Workspaces: Monorepo structure with shared dependencies

### ⚠️ CRITICAL: Production Deployment Rules

**NEVER use `npm run build` directly for production!**

```bash
# ❌ WRONG - Manual builds can miss environment variables
cd frontend && npm run build
cd backend && npm run build

# ✅ CORRECT - Always use install script
./install-production.sh         # Standard deployment
./install-production.sh --force # Force complete rebuild
```

**Why the install script is mandatory:**
- **Environment Loading**: Properly loads all `.env` variables including `VITE_API_URL`
- **Build Validation**: Pre-build TypeScript checks prevent broken deployments
- **Dependency Resolution**: Handles path aliases and import resolution correctly
- **Service Integration**: Configures systemd services and nginx routing
- **Health Verification**: Tests API connectivity and database access post-deployment

### Production Installation
```bash
# Standard production deployment
./install-production.sh

# Force complete rebuild (use when environment variables change)
./install-production.sh --force

# The script includes:
# - Environment variable validation and loading
# - Pre-build TypeScript validation
# - Path alias resolution verification  
# - Database connectivity testing
# - Service configuration (systemd + nginx)
# - Post-deployment health checks
# - API routing verification
```

**⚡ Critical Production Lessons (2025-09-01):**
1. **Environment Variables**: Always use `--force` when `VITE_*` variables change to prevent cached build issues
2. **Path Aliases**: The `tsc-alias` step is CRITICAL - without it, `@/*` imports cause runtime failures
3. **Build Validation**: Install script includes validation that `@/*` patterns are resolved in compiled code
4. **API Routing**: Frontend MUST have `VITE_API_URL=/dashboard/api` or API calls fail with wrong paths

## 📊 Database Integration

### **Dual Database Architecture** (NEW - September 2025)

**N8N Database** (Source - Read-only):
- **Primary Tables**: `execution_entity`, `execution_data`, `workflow_entity`
- **Target Workflow**: "Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto" (ID: yDbfhooKemfhMIkC)
- **Purpose**: Source data extraction via PostgreSQL triggers
- **Safety**: Read-only access, no write operations

**SAI Dashboard Database** (Optimized Schema - Read/Write):
- **Optimized Tables**: `sai_executions`, `sai_images`, `monitoring_nodes`, `node_cameras`
- **Expert System**: `expert_assignments`, `expert_reviews`, `incident_reports` 
- **Performance**: 90% query load reduction, indexed for fast regional filtering
- **ETL Integration**: Real-time processing via LISTEN/NOTIFY triggers

**Key ETL Operations**:
- **Immediate Processing**: PostgreSQL triggers fire on n8n execution completion
- **Image Extraction**: Base64 → hybrid JPEG originals + WebP variants (150px, 300px thumbnails)
- **Node Assignment**: Camera location → regional node mapping for coverage analysis
- **Analysis Enhancement**: Ollama results → 160+ structured analysis fields
- **Real-time Notifications**: PostgreSQL NOTIFY → SSE client updates

## 🏔️ Node-Based Regional Data Architecture (NEW)

**Critical Feature**: Node-based aggregation enables regional coverage monitoring and geographical filtering for the distributed SAI camera network.

### **Node Structure and Organization**
```typescript
interface NodeStructure {
  nodeId: string;              // NODE_001, NODE_002, etc.
  nodeName: string;            // "Córdoba Centro", "Villa Carlos Paz"
  region: string;              // "Córdoba", "Buenos Aires"
  coordinates: {
    lat: number;               // -31.4135
    lng: number;               // -64.1811
    elevation: number;         // meters above sea level
    coverage_radius: number;   // monitoring radius in meters
  };
  cameras: CameraInfo[];       // Multiple cameras per node
  status: 'active' | 'maintenance' | 'offline';
  lastActivity: Date;
}

interface CameraInfo {
  cameraId: string;           // CAM_001, CAM_002
  cameraName: string;         // "Norte", "Sur", "Este", "Oeste"
  direction: number;          // degrees (0-360)
  fieldOfView: number;        // degrees  
  resolution: string;         // "1920x1080"
  nightVision: boolean;
  status: 'active' | 'fault' | 'maintenance';
}
```

### **Database Schema Extensions for Node Support**
```sql
-- Node registry table
CREATE TABLE monitoring_nodes (
    node_id VARCHAR(50) PRIMARY KEY,
    node_name VARCHAR(100) NOT NULL,
    region VARCHAR(50) NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    elevation_meters INTEGER,
    coverage_radius_meters INTEGER DEFAULT 5000,
    installation_date DATE,
    status ENUM('active', 'maintenance', 'offline') DEFAULT 'active',
    last_activity TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_region (region),
    INDEX idx_status (status),
    INDEX idx_location (latitude, longitude),
    INDEX idx_last_activity (last_activity DESC)
);

-- Camera registry per node
CREATE TABLE node_cameras (
    id SERIAL PRIMARY KEY,
    node_id VARCHAR(50) NOT NULL,
    camera_id VARCHAR(50) NOT NULL,
    camera_name VARCHAR(50),
    direction_degrees INTEGER,           -- 0-360 degrees
    field_of_view_degrees INTEGER,       -- FOV angle
    resolution VARCHAR(20),              -- "1920x1080"
    night_vision BOOLEAN DEFAULT FALSE,
    status ENUM('active', 'fault', 'maintenance') DEFAULT 'active',
    last_image_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE KEY idx_node_camera (node_id, camera_id),
    INDEX idx_node (node_id),
    INDEX idx_status (status),
    FOREIGN KEY (node_id) REFERENCES monitoring_nodes(node_id)
);

-- Enhanced execution_analysis with node data
ALTER TABLE execution_analysis ADD COLUMN node_id VARCHAR(50);
ALTER TABLE execution_analysis ADD INDEX idx_node_id (node_id);
ALTER TABLE execution_analysis ADD FOREIGN KEY (node_id) REFERENCES monitoring_nodes(node_id);
```

### **ETL Service Node Data Extraction**
```typescript
// Enhanced ETL service with node identification
class NodeAwareETLService extends ETLService {
  private extractNodeData(executionData: any): NodeExtraction {
    const parsedData = JSON.parse(executionData.data);
    
    // Extract node information from multiple possible sources
    const nodeData = this.identifyNode(parsedData);
    const cameraData = this.identifyCamera(parsedData);
    
    return {
      nodeId: nodeData.nodeId,
      nodeName: nodeData.nodeName,
      region: nodeData.region,
      cameraId: cameraData.cameraId,
      cameraDirection: cameraData.direction,
      coordinates: nodeData.coordinates
    };
  }
  
  private identifyNode(parsedData: any): NodeInfo {
    // Multiple extraction strategies for node identification
    
    // Strategy 1: Direct node_id in webhook payload
    let nodeId = parsedData?.nodeInputData?.Webhook?.[0]?.json?.node_id ||
                 parsedData?.nodeInputData?.Webhook?.[0]?.json?.body?.node_id;
    
    // Strategy 2: Extract from camera_id pattern (CAM_001 → NODE_001)
    const cameraId = parsedData?.nodeInputData?.Webhook?.[0]?.json?.camera_id ||
                     parsedData?.nodeInputData?.Webhook?.[0]?.json?.body?.camera_id;
    
    if (!nodeId && cameraId) {
      // Pattern: CAM_001_A → NODE_001, CAM_002_B → NODE_002
      const nodeMatch = cameraId.match(/CAM_(\d+)/);
      if (nodeMatch) {
        nodeId = `NODE_${nodeMatch[1].padStart(3, '0')}`;
      }
    }
    
    // Strategy 3: GPS coordinates to node mapping
    const gps = this.extractGPSCoordinates(parsedData);
    if (!nodeId && gps) {
      nodeId = this.findNearestNode(gps.lat, gps.lng);
    }
    
    // Strategy 4: IP address to node mapping (network topology)
    const sourceIP = parsedData?.nodeInputData?.Webhook?.[0]?.json?.headers?.['x-forwarded-for'];
    if (!nodeId && sourceIP) {
      nodeId = this.mapIPToNode(sourceIP);
    }
    
    return this.enrichNodeInfo(nodeId);
  }
  
  private async createNodeSymlinks(executionId: number, nodeData: NodeInfo): Promise<void> {
    const baseImagePath = `/mnt/raid1/n8n/backup/images/by-execution/${executionId}`;
    
    // Create node-based organization
    const nodeDir = `/mnt/raid1/n8n/backup/images/by-node/${nodeData.nodeId}`;
    const cameraDir = `${nodeDir}/${nodeData.cameraId}`;
    
    await fs.mkdir(cameraDir, { recursive: true });
    
    // Create symlinks for different image variants
    const variants = ['original.jpg', 'high.webp', 'medium.webp', 'thumb.webp'];
    
    for (const variant of variants) {
      const sourcePath = `${baseImagePath}/${variant}`;
      const linkPath = `${cameraDir}/${executionId}_${variant}`;
      
      if (await fs.exists(sourcePath)) {
        const relativePath = path.relative(cameraDir, sourcePath);
        await fs.symlink(relativePath, linkPath).catch(() => {}); // Ignore if exists
      }
    }
    
    // Update "latest" links for quick access
    await this.updateLatestLinks(nodeData, executionId);
  }
  
  private async updateLatestLinks(nodeData: NodeInfo, executionId: number): Promise<void> {
    const nodeDir = `/mnt/raid1/n8n/backup/images/by-node/${nodeData.nodeId}`;
    const latestHigh = `${nodeDir}/latest_high.webp`;
    const latestThumb = `${nodeDir}/latest_thumb.webp`;
    
    const sourceHigh = `../by-execution/${executionId}/high.webp`;
    const sourceThumb = `../by-execution/${executionId}/thumb.webp`;
    
    // Update latest symlinks (remove old, create new)
    await fs.unlink(latestHigh).catch(() => {});
    await fs.unlink(latestThumb).catch(() => {});
    await fs.symlink(sourceHigh, latestHigh).catch(() => {});
    await fs.symlink(sourceThumb, latestThumb).catch(() => {});
  }
}
```

### **API Endpoints for Node-Based Filtering**
```typescript
// Enhanced API with node-based endpoints
app.get('/api/nodes', async (req, res) => {
  // GET /api/nodes - List all monitoring nodes with status
  const nodes = await db.query(`
    SELECT 
      n.*,
      COUNT(c.camera_id) as camera_count,
      COUNT(CASE WHEN c.status = 'active' THEN 1 END) as active_cameras,
      COUNT(e.id) as executions_today
    FROM monitoring_nodes n
    LEFT JOIN node_cameras c ON n.node_id = c.node_id
    LEFT JOIN executions e ON n.node_id = e.node_id AND DATE(e.execution_timestamp) = CURRENT_DATE
    GROUP BY n.node_id
    ORDER BY n.region, n.node_name
  `);
  
  res.json({ data: nodes });
});

app.get('/api/nodes/:nodeId', async (req, res) => {
  // GET /api/nodes/NODE_001 - Detailed node information
  const { nodeId } = req.params;
  
  const nodeInfo = await db.query(`
    SELECT * FROM monitoring_nodes WHERE node_id = $1
  `, [nodeId]);
  
  const cameras = await db.query(`
    SELECT * FROM node_cameras WHERE node_id = $1 ORDER BY camera_name
  `, [nodeId]);
  
  const recentExecutions = await db.query(`
    SELECT e.*, ea.risk_level, ea.confidence_score
    FROM executions e
    JOIN execution_analysis ea ON e.id = ea.execution_id
    WHERE ea.node_id = $1
    ORDER BY e.execution_timestamp DESC
    LIMIT 50
  `, [nodeId]);
  
  res.json({
    data: {
      node: nodeInfo[0],
      cameras,
      recentExecutions
    }
  });
});

app.get('/api/executions', async (req, res) => {
  // Enhanced executions endpoint with node filtering
  const { nodeId, region, cameraId } = req.query;
  
  let whereConditions = ['1=1'];
  const queryParams = [];
  
  if (nodeId) {
    whereConditions.push('ea.node_id = $' + (queryParams.length + 1));
    queryParams.push(nodeId);
  }
  
  if (region) {
    whereConditions.push('n.region = $' + (queryParams.length + 1));
    queryParams.push(region);
  }
  
  if (cameraId) {
    whereConditions.push('ea.camera_id = $' + (queryParams.length + 1));
    queryParams.push(cameraId);
  }
  
  const query = `
    SELECT 
      e.*,
      ea.risk_level, ea.confidence_score, ea.node_id, ea.camera_id,
      n.node_name, n.region, n.latitude, n.longitude
    FROM executions e
    JOIN execution_analysis ea ON e.id = ea.execution_id
    LEFT JOIN monitoring_nodes n ON ea.node_id = n.node_id
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY e.execution_timestamp DESC
    LIMIT 50
  `;
  
  const executions = await db.query(query, queryParams);
  res.json({ data: executions });
});

app.get('/api/coverage/map', async (req, res) => {
  // GET /api/coverage/map - Geographic coverage visualization data
  const coverageData = await db.query(`
    SELECT 
      n.node_id, n.node_name, n.region,
      n.latitude, n.longitude, n.coverage_radius_meters,
      COUNT(e.id) as executions_last_24h,
      COUNT(CASE WHEN ea.risk_level IN ('high', 'critical') THEN 1 END) as high_risk_count,
      MAX(e.execution_timestamp) as last_activity
    FROM monitoring_nodes n
    LEFT JOIN executions e ON n.node_id = e.node_id AND e.execution_timestamp > NOW() - INTERVAL '24 hours'
    LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
    GROUP BY n.node_id
    ORDER BY n.region, n.node_name
  `);
  
  res.json({ data: coverageData });
});
```

### **Frontend Node-Based Components**
```typescript
// Node filter component
const NodeFilter: React.FC = () => {
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [selectedNode, setSelectedNode] = useState<string>('');
  const { data: nodes } = useQuery(['nodes'], fetchNodes);
  
  const regions = useMemo(() => {
    return [...new Set(nodes?.map(node => node.region))].sort();
  }, [nodes]);
  
  const filteredNodes = useMemo(() => {
    return nodes?.filter(node => !selectedRegion || node.region === selectedRegion);
  }, [nodes, selectedRegion]);
  
  return (
    <div className="flex gap-4">
      <select value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)}>
        <option value="">All Regions</option>
        {regions.map(region => (
          <option key={region} value={region}>{region}</option>
        ))}
      </select>
      
      <select value={selectedNode} onChange={(e) => setSelectedNode(e.target.value)}>
        <option value="">All Nodes</option>
        {filteredNodes?.map(node => (
          <option key={node.node_id} value={node.node_id}>
            {node.node_name} ({node.camera_count} cameras)
          </option>
        ))}
      </select>
    </div>
  );
};

// Coverage map component  
const CoverageMap: React.FC = () => {
  const { data: coverageData } = useQuery(['coverage'], fetchCoverageData);
  
  return (
    <div className="coverage-map">
      {/* Interactive map showing node coverage areas */}
      {/* Color-coded by activity level and risk status */}
      {/* Click to filter executions by node/region */}
    </div>
  );
};
```

### **Node-Based Use Cases**

1. **Regional Monitoring**: "Show me all fire alerts from Córdoba region"
2. **Node Status**: "Which camera nodes are offline or need maintenance?"  
3. **Coverage Analysis**: "Are there monitoring gaps in the northern region?"
4. **Performance Tracking**: "Which nodes have the highest false positive rates?"
5. **Emergency Response**: "Route critical alerts to regional emergency services"
6. **Capacity Planning**: "Which regions need additional camera nodes?"

This node-based architecture provides:
- **📍 Geographic Organization**: Logical grouping by coverage areas
- **🎯 Regional Filtering**: Quick access to specific monitoring zones  
- **📊 Coverage Analysis**: Identify gaps and overlaps in monitoring
- **🚨 Alert Routing**: Regional emergency response coordination
- **📈 Performance Metrics**: Node-level statistics and health monitoring
- **🗂️ Efficient Storage**: Organized image access patterns by location

## 🔌 API Architecture

**Base URL**: `http://localhost:3001/dashboard/api` (Self-contained routing)

**Core Endpoints**:
- `GET /executions` - Paginated execution list with filters (node-based filtering support)
- `GET /executions/{id}` - Detailed execution information  
- `GET /executions/{id}/image` - Serve hybrid JPEG originals
- `GET /executions/{id}/image/webp` - Serve optimized WebP variants
- `GET /executions/{id}/thumbnail` - WebP thumbnails (150x150, 300x300)
- `GET /executions/summary/daily` - Daily statistics with node aggregation
- `GET /executions/stats/enhanced` - Enhanced statistics with regional breakdowns
- `GET /events` - Tiered SSE stream with granular updates (10s-60s intervals)
- `GET /health` - System health check (no auth required)

**Node-Based Regional Endpoints** (NEW):
- `GET /nodes` - List all monitoring nodes with coverage areas
- `GET /nodes/{nodeId}/executions` - Executions filtered by specific node
- `GET /nodes/{nodeId}/cameras` - Camera details for a node
- `GET /coverage/map` - Geographic coverage visualization data
- `GET /coverage/stats` - Regional coverage statistics and performance
- `GET /regions/{region}/nodes` - Nodes within a specific region

**Expert Review System** (Advanced features):
- `GET /expert/assignments` - Expert review assignments with node context
- `POST /expert/assignments/{id}/review` - Submit expert review
- `GET /expert/performance` - Expert performance metrics by region
- `GET /incidents` - Multi-camera incident analysis with node correlation

**New ETL System Endpoints**:
- `GET /etl/status` - ETL processing status and queue metrics
- `GET /etl/history` - Processing history with success rates
- `POST /etl/reprocess/{executionId}` - Manual reprocessing trigger

**Response Format**: Standardized JSON with data/meta/error structure
**Authentication**: Bearer JWT token with role-based access
**Rate Limiting**: 60 req/min general, burst protection, 5 login attempts/15min

## 🎨 Frontend Structure

**Component Architecture**:
- `ImageGallery` - Main grid view with lazy loading and pagination
- `ImageCard` - Individual execution display with status/results overlay
- `ImageModal` - Full-screen viewer with comprehensive analysis data
- `StatusBadge` - Execution status indicators with color coding
- `FilterBar` - Advanced filtering (date, status, risk level, search)
- `StatsDashboard` - Real-time statistics and performance metrics
- `ExpertDashboard` - Expert review interface and assignment management
- `LiveExecutionStrip` - Real-time execution updates via SSE

**Advanced Features**:
- **SSE Integration**: Real-time updates via `SSEContext` and `useSSE` hook
- **Expert System**: Review workflow, assignments, and performance tracking  
- **Multi-modal UI**: Dashboard, expert review, and incident analysis views
- **Notification System**: Real-time alerts and status updates

**State Management**: 
- React Query (@tanstack/react-query) for server state and caching
- Zustand for client-side state management
- SSEContext for real-time data streams

**Styling**: Tailwind CSS with component library (ui/button, ui/card, etc.)
**Testing**: Vitest + React Testing Library with comprehensive test coverage

## 🔧 Configuration

**Key Environment Variables** (see `.env.example` for complete list):

### New System Environment Variables (September 2025)
```env
# N8N Database (source, read-only)
N8N_DB_HOST=localhost
N8N_DB_PORT=5432
N8N_DB_NAME=n8n
N8N_DB_USER=n8n_user
N8N_DB_PASSWORD=CHANGE_PASSWORD

# SAI Dashboard Database (optimized schema)
SAI_DB_HOST=localhost
SAI_DB_PORT=5432
SAI_DB_NAME=sai_dashboard
SAI_DB_USER=sai_dashboard_user
SAI_DB_PASSWORD=CHANGE_PASSWORD

# Application  
NODE_ENV=development|production
API_PORT=3001
FRONTEND_PORT=3000
CORS_ORIGIN=http://localhost:3000

# ETL Service Configuration
ETL_BATCH_SIZE=50
ETL_MAX_CONCURRENT=5
ETL_RETRY_ATTEMPTS=3
ETL_TIMEOUT_MS=30000

# Image Processing (Hybrid JPEG+WebP)
IMAGE_CACHE_PATH=/mnt/raid1/n8n/backup/images/
IMAGE_CACHE_MAX_SIZE=50MB
GENERATE_THUMBNAILS=true
WEBP_QUALITY_HIGH=85
WEBP_QUALITY_MEDIUM=80
WEBP_QUALITY_THUMB=75

# Tiered SSE Configuration
SSE_CRITICAL_IMMEDIATE=true
SSE_EXECUTION_INTERVAL=10000
SSE_STATISTICS_INTERVAL=30000
SSE_HEALTH_INTERVAL=60000
SSE_MAX_CLIENTS=50

# Authentication (REQUIRED for production)
DASHBOARD_PASSWORD=CHANGE_THIS_SECURE_PASSWORD_2025
SESSION_SECRET=your-super-secret-session-key-change-this
JWT_SECRET=your-jwt-secret-key-change-this

# Node-Based Regional Configuration
NODE_COVERAGE_ENABLED=true
DEFAULT_NODE_REGION=argentina_cordoba
REGIONAL_TIMEZONE=America/Argentina/Cordoba

# Frontend Build (production routing)
VITE_BASE_PATH=/dashboard/
VITE_API_URL=/dashboard/api
```

### Legacy System Environment Variables (Pre-September 2025)
```env
# Database (required)
DATABASE_URL=postgresql://sai_dashboard_readonly:CHANGE_PASSWORD@localhost:5432/n8n
DB_HOST=localhost
DB_PORT=5432
DB_NAME=n8n
DB_USER=sai_dashboard_readonly
DB_PASSWORD=CHANGE_PASSWORD

# SAI Workflow Target
SAI_WORKFLOW_NAME=Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto

# Performance & Security
DEFAULT_PAGE_SIZE=50
MAX_IMAGE_SIZE=5242880
CACHE_PATH=/mnt/raid1/n8n/backup/images/
RATE_LIMIT_MAX_REQUESTS=60
ENFORCE_HTTPS=true
```

**Port Configuration**:
- Backend API: Port 3001
- Frontend: Port 3000 (development only, production uses nginx on port 80)

## 🧪 Testing Strategy

**Backend Testing** (Enhanced for New Architecture):
- **Jest**: Unit tests with dual database connection mocking
- **Supertest**: API integration tests including node-based filtering endpoints
- **ETL Testing**: PostgreSQL trigger simulation and LISTEN/NOTIFY validation
- **Image Processing**: Sharp-based hybrid format generation testing
- **Performance**: Load testing with 10-20 concurrent SSE clients
- **Error Handling**: Comprehensive validation for new regional endpoints

**Frontend Testing** (Node-Aware Components):
- **React Testing Library**: Component tests with node context mocking
- **Vitest**: Test runner with regional filtering UI validation
- **SSE Testing**: Mock tiered update streams (10s-60s intervals)
- **Image Gallery**: WebP fallback and hybrid loading behavior tests
- **Expert Dashboard**: Review workflow and node assignment testing

**Integration Testing** (NEW):
- **ETL Pipeline**: End-to-end n8n → sai_dashboard processing validation
- **Real-time Flow**: PostgreSQL NOTIFY → SSE → Frontend update chain
- **Node Assignment**: Camera location → regional node mapping accuracy
- **Performance Benchmarks**: 90% query reduction validation vs legacy system

## 🔒 Security Considerations

- **Read-Only Database Access**: No write operations to n8n database
- **Input Validation**: All API inputs validated and sanitized
- **Rate Limiting**: Request throttling to prevent abuse
- **CORS Configuration**: Domain restrictions for API access
- **Image Security**: Base64 validation and size limits
- **Error Handling**: No sensitive data exposed in error responses

## 📦 Deployment Architecture

**Production Stack**:
- Direct Node.js deployment via systemd service
- Nginx reverse proxy with SSL termination (required for public access)
- Filesystem cache on RAID storage at `/mnt/raid1/n8n/backup/images/`
- Authentication middleware with session management
- Rate limiting and security headers
- Health checks at `/dashboard/api/health`

**Critical Configuration**:
- HTTPS enforced for public deployment via nginx
- Self-contained API routes under `/dashboard/api/*`
- Rate limiting: 60 req/min general, 5 login attempts/15min
- Session duration: 24 hours (configurable)

## 🎯 SAI Workflow Context

**Target Workflow Specifics**:
- **Execution Pattern**: Webhook-triggered image uploads
- **Success Rate**: 99.96% (4,892/4,893 total executions)
- **Node Flow**: Webhook → Ollama Analysis → Telegram Notification
- **Key Data Points**: Risk assessment, confidence scores, delivery confirmation

**Integration Points**:
- **Ollama API**: qwen2.5vl:7b model for image analysis
- **Telegram Bot**: Multiple bot configurations for alerts
- **Webhook Endpoint**: https://ai.altermundi.net/pipelines/[uuid]

## 💡 Critical Implementation Guidelines

### Backend Architecture Notes
- **Self-Contained Routes**: Backend serves all routes under `/dashboard/api/*` (see `backend/src/index.ts:62`)  
- **Authentication System**: JWT tokens with role-based access, rate limiting, and session management
- **Database**: Read-only PostgreSQL with connection pooling (max 5 connections, 5s timeout)
- **Advanced Features**: Expert review system, incident analysis, real-time SSE events
- **Caching**: Filesystem-based image cache at `/mnt/raid1/n8n/backup/images/`
- **Security**: Helmet headers, CORS, input validation, parameterized queries
- **Error Handling**: Comprehensive middleware with development/production modes
- **Path Resolution**: Uses `tsc-alias` to resolve `@/*` imports after TypeScript compilation

### Frontend Architecture Notes  
- **Base Path Support**: Configurable via `VITE_BASE_PATH` environment variable (`/dashboard/`)
- **Proxy Configuration**: Vite dev server proxies `/dashboard/api` to backend (port 3001)
- **State Management**: React Query (@tanstack/react-query) + Zustand + SSEContext
- **Routing**: React Router DOM with protected routes and authentication guards
- **Component Library**: Custom UI components in `/ui/` (button, card, input, select, badge)
- **Real-time Features**: Server-Sent Events integration with reconnection logic
- **Testing**: Vitest + React Testing Library with jsdom environment and setup files
- **Build Optimization**: Code splitting for vendor, router, and query libraries

### Database Query Patterns
- **Two-Phase Loading**: Never load full execution data in list views
- **Parameterized Queries**: All database queries use prepared statements
- **Connection Pool**: Max 5 connections with 5s timeout
- **Target Tables**: `execution_entity`, `execution_data`, `workflow_entity`

### Production Deployment Lessons (BATTLE-TESTED)

**SSH Reverse Tunnel Architecture (CORRECTED):**
```bash
# Existing reverse tunnel services (already running):
tunnel-dashboard.service: ssh -R 3000:localhost:80 user@sai.altermundi.net
tunnel-dashboard-api.service: ssh -R 3001:localhost:3001 user@sai.altermundi.net

# This creates remote bindings on public proxy (sai.altermundi.net):
# - localhost:3000 (on proxy) -> localhost:80 (on local server)
# - localhost:3001 (on proxy) -> localhost:3001 (on local server)

# Backend: Self-contained under /dashboard/api/*
app.use('/dashboard/api', apiRoutes);  # No URL rewriting needed

# Frontend Environment Variables:
VITE_BASE_PATH=/dashboard/
VITE_API_URL=/dashboard/api
```

**nginx Public Proxy Configuration (CORRECTED):**
```nginx
# ✅ REVERSE TUNNEL: Uses remote port bindings created by local services
location /dashboard/ {
    proxy_pass http://127.0.0.1:3000/dashboard/;  # Remote port 3000 -> local port 80
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
}

location /dashboard/api/ {
    proxy_pass http://127.0.0.1:3001;  # Remote port 3001 -> local port 3001
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
}

# ❌ OLD APPROACH: Complex URL rewriting (avoid this)
location /dashboard/api/ {
    rewrite ^/dashboard/api/(.*) /api/$1 break;  # Complex and fragile
    proxy_pass http://127.0.0.1:3001;
}

# ❌ WRONG: Location ordering conflicts with existing /api/
# /api/ location captures requests before /dashboard/api/ can match
```

**Self-Contained Benefits:**
1. **No Route Conflicts** → Complete isolation under `/dashboard/` path
2. **No URL Rewriting** → Backend handles `/dashboard/api/*` natively  
3. **Simple nginx Config** → One location block handles everything
4. **Future-Proof** → Won't break with nginx config changes
5. **Standard Pattern** → Used by many web applications

**Legacy Troubleshooting (Pre-Self-Contained):**
1. **MIME Type Errors** → Dashboard assets location not before general assets
2. **API 404 Errors** → Location precedence conflicts with existing `/api/`
3. **Redirect Loops** → Frontend base path configuration mismatch
4. **nginx Config Errors** → `try_files` or URI parts in wrong locations

### Hybrid Image Storage Strategy (NEW - September 2025)
```javascript
// ✅ NEW: Hybrid JPEG + WebP approach with 37% storage savings
app.get('/api/executions/:id/image', serveJPEGOriginal);           // JPEG original
app.get('/api/executions/:id/image/webp', serveWebPVariant);       // WebP optimized  
app.get('/api/executions/:id/thumbnail', serveWebPThumbnail);      // WebP thumbnails

// Storage structure: /mnt/raid1/n8n/backup/images/
// ├── originals/
// │   └── YYYY/MM/DD/executionId_timestamp.jpg        // JPEG originals
// ├── webp/
// │   └── YYYY/MM/DD/executionId_timestamp.webp       // WebP variants
// └── thumbnails/
//     ├── 150px/executionId_timestamp.webp            // Small thumbnails
//     └── 300px/executionId_timestamp.webp            // Medium thumbnails

// ✅ ETL Processing with Sharp optimization
const processImage = async (base64Data, executionId) => {
  // Extract JPEG original (preserve quality for expert review)  
  const jpegBuffer = Buffer.from(base64Data, 'base64');
  await sharp(jpegBuffer).jpeg({ quality: 95 }).toFile(jpegPath);
  
  // Generate WebP variants (optimized for web display)
  await sharp(jpegBuffer).webp({ quality: 85 }).toFile(webpPath);
  await sharp(jpegBuffer).resize(150).webp({ quality: 75 }).toFile(thumb150);
  await sharp(jpegBuffer).resize(300).webp({ quality: 80 }).toFile(thumb300);
};

// ❌ OLD: Memory-intensive Base64 in JSON responses
// app.get('/api/executions', () => ({ data: executionsWithBase64Images }));
```

### Authentication Implementation
```javascript
// Simple password auth for public access
app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const { password } = req.body;
  if (password === process.env.DASHBOARD_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    await redis.setex(`session:${token}`, 86400, JSON.stringify({...}));
    res.json({ token });
  }
});
```

### Cache Management
```javascript
// Filesystem structure: /mnt/raid1/n8n/backup/images/
// - by-date/2025/08/28/4893_125557.jpg
// - by-execution/4893/original.jpg  
// - by-execution/4893/thumb.jpg
// - by-status/success/4893.jpg -> ../by-execution/4893/original.jpg
```

### SSE Implementation
```javascript
// Server-Sent Events, not WebSockets
app.get('/api/events', authenticateSSE, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache'
  });
  // Push new execution updates
});
```

### Database Security
- Use parameterized queries only
- Create read-only user with restricted views
- Never concatenate user input into SQL
- Implement query timeouts (5 seconds max)

## 🔍 Troubleshooting

**Production Deployment Issues (SOLVED):**
- **MIME Type Errors**: Dashboard asset location must come before general static assets in nginx
- **API 404 Errors**: Frontend must use `VITE_API_URL=/dashboard/api` and nginx needs URL rewrite
- **Redirect Loops**: Frontend base path must match nginx routing (`/dashboard/`)
- **nginx Config Fails**: Avoid `try_files` with `proxy_pass` and URI parts in named locations

**Common Development Issues** (Updated for New Architecture):
- **Dual Database Issues**: Verify both n8n and sai_dashboard database connections
- **ETL Processing Failures**: Check PostgreSQL trigger status and LISTEN/NOTIFY configuration
- **Node Assignment Errors**: Validate camera location → node mapping in monitoring_nodes table
- **Image Processing Issues**: Verify Sharp library installation and WebP generation
- **SSE Connection Problems**: Check tiered interval configuration (10s-60s) and client limits
- **Regional Filtering Failures**: Ensure node-based indexes are created in sai_dashboard
- **Port conflicts**: Ensure ports 3000/3001 are free
- **CORS errors**: Verify `CORS_ORIGIN` matches frontend URL
- **Memory issues** (LEGACY): Should be resolved with new optimized schema
- **Build failures**: Clear `node_modules` and reinstall, check TypeScript paths
- **Path alias errors**: Ensure tsc-alias runs after TypeScript compilation

**Development Database**: If n8n database is unavailable, use the provided test data in `database/test-data.json` for local development.

**Debugging Tips**:
- Backend logs: Check console output for detailed error information  
- Frontend network: Use browser DevTools to inspect API calls
- Database queries: Enable `LOG_DATABASE_QUERIES=true` for SQL debugging
- Authentication: Check token validity and rate limiting headers
- SSE connections: Monitor browser EventSource connection status

## ✅ Production Deployment Status

### **Self-Contained Architecture (2025-08-29):**
- ✅ **Domain**: https://sai.altermundi.net/dashboard/
- ✅ **Backend**: Self-contained routes under `/dashboard/api/*` (port 3001)
- ✅ **Frontend**: Vite development server (port 3000)  
- ✅ **Database**: 7,721+ SAI workflow executions connected
- ✅ **nginx**: Single location block, no route conflicts
- ✅ **No URL Rewriting**: Clean, maintainable configuration

**Current Live Environment:**
- Frontend: Port 3000 with `/dashboard/` base path
- Backend: Port 3001 with self-contained `/dashboard/api/*` routes
- Database: PostgreSQL read-only access with custom views
- Performance: Sub-second response times for dashboard queries

**Architecture Benefits:**
- **Zero Conflicts**: Complete isolation from existing SAI Proxy `/api/` routes
- **Maintainable**: Standard self-contained web application pattern
- **Future-Proof**: Won't break with infrastructure changes
- **Clean Deployment**: One nginx location block handles everything

This **self-contained deployment configuration** is production-ready and represents the evolution from complex routing to clean, maintainable architecture.

## 🔧 API Testing & Authentication (MANDATORY REFERENCE)

### **Correct API Authentication Pattern:**
```bash
# Get auth token first
curl -s "https://sai.altermundi.net/dashboard/api/auth/login" \
  -H "Content-Type:application/json" \
  -d '{"password":"SaiDash2025SecureProd"}' > /tmp/token.json

# Extract token  
jq -r '.data.token' /tmp/token.json > /tmp/token.txt

# Use token for API calls
curl -s "https://sai.altermundi.net/dashboard/api/executions/stats/enhanced" \
  -H "Authorization: Bearer $(cat /tmp/token.txt)"
```

### **Local Development Testing:**
```bash
# Health check (no auth required)
curl -s http://localhost:3001/dashboard/api/health | jq

# Login and get token
curl -s -X POST http://localhost:3001/dashboard/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"SaiDash2025SecureProd"}' | jq -r '.data.token' > /tmp/token.txt

# Test authenticated endpoint  
curl -s "http://localhost:3001/dashboard/api/executions?limit=1" \
  -H "Authorization: Bearer $(cat /tmp/token.txt)" | jq '.data | length'
```

### **NEVER DO (Common Mistakes):**
- Don't try multiple curl syntax variations in sequence
- Don't use shell variables for tokens across tool calls  
- Don't test authentication without first checking CLAUDE.md
- Always use the exact patterns documented above


## 🎯 Key Files to Understand

### Essential Architecture Files
- **Backend Entry**: `backend/src/index.ts` - Express server with self-contained `/dashboard/api/*` routes
- **API Routes**: `backend/src/routes/index.ts` - Complete API endpoint definitions with node-based filtering
- **Authentication**: `backend/src/middleware/auth.ts` - JWT tokens, rate limiting, role-based access
- **Dual Database Pools**: `backend/src/database/pool.ts` - N8N and SAI Dashboard connection management
- **Tiered SSE Controller**: `backend/src/controllers/sse.ts` - Multi-interval real-time updates (10s-60s)

### NEW Architecture Files (September 2025)
- **ETL Service**: `backend/src/services/etl-service.ts` - PostgreSQL trigger-based processing pipeline
- **Tiered SSE**: `backend/src/services/tiered-sse.ts` - Priority-based message queuing system  
- **Node Controller**: `backend/src/controllers/node.ts` - Regional coverage and node management
- **Image Processing**: `backend/src/services/image-processor.ts` - Hybrid JPEG+WebP generation
- **Enhanced Analysis**: `backend/src/services/enhanced-analysis.ts` - 160+ field analysis extraction

### Frontend Core Files  
- **Frontend Entry**: `frontend/src/main.tsx` - React application bootstrap with providers
- **App Router**: `frontend/src/App.tsx` - Main router with protected routes
- **SSE Context**: `frontend/src/contexts/SSEContext.tsx` - Real-time data stream management
- **API Service**: `frontend/src/services/api.ts` - Axios-based API client with auth interceptors
- **Vite Config**: `frontend/vite.config.ts` - Dev server, proxy config, build optimization

### Configuration Files
- **TypeScript Config**: `backend/tsconfig.json` - Path aliases, strict mode, decorators
- **Environment**: `.env.example` - Complete configuration template with dual database variables
- **Package.json**: Root level with workspace configuration and combined scripts
- **Installation**: `install-production.sh` - Production deployment with validation

### NEW Database Schema Files (September 2025)
- **SAI Dashboard Schema**: `database/sai_dashboard_schema.sql` - Optimized schema with 160+ analysis fields
- **ETL Triggers**: `database/n8n_etl_triggers.sql` - PostgreSQL LISTEN/NOTIFY trigger implementation
- **Data Migration**: `scripts/populate-sai-dashboard.js` - Historical data migration (4,893+ executions)
- **Architecture Analysis**: `docs/SAI_DATA_FLOW_REFACTORING_PLAN.md` - 3-week implementation roadmap

### Advanced Features
- **Expert Review**: `backend/src/controllers/expert-review.ts` - Expert assignment and review system
- **Enhanced Analysis**: `backend/src/services/enhanced-analysis.ts` - Advanced image analysis processing
- **Incident Analysis**: API routes for multi-camera incident correlation
- **Live Dashboard**: `frontend/src/components/ExpertDashboard.tsx` - Expert interface

**Architecture Docs**: Review `docs/ARCHITECTURE_ANALYSIS.md` for detailed design decisions and potential issues.