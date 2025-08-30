#!/bin/bash

# SAI Dashboard Frontend Integration Tests
# Tests the complete frontend functionality through browser automation

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test configuration
FRONTEND_URL="http://localhost:3000/dashboard/"
BACKEND_URL="http://localhost:3001"
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

# Check if required tools are available
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v curl >/dev/null 2>&1; then
        log_error "curl is required but not installed"
        exit 1
    fi
    
    if ! command -v jq >/dev/null 2>&1; then
        log_error "jq is required but not installed"
        exit 1
    fi
    
    # Check if Chrome/Chromium is available for headless testing
    if command -v google-chrome >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1; then
        log_success "Browser available for headless testing"
        BROWSER_AVAILABLE=true
    else
        log_warning "No browser available - skipping browser-based tests"
        BROWSER_AVAILABLE=false
    fi
}

# Test 1: Frontend Accessibility
test_frontend_accessibility() {
    log_info "Testing frontend accessibility..."
    
    # Check if frontend is serving
    if response=$(curl -s -w '%{http_code}' "$FRONTEND_URL" 2>/dev/null); then
        http_code=$(echo "$response" | tail -c 4)
        
        if [[ "$http_code" == "200" ]]; then
            log_success "Frontend is accessible at $FRONTEND_URL"
            
            # Check if HTML contains expected content
            html_content=$(echo "$response" | sed '$d')
            if echo "$html_content" | grep -q "SAI Dashboard\|Vite\|React"; then
                log_success "Frontend HTML contains expected content"
            else
                log_error "Frontend HTML does not contain expected content"
            fi
        else
            log_error "Frontend returned HTTP $http_code"
        fi
    else
        log_error "Frontend is not accessible at $FRONTEND_URL"
    fi
}

