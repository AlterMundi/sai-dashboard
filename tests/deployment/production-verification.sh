#!/bin/bash

# SAI Dashboard Production Deployment Verification
# Tests the complete production environment setup

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test configuration
PRODUCTION_BACKEND_DIR="/opt/sai-dashboard/backend"
LOCAL_PROJECT_DIR="/root/sai-dashboard"
NGINX_CONFIG="/etc/nginx/sites-available/sai-dashboard"
SYSTEMD_SERVICE="/etc/systemd/system/sai-dashboard-api.service"
CACHE_DIR="/mnt/raid1/n8n/backup/images"
FRONTEND_BUILD_DIR="/var/www/sai-dashboard"

TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ((TESTS_FAILED++))
    FAILED_TESTS+=("$1")
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Test 1: File Structure and Permissions
test_file_structure() {
    log_info "Testing production file structure and permissions..."
    
    # Check production backend directory
    if [[ -d "$PRODUCTION_BACKEND_DIR" ]]; then
        log_success "Production backend directory exists"
        
        # Check for built JavaScript files
        if [[ -f "$PRODUCTION_BACKEND_DIR/dist/index.js" ]]; then
            log_success "Backend build exists"
            
            # Check for unresolved imports
            if grep -r "require('@/" "$PRODUCTION_BACKEND_DIR/dist/" >/dev/null 2>&1; then
                log_error "Production build contains unresolved path aliases"
            else
                log_success "Production build has resolved imports"
            fi
        else
            log_error "Backend build not found at $PRODUCTION_BACKEND_DIR/dist/index.js"
        fi
        
        # Check node_modules
        if [[ -d "$PRODUCTION_BACKEND_DIR/node_modules" ]]; then
            log_success "Production node_modules exists"
        else
            log_error "Production node_modules missing"
        fi
        
        # Check .env file
        if [[ -f "$PRODUCTION_BACKEND_DIR/.env" ]] || [[ -f "$LOCAL_PROJECT_DIR/.env" ]]; then
            log_success "Environment configuration found"
        else
            log_error "Environment configuration missing"
        fi
    else
        log_error "Production backend directory not found: $PRODUCTION_BACKEND_DIR"
    fi
    
    # Check frontend build
    if [[ -d "$FRONTEND_BUILD_DIR" ]]; then
        log_success "Frontend build directory exists"
        
        if [[ -f "$FRONTEND_BUILD_DIR/index.html" ]]; then
            log_success "Frontend index.html exists"
            
            # Check base path configuration
            if grep -q '"/dashboard/"' "$FRONTEND_BUILD_DIR/index.html" 2>/dev/null; then
                log_success "Frontend has correct base path configuration"
            else
                log_warning "Frontend may be missing base path configuration"
            fi
        else
            log_error "Frontend index.html not found"
        fi
        
        if [[ -d "$FRONTEND_BUILD_DIR/assets" ]]; then
            log_success "Frontend assets directory exists"
        else
            log_warning "Frontend assets directory missing"
        fi
    else
        log_error "Frontend build directory not found: $FRONTEND_BUILD_DIR"
    fi
}

# Test 2: Service Configuration
test_service_configuration() {
    log_info "Testing service configuration..."
    
    # Check systemd service file
    if [[ -f "$SYSTEMD_SERVICE" ]]; then
        log_success "systemd service file exists"
        
        # Validate service file syntax
        if sudo systemd-analyze verify "$SYSTEMD_SERVICE" >/dev/null 2>&1; then
            log_success "systemd service configuration is valid"
        else
            log_error "systemd service configuration has issues"
        fi
        
        # Check service status
        if systemctl is-enabled sai-dashboard-api.service >/dev/null 2>&1; then
            log_success "SAI Dashboard API service is enabled"
        else
            log_warning "SAI Dashboard API service is not enabled"
        fi
        
        # Check if service is running
        if systemctl is-active sai-dashboard-api.service >/dev/null 2>&1; then
            log_success "SAI Dashboard API service is running"
            
            # Test API endpoint
            if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
                log_success "API health endpoint responding"
            else
                log_error "API health endpoint not responding"
            fi
        else
            log_warning "SAI Dashboard API service is not running"
        fi
    else
        log_error "systemd service file not found: $SYSTEMD_SERVICE"
    fi
}

