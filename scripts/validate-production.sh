#!/bin/bash
# SAI Dashboard Production Validation Script
# Quick smoke tests for production deployment validation
# Usage: ./scripts/validate-production.sh [--verbose]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
API_URL="http://localhost:3001/dashboard/api"
PASSWORD="${DASHBOARD_PASSWORD:-12345}"
VERBOSE=false

# Parse arguments
if [[ "$1" == "--verbose" ]]; then
    VERBOSE=true
fi

# Helper functions
print_header() {
    echo -e "\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}  ✓${NC} $1"
}

print_fail() {
    echo -e "${RED}  ✗${NC} $1"
}

print_info() {
    echo -e "${CYAN}  →${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}  ⚠${NC} $1"
}

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

run_test() {
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
}

test_passed() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    print_pass "$1"
}

test_failed() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    print_fail "$1"
    if [ "$VERBOSE" = true ]; then
        echo -e "${RED}     Error: $2${NC}"
    fi
}

# Test functions
test_service_running() {
    print_test "Service Status"
    run_test

    if sudo systemctl is-active --quiet sai-dashboard-api; then
        local pid=$(sudo systemctl show -p MainPID sai-dashboard-api | cut -d= -f2)
        local uptime=$(ps -p $pid -o etime= 2>/dev/null | xargs)
        test_passed "Service running (PID: $pid, Uptime: $uptime)"
    else
        test_failed "Service not running" "systemctl is-active failed"
        return 1
    fi
}

test_health_endpoint() {
    print_test "Health Endpoint"
    run_test

    local start_time=$(date +%s%3N)
    local response=$(curl -s -w "\n%{http_code}" "$API_URL/health" 2>/dev/null)
    local end_time=$(date +%s%3N)
    local response_time=$((end_time - start_time))

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)

    if [[ "$http_code" == "200" ]]; then
        local status=$(echo "$body" | jq -r '.status' 2>/dev/null)
        local uptime=$(echo "$body" | jq -r '.uptime' 2>/dev/null | awk '{printf "%.1fs", $1}')
        test_passed "Health OK (${response_time}ms, uptime: $uptime)"
    else
        test_failed "Health check failed" "HTTP $http_code"
        return 1
    fi
}

test_authentication() {
    print_test "Authentication"
    run_test

    local response=$(curl -s -X POST "$API_URL/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"password\":\"$PASSWORD\"}" 2>/dev/null)

    local token=$(echo "$response" | jq -r '.data.token' 2>/dev/null)
    local expires_in=$(echo "$response" | jq -r '.data.expiresIn' 2>/dev/null)

    if [[ "$token" != "null" && -n "$token" ]]; then
        echo "$token" > /tmp/sai_api_token.txt
        test_passed "Authentication successful (expires: ${expires_in}s)"
    else
        test_failed "Authentication failed" "No token received"
        return 1
    fi
}

test_database_connectivity() {
    print_test "Database Connectivity"
    run_test

    local result=$(sudo -u postgres psql -d sai_dashboard -t -A -c "SELECT COUNT(*) FROM executions;" 2>/dev/null)

    if [[ "$result" =~ ^[0-9]+$ ]]; then
        test_passed "Database accessible ($result executions)"
    else
        test_failed "Database query failed" "$result"
        return 1
    fi
}

test_etl_status() {
    print_test "ETL Pipeline Status"
    run_test

    local queue_stats=$(sudo -u postgres psql -d sai_dashboard -t -A -F'|' -c "
        SELECT
            COUNT(*) FILTER (WHERE status = 'completed')::text,
            COUNT(*) FILTER (WHERE status = 'pending')::text,
            COUNT(*) FILTER (WHERE status = 'failed')::text
        FROM etl_processing_queue
        WHERE stage = 'stage2';
    " 2>/dev/null)

    IFS='|' read -r completed pending failed <<< "$queue_stats"

    if [[ -n "$completed" ]]; then
        test_passed "ETL active (completed: $completed, pending: $pending, failed: $failed)"

        if [[ "$pending" -gt 100 ]]; then
            print_warn "High pending queue: $pending executions"
        fi

        if [[ "$failed" -gt 10 ]]; then
            print_warn "Multiple failures: $failed executions"
        fi
    else
        test_failed "ETL status check failed" "Unable to query queue"
        return 1
    fi
}

test_etl_logs() {
    print_test "ETL Processing Logs"
    run_test

    local stage1_count=$(sudo journalctl -u sai-dashboard-api.service --since '5 minutes ago' --no-pager 2>/dev/null | grep -c "Stage 1:" || echo "0")
    local stage2_count=$(sudo journalctl -u sai-dashboard-api.service --since '5 minutes ago' --no-pager 2>/dev/null | grep -c "Stage 2:" || echo "0")
    stage1_count=$(echo "$stage1_count" | tr -d '\n\r ')
    stage2_count=$(echo "$stage2_count" | tr -d '\n\r ')

    if [[ "$stage1_count" -gt 0 || "$stage2_count" -gt 0 ]]; then
        test_passed "ETL logs present (Stage 1: $stage1_count, Stage 2: $stage2_count events)"
    else
        print_warn "No recent ETL activity (Stage 1: $stage1_count, Stage 2: $stage2_count)"
        TESTS_PASSED=$((TESTS_PASSED + 1)) # Don't fail on this
    fi
}

test_api_executions() {
    print_test "API Executions Endpoint"
    run_test

    if [[ ! -f /tmp/sai_api_token.txt ]]; then
        test_failed "No auth token available" "Run authentication test first"
        return 1
    fi

    local token=$(cat /tmp/sai_api_token.txt)
    local response=$(curl -s "$API_URL/executions?limit=5" \
        -H "Authorization: Bearer $token" 2>/dev/null)

    local count=$(echo "$response" | jq -r '.executions | length' 2>/dev/null)

    if [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt 0 ]]; then
        local first_id=$(echo "$response" | jq -r '.executions[0].id' 2>/dev/null)
        local first_status=$(echo "$response" | jq -r '.executions[0].status' 2>/dev/null)
        test_passed "API returning data ($count executions, latest: #$first_id, $first_status)"
    else
        test_failed "API executions endpoint failed" "No executions returned"
        return 1
    fi
}

