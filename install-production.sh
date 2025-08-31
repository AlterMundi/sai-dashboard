#!/bin/bash
# SAI Dashboard Production Installation Script
# Complete deployment with built-in quality checks

set -e  # Exit on any error

# Script version
VERSION="2.0.0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration flags (defaults)
SKIP_PREREQ=false
SKIP_QUALITY=false
SKIP_BUILD=false
SKIP_DEPLOY=false
SKIP_SERVICE=false
SKIP_VERIFY=false
FORCE_REBUILD=false
VERBOSE=false
DRY_RUN=false

# Logging functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    [ "$DRY_RUN" = true ] || exit 1
}

info() {
    echo -e "${CYAN}[INFO] $1${NC}"
}

success() {
    echo -e "${GREEN}${BOLD}✓${NC} ${GREEN}$1${NC}"
}

# Show usage
show_usage() {
    cat << EOF
${BOLD}SAI Dashboard Production Installation Script v${VERSION}${NC}

${BOLD}Usage:${NC}
    $0 [OPTIONS]

${BOLD}Options:${NC}
    ${CYAN}-h, --help${NC}              Show this help message
    ${CYAN}-v, --verbose${NC}           Enable verbose output
    ${CYAN}-d, --dry-run${NC}           Simulate installation without making changes
    ${CYAN}-f, --force${NC}             Force rebuild even if builds exist
    
    ${BOLD}Skip Phases:${NC}
    ${CYAN}--skip-prereq${NC}           Skip prerequisite checks
    ${CYAN}--skip-quality${NC}          Skip pre-build quality checks
    ${CYAN}--skip-build${NC}            Skip build phase (use existing builds)
    ${CYAN}--skip-deploy${NC}           Skip deployment phase
    ${CYAN}--skip-service${NC}          Skip service configuration
    ${CYAN}--skip-verify${NC}           Skip post-installation verification
    
    ${BOLD}Individual Phases:${NC}
    ${CYAN}--only-build${NC}            Only run build phase
    ${CYAN}--only-deploy${NC}           Only run deployment phase
    ${CYAN}--only-verify${NC}           Only run verification phase

${BOLD}Examples:${NC}
    ${CYAN}$0${NC}                      # Complete installation (default)
    ${CYAN}$0 --skip-quality${NC}       # Fast installation, skip quality checks
    ${CYAN}$0 --only-build${NC}         # Build only, don't deploy
    ${CYAN}$0 --dry-run${NC}            # Simulate without changes
    ${CYAN}$0 -f --only-deploy${NC}     # Force redeploy with existing builds

${BOLD}Default Behavior:${NC}
    Runs complete installation with all quality checks enabled.

EOF
    exit 0
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
                info "DRY RUN MODE - No changes will be made"
                shift
                ;;
            -f|--force)
                FORCE_REBUILD=true
                shift
                ;;
            --skip-prereq)
                SKIP_PREREQ=true
                shift
                ;;
            --skip-quality)
                SKIP_QUALITY=true
                shift
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --skip-deploy)
                SKIP_DEPLOY=true
                shift
                ;;
            --skip-service)
                SKIP_SERVICE=true
                shift
                ;;
            --skip-verify)
                SKIP_VERIFY=true
                shift
                ;;
            --only-build)
                SKIP_PREREQ=true
                SKIP_DEPLOY=true
                SKIP_SERVICE=true
                SKIP_VERIFY=true
                shift
                ;;
            --only-deploy)
                SKIP_PREREQ=true
                SKIP_QUALITY=true
                SKIP_BUILD=true
                SKIP_VERIFY=true
                shift
                ;;
            --only-verify)
                SKIP_PREREQ=true
                SKIP_QUALITY=true
                SKIP_BUILD=true
                SKIP_DEPLOY=true
                SKIP_SERVICE=true
                shift
                ;;
            *)
                error "Unknown option: $1"
                show_usage
                ;;
        esac
    done
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
    
    # Validate environment configuration
    log "Validating environment configuration..."
    source "$SCRIPT_DIR/.env"
    
    # Check required environment variables
    REQUIRED_VARS=("DB_HOST" "DB_PORT" "DB_NAME" "DB_USER" "DB_PASSWORD" "DASHBOARD_PASSWORD" "SESSION_SECRET")
    for var in "${REQUIRED_VARS[@]}"; do
        if [[ -z "${!var}" ]]; then
            error "Required environment variable missing: $var"
        fi
    done
    
    # Test database connectivity (quick check)
    log "Testing database connectivity..."
    if timeout 3 bash -c "echo > /dev/tcp/$DB_HOST/${DB_PORT:-5432}" 2>/dev/null; then
        log "✓ Database port accessible at $DB_HOST:${DB_PORT:-5432}"
    else
        error "Cannot connect to database at $DB_HOST:${DB_PORT:-5432}"
    fi
    
    log "Prerequisites check passed"
}

