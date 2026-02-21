#!/bin/bash

# SAI Dashboard SSH Tunnel and Public Proxy Verification
# Tests the SSH tunnel configuration and public proxy access

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
LOCAL_API_PORT=3001
LOCAL_NGINX_PORT=80
PUBLIC_DOMAIN="sai.altermundi.net"
PUBLIC_PROXY_IP="88.207.86.56"
DASHBOARD_PATH="/dashboard"

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

# Test 1: Local Services Verification
test_local_services() {
    log_info "Testing local services for SSH tunnel readiness..."
    
    # Test API service
    if curl -s "http://localhost:$LOCAL_API_PORT/api/health" >/dev/null 2>&1; then
        log_success "Local API service running on port $LOCAL_API_PORT"
    else
        log_error "Local API service not running on port $LOCAL_API_PORT"
    fi
    
    # Test nginx service (static files) - both localhost and 127.0.0.1
    if curl -s "http://localhost:$LOCAL_NGINX_PORT$DASHBOARD_PATH/" >/dev/null 2>&1; then
        log_success "Local nginx serving dashboard on localhost:$LOCAL_NGINX_PORT"
    else
        log_error "Local nginx not serving dashboard on localhost:$LOCAL_NGINX_PORT"
    fi
    
    if curl -s "http://127.0.0.1:$LOCAL_NGINX_PORT$DASHBOARD_PATH/" >/dev/null 2>&1; then
        log_success "Local nginx serving dashboard on 127.0.0.1:$LOCAL_NGINX_PORT (tunnel-ready)"
    else
        log_error "Local nginx not serving dashboard on 127.0.0.1:$LOCAL_NGINX_PORT (tunnel will fail)"
    fi
    
    # Test dashboard static files
    if curl -s -f "http://localhost:$LOCAL_NGINX_PORT$DASHBOARD_PATH/" | grep -q "html\|DOCTYPE"; then
        log_success "Dashboard static files accessible via nginx"
    else
        log_error "Dashboard static files not accessible via nginx"
    fi
}

# Test 2: Existing Reverse Tunnel Services
test_reverse_tunnel_services() {
    log_info "Testing existing reverse tunnel services..."
    
    # Check tunnel-dashboard.service
    if systemctl is-active tunnel-dashboard.service >/dev/null 2>&1; then
        log_success "tunnel-dashboard.service is active"
    else
        log_error "tunnel-dashboard.service is not active"
    fi
    
    # Check tunnel-dashboard-api.service  
    if systemctl is-active tunnel-dashboard-api.service >/dev/null 2>&1; then
        log_success "tunnel-dashboard-api.service is active"
    else
        log_error "tunnel-dashboard-api.service is not active"
    fi
    
    # Check if services are enabled
    if systemctl is-enabled tunnel-dashboard.service >/dev/null 2>&1; then
        log_success "tunnel-dashboard.service is enabled"
    else
        log_warning "tunnel-dashboard.service is not enabled for auto-start"
    fi
}

# Test 3: SSH Connection and Tunnel Setup  
test_ssh_connectivity() {
    log_info "Testing SSH connectivity to public proxy..."
    
    # Check if SSH key exists
    SSH_KEY="/root/.ssh/id_rsa"
    if [[ ! -f "$SSH_KEY" ]]; then
        SSH_KEY="/home/$USER/.ssh/id_rsa"
    fi
    
    if [[ -f "$SSH_KEY" ]]; then
        log_success "SSH key found: $SSH_KEY"
        
        # Test SSH connection (without tunnel)
        if timeout 10 ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i "$SSH_KEY" "root@$PUBLIC_PROXY_IP" "echo 'SSH connection test'" 2>/dev/null; then
            log_success "SSH connection to public proxy successful"
            
            # Test if tunnel service exists
            if ssh -o ConnectTimeout=5 -i "$SSH_KEY" "root@$PUBLIC_PROXY_IP" "systemctl is-enabled sai-dashboard-tunnel.service" >/dev/null 2>&1; then
                log_success "SSH tunnel service is configured on public proxy"
            else
                log_warning "SSH tunnel service not found on public proxy"
            fi
        else
            log_error "SSH connection to public proxy failed"
        fi
    else
        log_error "SSH key not found - cannot test SSH connectivity"
    fi
}

# Test 3: Tunnel Port Verification
test_tunnel_ports() {
    log_info "Testing SSH tunnel port forwarding..."
    
    # Check if ports are bound for forwarding
    api_port_bound=$(ss -tlnp | grep ":$LOCAL_API_PORT " || true)
    nginx_port_bound=$(ss -tlnp | grep ":$LOCAL_NGINX_PORT " || true)
    
    if [[ -n "$api_port_bound" ]]; then
        log_success "API port $LOCAL_API_PORT is bound and ready for tunneling"
    else
        log_error "API port $LOCAL_API_PORT is not bound"
    fi
    
    if [[ -n "$nginx_port_bound" ]]; then
        log_success "nginx port $LOCAL_NGINX_PORT is bound and ready for tunneling"
    else
        log_error "nginx port $LOCAL_NGINX_PORT is not bound"
    fi
    
    # Check for conflicting processes on tunnel ports
    if ss -tlnp | grep ":3000 " >/dev/null; then
        log_warning "Port 3000 is in use - ensure it's not conflicting with tunnel"
    fi
}

