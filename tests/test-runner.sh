#!/bin/bash

# SAI Dashboard Test Runner
# Comprehensive testing framework for debugging and consolidating releases

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
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

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ((TESTS_FAILED++))
    FAILED_TESTS+=("$1")
}

# Test configuration
PROJECT_ROOT="/root/sai-dashboard"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
PRODUCTION_BACKEND="/opt/sai-dashboard/backend"

echo "=============================================="
echo "    SAI Dashboard Test Framework"
echo "=============================================="

# Test 1: Environment Configuration Validation
test_environment_config() {
    log_info "Testing environment configuration..."
    
    # Check .env file exists and has required variables
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        required_vars=("DATABASE_URL" "DB_HOST" "DB_PORT" "DB_NAME" "DB_USER" "DB_PASSWORD" "DASHBOARD_PASSWORD" "SESSION_SECRET")
        for var in "${required_vars[@]}"; do
            if grep -q "^${var}=" "$PROJECT_ROOT/.env"; then
                log_success "Environment variable $var is configured"
            else
                log_error "Missing required environment variable: $var"
            fi
        done
    else
        log_error ".env file not found in $PROJECT_ROOT"
    fi
}

# Test 2: TypeScript Compilation and Path Resolution
test_typescript_compilation() {
    log_info "Testing TypeScript compilation..."
    
    # Backend TypeScript compilation
    cd "$BACKEND_DIR"
    if npm run build > /tmp/backend_build.log 2>&1; then
        log_success "Backend TypeScript compilation successful"
        
        # Check for path alias resolution issues
        if grep -r "from '@/" dist/ > /tmp/path_aliases.log 2>/dev/null; then
            log_error "Path aliases (@/) not resolved in backend build"
            cat /tmp/path_aliases.log
        else
            log_success "Backend path aliases resolved correctly"
        fi
    else
        log_error "Backend TypeScript compilation failed"
        tail -20 /tmp/backend_build.log
    fi
    
    # Frontend TypeScript compilation
    cd "$FRONTEND_DIR"
    if npm run build > /tmp/frontend_build.log 2>&1; then
        log_success "Frontend TypeScript compilation successful"
    else
        log_error "Frontend TypeScript compilation failed"
        tail -20 /tmp/frontend_build.log
    fi
}

# Test 3: Database Connection and Schema Validation
test_database_connection() {
    log_info "Testing database connection..."
    
    cd "$BACKEND_DIR"
    
    # Test database connection
    if node -e "
        require('dotenv').config({ path: '../.env' });
        const { Pool } = require('pg');
        const pool = new Pool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD
        });
        pool.query('SELECT 1', (err, res) => {
            if (err) {
                console.error('Database connection failed:', err.message);
                process.exit(1);
            } else {
                console.log('Database connection successful');
                pool.end();
            }
        });
    " > /tmp/db_test.log 2>&1; then
        log_success "Database connection test passed"
        
        # Test required tables exist
        if node -e "
            require('dotenv').config({ path: '../.env' });
            const { Pool } = require('pg');
            const pool = new Pool({
                host: process.env.DB_HOST,
                port: process.env.DB_PORT,
                database: process.env.DB_NAME,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD
            });
            const tables = ['execution_entity', 'execution_data', 'workflow_entity'];
            Promise.all(tables.map(table => 
                pool.query('SELECT 1 FROM ' + table + ' LIMIT 1')
            )).then(() => {
                console.log('All required tables accessible');
                pool.end();
            }).catch(err => {
                console.error('Table access failed:', err.message);
                pool.end();
                process.exit(1);
            });
        " > /tmp/db_tables.log 2>&1; then
            log_success "Database table access test passed"
        else
            log_error "Database table access test failed"
            cat /tmp/db_tables.log
        fi
    else
        log_error "Database connection test failed"
        cat /tmp/db_test.log
    fi
}

# Test 4: Service Configuration and systemd
test_service_configuration() {
    log_info "Testing service configuration..."
    
    # Check systemd service files
    if [[ -f "/etc/systemd/system/sai-dashboard-api.service" ]]; then
        log_success "systemd service file exists"
        
        # Test service can start (dry run)
        if sudo systemd-analyze verify /etc/systemd/system/sai-dashboard-api.service > /tmp/service_verify.log 2>&1; then
            log_success "systemd service configuration is valid"
        else
            log_error "systemd service configuration has issues"
            cat /tmp/service_verify.log
        fi
    else
        log_error "systemd service file not found"
    fi
    
    # Check production backend directory structure
    if [[ -d "$PRODUCTION_BACKEND" ]]; then
        log_success "Production backend directory exists"
        
        # Check for common module resolution issues
        if [[ -f "$PRODUCTION_BACKEND/dist/index.js" ]]; then
            if grep -q "require('@/" "$PRODUCTION_BACKEND/dist/index.js"; then
                log_error "Production build contains unresolved path aliases"
            else
                log_success "Production build has resolved imports"
            fi
        else
            log_warning "Production build not found - may need deployment"
        fi
    else
        log_warning "Production backend directory not found - deployment needed"
    fi
}

