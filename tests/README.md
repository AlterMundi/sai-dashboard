# SAI Dashboard Testing Framework

Comprehensive testing framework designed to debug and consolidate future releases of the SAI Dashboard.

## Overview

This testing framework addresses the module resolution, deployment, and configuration issues encountered during development by providing:

- **Unit Tests**: Individual component and service testing
- **Integration Tests**: End-to-end API and frontend testing  
- **Deployment Tests**: Production environment verification
- **Automated Runners**: Comprehensive test execution with reporting

## Test Structure

```
tests/
├── unit/                           # Unit tests
│   ├── backend/                    # Backend unit tests
│   └── frontend/                   # Frontend unit tests
├── integration/                    # Integration tests
│   ├── api-integration.test.sh     # API endpoint testing
│   └── frontend-integration.test.sh # Frontend functionality testing
├── deployment/                     # Deployment verification
│   ├── production-verification.sh  # Production environment checks
│   └── ssh-tunnel-verification.sh  # SSH tunnel and proxy testing
├── test-runner.sh                  # Comprehensive framework tests
└── README.md                       # This file
```

## Quick Start

### 1. Run Quick Development Tests
```bash
# Fast essential checks for development
npm run test:quick
# or
./scripts/quick-test.sh
```

### 2. Run Complete Test Suite
```bash
# All tests with comprehensive reporting
npm run test:all
# or
./scripts/run-all-tests.sh
```

### 3. Run Specific Test Categories
```bash
# Unit tests only
npm run test

# Integration tests only
npm run test:integration

# Deployment verification only
npm run test:deployment

# SSH tunnel verification
npm run tunnel:test
```

## Test Categories

### Unit Tests

**Backend Unit Tests**
- Service layer testing (execution service, image service)
- Controller testing (API endpoints, request validation)
- Database query testing with mocked connections
- Error handling and edge case validation

Location: `backend/src/tests/unit/`
Runner: Jest with TypeScript support
Coverage: Comprehensive service and controller coverage

**Frontend Unit Tests**
- React component testing (ImageGallery, ImageCard, etc.)
- API service testing with mocked responses
- State management and user interaction testing
- Responsive design and accessibility testing

Location: `frontend/src/__tests__/`
Runner: Vitest with React Testing Library
Coverage: Component behavior and integration testing

### Integration Tests

**API Integration Tests**
- Complete API workflow testing with real database
- Authentication and authorization testing
- Rate limiting and security header validation
- Error handling and edge case scenarios
- Performance and response time testing

**Frontend Integration Tests**  
- Full application loading and rendering
- API connectivity and CORS configuration
- Static asset loading and caching
- Browser functionality and console error checking
- Mobile responsiveness verification

### Deployment Tests

**Production Verification**
- File structure and permission validation
- Service configuration and systemd testing
- nginx configuration syntax and routing
- Database connectivity and schema validation
- Cache setup and directory permissions
- Security configuration audit
- Performance and monitoring checks

**SSH Tunnel Verification**
- Local service availability for tunneling
- SSH connectivity to public proxy server
- Port forwarding configuration validation
- Public domain resolution and SSL certificates
- nginx proxy configuration verification
- Failover and recovery readiness testing

## Configuration

### Environment Setup

Tests require specific environment configuration:

```bash
# Backend testing
DATABASE_URL=postgresql://test:test@localhost:5432/test_n8n
DASHBOARD_PASSWORD=test_password_2025
SESSION_SECRET=test_secret

# Frontend testing  
VITE_API_URL=/dashboard/api
VITE_BASE_PATH=/dashboard/
NODE_ENV=test
```

### Test Dependencies

**Backend**: Jest, Supertest, @types/jest
**Frontend**: Vitest, @testing-library/react, @testing-library/jest-dom
**System**: curl, jq, bash, systemd, nginx

## Advanced Usage

### Custom Test Execution

