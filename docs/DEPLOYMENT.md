# SAI Dashboard - Deployment Documentation

**Production deployment guide using SSH tunnel architecture with nginx reverse proxy**

---

## 🏗️ Architecture Overview

The SAI Dashboard deploys using a **secure SSH tunnel architecture** where:
- **Private Server**: Runs Docker containers (n8n database access)
- **Public Server**: Runs nginx only (SSL termination)
- **SSH Tunnels**: Secure connection between servers
- **Path**: Available at `n8n.altermundi.net/dashboard/`

```
┌─────────────────────┐         ┌──────────────────────┐
│  Public Server       │         │  Private Server      │
│  88.207.86.56        │         │  (Internal)          │
│                      │         │                      │
│  ┌────────────┐     │  SSH    │  ┌───────────────┐  │
│  │   Nginx    │◄────┼─Tunnels─┼──┤ n8n:5678      │  │
│  │  Port 443  │     │         │  └───────────────┘  │
│  └──────┬─────┘     │         │                      │
│         │           │         │  ┌───────────────┐  │
│    /dashboard/*     │◄────────┼──┤ Dashboard     │  │
│                     │ :3000   │  │ UI:3000       │  │
│    /dashboard/api/* │ :3001   │  │ API:3001      │  │
│                     │◄────────┼──┤               │  │
│                     │         │  └───────────────┘  │
└─────────────────────┘         └──────────────────────┘
```

---

## 📍 URL Structure

```
n8n.altermundi.net/
├── /                       # Main n8n interface
├── /webhook/               # n8n webhook endpoints
├── /api/                   # n8n API
└── /dashboard/             # SAI Dashboard
    ├── /dashboard/         # React SPA
    ├── /dashboard/login    # Login page
    ├── /dashboard/api/     # Backend API
    └── /dashboard/static/  # Static assets
```

---

## 🚀 Deployment Steps

### Step 1: Private Server Setup

#### 1.1 Database Preparation
```sql
-- Connect to n8n PostgreSQL
sudo -u postgres psql n8n

-- Create read-only user
CREATE USER sai_dashboard_readonly WITH PASSWORD 'CHANGE_THIS_SECURE_PASSWORD';
GRANT CONNECT ON DATABASE n8n TO sai_dashboard_readonly;
GRANT USAGE ON SCHEMA public TO sai_dashboard_readonly;
GRANT SELECT ON execution_entity, execution_data, workflow_entity TO sai_dashboard_readonly;

-- Create security views (from database/schema-analysis.md)
CREATE VIEW sai_executions AS 
  SELECT e.* FROM execution_entity e
  JOIN workflow_entity w ON e.workflowId = w.id
  WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
    AND e.deletedAt IS NULL;

GRANT SELECT ON sai_executions TO sai_dashboard_readonly;
```

#### 1.2 Environment Configuration
```bash
# Clone repository
cd /root
git clone https://github.com/your-org/sai-dashboard.git
cd sai-dashboard

# Setup environment
cp .env.example .env
nano .env
```

**Update .env with:**
```env
# Database (localhost connection - no Docker networking needed)
DATABASE_URL=postgresql://sai_dashboard_readonly:SECURE_PASSWORD@localhost:5432/n8n
DB_HOST=localhost

# Ports (bind to localhost only)
API_PORT=3001
FRONTEND_PORT=3000

# Security
DASHBOARD_PASSWORD=CHANGE_THIS_SECURE_PASSWORD_2025
SESSION_SECRET=RANDOM_64_CHAR_STRING_HERE

# Paths
BASE_PATH=/dashboard
VITE_BASE_PATH=/dashboard/
CACHE_PATH=/mnt/raid1/n8n/backup/images/

# Production settings
NODE_ENV=production
ENFORCE_HTTPS=true
CORS_ORIGIN=https://n8n.altermundi.net
```

#### 1.3 Create Cache Directory
```bash
# Create filesystem cache structure
sudo mkdir -p /mnt/raid1/n8n/backup/images/{by-date,by-execution,by-status}
sudo chown -R $(whoami):docker /mnt/raid1/n8n/backup/images
chmod 755 /mnt/raid1/n8n/backup/images
```

#### 1.4 Build and Deploy
```bash
# Build containers
docker-compose -f docker-compose.yml -f docker-compose.production.yml build

# Start services
docker-compose -f docker-compose.yml -f docker-compose.production.yml up -d

# Verify services
docker-compose ps
docker-compose logs -f --tail=50

# Test local access
curl http://localhost:3001/api/health
curl http://localhost:3000
```

---

### Step 2: SSH Tunnel Configuration

#### 2.1 Create Tunnel User (if not exists)
```bash
# On private server
sudo adduser --system --group tunnel-user
sudo -u tunnel-user mkdir -p /home/tunnel-user/.ssh
sudo -u tunnel-user ssh-keygen -t ed25519 -f /home/tunnel-user/.ssh/tunnel_key -N ""

# Copy public key
sudo cat /home/tunnel-user/.ssh/tunnel_key.pub
```