# Pre-build quality checks
pre_build_checks() {
    [ "$SKIP_QUALITY" = true ] && { info "Skipping quality checks (--skip-quality)"; return; }
    
    log "Running pre-build quality checks..."
    local start_time=$(date +%s)
    
    # Backend TypeScript validation
    info "Validating backend TypeScript..."
    cd "$SCRIPT_DIR/backend"
    
    if [ "$DRY_RUN" = true ]; then
        info "[DRY RUN] Would validate backend TypeScript"
    else
        if [ "$VERBOSE" = true ]; then
            npm run type-check || error "Backend TypeScript validation failed"
        else
            if ! npm run type-check >/dev/null 2>&1; then
                error "Backend TypeScript validation failed. Run 'cd backend && npm run type-check' to see errors."
            fi
        fi
    fi
    success "Backend TypeScript valid"
    
    # Frontend TypeScript validation
    info "Validating frontend TypeScript..."
    cd "$SCRIPT_DIR/frontend"
    
    if [ "$DRY_RUN" = true ]; then
        info "[DRY RUN] Would validate frontend TypeScript"
    else
        if [ "$VERBOSE" = true ]; then
            npm run type-check || error "Frontend TypeScript validation failed"
        else
            if ! npm run type-check >/dev/null 2>&1; then
                error "Frontend TypeScript validation failed. Run 'cd frontend && npm run type-check' to see errors."
            fi
        fi
    fi
    success "Frontend TypeScript valid"
    
    # Lint checks (non-blocking, just warn)
    if [ "$VERBOSE" = true ]; then
        info "Running lint checks..."
        cd "$SCRIPT_DIR/backend"
        npm run lint || warn "Backend has lint warnings"
        
        cd "$SCRIPT_DIR/frontend"
        npm run lint || warn "Frontend has lint warnings"
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    success "Pre-build checks completed in ${duration}s"
}

# Build frontend
build_frontend() {
    [ "$SKIP_BUILD" = true ] && { info "Skipping frontend build (--skip-build)"; return; }
    
    cd "$SCRIPT_DIR/frontend"
    
    # Check if build exists and force flag
    if [[ -d "dist" ]] && [ "$FORCE_REBUILD" = false ]; then
        info "Frontend build already exists. Use -f to force rebuild."
        return
    fi
    
    log "Building frontend for production..."
    local start_time=$(date +%s)
    
    # Install dependencies 
    info "Installing frontend dependencies (this may take a moment)..."
    if [ "$DRY_RUN" = true ]; then
        info "[DRY RUN] Would install frontend dependencies"
    else
        if [ "$VERBOSE" = true ]; then
            npm install
        else
            npm install --silent >/dev/null 2>&1 || error "Failed to install frontend dependencies"
        fi
    fi
    success "Frontend dependencies installed"
    
    # Build with production settings
    info "Building React application (this may take 30-60 seconds)..."
    if [ "$DRY_RUN" = true ]; then
        info "[DRY RUN] Would build frontend with VITE_BASE_PATH=/dashboard/ VITE_API_URL=/dashboard/api"
    else
        if [ "$VERBOSE" = true ]; then
            VITE_BASE_PATH="/dashboard/" VITE_API_URL="/dashboard/api" npm run build -- --mode production
        else
            VITE_BASE_PATH="/dashboard/" VITE_API_URL="/dashboard/api" npm run build -- --mode production >/dev/null 2>&1 || error "Frontend build failed"
        fi
    fi
    
    if [ "$DRY_RUN" = false ]; then
        if [[ ! -d "dist" ]]; then
            error "Frontend build failed - no dist directory created"
        fi
        
        # Validate build output
        if [[ ! -f "dist/index.html" ]]; then
            error "Frontend build incomplete - missing index.html"
        fi
        
        # Check for proper base path configuration
        if ! grep -q "/dashboard/" dist/index.html 2>/dev/null; then
            warn "Frontend may not have correct base path configured"
        fi
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    success "Frontend built and validated successfully in ${duration}s"
}

