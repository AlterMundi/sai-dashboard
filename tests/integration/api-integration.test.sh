#!/bin/bash

# SAI Dashboard API Integration Tests
# Tests the complete API functionality with real services

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test configuration
API_BASE_URL="http://localhost:3001/api"
TEST_PASSWORD="test_password_2025"
AUTH_TOKEN=""
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

# Helper function to make authenticated API calls
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local expected_status="${4:-200}"
    
    local curl_cmd="curl -s -w '\n%{http_code}' -X $method"
    
    if [[ -n "$AUTH_TOKEN" ]]; then
        curl_cmd="$curl_cmd -H 'Authorization: Bearer $AUTH_TOKEN'"
    fi
    
    if [[ -n "$data" ]]; then
        curl_cmd="$curl_cmd -H 'Content-Type: application/json' -d '$data'"
    fi
    
    curl_cmd="$curl_cmd '$API_BASE_URL$endpoint'"
    
    local response
    response=$(eval "$curl_cmd")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" == "$expected_status" ]]; then
        echo "$body"
        return 0
    else
        log_error "API call failed. Expected $expected_status, got $http_code"
        echo "$body" >&2
        return 1
    fi
}

# Test 1: Health Check
test_health_check() {
    log_info "Testing health check endpoint..."
    
    if response=$(api_call "GET" "/health"); then
        if echo "$response" | grep -q "status.*healthy"; then
            log_success "Health check passed"
        else
            log_error "Health check response invalid: $response"
        fi
    else
        log_error "Health check failed"
    fi
}

# Test 2: Authentication
test_authentication() {
    log_info "Testing authentication..."
    
    # Test wrong password
    if api_call "POST" "/auth/login" '{"password":"wrong_password"}' 401 >/dev/null 2>&1; then
        log_success "Authentication correctly rejects wrong password"
    else
        log_error "Authentication should reject wrong password"
    fi
    
    # Test correct password
    if response=$(api_call "POST" "/auth/login" "{\"password\":\"$TEST_PASSWORD\"}"); then
        AUTH_TOKEN=$(echo "$response" | jq -r '.token // empty')
        if [[ -n "$AUTH_TOKEN" ]]; then
            log_success "Authentication successful, token received"
        else
            log_error "Authentication successful but no token received"
        fi
    else
        log_error "Authentication failed with correct password"
    fi
}

# Test 3: Executions List
test_executions_list() {
    log_info "Testing executions list endpoint..."
    
    if response=$(api_call "GET" "/executions"); then
        # Validate response structure
        if echo "$response" | jq -e '.data' >/dev/null && \
           echo "$response" | jq -e '.meta' >/dev/null; then
            
            local total=$(echo "$response" | jq -r '.meta.total // 0')
            local count=$(echo "$response" | jq -r '.data | length')
            
            log_success "Executions list returned $count items (total: $total)"
            
            # Test pagination
            if response2=$(api_call "GET" "/executions?limit=5&page=0"); then
                local limited_count=$(echo "$response2" | jq -r '.data | length')
                if [[ $limited_count -le 5 ]]; then
                    log_success "Pagination limit working correctly"
                else
                    log_error "Pagination limit not respected"
                fi
            fi
        else
            log_error "Executions list response structure invalid"
        fi
    else
        log_error "Executions list failed"
    fi
}

# Test 4: Execution Filters
test_execution_filters() {
    log_info "Testing execution filters..."
    
    # Test status filter
    if response=$(api_call "GET" "/executions?status=success"); then
        log_success "Status filter executed successfully"
    else
        log_error "Status filter failed"
    fi
    
    # Test date filters
    local start_date="2025-08-01T00:00:00Z"
    local end_date="2025-08-31T23:59:59Z"
    
    if response=$(api_call "GET" "/executions?startDate=$start_date&endDate=$end_date"); then
        log_success "Date filters executed successfully"
    else
        log_error "Date filters failed"
    fi
    
    # Test hasImage filter
    if response=$(api_call "GET" "/executions?hasImage=true"); then
        log_success "HasImage filter executed successfully"
    else
        log_error "HasImage filter failed"
    fi
}

# Test 5: Individual Execution
test_execution_detail() {
    log_info "Testing individual execution endpoint..."
    
    # First get an execution ID from the list
    if response=$(api_call "GET" "/executions?limit=1"); then
        local execution_id=$(echo "$response" | jq -r '.data[0].id // empty')
        
        if [[ -n "$execution_id" ]]; then
            if detail_response=$(api_call "GET" "/executions/$execution_id"); then
                if echo "$detail_response" | jq -e '.data.id' >/dev/null; then
                    log_success "Execution detail retrieved successfully"
                    
                    # Test image endpoint if execution has image
                    local has_image=$(echo "$detail_response" | jq -r '.data.hasImage // false')
                    if [[ "$has_image" == "true" ]]; then
                        if api_call "GET" "/executions/$execution_id/image" "" 200 >/dev/null 2>&1 || \
                           api_call "GET" "/executions/$execution_id/image" "" 404 >/dev/null 2>&1; then
                            log_success "Image endpoint accessible"
                        else
                            log_error "Image endpoint failed"
                        fi
                    fi
                else
                    log_error "Execution detail response invalid"
                fi
            else
                log_error "Execution detail failed"
            fi
        else
            log_info "No executions available for detail testing"
        fi
    fi
}