#### 2.2 Configure Public Server Access
```bash
# On public server (88.207.86.56)
sudo adduser --system --group tunnel
sudo -u tunnel mkdir -p /home/tunnel/.ssh

# Add private server's public key
sudo nano /home/tunnel/.ssh/authorized_keys
# Paste the public key from step 2.1

# Restrict tunnel user (security)
sudo nano /home/tunnel/.ssh/authorized_keys
# Add restrictions to the key line:
# command="/bin/false",no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA...
```

#### 2.3 Create SSH Config
```bash
# On private server
sudo -u tunnel-user nano /home/tunnel-user/.ssh/config
```

```
Host sai-tunnel
    HostName 88.207.86.56
    User tunnel
    IdentityFile ~/.ssh/tunnel_key
    ServerAliveInterval 60
    ServerAliveCountMax 3
    ExitOnForwardFailure yes
    StrictHostKeyChecking no
    RemoteForward 5678 localhost:5678
    RemoteForward 3001 localhost:3001
    RemoteForward 3000 localhost:3000
```

#### 2.4 Create Systemd Service
```bash
sudo nano /etc/systemd/system/sai-tunnels.service
```

```ini
[Unit]
Description=SAI SSH Tunnels to Public Server
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=tunnel-user
Group=tunnel-user

# Using autossh for automatic reconnection
ExecStart=/usr/bin/autossh -M 0 -N \
  -o ServerAliveInterval=60 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -o StrictHostKeyChecking=no \
  -i /home/tunnel-user/.ssh/tunnel_key \
  -R 5678:127.0.0.1:5678 \
  -R 3001:127.0.0.1:3001 \
  -R 3000:127.0.0.1:3000 \
  tunnel@88.207.86.56

# Restart policy
Restart=always
RestartSec=10
StartLimitInterval=0

# Environment
Environment="AUTOSSH_GATETIME=0"
Environment="AUTOSSH_PORT=0"

[Install]
WantedBy=multi-user.target
```

```bash
# Install autossh if needed
sudo apt-get update && sudo apt-get install -y autossh

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable sai-tunnels.service
sudo systemctl start sai-tunnels.service

# Check status
sudo systemctl status sai-tunnels.service
sudo journalctl -u sai-tunnels -f
```

#### 2.5 Verify Tunnels
```bash
# On private server - check tunnel is established
sudo netstat -tlnp | grep ssh

# On public server - verify ports are listening
sudo netstat -tlnp | grep -E "5678|3001|3000"
# Should show:
# tcp  0  0 127.0.0.1:5678  0.0.0.0:*  LISTEN  12345/sshd: tunnel
# tcp  0  0 127.0.0.1:3001  0.0.0.0:*  LISTEN  12345/sshd: tunnel  
# tcp  0  0 127.0.0.1:3000  0.0.0.0:*  LISTEN  12345/sshd: tunnel
```

---

### Step 3: Public Server Nginx Configuration

#### 3.1 Create Nginx Configuration
```bash
# On public server
sudo nano /etc/nginx/sites-available/n8n.altermundi.net
```

```nginx
# SAI Dashboard configuration - Add to existing n8n.altermundi.net server block

server {
    listen 443 ssl http2;
    server_name n8n.altermundi.net;
    
    # Existing SSL configuration
    ssl_certificate /etc/letsencrypt/live/n8n.altermundi.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/n8n.altermundi.net/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Existing n8n proxy configuration
    location / {
        proxy_pass http://127.0.0.1:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # ===== SAI DASHBOARD CONFIGURATION =====
    
    # Dashboard API endpoints
    location /dashboard/api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        
        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /dashboard;
        
        # Timeouts for long-running requests
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Disable buffering for SSE
        proxy_buffering off;
        proxy_cache off;
        
        # SSE specific
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
        
        # Body size for image uploads (if needed in future)
        client_max_body_size 10M;
    }
    
    # Dashboard static assets (with caching)
    location /dashboard/static/ {
        proxy_pass http://127.0.0.1:3000/static/;
        
        # Aggressive caching for static assets
        expires 1y;
        add_header Cache-Control "public, immutable";
        
        # Compression
        gzip on;
        gzip_types text/css application/javascript image/svg+xml;
        gzip_vary on;
    }
    
    # Dashboard SPA (React app)
    location /dashboard {
        # Ensure trailing slash
        rewrite ^/dashboard$ /dashboard/ permanent;
    }
    
    location /dashboard/ {
        proxy_pass http://127.0.0.1:3000/;
        
        # Proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /dashboard;
        
        # SPA fallback - Try files, fallback to index.html
        proxy_intercept_errors on;
        error_page 404 = @dashboard_spa;
    }
    
    # SPA fallback handler
    location @dashboard_spa {
        proxy_pass http://127.0.0.1:3000/index.html;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Rate limiting for dashboard API
    limit_req_zone $binary_remote_addr zone=dashboard_api:10m rate=60r/m;
    limit_req_zone $binary_remote_addr zone=dashboard_login:10m rate=5r/m;
    
    # Apply rate limiting to login endpoint
    location = /dashboard/api/auth/login {
        limit_req zone=dashboard_login burst=2 nodelay;
        proxy_pass http://127.0.0.1:3001/api/auth/login;
        
        # Same proxy headers as API
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name n8n.altermundi.net;
    return 301 https://$server_name$request_uri;
}
```