# Build backend
build_backend() {
    [ "$SKIP_BUILD" = true ] && { info "Skipping backend build (--skip-build)"; return; }
    
    cd "$SCRIPT_DIR/backend"
    
    # Check if build exists and force flag
    if [[ -d "dist" ]] && [ "$FORCE_REBUILD" = false ]; then
        info "Backend build already exists. Use -f to force rebuild."
        return
    fi
    
    log "Building backend for production..."
    local start_time=$(date +%s)
    
    # Install dependencies
    info "Installing backend dependencies (this may take a moment)..."
    if [ "$DRY_RUN" = true ]; then
        info "[DRY RUN] Would install backend dependencies"
    else
        if [ "$VERBOSE" = true ]; then
            npm install
        else
            npm install --silent >/dev/null 2>&1 || error "Failed to install backend dependencies"
        fi
    fi
    success "Backend dependencies installed"
    
    # Build TypeScript using npm script
    info "Compiling TypeScript (this may take 20-40 seconds)..."
    if [ "$DRY_RUN" = true ]; then
        info "[DRY RUN] Would compile backend TypeScript"
    else
        if [ "$VERBOSE" = true ]; then
            npm run build || error "Backend build failed"
        else
            npm run build >/dev/null 2>&1 || error "Backend build failed"
        fi
    fi
    
    if [ "$DRY_RUN" = false ]; then
        if [[ ! -d "dist" ]]; then
            error "Backend build failed - no dist directory created"
        fi
        
        # CRITICAL: Verify that tsc-alias resolved imports properly
        info "Verifying path alias resolution (critical check)..."
        if grep -r "@/" dist/ >/dev/null 2>&1; then
            error "❌ CRITICAL: Path aliases (@/) not resolved in compiled code. tsc-alias failed!"
            error "This will cause runtime failures. Fix tsconfig paths configuration."
            exit 1
        fi
        success "Path aliases resolved correctly"
        
        # Verify main entry point exists
        if [[ ! -f "dist/index.js" ]]; then
            error "Backend build incomplete - missing dist/index.js"
        fi
        
        # Check for self-contained routing
        if ! grep -q "/dashboard/api" dist/index.js 2>/dev/null; then
            warn "Backend may not have self-contained API routing configured"
        fi
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    success "Backend built and validated successfully in ${duration}s"
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
    [ "$SKIP_DEPLOY" = true ] && { info "Skipping file deployment (--skip-deploy)"; return; }
    
    log "Deploying application files..."
    
    if [ "$DRY_RUN" = true ]; then
        info "[DRY RUN] Would deploy frontend to $WEB_ROOT/sai-dashboard/"
        info "[DRY RUN] Would deploy backend to /opt/sai-dashboard/backend/"
        info "[DRY RUN] Would copy environment configuration"
        return
    fi
    
    # Copy frontend build
    info "Deploying frontend assets..."
    sudo cp -r "$SCRIPT_DIR/frontend/dist/"* "$WEB_ROOT/sai-dashboard/" || error "Failed to deploy frontend"
    success "Frontend deployed"
    
    # Copy backend files
    info "Deploying backend application..."
    sudo cp -r "$SCRIPT_DIR/backend/dist" "/opt/sai-dashboard/backend/" || error "Failed to deploy backend dist"
    sudo cp -r "$SCRIPT_DIR/backend/node_modules" "/opt/sai-dashboard/backend/" || error "Failed to deploy backend modules"
    sudo cp "$SCRIPT_DIR/backend/package.json" "/opt/sai-dashboard/backend/" || error "Failed to deploy package.json"
    success "Backend deployed"
    
    # Copy environment file
    info "Deploying configuration..."
    sudo cp "$SCRIPT_DIR/.env" "/opt/sai-dashboard/" || error "Failed to deploy environment configuration"
    
    # Set permissions
    info "Setting file permissions..."
    sudo chown -R "$WEB_USER:$WEB_USER" "/opt/sai-dashboard"
    sudo chown -R "$WEB_USER:$WEB_USER" "$WEB_ROOT/sai-dashboard"
    
    success "Files deployed successfully"
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
    
    # Give service a moment to fully start
    sleep 3
    
    # Check if API is responding (with retries)
    log "Testing API health endpoint..."
    local retry_count=0
    local max_retries=5
    
    while [[ $retry_count -lt $max_retries ]]; do
        if curl -f -s -m 5 http://localhost:3001/dashboard/api/health >/dev/null 2>&1; then
            log "✓ API health check passed"
            
            # Test API response time
            local start_time=$(date +%s%N)
            curl -s -m 5 http://localhost:3001/dashboard/api/health >/dev/null 2>&1
            local end_time=$(date +%s%N)
            local response_time=$(( (end_time - start_time) / 1000000 ))
            
            if [[ $response_time -lt 500 ]]; then
                log "✓ API response time: ${response_time}ms (excellent)"
            elif [[ $response_time -lt 2000 ]]; then
                log "✓ API response time: ${response_time}ms (good)"
            else
                warn "⚠ API response time: ${response_time}ms (slow)"
            fi
            break
        else
            retry_count=$((retry_count + 1))
            if [[ $retry_count -lt $max_retries ]]; then
                log "API not ready yet, retrying in 2 seconds... ($retry_count/$max_retries)"
                sleep 2
            else
                error "❌ API health check failed after $max_retries attempts"
                error "Check logs: sudo journalctl -u sai-dashboard-api -n 50"
            fi
        fi
    done
    
    # Test database connectivity through API
    log "Testing database connectivity via API..."
    if curl -s http://localhost:3001/dashboard/api/executions?limit=1 | grep -q "data" 2>/dev/null; then
        log "✓ Database queries working through API"
    else
        warn "⚠ Database queries may not be working properly"
    fi
    
    # Check if frontend files exist and are accessible
    if [[ -f "$WEB_ROOT/sai-dashboard/index.html" ]]; then
        log "✓ Frontend files deployed"
        
        # Check if frontend assets are properly built
        if ls "$WEB_ROOT/sai-dashboard/assets/"*.js >/dev/null 2>&1; then
            log "✓ Frontend JavaScript assets found"
        else
            warn "⚠ Frontend JavaScript assets may be missing"
        fi
    else
        error "❌ Frontend files not found at $WEB_ROOT/sai-dashboard/"
    fi
    
    # Check service status
    if [[ "$INIT_SYSTEM" == "systemd" ]]; then
        if sudo systemctl is-active --quiet sai-dashboard-api.service; then
            log "✓ Service is running"
            
            # Check for recent errors in service logs
            if sudo journalctl -u sai-dashboard-api.service --since "5 minutes ago" | grep -i error >/dev/null 2>&1; then
                warn "⚠ Recent errors found in service logs"
                warn "Check: sudo journalctl -u sai-dashboard-api.service --since '5 minutes ago'"
            else
                log "✓ No recent errors in service logs"
            fi
        else
            error "❌ Service is not running"
            error "Debug: sudo systemctl status sai-dashboard-api.service"
        fi
    fi
    
    # Final nginx configuration test
    if command -v nginx >/dev/null 2>&1; then
        if sudo nginx -t >/dev/null 2>&1; then
            log "✓ nginx configuration valid"
        else
            error "❌ nginx configuration has errors"
            error "Run: sudo nginx -t"
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

# Show installation summary
show_summary() {
    echo
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}         SAI Dashboard Installation Summary         ${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
    
    local total_time=$(($(date +%s) - SCRIPT_START_TIME))
    local minutes=$((total_time / 60))
    local seconds=$((total_time % 60))
    
    echo -e "${BOLD}Installation completed in: ${CYAN}${minutes}m ${seconds}s${NC}"
    echo
    
    echo -e "${BOLD}Steps executed:${NC}"
    [ "$SKIP_PREREQ" = false ] && echo -e "  ${GREEN}✓${NC} Prerequisites checked"
    [ "$SKIP_QUALITY" = false ] && echo -e "  ${GREEN}✓${NC} Quality checks passed"
    [ "$SKIP_BUILD" = false ] && echo -e "  ${GREEN}✓${NC} Applications built"
    [ "$SKIP_DEPLOY" = false ] && echo -e "  ${GREEN}✓${NC} Files deployed"
    [ "$SKIP_SERVICE" = false ] && echo -e "  ${GREEN}✓${NC} Services configured"
    [ "$SKIP_VERIFY" = false ] && echo -e "  ${GREEN}✓${NC} Installation verified"
    
    echo
    echo -e "${BOLD}${GREEN}🎉 Installation successful!${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Main installation function
main() {
    # Record start time
    SCRIPT_START_TIME=$(date +%s)
    
    # Parse command line arguments
    parse_args "$@"
    
    # Show banner
    echo
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}    SAI Dashboard Production Installation v${VERSION}    ${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
    
    [ "$DRY_RUN" = true ] && echo -e "${YELLOW}${BOLD}DRY RUN MODE - No changes will be made${NC}\n"
    
    log "Starting installation process..."
    
    # Get script directory
    get_script_dir
    
    # Phase 1: System detection and prerequisites
    if [ "$SKIP_PREREQ" = false ]; then
        detect_system
        check_prerequisites
    else
        info "Skipping prerequisites (--skip-prereq)"
        get_script_dir  # Still need this for paths
    fi
    
    # Phase 2: Quality checks
    pre_build_checks
    
    # Phase 3: Build
    if [ "$SKIP_BUILD" = false ]; then
        build_frontend
        build_backend
    else
        info "Skipping build phase (--skip-build)"
    fi
    
    # Phase 4: Deploy
    if [ "$SKIP_DEPLOY" = false ]; then
        create_directories
        deploy_files
    else
        info "Skipping deployment (--skip-deploy)"
    fi
    
    # Phase 5: Service configuration
    if [ "$SKIP_SERVICE" = false ]; then
        # Ensure INIT_SYSTEM is set if we skipped detection
        if [ -z "$INIT_SYSTEM" ]; then
            detect_system
        fi
        
        if [[ "$INIT_SYSTEM" == "systemd" ]]; then
            create_systemd_service
        else
            create_sysv_service
        fi
        configure_web_server
        start_services
    else
        info "Skipping service configuration (--skip-service)"
    fi
    
    # Phase 6: Verification
    if [ "$SKIP_VERIFY" = false ]; then
        verify_installation
    else
        info "Skipping verification (--skip-verify)"
    fi
    
    # Show final information
    if [ "$SKIP_DEPLOY" = false ] && [ "$SKIP_SERVICE" = false ]; then
        show_deployment_info
    fi
    
    # Show summary
    show_summary
}

# Run main function
main "$@"