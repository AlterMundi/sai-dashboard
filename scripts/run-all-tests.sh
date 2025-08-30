#!/bin/bash

# SAI Dashboard - Complete Test Suite Runner
# Runs all tests in the correct order with proper reporting

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
PROJECT_ROOT="/root/sai-dashboard"
TESTS_DIR="$PROJECT_ROOT/tests"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

# Test results tracking
TOTAL_TESTS=0
TOTAL_PASSED=0
TOTAL_FAILED=0
FAILED_SUITES=()

# Test suite definitions
declare -A TEST_SUITES=(
    ["unit_backend"]="Unit Tests (Backend)"
    ["unit_frontend"]="Unit Tests (Frontend)"
    ["integration_api"]="Integration Tests (API)"
    ["integration_frontend"]="Integration Tests (Frontend)"
    ["deployment_verification"]="Deployment Verification"
    ["ssh_tunnel_verification"]="SSH Tunnel Verification"
    ["comprehensive_framework"]="Comprehensive Framework Tests"
)

# Test execution order
TEST_ORDER=(
    "unit_backend"
    "unit_frontend"
    "integration_api"
    "integration_frontend"
    "deployment_verification"
    "ssh_tunnel_verification"
    "comprehensive_framework"
)

log_header() {
    echo
    echo -e "${BOLD}${BLUE}=============================================="
    echo -e "$1"
    echo -e "==============================================${NC}"
    echo
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to run a test suite and capture results
run_test_suite() {
    local suite_key="$1"
    local suite_name="${TEST_SUITES[$suite_key]}"
    local start_time=$(date +%s)
    
    log_header "$suite_name"
    
    case "$suite_key" in
        "unit_backend")
            run_unit_tests_backend
            ;;
        "unit_frontend")
            run_unit_tests_frontend
            ;;
        "integration_api")
            run_integration_tests_api
            ;;
        "integration_frontend")
            run_integration_tests_frontend
            ;;
        "deployment_verification")
            run_deployment_verification
            ;;
        "ssh_tunnel_verification")
            run_ssh_tunnel_verification
            ;;
        "comprehensive_framework")
            run_comprehensive_framework
            ;;
    esac
    
    local exit_code=$?
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    echo
    if [[ $exit_code -eq 0 ]]; then
        log_success "$suite_name completed successfully (${duration}s)"
        ((TOTAL_PASSED++))
    else
        log_error "$suite_name failed (${duration}s)"
        ((TOTAL_FAILED++))
        FAILED_SUITES+=("$suite_name")
    fi
    
    ((TOTAL_TESTS++))
    return $exit_code
}

# Backend unit tests
run_unit_tests_backend() {
    log_info "Running backend unit tests..."
    
    cd "$BACKEND_DIR"
    
    # Check if test dependencies are installed
    if [[ ! -d "node_modules" ]]; then
        log_error "Backend dependencies not installed. Run: cd backend && npm install"
        return 1
    fi
    
    # Run Jest tests
    if npm test -- --coverage --verbose 2>&1 | tee /tmp/backend_test_output.log; then
        # Extract test results from Jest output
        if grep -q "Tests:.*passed" /tmp/backend_test_output.log; then
            log_success "Backend unit tests passed"
            return 0
        else
            log_error "Backend unit tests had issues"
            return 1
        fi
    else
        log_error "Backend unit tests failed to run"
        return 1
    fi
}

# Frontend unit tests
run_unit_tests_frontend() {
    log_info "Running frontend unit tests..."
    
    cd "$FRONTEND_DIR"
    
    # Check if test dependencies are installed
    if [[ ! -d "node_modules" ]]; then
        log_error "Frontend dependencies not installed. Run: cd frontend && npm install"
        return 1
    fi
    
    # Run Vitest tests
    if npm test -- --coverage --reporter=verbose 2>&1 | tee /tmp/frontend_test_output.log; then
        log_success "Frontend unit tests completed"
        return 0
    else
        log_error "Frontend unit tests failed"
        return 1
    fi
}

# API integration tests
run_integration_tests_api() {
    log_info "Running API integration tests..."
    
    # Check if API is running
    if ! curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
        log_warning "API is not running. Starting backend service..."
        
        cd "$BACKEND_DIR"
        if ! npm run dev >/dev/null 2>&1 &; then
            log_error "Failed to start backend API"
            return 1
        fi
        
        # Wait for API to start
        local attempts=0
        while [[ $attempts -lt 30 ]]; do
            if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
                break
            fi
            sleep 1
            ((attempts++))
        done
        
        if [[ $attempts -eq 30 ]]; then
            log_error "API failed to start within 30 seconds"
            return 1
        fi
    fi
    
    # Run API integration tests
    if bash "$TESTS_DIR/integration/api-integration.test.sh"; then
        return 0
    else
        return 1
    fi
}