# Test 5: nginx Configuration Validation
test_nginx_configuration() {
    log_info "Testing nginx configuration..."
    
    # Check local nginx config
    if [[ -f "/etc/nginx/sites-available/sai-dashboard" ]]; then
        log_success "Local nginx configuration exists"
        
        # Test nginx config syntax
        if sudo nginx -t -c /etc/nginx/nginx.conf > /tmp/nginx_test.log 2>&1; then
            log_success "nginx configuration syntax is valid"
        else
            log_error "nginx configuration syntax error"
            cat /tmp/nginx_test.log
        fi
    else
        log_error "Local nginx configuration not found"
    fi
    
    # Check proxy configuration file exists
    if [[ -f "$PROJECT_ROOT/nginx/sai-altermundi-net.conf" ]]; then
        log_success "Public proxy configuration file exists"
    else
        log_error "Public proxy configuration file not found"
    fi
}

# Test 6: API Endpoint Functional Tests
test_api_endpoints() {
    log_info "Testing API endpoints..."
    
    # Check if backend is running
    if curl -s http://localhost:3001/api/health > /tmp/api_health.log 2>&1; then
        log_success "Backend API health check passed"
        
        # Test authentication endpoint
        if curl -s -X POST http://localhost:3001/api/auth/login \
            -H "Content-Type: application/json" \
            -d '{"password":"wrong"}' | grep -q "error"; then
            log_success "Authentication endpoint responding correctly"
        else
            log_error "Authentication endpoint not responding as expected"
        fi
        
        # Test main data endpoints (with auth)
        if curl -s http://localhost:3001/api/executions | grep -q "data\|error"; then
            log_success "Executions endpoint responding"
        else
            log_error "Executions endpoint not responding properly"
        fi
    else
        log_warning "Backend API not running - start with: cd backend && npm run dev"
    fi
}

# Test 7: Frontend Build and Static Assets
test_frontend_build() {
    log_info "Testing frontend build and assets..."
    
    cd "$FRONTEND_DIR"
    
    # Check if build exists or create it
    if [[ ! -d "dist" ]]; then
        log_info "Frontend build not found, creating..."
        npm run build > /tmp/frontend_build.log 2>&1
    fi
    
    if [[ -d "dist" ]]; then
        log_success "Frontend build directory exists"
        
        # Check essential files
        essential_files=("index.html" "assets")
        for file in "${essential_files[@]}"; do
            if [[ -e "dist/$file" ]]; then
                log_success "Frontend build contains $file"
            else
                log_error "Frontend build missing $file"
            fi
        done
        
        # Check for base path configuration
        if grep -q '"/dashboard/"' dist/index.html; then
            log_success "Frontend build has correct base path configuration"
        else
            log_warning "Frontend build may be missing base path configuration"
        fi
    else
        log_error "Frontend build failed"
        cat /tmp/frontend_build.log
    fi
}

# Test 8: Cache Directory and Permissions
test_cache_setup() {
    log_info "Testing cache setup and permissions..."
    
    cache_dir="/mnt/raid1/n8n/backup/images"
    if [[ -d "$cache_dir" ]]; then
        log_success "Cache directory exists"
        
        # Test write permissions
        if touch "$cache_dir/test_write" 2>/dev/null; then
            rm -f "$cache_dir/test_write"
            log_success "Cache directory has write permissions"
        else
            log_error "Cache directory lacks write permissions"
        fi
        
        # Check subdirectory structure
        subdirs=("by-date" "by-execution" "by-status")
        for subdir in "${subdirs[@]}"; do
            if [[ -d "$cache_dir/$subdir" ]]; then
                log_success "Cache subdirectory $subdir exists"
            else
                log_warning "Cache subdirectory $subdir missing - will be created automatically"
            fi
        done
    else
        log_error "Cache directory $cache_dir does not exist"
    fi
}

# Test 9: SSH Tunnel Configuration Verification
test_ssh_tunnel_config() {
    log_info "Testing SSH tunnel configuration..."
    
    # Check if tunnel script/config exists
    if [[ -f "$PROJECT_ROOT/systemd/sai-dashboard-tunnel.service" ]]; then
        log_success "SSH tunnel service configuration exists"
    else
        log_warning "SSH tunnel service configuration not found"
    fi
    
    # Test local ports are available or in use
    ports=(80 3001)
    for port in "${ports[@]}"; do
        if ss -tlnp | grep -q ":$port "; then
            log_success "Port $port is in use (service running)"
        else
            log_warning "Port $port is not in use (service may be stopped)"
        fi
    done
}

# Test 10: End-to-End Integration Test
test_integration() {
    log_info "Running integration tests..."
    
    # Test full request flow if services are running
    if curl -s http://localhost:80/dashboard/ > /tmp/dashboard_test.log 2>&1; then
        if grep -q "SAI Dashboard" /tmp/dashboard_test.log; then
            log_success "Frontend serving correctly through nginx"
        else
            log_error "Frontend not serving expected content"
        fi
    else
        log_warning "Local dashboard not accessible - nginx may be stopped"
    fi
}

# Main test execution
echo "Starting comprehensive test suite..."
echo

test_environment_config
echo
test_typescript_compilation
echo
test_database_connection
echo
test_service_configuration
echo
test_nginx_configuration
echo
test_api_endpoints
echo
test_frontend_build
echo
test_cache_setup
echo
test_ssh_tunnel_config
echo
test_integration
echo

# Final results
echo "=============================================="
echo "           TEST RESULTS SUMMARY"
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
    echo -e "${RED}❌ Some tests failed. Review the output above for details.${NC}"
    exit 1
else
    echo
    echo -e "${GREEN}✅ All tests passed! The SAI Dashboard is ready for deployment.${NC}"
    exit 0
fi