# Test 6: Search Functionality
test_search() {
    log_info "Testing search functionality..."
    
    if response=$(api_call "GET" "/executions/search?q=workflow&limit=10"); then
        if echo "$response" | jq -e '.data' >/dev/null && \
           echo "$response" | jq -e '.meta.query' >/dev/null; then
            local results_count=$(echo "$response" | jq -r '.data | length')
            log_success "Search returned $results_count results"
        else
            log_error "Search response structure invalid"
        fi
    else
        log_error "Search functionality failed"
    fi
    
    # Test search validation
    if api_call "GET" "/executions/search" "" 400 >/dev/null 2>&1; then
        log_success "Search correctly validates missing query"
    else
        log_error "Search should require query parameter"
    fi
}

# Test 7: Statistics Endpoints
test_statistics() {
    log_info "Testing statistics endpoints..."
    
    # Test execution stats
    if response=$(api_call "GET" "/executions/stats"); then
        if echo "$response" | jq -e '.data.total' >/dev/null && \
           echo "$response" | jq -e '.data.success' >/dev/null; then
            log_success "Execution statistics retrieved successfully"
        else
            log_error "Execution statistics response invalid"
        fi
    else
        log_error "Execution statistics failed"
    fi
    
    # Test daily summary
    if response=$(api_call "GET" "/executions/summary/daily?days=7"); then
        if echo "$response" | jq -e '.data' >/dev/null && \
           echo "$response" | jq -e '.meta.days' >/dev/null; then
            log_success "Daily summary retrieved successfully"
        else
            log_error "Daily summary response invalid"
        fi
    else
        log_error "Daily summary failed"
    fi
    
    # Test daily summary validation
    if api_call "GET" "/executions/summary/daily?days=100" "" 400 >/dev/null 2>&1; then
        log_success "Daily summary correctly validates days limit"
    else
        log_error "Daily summary should limit days parameter"
    fi
}

# Test 8: Rate Limiting
test_rate_limiting() {
    log_info "Testing rate limiting..."
    
    # Make multiple rapid requests to test rate limiting
    local success_count=0
    local rate_limited=false
    
    for i in {1..10}; do
        if api_call "GET" "/health" "" 200 >/dev/null 2>&1; then
            ((success_count++))
        elif api_call "GET" "/health" "" 429 >/dev/null 2>&1; then
            rate_limited=true
            break
        fi
    done
    
    if [[ $success_count -gt 0 ]]; then
        log_success "API handles multiple requests ($success_count successful)"
        if [[ "$rate_limited" == true ]]; then
            log_success "Rate limiting is working"
        else
            log_info "Rate limiting not triggered with 10 requests"
        fi
    else
        log_error "API not responding to requests"
    fi
}

# Test 9: Error Handling
test_error_handling() {
    log_info "Testing error handling..."
    
    # Test invalid execution ID
    if api_call "GET" "/executions/invalid-id" "" 404 >/dev/null 2>&1; then
        log_success "Invalid execution ID correctly returns 404"
    else
        log_error "Invalid execution ID should return 404"
    fi
    
    # Test invalid date format
    if api_call "GET" "/executions?startDate=invalid-date" "" 400 >/dev/null 2>&1; then
        log_success "Invalid date format correctly returns 400"
    else
        log_error "Invalid date format should return 400"
    fi
    
    # Test unauthorized access (if auth is required)
    local old_token="$AUTH_TOKEN"
    AUTH_TOKEN="invalid_token"
    
    if api_call "GET" "/executions" "" 401 >/dev/null 2>&1; then
        log_success "Invalid token correctly returns 401"
    else
        log_info "API may not require authentication for all endpoints"
    fi
    
    AUTH_TOKEN="$old_token"
}

# Main test execution
echo "=============================================="
echo "    SAI Dashboard API Integration Tests"
echo "=============================================="

# Check if API is running
if ! curl -s "$API_BASE_URL/health" >/dev/null; then
    log_error "API is not running at $API_BASE_URL"
    echo "Please start the API server with: cd backend && npm run dev"
    exit 1
fi

# Run all tests
test_health_check
echo
test_authentication
echo
test_executions_list
echo
test_execution_filters
echo
test_execution_detail
echo
test_search
echo
test_statistics
echo
test_rate_limiting
echo
test_error_handling
echo

# Results summary
echo "=============================================="
echo "         INTEGRATION TEST RESULTS"
echo "=============================================="
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"

if [[ $TESTS_FAILED -gt 0 ]]; then
    echo
    echo -e "${RED}❌ Some integration tests failed.${NC}"
    exit 1
else
    echo
    echo -e "${GREEN}✅ All integration tests passed!${NC}"
    exit 0
fi