#### 3.2 Test and Apply Configuration
```bash
# Test nginx configuration
sudo nginx -t

# If successful, reload nginx
sudo systemctl reload nginx

# Check nginx error log
sudo tail -f /var/log/nginx/error.log
```

---

### Step 4: Verification

#### 4.1 Test Endpoints
```bash
# From public server or any external location

# Test API health
curl https://n8n.altermundi.net/dashboard/api/health

# Test frontend
curl -I https://n8n.altermundi.net/dashboard/

# Test authentication
curl -X POST https://n8n.altermundi.net/dashboard/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"test"}'
```

#### 4.2 Browser Testing
1. Navigate to `https://n8n.altermundi.net/dashboard/`
2. Should redirect to login page
3. Login with configured password
4. Verify image gallery loads
5. Check browser console for errors
6. Test SSE connection (should see heartbeat events)

---

## 🔧 Maintenance Operations

### Viewing Logs
```bash
# On private server

# Application logs
docker logs -f sai-dashboard

# SSH tunnel logs
sudo journalctl -u sai-tunnels -f

# On public server
# Nginx access logs
sudo tail -f /var/log/nginx/access.log | grep dashboard

# Nginx error logs
sudo tail -f /var/log/nginx/error.log
```

### Restarting Services
```bash
# On private server

# Restart dashboard
docker-compose restart

# Restart SSH tunnels
sudo systemctl restart sai-tunnels

# On public server
# Reload nginx (no downtime)
sudo systemctl reload nginx
```

### Updating Dashboard
```bash
# On private server
cd /root/sai-dashboard

# Pull updates
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# No changes needed on public server
```

---

## 🚨 Troubleshooting

### SSH Tunnel Issues
```bash
# Check tunnel status
sudo systemctl status sai-tunnels

# Test manual connection
sudo -u tunnel-user ssh -v tunnel@88.207.86.56

# Kill existing tunnels and restart
sudo pkill -f "ssh.*tunnel@88.207.86.56"
sudo systemctl restart sai-tunnels
```

### Dashboard Not Loading
```bash
# Check Docker containers
docker-compose ps
docker-compose logs --tail=100

# Test local endpoints
curl http://localhost:3001/api/health
curl http://localhost:3000

# Check tunnel ports on public server
ssh root@88.207.86.56 "netstat -tlnp | grep -E '3000|3001'"
```

### Performance Issues
```bash
# Check resource usage
docker stats

# Check cache directory
du -sh /mnt/raid1/n8n/backup/images/

# Database connections
docker exec sai-dashboard npm run db:check
```

---

## 🔒 Security Checklist

- [ ] Database user is read-only
- [ ] Dashboard password is strong and unique
- [ ] SSH tunnel key has proper permissions (600)
- [ ] Nginx rate limiting is configured
- [ ] HTTPS is enforced
- [ ] CORS is properly configured
- [ ] Session secrets are random
- [ ] Docker containers run as non-root
- [ ] Filesystem cache has proper permissions
- [ ] Logs don't contain sensitive data

---

## 📊 Monitoring

### Health Check Endpoints
```bash
# Overall health
curl https://n8n.altermundi.net/dashboard/api/health

# Returns:
{
  "status": "healthy",
  "database": "connected",
  "cache": "available",
  "uptime": 3600,
  "version": "1.0.0"
}
```

### Monitoring Commands
```bash
# Watch tunnel stability
watch -n 5 'systemctl status sai-tunnels | grep Active'

# Monitor container resources
docker stats --no-stream

# Check error rates
grep ERROR /var/log/sai-dashboard/*.log | wc -l
```

---

## 🔄 Backup & Recovery

### Backup Strategy
```bash
# Daily backup script
#!/bin/bash
# /root/scripts/backup-sai-dashboard.sh

# Backup cache directory structure (not images)
tar -czf /backup/sai-dashboard-cache-$(date +%Y%m%d).tar.gz \
  --exclude='*.jpg' --exclude='*.png' \
  /mnt/raid1/n8n/backup/images/

# Backup configuration
tar -czf /backup/sai-dashboard-config-$(date +%Y%m%d).tar.gz \
  /root/sai-dashboard/.env \
  /root/sai-dashboard/docker-compose.yml

# Keep last 7 days
find /backup -name "sai-dashboard-*.tar.gz" -mtime +7 -delete
```

### Recovery Procedure
```bash
# Restore configuration
tar -xzf /backup/sai-dashboard-config-20250828.tar.gz -C /

# Restart services
docker-compose down
docker-compose up -d

# SSH tunnels will auto-reconnect
sudo systemctl restart sai-tunnels
```

---

This deployment architecture provides secure, stable, and maintainable production deployment using SSH tunnels with centralized nginx management on the public server.

---

*Deployment Documentation Version: 1.0*  
*Last Updated: August 28, 2025*  
*Architecture: SSH Tunnel Proxy*