#!/bin/bash
# SAI Dashboard Production Installation Script
# System-agnostic deployment using relative paths

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

# Detect system
detect_system() {
    log "Detecting system..."
    
    if command -v systemctl >/dev/null 2>&1; then
        INIT_SYSTEM="systemd"
    elif command -v service >/dev/null 2>&1; then
        INIT_SYSTEM="sysv"
    else
        error "Unsupported init system. Need systemd or sysv."
    fi
    
    if command -v nginx >/dev/null 2>&1; then
        WEB_SERVER="nginx"
        WEB_USER="www-data"
        WEB_ROOT="/var/www"
    elif command -v apache2 >/dev/null 2>&1 || command -v httpd >/dev/null 2>&1; then
        WEB_SERVER="apache"
        WEB_USER="www-data"
        WEB_ROOT="/var/www"
    else
        warn "No web server detected. Will create simple file server."
        WEB_SERVER="none"
        WEB_USER="$(whoami)"
        WEB_ROOT="/opt/sai-dashboard/www"
    fi
    
    # Try to determine web user more accurately
    if getent passwd www-data >/dev/null 2>&1; then
        WEB_USER="www-data"
    elif getent passwd apache >/dev/null 2>&1; then
        WEB_USER="apache"
    elif getent passwd nginx >/dev/null 2>&1; then
        WEB_USER="nginx"
    fi
    
    log "System: $INIT_SYSTEM init, $WEB_SERVER web server, user: $WEB_USER"
}