# Test 2: Static Assets Loading
test_static_assets() {
    log_info "Testing static assets loading..."
    
    # Get HTML content and extract asset URLs
    if html=$(curl -s "$FRONTEND_URL" 2>/dev/null); then
        # Extract CSS files
        css_files=$(echo "$html" | grep -o 'href="[^"]*\.css[^"]*"' | sed 's/href="//; s/"//' | head -5)
        
        for css_file in $css_files; do
            if [[ "$css_file" == /* ]]; then
                asset_url="http://localhost:3000$css_file"
            else
                asset_url="$FRONTEND_URL$css_file"
            fi
            
            if curl -s -f "$asset_url" >/dev/null 2>&1; then
                log_success "CSS asset loaded: $css_file"
            else
                log_error "CSS asset failed to load: $css_file"
            fi
        done
        
        # Extract JS files
        js_files=$(echo "$html" | grep -o 'src="[^"]*\.js[^"]*"' | sed 's/src="//; s/"//' | head -5)
        
        for js_file in $js_files; do
            if [[ "$js_file" == /* ]]; then
                asset_url="http://localhost:3000$js_file"
            else
                asset_url="$FRONTEND_URL$js_file"
            fi
            
            if curl -s -f "$asset_url" >/dev/null 2>&1; then
                log_success "JS asset loaded: $js_file"
            else
                log_error "JS asset failed to load: $js_file"
            fi
        done
    else
        log_error "Could not retrieve HTML content for asset testing"
    fi
}

# Test 3: API Connectivity from Frontend
test_api_connectivity() {
    log_info "Testing API connectivity from frontend perspective..."
    
    # Test API health endpoint
    if response=$(curl -s -w '%{http_code}' "$BACKEND_URL/api/health" 2>/dev/null); then
        http_code=$(echo "$response" | tail -c 4)
        
        if [[ "$http_code" == "200" ]]; then
            log_success "Backend API is accessible from frontend"
            
            # Test CORS headers by simulating frontend request
            if cors_response=$(curl -s -H "Origin: http://localhost:3000" \
                -H "Access-Control-Request-Method: GET" \
                -H "Access-Control-Request-Headers: Content-Type" \
                -X OPTIONS "$BACKEND_URL/api/health" 2>/dev/null); then
                log_success "CORS preflight request successful"
            else
                log_warning "CORS preflight may have issues"
            fi
        else
            log_error "Backend API returned HTTP $http_code"
        fi
    else
        log_error "Backend API is not accessible"
    fi
}

# Test 4: Frontend Route Handling
test_frontend_routing() {
    log_info "Testing frontend routing..."
    
    # Test dashboard root route
    if curl -s -f "$FRONTEND_URL" >/dev/null 2>&1; then
        log_success "Dashboard root route accessible"
    else
        log_error "Dashboard root route failed"
    fi
    
    # Test potential sub-routes (SPA routing should serve index.html)
    test_routes=("executions" "settings" "stats" "nonexistent")
    
    for route in "${test_routes[@]}"; do
        route_url="${FRONTEND_URL}${route}"
        if response=$(curl -s -w '%{http_code}' "$route_url" 2>/dev/null); then
            http_code=$(echo "$response" | tail -c 4)
            
            # For SPA, all routes should return 200 with index.html
            if [[ "$http_code" == "200" ]]; then
                log_success "Route /$route returns 200 (SPA routing)"
            else
                log_warning "Route /$route returned HTTP $http_code"
            fi
        fi
    done
}

# Test 5: Browser-based Functional Tests (if browser available)
test_browser_functionality() {
    if [[ "$BROWSER_AVAILABLE" != true ]]; then
        log_warning "Skipping browser tests - no browser available"
        return
    fi
    
    log_info "Testing browser functionality..."
    
    # Create a simple headless browser test script
    cat > /tmp/browser_test.js << 'EOF'
const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        // Navigate to dashboard
        await page.goto('http://localhost:3000/dashboard/', { 
            waitUntil: 'networkidle2',
            timeout: 10000
        });
        
        // Check if React app loaded
        const title = await page.title();
        if (title.includes('SAI Dashboard') || title.includes('Vite')) {
            console.log('SUCCESS: Page loaded with correct title');
        }
        
        // Check for main content elements
        const hasMainContent = await page.$eval('body', el => 
            el.textContent.includes('SAI') || 
            el.textContent.includes('Dashboard') ||
            el.querySelector('#root')
        ).catch(() => false);
        
        if (hasMainContent) {
            console.log('SUCCESS: Main content rendered');
        } else {
            console.log('ERROR: Main content not found');
        }
        
        // Test console errors
        const logs = [];
        page.on('console', msg => logs.push(msg.text()));
        
        await page.reload();
        await page.waitForTimeout(2000);
        
        const errors = logs.filter(log => log.includes('ERROR') || log.includes('Failed'));
        if (errors.length === 0) {
            console.log('SUCCESS: No console errors found');
        } else {
            console.log('WARNING: Console errors found:', errors.length);
        }
        
        await browser.close();
        process.exit(0);
    } catch (error) {
        console.log('ERROR: Browser test failed:', error.message);
        process.exit(1);
    }
})();
EOF

    # Run browser test if puppeteer is available
    if command -v node >/dev/null 2>&1 && node -e "require('puppeteer')" 2>/dev/null; then
        if node /tmp/browser_test.js 2>/dev/null | while read line; do
            if [[ "$line" == SUCCESS:* ]]; then
                log_success "${line#SUCCESS: }"
            elif [[ "$line" == WARNING:* ]]; then
                log_warning "${line#WARNING: }"
            elif [[ "$line" == ERROR:* ]]; then
                log_error "${line#ERROR: }"
            fi
        done; then
            true # Success handled by while loop
        else
            log_warning "Browser test script execution failed"
        fi
    else
        log_warning "Puppeteer not available - skipping detailed browser tests"
        
        # Fallback: basic curl-based checks
        if html=$(curl -s "$FRONTEND_URL" 2>/dev/null); then
            if echo "$html" | grep -q "id=['\"]root['\"]"; then
                log_success "React root element found"
            else
                log_warning "React root element not found"
            fi
            
            if echo "$html" | grep -q "script.*src"; then
                log_success "JavaScript bundle references found"
            else
                log_error "No JavaScript bundle references found"
            fi
        fi
    fi
    
    rm -f /tmp/browser_test.js
}

# Test 6: Performance and Load Time
test_performance() {
    log_info "Testing frontend performance..."
    
    # Measure page load time
    start_time=$(date +%s%N)
    if curl -s -f "$FRONTEND_URL" >/dev/null 2>&1; then
        end_time=$(date +%s%N)
        load_time=$((($end_time - $start_time) / 1000000)) # Convert to milliseconds
        
        if [[ $load_time -lt 5000 ]]; then # Less than 5 seconds
            log_success "Page load time: ${load_time}ms (good)"
        elif [[ $load_time -lt 10000 ]]; then # Less than 10 seconds
            log_warning "Page load time: ${load_time}ms (acceptable)"
        else
            log_error "Page load time: ${load_time}ms (too slow)"
        fi
    else
        log_error "Could not measure page load time"
    fi
    
    # Check response size
    if response_size=$(curl -s -w '%{size_download}' -o /dev/null "$FRONTEND_URL" 2>/dev/null); then
        if [[ $response_size -gt 0 ]]; then
            log_success "Response size: ${response_size} bytes"
        else
            log_error "Empty response received"
        fi
    fi
}

# Test 7: Mobile Responsiveness (Meta Tags)
test_mobile_responsiveness() {
    log_info "Testing mobile responsiveness..."
    
    if html=$(curl -s "$FRONTEND_URL" 2>/dev/null); then
        if echo "$html" | grep -q 'name=["\']viewport["\']'; then
            log_success "Viewport meta tag found"
        else
            log_warning "Viewport meta tag missing"
        fi
        
        if echo "$html" | grep -q 'responsive\|mobile-friendly'; then
            log_success "Mobile-friendly indicators found"
        else
            log_info "No explicit mobile-friendly indicators"
        fi
    fi
}

# Main test execution
echo "=============================================="
echo "   SAI Dashboard Frontend Integration Tests"
echo "=============================================="

check_prerequisites
echo

# Check if frontend is running
if ! curl -s "$FRONTEND_URL" >/dev/null 2>&1; then
    log_error "Frontend is not running at $FRONTEND_URL"
    echo "Please start the frontend server with:"
    echo "  cd frontend && VITE_BASE_PATH=/dashboard/ VITE_API_URL=/dashboard/api npm run dev"
    exit 1
fi

# Check if backend is running
if ! curl -s "$BACKEND_URL/api/health" >/dev/null 2>&1; then
    log_warning "Backend is not running - some tests may fail"
    echo "Start backend with: cd backend && npm run dev"
fi

# Run all tests
test_frontend_accessibility
echo
test_static_assets
echo
test_api_connectivity
echo
test_frontend_routing
echo
test_browser_functionality
echo
test_performance
echo
test_mobile_responsiveness
echo

# Results summary
echo "=============================================="
echo "      FRONTEND INTEGRATION TEST RESULTS"
echo "=============================================="
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"

if [[ $TESTS_FAILED -gt 0 ]]; then
    echo
    echo -e "${RED}❌ Some frontend integration tests failed.${NC}"
    exit 1
else
    echo
    echo -e "${GREEN}✅ All frontend integration tests passed!${NC}"
    exit 0
fi