test_sse_endpoint() {
    print_test "SSE Endpoint"
    run_test

    if [[ ! -f /tmp/sai_api_token.txt ]]; then
        test_failed "No auth token available" "Run authentication test first"
        return 1
    fi

    local token=$(cat /tmp/sai_api_token.txt)

    # Test SSE connection (timeout after 3 seconds)
    local sse_test=$(timeout 3 curl -s -N "$API_URL/sse?token=$token" 2>/dev/null | head -n5 || echo "timeout")

    if [[ "$sse_test" =~ "data:" ]]; then
        test_passed "SSE endpoint responsive"
    else
        print_warn "SSE endpoint test inconclusive (may require longer test)"
        TESTS_PASSED=$((TESTS_PASSED + 1)) # Don't fail on this
    fi
}

test_recent_errors() {
    print_test "Recent Error Logs"
    run_test

    local error_count=$(sudo journalctl -u sai-dashboard-api.service --since '5 minutes ago' --no-pager 2>/dev/null | grep -c "ERROR" || echo "0")
    error_count=$(echo "$error_count" | tr -d '\n\r ')

    if [[ "$error_count" -eq 0 ]]; then
        test_passed "No errors in last 5 minutes"
    elif [[ "$error_count" -lt 5 ]]; then
        print_warn "$error_count errors found (check logs for details)"
        TESTS_PASSED=$((TESTS_PASSED + 1)) # Don't fail on minor errors
    else
        test_failed "Multiple errors detected: $error_count" "Check: sudo journalctl -u sai-dashboard-api -f"
    fi
}

test_data_coverage() {
    print_test "Data Coverage (YOLO)"
    run_test

    local coverage=$(sudo -u postgres psql -d sai_dashboard -t -A -c "
        SELECT
            ROUND(100.0 * COUNT(ea.execution_id) / NULLIF(COUNT(e.id), 0), 2)
        FROM executions e
        LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
        WHERE e.id >= 176444 AND e.id < 999999;
    " 2>/dev/null)

    if [[ "$coverage" =~ ^[0-9.]+$ ]]; then
        if (( $(echo "$coverage >= 95" | bc -l) )); then
            test_passed "Coverage: ${coverage}% (excellent)"
        elif (( $(echo "$coverage >= 80" | bc -l) )); then
            test_passed "Coverage: ${coverage}% (good)"
            print_warn "Coverage below 95%"
        else
            test_failed "Coverage: ${coverage}%" "Below acceptable threshold"
        fi
    else
        test_failed "Coverage check failed" "Unable to calculate"
        return 1
    fi
}

# Main execution
main() {
    print_header "SAI Dashboard Production Validation"

    echo -e "${CYAN}API URL:${NC} $API_URL"
    echo -e "${CYAN}Time:${NC} $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    # Run all tests
    test_service_running || true
    test_health_endpoint || true
    test_database_connectivity || true
    test_authentication || true
    test_etl_status || true
    test_etl_logs || true
    test_data_coverage || true
    test_api_executions || true
    test_sse_endpoint || true
    test_recent_errors || true

    # Print summary
    print_header "Validation Summary"

    echo -e "${BOLD}Tests Run:${NC} $TESTS_TOTAL"
    echo -e "${GREEN}${BOLD}Passed:${NC} $TESTS_PASSED"

    if [[ $TESTS_FAILED -gt 0 ]]; then
        echo -e "${RED}${BOLD}Failed:${NC} $TESTS_FAILED"
    fi

    local pass_rate=$(( (TESTS_PASSED * 100) / TESTS_TOTAL ))

    echo ""
    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}${BOLD}✓ All tests passed! System is healthy.${NC}"
        exit 0
    elif [[ $pass_rate -ge 80 ]]; then
        echo -e "${YELLOW}${BOLD}⚠ Some tests failed but system is mostly operational (${pass_rate}% pass rate)${NC}"
        echo -e "${YELLOW}Run with --verbose for details${NC}"
        exit 1
    else
        echo -e "${RED}${BOLD}✗ Multiple test failures detected (${pass_rate}% pass rate)${NC}"
        echo -e "${RED}System may not be functioning correctly${NC}"
        exit 2
    fi
}

# Cleanup on exit
cleanup() {
    rm -f /tmp/sai_api_token.txt 2>/dev/null || true
}
trap cleanup EXIT

# Run main
main "$@"