# Test 3: nginx Configuration
test_nginx_configuration() {
    log_info "Testing nginx configuration..."
    
    # Check nginx config file
    if [[ -f "$NGINX_CONFIG" ]]; then
        log_success "nginx configuration file exists"
        
        # Test nginx configuration syntax
        if sudo nginx -t >/dev/null 2>&1; then
            log_success "nginx configuration syntax is valid"
        else
            log_error "nginx configuration syntax error"
        fi
        
        # Check if site is enabled
        if [[ -L "/etc/nginx/sites-enabled/sai-dashboard" ]]; then
            log_success "nginx site is enabled"
        else
            log_warning "nginx site is not enabled"
        fi
        
        # Test nginx service
        if systemctl is-active nginx.service >/dev/null 2>&1; then
            log_success "nginx service is running"
            
            # Test local dashboard access
            if curl -s http://localhost/dashboard/ >/dev/null 2>&1; then
                log_success "Dashboard accessible through nginx"
            else
                log_error "Dashboard not accessible through nginx"
            fi
        else
            log_error "nginx service is not running"
        fi
    else
        log_error "nginx configuration file not found: $NGINX_CONFIG"
    fi
    
    # Check public proxy configuration
    if [[ -f "$LOCAL_PROJECT_DIR/nginx/sai-altermundi-net.conf" ]]; then
        log_success "Public proxy configuration exists"
    else
        log_error "Public proxy configuration missing"
    fi
}

# Test 4: Database Connectivity
test_database_connectivity() {
    log_info "Testing database connectivity..."
    
    # Load environment variables
    if [[ -f "$LOCAL_PROJECT_DIR/.env" ]]; then
        source "$LOCAL_PROJECT_DIR/.env"
    elif [[ -f "$PRODUCTION_BACKEND_DIR/.env" ]]; then
        source "$PRODUCTION_BACKEND_DIR/.env"
    fi
    
    if [[ -n "$DB_HOST" && -n "$DB_USER" && -n "$DB_NAME" ]]; then
        # Test database connection
        if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" >/dev/null 2>&1; then
            log_success "Database connection successful"
            
            # Test required tables
            if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1 FROM execution_entity LIMIT 1;" >/dev/null 2>&1; then
                log_success "execution_entity table accessible"
            else
                log_error "execution_entity table not accessible"
            fi
            
            # Test SAI workflow data
            if [[ -n "$SAI_WORKFLOW_NAME" ]]; then
                workflow_count=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM execution_entity e JOIN workflow_entity w ON e.\"workflowId\" = w.id WHERE w.name LIKE '%${SAI_WORKFLOW_NAME}%';" 2>/dev/null | tr -d ' ')
                
                if [[ "$workflow_count" -gt 0 ]]; then
                    log_success "SAI workflow executions found: $workflow_count"
                else
                    log_warning "No SAI workflow executions found"
                fi
            fi
        else
            log_error "Database connection failed"
        fi
    else
        log_error "Database connection parameters not configured"
    fi
}

# Test 5: Cache Directory Setup
test_cache_setup() {
    log_info "Testing cache directory setup..."
    
    if [[ -d "$CACHE_DIR" ]]; then
        log_success "Cache directory exists: $CACHE_DIR"
        
        # Test write permissions
        if touch "$CACHE_DIR/deployment_test" 2>/dev/null; then
            rm -f "$CACHE_DIR/deployment_test"
            log_success "Cache directory has write permissions"
        else
            log_error "Cache directory lacks write permissions"
        fi
        
        # Check subdirectory structure
        subdirs=("by-date" "by-execution" "by-status")
        for subdir in "${subdirs[@]}"; do
            if [[ -d "$CACHE_DIR/$subdir" ]]; then
                log_success "Cache subdirectory exists: $subdir"
            else
                log_warning "Cache subdirectory missing (will be created): $subdir"
            fi
        done
        
        # Check disk space
        available_space=$(df -BG "$CACHE_DIR" | awk 'NR==2 {print $4}' | sed 's/G//')
        if [[ "$available_space" -gt 1 ]]; then
            log_success "Sufficient disk space available: ${available_space}GB"
        else
            log_warning "Low disk space available: ${available_space}GB"
        fi
    else
        log_error "Cache directory not found: $CACHE_DIR"
    fi
}

