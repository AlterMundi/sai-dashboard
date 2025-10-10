# SAI Dashboard - Architectural Decision Records

**Key technical decisions and their rationale for the SAI Image Analysis Dashboard**

---

## 📋 Decision Summary

| Decision | Choice | Alternative(s) | Status |
|----------|--------|----------------|--------|
| **Image Caching** | Filesystem at `/mnt/raid1/n8n/backup/images/` | Redis/Database | ✅ Implemented |
| **Real-time Updates** | Server-Sent Events (SSE) | WebSockets/Polling | ✅ Implemented |
| **Authentication** | Simple password-based | JWT/OAuth/API Keys | ✅ Implemented |
| **Database Access** | Read-only user with views | Direct table access | ✅ Implemented |
| **Image Storage** | Extract from n8n database | Modify workflow to save files | ✅ Implemented |
| **Rate Limiting** | 60 req/min, 5 login/15min | Higher limits | ✅ Implemented |
| **Deployment** | SSH Tunnel + Subpath (/dashboard/) | Direct exposure/Subdomain | ✅ Implemented |

---

## 🗄️ ADR-001: Image Caching Strategy

### Status: **ACCEPTED**

### Context
SAI workflow stores 4,893 images as base64 in n8n's PostgreSQL database (~1GB of image data). Need efficient way to serve images without memory issues.

### Decision
**Use filesystem caching at `/mnt/raid1/n8n/backup/images/` with structured folder organization**

### Alternatives Considered
- **Redis caching**: Fast (5ms access) but expensive RAM usage (~1.5GB)
- **Database-only**: Simple but causes memory issues with large payloads
- **Object storage**: S3/MinIO adds complexity and external dependencies

### Rationale
- **Persistent**: Survives application restarts
- **Fast enough**: 10-20ms access on RAID SSD vs 100-500ms from database
- **Cost effective**: Uses existing RAID storage efficiently
- **Future ready**: Can add Redis layer later for hot data
- **Low complexity**: Simple filesystem operations

### Folder Structure
```
/mnt/raid1/n8n/backup/images/
├── by-date/2025/08/28/4893_125557.jpg
├── by-execution/4893/original.jpg
├── by-execution/4893/thumb.jpg
└── by-status/success/4893.jpg -> ../by-execution/4893/original.jpg
```

### Consequences
- ✅ **Positive**: Fast access, persistent, cost-effective
- ⚠️ **Neutral**: Requires cache invalidation strategy (minimal since executions are immutable)
- ❌ **Negative**: Slightly slower than Redis for hot data

---

## 🔄 ADR-002: Real-time Updates Implementation

### Status: **ACCEPTED**

### Context
Dashboard needs real-time updates when new executions complete (~160/day, average 9 minutes between events).

### Decision
**Server-Sent Events (SSE) for unidirectional push updates**

### Alternatives Considered
- **WebSockets**: Bidirectional, more complex, overkill for read-only dashboard
- **HTTP Polling**: Simple but inefficient for low-frequency updates
- **No real-time**: Manual refresh, poor user experience

### Rationale
- **Appropriate complexity**: SSE perfect for one-way data push
- **Browser native**: No additional client libraries needed
- **Automatic reconnection**: Built-in resilience
- **Firewall friendly**: Works everywhere HTTP works
- **Efficient**: Server pushes only when new data available

### Implementation
```javascript
// Server pushes events:
// - execution:new (successful completion)  
// - execution:error (failures)
// - heartbeat (keep-alive every 30s)

eventSource.addEventListener('execution:new', (event) => {
  const execution = JSON.parse(event.data);
  addToGallery(execution);
});
```

### Consequences
- ✅ **Positive**: Simple, efficient, browser-native
- ⚠️ **Neutral**: Limited to server→client communication (sufficient for use case)
- ❌ **Negative**: Less flexible than WebSockets if requirements change

---

## 🔐 ADR-003: Authentication Strategy

### Status: **ACCEPTED**

### Context
Dashboard will be publicly accessible but needs protection from unauthorized access. Internal tool used by small team.

### Decision
**Simple password-based authentication with session tokens**

### Alternatives Considered
- **No authentication**: Exposed to public internet
- **API keys**: Complex distribution, no session management  
- **Full user system**: Username/password, roles - overkill for internal tool
- **OAuth integration**: External dependency, complexity

### Rationale
- **Appropriate security**: Single shared password sufficient for internal use
- **Simple UX**: One password field, 24-hour sessions
- **Rate limited**: 5 attempts per 15 minutes prevents brute force
- **Session based**: Tokens expire, can be revoked
- **Future ready**: Can add user accounts later if needed

### Implementation
```javascript
// Login flow:
POST /api/auth/login { "password": "secret" }
→ { "token": "abc123...", "expiresIn": 86400 }

// All API calls require:
Authorization: Bearer abc123...
```

### Consequences
- ✅ **Positive**: Simple to implement and use, adequate security
- ⚠️ **Neutral**: Single password shared among team (acceptable for internal tool)
- ❌ **Negative**: No per-user permissions (not needed currently)

---