# Get script directory (works with symlinks)
get_script_dir() {
    SOURCE="${BASH_SOURCE[0]}"
    while [ -h "$SOURCE" ]; do
        DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
        SOURCE="$(readlink "$SOURCE")"
        [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
    done
    SCRIPT_DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
    log "Repository root: $SCRIPT_DIR"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if we're in the right directory
    if [[ ! -d "$SCRIPT_DIR/backend" ]] || [[ ! -d "$SCRIPT_DIR/frontend" ]] || [[ ! -f "$SCRIPT_DIR/.env" ]]; then
        error "Script must be run from SAI Dashboard repository root (missing backend/, frontend/, or .env)"
    fi
    
    # Check Node.js
    if ! command -v node >/dev/null 2>&1; then
        error "Node.js is required but not installed"
    fi
    
    NODE_VERSION=$(node --version | cut -d'.' -f1 | sed 's/v//')
    if [[ $NODE_VERSION -lt 18 ]]; then
        error "Node.js 18+ is required, found: $(node --version)"
    fi
    
    # Check npm
    if ! command -v npm >/dev/null 2>&1; then
        error "npm is required but not installed"
    fi
    
    # Check PostgreSQL client
    if ! command -v psql >/dev/null 2>&1; then
        warn "psql not found. Database connection may not work."
    fi
    
    log "Prerequisites check passed"
}

# Build frontend
build_frontend() {
    log "Building frontend for production..."
    
    cd "$SCRIPT_DIR/frontend"
    
    # Install dependencies 
    log "Installing frontend dependencies..."
    npm install
    
    # Build with production settings
    log "Building React application..."
    VITE_BASE_PATH="/dashboard/" VITE_API_URL="/dashboard/api" npm run build -- --mode production
    
    if [[ ! -d "dist" ]]; then
        error "Frontend build failed - no dist directory created"
    fi
    
    log "Frontend built successfully"
}

# Build backend
build_backend() {
    log "Building backend for production..."
    
    cd "$SCRIPT_DIR/backend"
    
    # Install dependencies
    log "Installing backend dependencies..."
    npm install
    
    # Build TypeScript using npm script
    log "Compiling TypeScript..."
    npm run build
    
    if [[ ! -d "dist" ]]; then
        error "Backend build failed - no dist directory created"
    fi
    
    # Verify that tsc-alias resolved imports properly
    log "Verifying path alias resolution..."
    if grep -r "@/" dist/ >/dev/null 2>&1; then
        error "Path aliases (@/) not resolved in compiled code. tsc-alias may have failed."
    fi
    
    log "Backend built successfully"
}

# Create production directories
create_directories() {
    log "Creating production directories..."
    
    # Production application directory
    PROD_DIR="/opt/sai-dashboard"
    sudo mkdir -p "$PROD_DIR"/{backend,logs}
    
    # Web root directory
    sudo mkdir -p "$WEB_ROOT/sai-dashboard"
    
    # Cache directory (if not exists)
    CACHE_DIR="/mnt/raid1/n8n-backup/images"
    if [[ ! -d "$CACHE_DIR" ]]; then
        log "Creating cache directory: $CACHE_DIR"
        sudo mkdir -p "$CACHE_DIR"
    fi
    
    # Set ownership
    sudo chown -R "$WEB_USER:$WEB_USER" "$PROD_DIR"
    sudo chown -R "$WEB_USER:$WEB_USER" "$WEB_ROOT/sai-dashboard"
    sudo chown -R "$WEB_USER:$WEB_USER" "$CACHE_DIR"
    
    log "Directories created: $PROD_DIR, $WEB_ROOT/sai-dashboard, $CACHE_DIR"
}

# Deploy files
deploy_files() {
    log "Deploying application files..."
    
    # Copy frontend build
    log "Deploying frontend..."
    sudo cp -r "$SCRIPT_DIR/frontend/dist/"* "$WEB_ROOT/sai-dashboard/"
    
    # Copy backend files
    log "Deploying backend..."
    sudo cp -r "$SCRIPT_DIR/backend/dist" "/opt/sai-dashboard/backend/"
    sudo cp -r "$SCRIPT_DIR/backend/node_modules" "/opt/sai-dashboard/backend/"
    sudo cp "$SCRIPT_DIR/backend/package.json" "/opt/sai-dashboard/backend/"
    
    # Copy environment file
    sudo cp "$SCRIPT_DIR/.env" "/opt/sai-dashboard/"
    
    # Set permissions
    sudo chown -R "$WEB_USER:$WEB_USER" "/opt/sai-dashboard"
    sudo chown -R "$WEB_USER:$WEB_USER" "$WEB_ROOT/sai-dashboard"
    
    log "Files deployed successfully"
}

# Create systemd service
create_systemd_service() {
    log "Creating systemd service..."
    
    sudo tee /etc/systemd/system/sai-dashboard-api.service > /dev/null << EOF
[Unit]
Description=SAI Dashboard API Server
Documentation=https://github.com/sai-dashboard
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$WEB_USER
Group=$WEB_USER
WorkingDirectory=/opt/sai-dashboard
Environment=NODE_ENV=production
Environment=PATH=/usr/bin:/usr/local/bin
ExecStart=/usr/bin/node backend/dist/index.js
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=10
TimeoutStopSec=30
KillMode=mixed

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sai-dashboard-api

# Security settings
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/sai-dashboard/logs /mnt/raid1/n8n-backup/images /tmp
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload and enable service
    sudo systemctl daemon-reload
    sudo systemctl enable sai-dashboard-api.service
    
    log "Systemd service created and enabled"
}

# Create SysV init script (fallback)
create_sysv_service() {
    log "Creating SysV init script..."
    
    sudo tee /etc/init.d/sai-dashboard-api > /dev/null << 'EOF'
#!/bin/bash
# SAI Dashboard API Service
# chkconfig: 35 80 20
# description: SAI Dashboard API Server

. /etc/rc.d/init.d/functions

USER="www-data"
DAEMON="sai-dashboard-api"
ROOT_DIR="/opt/sai-dashboard"
LOCK_FILE="/var/lock/subsys/$DAEMON"

start() {
    if [ -f $LOCK_FILE ] ; then
        echo "$DAEMON is locked."
        return 1
    fi

    echo -n "Starting $DAEMON: "
    runuser -l "$USER" -c "$ROOT_DIR/backend/dist/index.js" && echo_success || echo_failure
    RETVAL=$?
    echo
    [ $RETVAL -eq 0 ] && touch $LOCK_FILE
    return $RETVAL
}

stop() {
    echo -n "Shutting down $DAEMON: "
    pid=`ps -aefw | grep "$DAEMON" | grep -v " grep " | awk '{print $2}'`
    kill -9 $pid > /dev/null 2>&1
    [ $? -eq 0 ] && echo_success || echo_failure
    echo
    [ $RETVAL -eq 0 ] && rm -f $LOCK_FILE
    return $RETVAL
}

restart() {
    stop
    start
}

status() {
    if [ -f $LOCK_FILE ]; then
        echo "$DAEMON is running."
    else
        echo "$DAEMON is stopped."
    fi
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    restart)
        restart
        ;;
    *)
        echo "Usage: {start|stop|status|restart}"
        exit 1
        ;;
esac

exit $?
EOF
    
    sudo chmod +x /etc/init.d/sai-dashboard-api
    sudo chkconfig --add sai-dashboard-api
    sudo chkconfig sai-dashboard-api on
    
    log "SysV service created and enabled"
}