# Test 6: Security Configuration
test_security_configuration() {
    log_info "Testing security configuration..."
    
    # Check file permissions
    if [[ -f "$LOCAL_PROJECT_DIR/.env" ]]; then
        env_perms=$(stat -c "%a" "$LOCAL_PROJECT_DIR/.env" 2>/dev/null)
        if [[ "$env_perms" == "600" ]] || [[ "$env_perms" == "640" ]]; then
            log_success "Environment file has secure permissions: $env_perms"
        else
            log_warning "Environment file permissions may be too open: $env_perms"
        fi
    fi
    
    # Check for sensitive data in logs
    if [[ -f "/var/log/sai-dashboard/app.log" ]]; then
        if grep -i "password\|secret\|token" "/var/log/sai-dashboard/app.log" >/dev/null 2>&1; then
            log_warning "Potential sensitive data found in application logs"
        else
            log_success "No sensitive data found in application logs"
        fi
    else
        log_info "Application log file not found (may use system journal)"
    fi
    
    # Check systemd service security settings
    if grep -q "NoNewPrivileges=true" "$SYSTEMD_SERVICE" 2>/dev/null; then
        log_success "systemd service has NoNewPrivileges enabled"
    else
        log_warning "systemd service missing NoNewPrivileges security setting"
    fi
    
    # Check for running as non-root
    if grep -q "User=www-data\|User=node\|User=sai" "$SYSTEMD_SERVICE" 2>/dev/null; then
        log_success "Service configured to run as non-root user"
    else
        log_warning "Service may be running as root user"
    fi
}

# Test 7: Monitoring and Logging
test_monitoring_logging() {
    log_info "Testing monitoring and logging..."
    
    # Check service logs
    if journalctl -u sai-dashboard-api.service --since "1 hour ago" --no-pager -q >/dev/null 2>&1; then
        log_success "Service logs accessible via journalctl"
        
        # Check for errors in recent logs
        error_count=$(journalctl -u sai-dashboard-api.service --since "1 hour ago" --no-pager -q | grep -ci "error\|failed\|exception" || true)
        
        if [[ "$error_count" == "0" ]]; then
            log_success "No recent errors in service logs"
        else
            log_warning "Recent errors found in service logs: $error_count"
        fi
    else
        log_warning "Service logs not accessible or service not found"
    fi
    
    # Check nginx logs
    if [[ -f "/var/log/nginx/access.log" ]]; then
        recent_requests=$(tail -100 "/var/log/nginx/access.log" | grep "/dashboard/" | wc -l)
        if [[ "$recent_requests" -gt 0 ]]; then
            log_success "Recent dashboard requests found in nginx logs: $recent_requests"
        else
            log_info "No recent dashboard requests in nginx logs"
        fi
    fi
    
    if [[ -f "/var/log/nginx/error.log" ]]; then
        recent_errors=$(tail -100 "/var/log/nginx/error.log" | grep -v "notice" | wc -l)
        if [[ "$recent_errors" == "0" ]]; then
            log_success "No recent nginx errors"
        else
            log_warning "Recent nginx errors found: $recent_errors"
        fi
    fi
}