# Test 4: Public Domain Resolution
test_domain_resolution() {
    log_info "Testing public domain resolution..."
    
    # Test domain resolution
    if resolved_ip=$(dig +short "$PUBLIC_DOMAIN" 2>/dev/null | head -1); then
        if [[ "$resolved_ip" == "$PUBLIC_PROXY_IP" ]]; then
            log_success "Domain $PUBLIC_DOMAIN resolves to correct IP: $PUBLIC_PROXY_IP"
        else
            log_warning "Domain $PUBLIC_DOMAIN resolves to: $resolved_ip (expected: $PUBLIC_PROXY_IP)"
        fi
    else
        log_error "Domain $PUBLIC_DOMAIN resolution failed"
    fi
    
    # Test HTTPS certificate
    if command -v openssl >/dev/null 2>&1; then
        if cert_info=$(timeout 10 openssl s_client -connect "$PUBLIC_DOMAIN:443" -servername "$PUBLIC_DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -subject 2>/dev/null); then
            log_success "HTTPS certificate accessible for $PUBLIC_DOMAIN"
        else
            log_warning "HTTPS certificate test failed for $PUBLIC_DOMAIN"
        fi
    fi
}

# Test 5: Public Dashboard Access (if tunnel is active)
test_public_access() {
    log_info "Testing public dashboard access..."
    
    # Test HTTPS dashboard URL
    dashboard_url="https://$PUBLIC_DOMAIN$DASHBOARD_PATH/"
    
    if response=$(curl -s -m 10 "$dashboard_url" 2>/dev/null); then
        if echo "$response" | grep -q "html\|DOCTYPE"; then
            log_success "Public dashboard accessible at $dashboard_url"
            
            # Check for correct content
            if echo "$response" | grep -q "SAI Dashboard\|Vite\|React"; then
                log_success "Public dashboard serving expected content"
            else
                log_warning "Public dashboard content may not be correct"
            fi
        else
            log_error "Public dashboard not returning HTML content"
        fi
    else
        log_warning "Public dashboard not accessible (tunnel may be down)"
        echo "This is expected if SSH tunnels are not currently active"
    fi
    
    # Test API endpoint through public proxy
    api_url="https://$PUBLIC_DOMAIN$DASHBOARD_PATH/api/health"
    
    if response=$(curl -s -m 10 "$api_url" 2>/dev/null); then
        if echo "$response" | grep -q "status\|healthy"; then
            log_success "Public API endpoint accessible"
        else
            log_warning "Public API endpoint responding but content may be incorrect"
        fi
    else
        log_warning "Public API endpoint not accessible (tunnel may be down)"
    fi
}

# Test 6: nginx Configuration Verification
test_nginx_config() {
    log_info "Testing nginx configuration for tunnel compatibility..."
    
    local_config="/etc/nginx/sites-available/sai-dashboard"
    proxy_config="/root/sai-dashboard/nginx/sai-altermundi-net.conf"
    
    # Check local nginx config
    if [[ -f "$local_config" ]]; then
        log_success "Local nginx configuration exists"
        
        # Check if dashboard location exists
        if grep -q "location /dashboard/" "$local_config"; then
            log_success "Local nginx configured for dashboard path"
        else
            log_error "Local nginx missing dashboard location configuration"
        fi
    else
        log_error "Local nginx configuration not found"
    fi
    
    # Check public proxy config
    if [[ -f "$proxy_config" ]]; then
        log_success "Public proxy configuration exists"
        
        # Check tunnel port mappings
        if grep -q "proxy_pass.*:$LOCAL_NGINX_PORT" "$proxy_config" && \
           grep -q "proxy_pass.*:$LOCAL_API_PORT" "$proxy_config"; then
            log_success "Proxy configuration has correct port mappings"
        else
            log_error "Proxy configuration missing correct port mappings"
        fi
        
        # Check dashboard paths
        if grep -q "location.*$DASHBOARD_PATH" "$proxy_config"; then
            log_success "Proxy configuration has dashboard path routing"
        else
            log_error "Proxy configuration missing dashboard path routing"
        fi
    else
        log_error "Public proxy configuration not found"
    fi
}

# Test 7: Security and SSL Configuration
test_security_config() {
    log_info "Testing security configuration for public access..."
    
    proxy_config="/root/sai-dashboard/nginx/sai-altermundi-net.conf"
    
    if [[ -f "$proxy_config" ]]; then
        # Check SSL configuration
        if grep -q "ssl_certificate\|ssl_protocols" "$proxy_config"; then
            log_success "SSL configuration found in proxy config"
        else
            log_warning "SSL configuration may be missing in proxy config"
        fi
        
        # Check security headers
        security_headers=("X-Frame-Options" "X-Content-Type-Options" "Strict-Transport-Security")
        for header in "${security_headers[@]}"; do
            if grep -q "$header" "$proxy_config"; then
                log_success "Security header configured: $header"
            else
                log_warning "Security header missing: $header"
            fi
        done
        
        # Check HTTPS redirect
        if grep -q "return 301 https" "$proxy_config"; then
            log_success "HTTPS redirect configured"
        else
            log_warning "HTTPS redirect may be missing"
        fi
    fi
}

# Test 8: Monitoring and Alerting Setup
test_monitoring_setup() {
    log_info "Testing monitoring setup for tunnel and public access..."
    
    # Check if tunnel monitoring script exists
    if [[ -f "/root/sai-dashboard/systemd/sai-dashboard-tunnel.service" ]]; then
        log_success "SSH tunnel systemd service configuration exists"
    else
        log_warning "SSH tunnel systemd service configuration not found"
    fi
    
    # Check for monitoring scripts
    monitor_scripts_dir="/root/sai-dashboard/scripts/monitoring"
    if [[ -d "$monitor_scripts_dir" ]]; then
        log_success "Monitoring scripts directory exists"
    else
        log_info "Monitoring scripts directory not found (optional)"
    fi
    
    # Check log files for tunnel monitoring
    if [[ -f "/var/log/sai-tunnel.log" ]] || [[ -f "/var/log/ssh-tunnel.log" ]]; then
        log_success "SSH tunnel log file exists for monitoring"
    else
        log_info "SSH tunnel log file not found (may use system journal)"
    fi
}

# Test 9: Failover and Recovery Testing
test_failover_recovery() {
    log_info "Testing failover and recovery readiness..."
    
    # Check if restart scripts exist
    restart_scripts=("/root/sai-dashboard/scripts/restart-services.sh" "/root/sai-dashboard/scripts/start-tunnel.sh")
    
    for script in "${restart_scripts[@]}"; do
        if [[ -f "$script" ]] && [[ -x "$script" ]]; then
            log_success "Recovery script exists and is executable: $(basename "$script")"
        else
            log_info "Recovery script not found: $(basename "$script") (optional)"
        fi
    done
    
    # Check Docker container restart policy
    local restart_policy
    restart_policy=$(docker inspect sai-dashboard --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null || echo "")
    if [[ "$restart_policy" == "unless-stopped" || "$restart_policy" == "always" ]]; then
        log_success "API container configured for automatic restart ($restart_policy)"
    else
        log_warning "API container may not be configured for automatic restart (policy: ${restart_policy:-unknown})"
    fi
    
    # Check nginx service restart configuration
    if systemctl show nginx.service -p Restart | grep -q "Restart="; then
        log_success "nginx service has restart configuration"
    else
        log_info "nginx service restart configuration not specified"
    fi
}

# Main test execution
echo "=============================================="
echo "    SSH Tunnel & Public Proxy Verification"
echo "=============================================="
echo
echo "Testing SSH tunnel setup and public proxy configuration"
echo "for SAI Dashboard deployment to $PUBLIC_DOMAIN"
echo

test_local_services
echo
test_reverse_tunnel_services
echo
test_ssh_connectivity
echo
test_tunnel_ports
echo
test_domain_resolution
echo
test_public_access
echo
test_nginx_config
echo
test_security_config
echo
test_monitoring_setup
echo
test_failover_recovery
echo

# Final results
echo "=============================================="
echo "           SSH TUNNEL TEST RESULTS"
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
    echo -e "${RED}❌ SSH tunnel setup has issues that need attention.${NC}"
    echo
    echo "To establish SSH tunnels manually:"
    echo "ssh -N -L 80:localhost:80 -L 3001:localhost:3001 root@$PUBLIC_PROXY_IP"
    echo
    echo "Or use systemd service:"
    echo "sudo systemctl start sai-dashboard-tunnel.service"
    exit 1
else
    echo
    echo -e "${GREEN}✅ SSH tunnel configuration verification successful!${NC}"
    echo
    echo "SSH Reverse Tunnel Status:"
    echo "- Local API: http://localhost:$LOCAL_API_PORT/dashboard/api/health"
    echo "- Local nginx: http://localhost:$LOCAL_NGINX_PORT$DASHBOARD_PATH/"
    echo "- Public URL: https://$PUBLIC_DOMAIN$DASHBOARD_PATH/"
    echo "- Remote Bindings: localhost:3000 -> localhost:80, localhost:3001 -> localhost:3001"
    echo
    echo "Reverse tunnel services (already running):"
    echo "- tunnel-dashboard.service: ssh -R 3000:localhost:80"
    echo "- tunnel-dashboard-api.service: ssh -R 3001:localhost:3001"
    exit 0
fi