# Frontend integration tests
run_integration_tests_frontend() {
    log_info "Running frontend integration tests..."
    
    # Check if frontend is running
    if ! curl -s http://localhost:3000/dashboard/ >/dev/null 2>&1; then
        log_warning "Frontend is not running on port 3000"
        log_info "Start with: cd frontend && VITE_BASE_PATH=/dashboard/ VITE_API_URL=/dashboard/api npm run dev"
    fi
    
    # Run frontend integration tests
    if bash "$TESTS_DIR/integration/frontend-integration.test.sh"; then
        return 0
    else
        return 1
    fi
}

# Deployment verification
run_deployment_verification() {
    log_info "Running deployment verification..."
    
    if bash "$TESTS_DIR/deployment/production-verification.sh"; then
        return 0
    else
        return 1
    fi
}

# SSH tunnel verification
run_ssh_tunnel_verification() {
    log_info "Running SSH tunnel verification..."
    
    if bash "$TESTS_DIR/deployment/ssh-tunnel-verification.sh"; then
        return 0
    else
        return 1
    fi
}

# Comprehensive framework tests
run_comprehensive_framework() {
    log_info "Running comprehensive framework tests..."
    
    if bash "$TESTS_DIR/test-runner.sh"; then
        return 0
    else
        return 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing_tools=()
    
    # Check required tools
    local required_tools=("node" "npm" "curl" "jq" "git")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        return 1
    fi
    
    # Check project structure
    if [[ ! -d "$PROJECT_ROOT" ]]; then
        log_error "Project root not found: $PROJECT_ROOT"
        return 1
    fi
    
    if [[ ! -d "$BACKEND_DIR" ]] || [[ ! -d "$FRONTEND_DIR" ]]; then
        log_error "Backend or frontend directory not found"
        return 1
    fi
    
    log_success "Prerequisites check passed"
    return 0
}

# Function to generate test report
generate_test_report() {
    local report_file="/tmp/sai-dashboard-test-report.txt"
    local html_report_file="/tmp/sai-dashboard-test-report.html"
    
    {
        echo "SAI Dashboard Test Suite Report"
        echo "Generated: $(date)"
        echo "Project: $PROJECT_ROOT"
        echo
        echo "Test Results Summary:"
        echo "- Total Test Suites: $TOTAL_TESTS"
        echo "- Passed: $TOTAL_PASSED"
        echo "- Failed: $TOTAL_FAILED"
        echo
        
        if [[ ${#FAILED_SUITES[@]} -gt 0 ]]; then
            echo "Failed Test Suites:"
            for suite in "${FAILED_SUITES[@]}"; do
                echo "- $suite"
            done
            echo
        fi
        
        echo "Test Suite Details:"
        for suite_key in "${TEST_ORDER[@]}"; do
            echo "- ${TEST_SUITES[$suite_key]}"
        done
        echo
        
        # Include system information
        echo "System Information:"
        echo "- OS: $(uname -s) $(uname -r)"
        echo "- Node.js: $(node --version 2>/dev/null || echo 'Not available')"
        echo "- npm: $(npm --version 2>/dev/null || echo 'Not available')"
        echo "- Git: $(git --version 2>/dev/null || echo 'Not available')"
        echo
        
        # Include recent git commit
        if git -C "$PROJECT_ROOT" log --oneline -1 >/dev/null 2>&1; then
            echo "Latest Git Commit:"
            git -C "$PROJECT_ROOT" log --oneline -1
            echo
        fi
    } > "$report_file"
    
    # Generate HTML report
    {
        echo "<!DOCTYPE html>"
        echo "<html><head><title>SAI Dashboard Test Report</title>"
        echo "<style>body{font-family:Arial,sans-serif;margin:40px;}"
        echo ".pass{color:green;} .fail{color:red;} .info{color:blue;}"
        echo "table{border-collapse:collapse;width:100%;}"
        echo "th,td{border:1px solid #ddd;padding:8px;text-align:left;}"
        echo "th{background-color:#f2f2f2;}</style></head><body>"
        echo "<h1>SAI Dashboard Test Suite Report</h1>"
        echo "<p><strong>Generated:</strong> $(date)</p>"
        echo "<p><strong>Project:</strong> $PROJECT_ROOT</p>"
        
        echo "<h2>Summary</h2>"
        echo "<table>"
        echo "<tr><th>Metric</th><th>Value</th></tr>"
        echo "<tr><td>Total Test Suites</td><td>$TOTAL_TESTS</td></tr>"
        echo "<tr><td class='pass'>Passed</td><td>$TOTAL_PASSED</td></tr>"
        echo "<tr><td class='fail'>Failed</td><td>$TOTAL_FAILED</td></tr>"
        echo "</table>"
        
        if [[ ${#FAILED_SUITES[@]} -gt 0 ]]; then
            echo "<h2 class='fail'>Failed Test Suites</h2>"
            echo "<ul>"
            for suite in "${FAILED_SUITES[@]}"; do
                echo "<li class='fail'>$suite</li>"
            done
            echo "</ul>"
        fi
        
        echo "</body></html>"
    } > "$html_report_file"
    
    log_info "Test report generated:"
    log_info "- Text: $report_file"
    log_info "- HTML: $html_report_file"
}

# Display usage information
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  --help, -h          Show this help message"
    echo "  --list, -l          List available test suites"
    echo "  --suite SUITE       Run specific test suite only"
    echo "  --skip-deps        Skip dependency checks"
    echo "  --quiet, -q        Suppress verbose output"
    echo "  --report-only      Generate report from previous run"
    echo
    echo "Available test suites:"
    for suite_key in "${TEST_ORDER[@]}"; do
        echo "  $suite_key: ${TEST_SUITES[$suite_key]}"
    done
    echo
    echo "Examples:"
    echo "  $0                    # Run all tests"
    echo "  $0 --suite unit_backend  # Run only backend unit tests"
    echo "  $0 --quiet           # Run all tests with minimal output"
}

# Parse command line arguments
SPECIFIC_SUITE=""
SKIP_DEPS=false
QUIET=false
REPORT_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --help|-h)
            usage
            exit 0
            ;;
        --list|-l)
            echo "Available test suites:"
            for suite_key in "${TEST_ORDER[@]}"; do
                echo "  $suite_key: ${TEST_SUITES[$suite_key]}"
            done
            exit 0
            ;;
        --suite)
            SPECIFIC_SUITE="$2"
            shift 2
            ;;
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --quiet|-q)
            QUIET=true
            shift
            ;;
        --report-only)
            REPORT_ONLY=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Main execution