# Test 8: Performance Verification
test_performance() {
    log_info "Testing production performance..."
    
    # Test API response time
    if command -v curl >/dev/null 2>&1; then
        start_time=$(date +%s%N)
        if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
            end_time=$(date +%s%N)
            response_time=$((($end_time - $start_time) / 1000000))
            
            if [[ $response_time -lt 1000 ]]; then
                log_success "API response time: ${response_time}ms (excellent)"
            elif [[ $response_time -lt 3000 ]]; then
                log_success "API response time: ${response_time}ms (good)"
            else
                log_warning "API response time: ${response_time}ms (slow)"
            fi
        else
            log_error "API not responding for performance test"
        fi
    fi
    
    # Check memory usage
    if command -v ps >/dev/null 2>&1; then
        node_memory=$(ps aux | grep "node.*sai-dashboard" | grep -v grep | awk '{print $6}' | head -1)
        if [[ -n "$node_memory" ]]; then
            memory_mb=$((node_memory / 1024))
            if [[ $memory_mb -lt 256 ]]; then
                log_success "Node.js memory usage: ${memory_mb}MB (efficient)"
            elif [[ $memory_mb -lt 512 ]]; then
                log_success "Node.js memory usage: ${memory_mb}MB (acceptable)"
            else
                log_warning "Node.js memory usage: ${memory_mb}MB (high)"
            fi
        fi
    fi
}

# Test 9: Backup and Recovery Readiness
test_backup_readiness() {
    log_info "Testing backup and recovery readiness..."
    
    # Check if important directories are backup-ready
    important_dirs=(
        "$PRODUCTION_BACKEND_DIR"
        "$FRONTEND_BUILD_DIR"
        "$LOCAL_PROJECT_DIR"
        "$CACHE_DIR"
    )
    
    for dir in "${important_dirs[@]}"; do
        if [[ -d "$dir" ]]; then
            # Check if directory is readable for backup
            if [[ -r "$dir" ]]; then
                log_success "Directory backup-ready: $dir"
            else
                log_warning "Directory not readable for backup: $dir"
            fi
        fi
    done
    
    # Check configuration files
    config_files=(
        "$NGINX_CONFIG"
        "$SYSTEMD_SERVICE"
        "$LOCAL_PROJECT_DIR/.env"
    )
    
    for file in "${config_files[@]}"; do
        if [[ -f "$file" ]]; then
            log_success "Configuration file exists: $(basename "$file")"
        else
            log_warning "Configuration file missing: $(basename "$file")"
        fi
    done
}

# Main test execution
echo "=============================================="
echo "  SAI Dashboard Production Deployment Test"
echo "=============================================="

test_file_structure
echo
test_service_configuration
echo
test_nginx_configuration
echo
test_database_connectivity
echo
test_cache_setup
echo
test_security_configuration
echo
test_monitoring_logging
echo
test_performance
echo
test_backup_readiness
echo

# Final results
echo "=============================================="
echo "        PRODUCTION DEPLOYMENT RESULTS"
echo "=============================================="
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"

if [[ $TESTS_FAILED -gt 0 ]]; then
    echo
    echo -e "${RED}Failed Tests:${NC}"
    for test in "${FAILED_TESTS[@]}"; do
        echo -e "  - $test"
    done
    echo
    echo -e "${RED}❌ Production deployment has issues that need attention.${NC}"
    echo
    echo "Recommended actions:"
    echo "1. Review failed tests above"
    echo "2. Run deployment script: $LOCAL_PROJECT_DIR/scripts/install.sh"
    echo "3. Check service status: systemctl status sai-dashboard-api"
    echo "4. Review logs: journalctl -u sai-dashboard-api -f"
    exit 1
else
    echo
    echo -e "${GREEN}✅ Production deployment verification successful!${NC}"
    echo
    echo "Dashboard Status:"
    echo "- Local Access: http://localhost/dashboard/"
    echo "- API Health: http://localhost:3001/api/health"
    echo "- Service Status: $(systemctl is-active sai-dashboard-api.service 2>/dev/null || echo 'unknown')"
    echo "- nginx Status: $(systemctl is-active nginx.service 2>/dev/null || echo 'unknown')"
    exit 0
fi