## 🗃️ ADR-004: Database Access Pattern

### Status: **ACCEPTED**

### Context
Need read-only access to n8n database without compromising security or performance of production n8n instance.

### Decision
**Read-only PostgreSQL user with restricted views and two-phase query pattern**

### Alternatives Considered
- **Direct table access**: Security risk, no payload size protection
- **API integration**: n8n API too slow for dashboard needs
- **Database replication**: Complexity overkill, sync issues
- **Shared database user**: Security risk, no audit trail

### Rationale
- **Security**: Restricted views prevent access to sensitive data
- **Performance**: Two-phase loading avoids memory issues
- **Safety**: Cannot affect n8n operations (read-only)
- **Audit**: Separate user for logging and monitoring

### Two-Phase Query Pattern
```sql
-- Phase 1: List view (fast)
SELECT id, status, startedAt FROM sai_executions LIMIT 50;

-- Phase 2: Load specific payload (on demand)  
SELECT data FROM sai_execution_data WHERE executionId = 4893;
```

### Security Views
- `sai_executions`: Only SAI workflow, exclude deleted
- `sai_execution_data`: Size limits, successful executions only
- `sai_dashboard_executions`: Optimized with image URLs

### Consequences
- ✅ **Positive**: Secure, performant, isolated from n8n operations
- ⚠️ **Neutral**: Requires initial DB setup (one-time cost)
- ❌ **Negative**: More complex than direct table access

---

## 💾 ADR-005: Image Storage Decision

### Status: **ACCEPTED**

### Context
Images already stored as base64 in n8n database. Dashboard needs efficient access without modifying n8n workflow.

### Decision
**Extract images from existing n8n database, maintain autonomous consumer pattern**

### Alternatives Considered
- **Modify n8n workflow**: Save images directly during processing
- **Database-only**: Serve base64 directly from PostgreSQL
- **Dual storage**: Both database and filesystem

### Rationale
- **Autonomous**: Dashboard remains independent consumer
- **Non-intrusive**: No changes to production n8n workflow
- **Clean separation**: Dashboard failure doesn't affect n8n
- **Future proof**: Can change dashboard without touching n8n

### Implementation
```javascript
// Extract on first request, cache for subsequent access
const getImage = async (executionId) => {
  // Check filesystem cache first
  if (await exists(`/cache/${executionId}.jpg`)) {
    return readFile(`/cache/${executionId}.jpg`);
  }
  
  // Extract from database and cache
  const base64 = await extractFromDatabase(executionId);
  const buffer = Buffer.from(base64, 'base64');
  await writeFile(`/cache/${executionId}.jpg`, buffer);
  
  return buffer;
};
```

### Consequences
- ✅ **Positive**: Maintains architectural independence, no n8n changes
- ⚠️ **Neutral**: Initial extraction cost (amortized by caching)
- ❌ **Negative**: Duplicate storage (acceptable given RAID capacity)

---

## 🛡️ ADR-006: Rate Limiting Strategy

### Status: **ACCEPTED**

### Context
Public dashboard needs protection from abuse while allowing normal usage patterns.

### Decision
**60 requests/minute general, 10 burst/10s, 5 login attempts/15min**

### Alternatives Considered
- **Higher limits** (100+ req/min): Risk of abuse
- **Lower limits** (30 req/min): May impact normal usage
- **No rate limiting**: Security risk
- **Per-user limits**: Requires user accounts (not implemented)

### Rationale
- **Normal usage**: ~160 executions/day = low API call frequency
- **Image loading**: Gallery with 50 thumbnails = 50 requests
- **Security**: Prevents brute force login attempts
- **Burst allowance**: Supports initial page loads

### Implementation
```javascript
// Rate limits by IP address:
// - General API: 60 requests per 60 seconds
// - Burst: 10 requests per 10 seconds  
// - Login: 5 attempts per 15 minutes
// - SSE connections: 100 concurrent maximum
```

### Consequences
- ✅ **Positive**: Prevents abuse, allows normal usage
- ⚠️ **Neutral**: May need adjustment based on actual usage patterns
- ❌ **Negative**: Potential false positives from NAT/proxy users

---

## ⚙️ ADR-007: Configuration Management

### Status: **ACCEPTED**

### Context
Application needs configuration for development, staging, and production environments with different security requirements.

### Decision
**Environment-based configuration with secure credential management**

### Key Configuration Decisions
- **Default ports**: API 3001, Frontend 3000, Grafana 3002 (fixed conflict)
- **Session duration**: 24 hours (balance of security vs usability)
- **Cache path**: `/mnt/raid1/n8n/backup/images/` (persistent location)
- **Database user**: `sai_dashboard_readonly` (dedicated user)
- **HTTPS enforcement**: Required for production, optional for development

### Implementation
```bash
# Development
NODE_ENV=development
ENFORCE_HTTPS=false
RATE_LIMIT_MAX_REQUESTS=100

# Production  
NODE_ENV=production
ENFORCE_HTTPS=true
RATE_LIMIT_MAX_REQUESTS=60
DASHBOARD_PASSWORD=complex-secure-password
```