```bash
# Run specific test suite
./scripts/run-all-tests.sh --suite unit_backend

# Skip dependency checks
./scripts/run-all-tests.sh --skip-deps

# Quiet mode (minimal output)
./scripts/run-all-tests.sh --quiet

# List available test suites
./scripts/run-all-tests.sh --list
```

### Test Report Generation

Tests automatically generate reports in multiple formats:

- **Text Report**: `/tmp/sai-dashboard-test-report.txt`
- **HTML Report**: `/tmp/sai-dashboard-test-report.html`
- **Coverage Reports**: `backend/coverage/` and `frontend/coverage/`

### Continuous Integration

For CI/CD integration:

```bash
# Non-interactive test execution
./scripts/run-all-tests.sh --quiet

# Exit codes:
# 0 = All tests passed  
# 1 = Some tests failed
```

## Troubleshooting

### Common Issues

**Module Resolution Errors**
```bash
# Check TypeScript path aliases
npm run type-check

# Rebuild with proper paths
npm run clean && npm run build
```

**Database Connection Issues**
```bash
# Verify database configuration
source .env && echo $DATABASE_URL

# Test connection manually
psql $DATABASE_URL -c "SELECT 1;"
```

**Service Startup Issues**
```bash
# Check service status
systemctl status sai-dashboard-api

# View service logs
journalctl -u sai-dashboard-api -f
```

**nginx Configuration Issues**
```bash
# Test nginx configuration
sudo nginx -t

# Reload configuration
sudo systemctl reload nginx
```

### Debug Mode

Enable verbose testing output:

```bash
# Debug API tests
DEBUG=1 ./tests/integration/api-integration.test.sh

# Debug deployment tests
VERBOSE=1 ./tests/deployment/production-verification.sh
```

## Test Development

### Adding New Tests

**Backend Unit Test**:
```typescript
// backend/src/tests/unit/services/new-service.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { newService } from '../../../services/new-service';

describe('NewService', () => {
  it('should handle new functionality', async () => {
    // Test implementation
  });
});
```

**Frontend Unit Test**:
```typescript  
// frontend/src/__tests__/components/NewComponent.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NewComponent from '../../components/NewComponent';

describe('NewComponent', () => {
  it('should render correctly', () => {
    render(<NewComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

**Integration Test**:
```bash
#!/bin/bash
# tests/integration/new-integration.test.sh

# Test new integration functionality
test_new_functionality() {
    if api_call "GET" "/new-endpoint"; then
        log_success "New functionality test passed"
    else
        log_error "New functionality test failed"
    fi
}
```

## Best Practices

1. **Test Early and Often**: Run quick tests during development
2. **Comprehensive Before Deployment**: Always run full suite before production deployment
3. **Environment Consistency**: Use identical test environments across development and CI
4. **Mock External Dependencies**: Use mocks for database and external API calls in unit tests
5. **Real Integration Testing**: Use actual services for integration tests when possible
6. **Documentation**: Document test scenarios and expected behaviors
7. **Failure Analysis**: Investigate and fix root causes, not just symptoms

## Performance

- **Quick Tests**: ~30 seconds (development workflow)
- **Unit Tests**: ~2-5 minutes (comprehensive coverage)
- **Integration Tests**: ~5-10 minutes (real service testing)
- **Full Test Suite**: ~15-25 minutes (complete verification)

## Maintenance

Regular maintenance tasks:

```bash
# Update test dependencies
npm update && cd backend && npm update && cd ../frontend && npm update

# Clean test artifacts
npm run clean

# Regenerate test configuration
./tests/test-runner.sh --configure
```

This testing framework ensures reliable deployments and helps prevent the module resolution, configuration, and deployment issues encountered during development.

## Integration with Development Workflow

### Pre-commit Testing
```bash
# Add to git pre-commit hook
#!/bin/bash
npm run test:quick || exit 1
```

### Pre-deployment Testing  
```bash
# Required before production deployment
npm run test:all && npm run test:deployment
```

### Continuous Monitoring
```bash
# Regular health checks in production
./tests/deployment/production-verification.sh
./tests/deployment/ssh-tunnel-verification.sh
```