# Configure web server
configure_web_server() {
    if [[ "$WEB_SERVER" == "nginx" ]]; then
        configure_nginx
    elif [[ "$WEB_SERVER" == "apache" ]]; then
        configure_apache
    else
        configure_simple_server
    fi
}

configure_nginx() {
    log "Configuring nginx..."
    
    # Create server block for dashboard
    sudo tee /etc/nginx/sites-available/sai-dashboard > /dev/null << EOF
# SAI Dashboard - Local server configuration
server {
    listen 80;
    listen [::]:80;
    server_name localhost 127.0.0.1 sai.altermundi.net _;
    
    # Dashboard - Exact redirect for trailing slash
    location = /dashboard {
        return 301 \$scheme://\$host/dashboard/;
    }
    
    # Dashboard static files
    location /dashboard/ {
        alias $WEB_ROOT/sai-dashboard/;
        try_files \$uri \$uri/ /dashboard/index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # API proxy
    location /dashboard/api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_buffering off;
    }
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
}
EOF
    
    # Enable site
    sudo ln -sf /etc/nginx/sites-available/sai-dashboard /etc/nginx/sites-enabled/
    
    # Test configuration
    if sudo nginx -t; then
        sudo systemctl reload nginx
        log "Nginx configured and reloaded"
    else
        error "Nginx configuration test failed"
    fi
}

configure_apache() {
    log "Configuring Apache..."
    
    sudo tee /etc/apache2/sites-available/sai-dashboard.conf > /dev/null << EOF
# SAI Dashboard - Local server configuration
<VirtualHost *:80>
    DocumentRoot $WEB_ROOT/sai-dashboard
    
    # Dashboard static files
    Alias /dashboard $WEB_ROOT/sai-dashboard
    <Directory "$WEB_ROOT/sai-dashboard">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
        
        # SPA fallback
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule . /dashboard/index.html [L]
    </Directory>
    
    # API proxy
    ProxyPreserveHost On
    ProxyPass /dashboard/api/ http://127.0.0.1:3001/dashboard/api/
    ProxyPassReverse /dashboard/api/ http://127.0.0.1:3001/dashboard/api/
</VirtualHost>
EOF
    
    # Enable modules and site
    sudo a2enmod rewrite proxy proxy_http
    sudo a2ensite sai-dashboard
    sudo systemctl reload apache2
    
    log "Apache configured and reloaded"
}

configure_simple_server() {
    log "Creating simple file server (no web server detected)..."
    
    # Create a simple Node.js static server
    sudo tee /opt/sai-dashboard/static-server.js > /dev/null << 'EOF'
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const WEB_ROOT = '/opt/sai-dashboard/www';

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    let filePath = path.join(WEB_ROOT, req.url === '/' ? 'index.html' : req.url);
    
    // SPA fallback
    if (!fs.existsSync(filePath) && !path.extname(filePath)) {
        filePath = path.join(WEB_ROOT, 'index.html');
    }
    
    const extname = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('File not found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Static server running on http://localhost:${PORT}`);
});
EOF
    
    # Copy frontend files to simple server location
    sudo cp -r "$SCRIPT_DIR/frontend/dist/"* "/opt/sai-dashboard/www/"
    
    log "Simple static server created (port 8080)"
}