main() {
    if [[ "$REPORT_ONLY" == true ]]; then
        generate_test_report
        exit 0
    fi
    
    log_header "SAI Dashboard Complete Test Suite"
    echo "Starting comprehensive test execution..."
    echo "Project Root: $PROJECT_ROOT"
    
    # Check prerequisites unless skipped
    if [[ "$SKIP_DEPS" != true ]]; then
        if ! check_prerequisites; then
            exit 1
        fi
        echo
    fi
    
    local start_time=$(date +%s)
    
    # Run specific suite or all suites
    if [[ -n "$SPECIFIC_SUITE" ]]; then
        if [[ -z "${TEST_SUITES[$SPECIFIC_SUITE]}" ]]; then
            log_error "Unknown test suite: $SPECIFIC_SUITE"
            log_info "Use --list to see available suites"
            exit 1
        fi
        
        run_test_suite "$SPECIFIC_SUITE"
        local exit_code=$?
    else
        # Run all test suites in order
        local overall_success=true
        
        for suite_key in "${TEST_ORDER[@]}"; do
            if ! run_test_suite "$suite_key"; then
                overall_success=false
                # Continue with other tests even if one fails
            fi
        done
        
        if [[ "$overall_success" == true ]]; then
            local exit_code=0
        else
            local exit_code=1
        fi
    fi
    
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    
    # Generate final report
    generate_test_report
    
    # Display final results
    echo
    log_header "FINAL TEST RESULTS"
    
    echo -e "Total Test Suites Run: $TOTAL_TESTS"
    echo -e "${GREEN}✅ Passed: $TOTAL_PASSED${NC}"
    echo -e "${RED}❌ Failed: $TOTAL_FAILED${NC}"
    echo -e "Total Execution Time: ${total_duration}s"
    
    if [[ ${#FAILED_SUITES[@]} -gt 0 ]]; then
        echo
        echo -e "${RED}Failed Test Suites:${NC}"
        for suite in "${FAILED_SUITES[@]}"; do
            echo -e "  ${RED}• $suite${NC}"
        done
    fi
    
    echo
    if [[ $exit_code -eq 0 ]]; then
        echo -e "${GREEN}🎉 All tests passed successfully!${NC}"
        echo -e "The SAI Dashboard is ready for deployment."
    else
        echo -e "${RED}⚠️  Some tests failed.${NC}"
        echo -e "Please review the failed tests above and fix issues before deployment."
    fi
    
    echo
    echo "For detailed logs, check:"
    echo "- Test report: /tmp/sai-dashboard-test-report.txt"
    echo "- HTML report: /tmp/sai-dashboard-test-report.html"
    
    exit $exit_code
}

# Run main function
main "$@"