### Consequences
- ✅ **Positive**: Clear environment separation, secure defaults
- ⚠️ **Neutral**: Requires proper credential management in production
- ❌ **Negative**: More configuration options to manage

---

## 🚀 ADR-008: Deployment Strategy

### Status: **ACCEPTED**

### Context
Dashboard needs to be deployed alongside n8n without interfering with production operations.

### Decision
**Docker Compose with filesystem cache mounting and Linux networking fixes**

### Key Deployment Decisions
- **Redis**: Commented out initially, available via profile for future use
- **Networking**: Fixed `host.docker.internal` issue with `extra_hosts`
- **Volumes**: Mount `/mnt/raid1/n8n/backup/images` for cache persistence
- **Dependencies**: Removed Redis dependency for MVP deployment

### Docker Configuration
```yaml
services:
  sai-dashboard-api:
    extra_hosts:
      - "host.docker.internal:host-gateway"  # Linux fix
    volumes:
      - /mnt/raid1/n8n/backup/images:/cache  # Filesystem cache
    # No Redis dependency for MVP
```

### Consequences
- ✅ **Positive**: Simple deployment, works on Linux, persistent cache
- ⚠️ **Neutral**: Can add Redis later when needed
- ❌ **Negative**: Requires Docker host directory permissions setup

---

## 🌐 ADR-009: Deployment Architecture - SSH Tunnel Strategy

### Status: **ACCEPTED**

### Context
SAI Dashboard needs public internet access while maintaining security. Existing infrastructure uses SSH tunnel pattern with public server handling nginx and private server running applications.

### Decision
**SSH Tunnel Architecture with subpath deployment at `/dashboard/`**

### Alternatives Considered
- **Direct public exposure**: Security risk, complex firewall management
- **Separate subdomain**: Requires SSL certificates, DNS configuration
- **VPN access**: Restricts accessibility, requires client setup
- **Cloud deployment**: Unnecessary cost and complexity

### Rationale
- **Reuses existing pattern**: n8n.altermundi.net already uses SSH tunnels
- **Secure by default**: Private server never directly exposed
- **SSL included**: Public server handles HTTPS termination
- **Simple DNS**: Uses existing domain configuration
- **Cost effective**: No additional hosting or certificates needed

### Architecture Overview
```
Internet → n8n.altermundi.net/dashboard/
    ↓ (Public Server: 88.207.86.56)
    ├── Nginx reverse proxy
    ├── SSL termination
    └── SSH tunnel → Private Server (127.0.0.1:3000/3001)
        ├── sai-dashboard-ui:3000
        └── sai-dashboard-api:3001
```

### SSH Tunnel Configuration
```bash
# Private server systemd service
[Service]
ExecStart=/usr/bin/autossh -M 0 -N \
  -R 5678:127.0.0.1:5678 \
  -R 3001:127.0.0.1:3001 \
  -R 3000:127.0.0.1:3000 \
  tunnel@88.207.86.56
```

### Nginx Configuration
```nginx
# On public server: /etc/nginx/sites-available/n8n.altermundi.net
location /dashboard/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header X-Forwarded-Prefix /dashboard;
}

location /dashboard/api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    # Rate limiting and SSE support included
}
```

### Security Benefits
- **No direct exposure**: Private server remains isolated
- **Firewall simplified**: Only SSH port needs to be open
- **Rate limiting**: Applied at nginx level on public server  
- **SSL enforcement**: Handled by public server configuration
- **Audit trail**: SSH tunnel provides connection logging

### Production Configuration
```yaml
# docker-compose.production.yml
services:
  sai-dashboard-api:
    ports:
      - "127.0.0.1:3001:3001"  # Localhost binding only
  
  sai-dashboard-ui:
    ports:
      - "127.0.0.1:3000:80"    # Localhost binding only
```

### Consequences
- ✅ **Positive**: Secure, reuses existing infrastructure, simple DNS
- ⚠️ **Neutral**: Depends on SSH tunnel reliability (proven in production)
- ❌ **Negative**: Slight latency overhead (~5ms), single point of failure

---

## 📈 Future Migration Paths

### Redis Integration (When Needed)
```javascript
// Add Redis for hot data when traffic increases
class HybridCache {
  async getImage(id) {
    // 1. Check Redis (hot data)
    // 2. Check filesystem (warm data)  
    // 3. Extract from database (cold data)
  }
}
```

### User Authentication (If Required)
```javascript
// Upgrade from single password to user accounts
// Existing tokens remain valid during migration
// Add user table, role-based permissions
```

### Monitoring Integration
```javascript
// Enable monitoring profile when needed
docker-compose --profile monitoring up -d
// Adds Prometheus + Grafana automatically
```

---

## ✅ Decision Review Schedule

- **Monthly**: Review rate limiting effectiveness
- **Quarterly**: Evaluate caching performance vs Redis needs  
- **Bi-annually**: Assess authentication requirements
- **Annually**: Review overall architecture decisions

---

*Document Version: 1.0*  
*Last Updated: August 28, 2025*  
*Next Review: September 28, 2025*