# Start/restart services
start_services() {
    log "Starting services..."
    
    if [[ "$INIT_SYSTEM" == "systemd" ]]; then
        # Check if service is already running and restart if needed
        if sudo systemctl is-active --quiet sai-dashboard-api.service; then
            log "Service is already running, restarting..."
            sudo systemctl restart sai-dashboard-api.service
        else
            log "Starting new service..."
            sudo systemctl start sai-dashboard-api.service
        fi
        
        # Wait a moment for service to start
        sleep 2
        
        if sudo systemctl is-active --quiet sai-dashboard-api.service; then
            log "SAI Dashboard API service started successfully"
        else
            error "Failed to start SAI Dashboard API service"
            sudo journalctl -u sai-dashboard-api.service --no-pager -n 10
        fi
    else
        # SysV systems
        if sudo service sai-dashboard-api status >/dev/null 2>&1; then
            log "Service is running, restarting..."
            sudo service sai-dashboard-api restart
        else
            sudo service sai-dashboard-api start
        fi
        log "SAI Dashboard API service started (SysV)"
    fi
}

# Verify installation
verify_installation() {
    log "Verifying installation..."
    
    # Check if API is responding
    if curl -f -s http://localhost:3001/dashboard/api/health >/dev/null; then
        log "✓ API health check passed"
    else
        warn "✗ API health check failed"
    fi
    
    # Check if frontend files exist
    if [[ -f "$WEB_ROOT/sai-dashboard/index.html" ]]; then
        log "✓ Frontend files deployed"
    else
        warn "✗ Frontend files not found"
    fi
    
    # Check service status
    if [[ "$INIT_SYSTEM" == "systemd" ]]; then
        if sudo systemctl is-active --quiet sai-dashboard-api.service; then
            log "✓ Service is running"
        else
            warn "✗ Service is not running"
        fi
    fi
    
    log "Verification completed"
}

# Show deployment info
show_deployment_info() {
    log "🎉 SAI Dashboard Production Installation Complete!"
    echo ""
    echo -e "${BLUE}📋 Deployment Information:${NC}"
    echo "  • Frontend: $WEB_ROOT/sai-dashboard/"
    echo "  • Backend:  /opt/sai-dashboard/backend/"
    echo "  • Config:   /opt/sai-dashboard/.env"
    echo "  • Cache:    /mnt/raid1/n8n-backup/images/"
    echo "  • Logs:     journalctl -u sai-dashboard-api.service -f"
    echo ""
    echo -e "${BLUE}🌐 Access URLs (via public proxy):${NC}"
    echo "  • Dashboard: https://sai.altermundi.net/dashboard/"
    echo "  • API:       https://sai.altermundi.net/dashboard/api/"
    echo ""
    echo -e "${BLUE}🔧 Management Commands:${NC}"
    echo "  • Status:  sudo systemctl status sai-dashboard-api"
    echo "  • Restart: sudo systemctl restart sai-dashboard-api" 
    echo "  • Logs:    sudo journalctl -u sai-dashboard-api -f"
    echo ""
    echo -e "${BLUE}📁 Login Credentials:${NC}"
    echo "  • Password: $(grep DASHBOARD_PASSWORD /opt/sai-dashboard/.env | cut -d'=' -f2)"
}

# Main installation function
main() {
    log "🚀 Starting SAI Dashboard Production Installation..."
    
    get_script_dir
    detect_system
    check_prerequisites
    build_frontend
    build_backend
    create_directories
    deploy_files
    
    if [[ "$INIT_SYSTEM" == "systemd" ]]; then
        create_systemd_service
    else
        create_sysv_service
    fi
    
    configure_web_server
    start_services
    verify_installation
    show_deployment_info
    
    log "✅ Installation completed successfully!"
}

# Run main function
main "$@"