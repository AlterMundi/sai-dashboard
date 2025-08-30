#!/bin/bash

# SAI Dashboard Quick Test Suite
# Fast essential tests for development workflow

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="/root/sai-dashboard"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

TESTS_PASSED=0
TESTS_FAILED=0

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
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Quick environment check
quick_env_check() {
    log_info "Quick environment check..."
    
    # Check if .env exists
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        log_success "Environment file exists"
    else
        log_error "Environment file missing"
    fi
    
    # Check database connection (fast)
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        source "$PROJECT_ROOT/.env"
        if [[ -n "$DB_HOST" && -n "$DB_USER" ]]; then
            if timeout 3 bash -c "echo > /dev/tcp/$DB_HOST/${DB_PORT:-5432}" 2>/dev/null; then
                log_success "Database port accessible"
            else
                log_warning "Database may not be accessible"
            fi
        fi
    fi
}

# Quick TypeScript compilation check
quick_typescript_check() {
    log_info "Quick TypeScript compilation check..."
    
    # Backend TypeScript
    cd "$BACKEND_DIR"
    if npm run type-check >/dev/null 2>&1; then
        log_success "Backend TypeScript checks pass"
    else
        log_error "Backend TypeScript issues found"
    fi
    
    # Frontend TypeScript
    cd "$FRONTEND_DIR"
    if npm run type-check >/dev/null 2>&1; then
        log_success "Frontend TypeScript checks pass"
    else
        log_error "Frontend TypeScript issues found"
    fi
}

# Quick service check
quick_service_check() {
    log_info "Quick service availability check..."
    
    # Check if backend is running
    if curl -s -m 2 http://localhost:3001/api/health >/dev/null 2>&1; then
        log_success "Backend API responding"
    else
        log_warning "Backend API not responding (may not be running)"
    fi
    
    # Check if frontend dev server is running
    if curl -s -m 2 http://localhost:3000 >/dev/null 2>&1; then
        log_success "Frontend dev server responding"
    else
        log_warning "Frontend dev server not responding (may not be running)"
    fi
    
    # Check if nginx is running
    if systemctl is-active nginx >/dev/null 2>&1; then
        log_success "nginx service is active"
        
        # Quick nginx config test
        if sudo nginx -t >/dev/null 2>&1; then
            log_success "nginx configuration is valid"
        else
            log_error "nginx configuration has issues"
        fi
    else
        log_warning "nginx service is not active"
    fi
}

# Quick build verification
quick_build_check() {
    log_info "Quick build verification..."
    
    # Check if production builds exist
    if [[ -f "$BACKEND_DIR/dist/index.js" ]]; then
        log_success "Backend production build exists"
        
        # Quick check for import issues
        if grep -q "require('@/" "$BACKEND_DIR/dist/index.js" 2>/dev/null; then
            log_error "Backend build has unresolved path aliases"
        else
            log_success "Backend build imports look clean"
        fi
    else
        log_warning "Backend production build not found"
    fi
    
    if [[ -f "$FRONTEND_DIR/dist/index.html" ]]; then
        log_success "Frontend production build exists"
    else
        log_warning "Frontend production build not found"
    fi
}

# Quick security check
quick_security_check() {
    log_info "Quick security check..."
    
    # Check .env file permissions
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        env_perms=$(stat -c "%a" "$PROJECT_ROOT/.env")
        if [[ "$env_perms" == "600" ]] || [[ "$env_perms" == "640" ]]; then
            log_success "Environment file has secure permissions"
        else
            log_warning "Environment file permissions may be too open: $env_perms"
        fi
    fi
    
    # Check for obvious security issues in config
    if grep -r "password.*=" "$PROJECT_ROOT" --include="*.js" --include="*.ts" --include="*.json" | grep -v node_modules | grep -v ".env" >/dev/null 2>&1; then
        log_warning "Potential hardcoded passwords found in code"
    else
        log_success "No obvious hardcoded passwords found"
    fi
}

# Quick performance check
quick_performance_check() {
    log_info "Quick performance check..."
    
    # Check API response time
    if start_time=$(date +%s%N); curl -s -m 5 http://localhost:3001/api/health >/dev/null 2>&1; then
        end_time=$(date +%s%N)
        response_time=$(( (end_time - start_time) / 1000000 ))
        
        if [[ $response_time -lt 500 ]]; then
            log_success "API response time: ${response_time}ms (excellent)"
        elif [[ $response_time -lt 2000 ]]; then
            log_success "API response time: ${response_time}ms (good)"
        else
            log_warning "API response time: ${response_time}ms (slow)"
        fi
    else
        log_info "API not available for performance test"
    fi
    
    # Quick memory check
    if command -v ps >/dev/null 2>&1; then
        node_processes=$(ps aux | grep -c "[n]ode.*sai-dashboard" || true)
        if [[ $node_processes -gt 0 ]]; then
            log_success "Node.js processes running: $node_processes"
        else
            log_info "No SAI Dashboard Node.js processes found"
        fi
    fi
}

# Main execution
echo "=============================================="
echo "    SAI Dashboard Quick Test Suite"
echo "=============================================="
echo "Running essential checks for development..."
echo

quick_env_check
echo
quick_typescript_check
echo
quick_service_check
echo
quick_build_check
echo
quick_security_check
echo
quick_performance_check
echo

# Results
echo "=============================================="
echo "         QUICK TEST RESULTS"
echo "=============================================="
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"

if [[ $TESTS_FAILED -gt 0 ]]; then
    echo
    echo -e "${YELLOW}⚠️  Some quick tests failed or showed warnings.${NC}"
    echo "For detailed testing, run: ./scripts/run-all-tests.sh"
    echo
    echo "Quick fixes:"
    echo "- Start backend: cd backend && npm run dev"
    echo "- Start frontend: cd frontend && npm run dev"
    echo "- Fix TypeScript: npm run lint --fix"
    echo "- Build production: npm run build"
    exit 1
else
    echo
    echo -e "${GREEN}✅ All quick tests passed!${NC}"
    echo "Development environment looks good."
    exit 0
fi