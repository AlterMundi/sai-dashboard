# Backend Package Dependencies Guide

**Comprehensive dependency specification for SAI Dashboard Node.js backend**

---

## 📦 Core Dependencies

### Web Framework & Server
```json
{
  "express": "^4.18.2",
  "helmet": "^7.0.0",
  "cors": "^2.8.5",
  "compression": "^1.7.4"
}
```

**Rationale:**
- **Express 4.18.2**: Stable, mature, extensive ecosystem
- **Helmet**: Security headers middleware (CSP, HSTS, etc.)
- **CORS**: Configurable cross-origin handling for public access
- **Compression**: Gzip/deflate compression for API responses

### Database & ORM
```json
{
  "pg": "^8.11.3",
  "pg-pool": "^3.6.1"
}
```

**Rationale:**
- **pg**: Native PostgreSQL client, excellent performance
- **pg-pool**: Connection pooling for concurrent requests
- No ORM (Prisma/TypeORM) - keeps queries explicit and optimized

### Authentication & Security
```json
{
  "bcrypt": "^5.1.1",
  "crypto": "built-in",
  "express-rate-limit": "^6.10.0",
  "express-validator": "^7.0.1"
}
```

**Rationale:**
- **bcrypt**: Industry standard for password hashing
- **crypto**: Node.js built-in for session token generation
- **express-rate-limit**: Flexible rate limiting middleware
- **express-validator**: Input sanitization and validation

### Image Processing
```json
{
  "sharp": "^0.32.6"
}
```

**Rationale:**
- **Sharp**: Fast, memory-efficient image processing
- WebP support, thumbnail generation, format conversion
- Better performance than ImageMagick or canvas-based solutions

### Environment & Configuration
```json
{
  "dotenv": "^16.3.1",
  "joi": "^17.9.2"
}
```

**Rationale:**
- **dotenv**: Environment variable loading
- **joi**: Schema validation for configuration

### Logging & Monitoring
```json
{
  "winston": "^3.10.0",
  "morgan": "^1.10.0"
}
```

**Rationale:**
- **winston**: Structured logging with multiple transports
- **morgan**: HTTP request logging middleware

---

## 🛠️ Development Dependencies

### TypeScript & Types
```json
{
  "typescript": "^5.2.2",
  "@types/express": "^4.17.17",
  "@types/node": "^20.5.9",
  "@types/pg": "^8.10.2",
  "@types/bcrypt": "^5.0.0",
  "@types/cors": "^2.8.13",
  "@types/compression": "^1.7.2",
  "@types/morgan": "^1.9.4"
}
```

### Development Tools
```json
{
  "nodemon": "^3.0.1",
  "ts-node": "^10.9.1",
  "concurrently": "^8.2.0"
}
```

**Rationale:**
- **nodemon**: Auto-restart on file changes
- **ts-node**: Direct TypeScript execution
- **concurrently**: Run multiple dev scripts

### Code Quality
```json
{
  "eslint": "^8.47.0",
  "@typescript-eslint/eslint-plugin": "^6.4.1",
  "@typescript-eslint/parser": "^6.4.1",
  "prettier": "^3.0.2",
  "eslint-config-prettier": "^9.0.0",
  "eslint-plugin-prettier": "^5.0.0"
}
```

### Testing
```json
{
  "jest": "^29.6.2",
  "@types/jest": "^29.5.4",
  "ts-jest": "^29.1.1",
  "supertest": "^6.3.3",
  "@types/supertest": "^2.0.12"
}
```

**Rationale:**
- **Jest**: Full testing framework with TypeScript support
- **supertest**: HTTP assertion library for API testing

---

## 📁 Complete package.json

```json
{
  "name": "sai-dashboard-api",
  "version": "1.0.0",
  "description": "SAI Image Analysis Dashboard Backend API",
  "main": "dist/index.js",
  "scripts": {
    "dev": "nodemon src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --write src/**/*.ts",
    "type-check": "tsc --noEmit",
    "clean": "rm -rf dist",
    "prebuild": "npm run clean",
    "postinstall": "npm run build"
  },
  "keywords": ["sai", "dashboard", "n8n", "image-analysis"],
  "author": "SAI Team",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "helmet": "^7.0.0",
    "cors": "^2.8.5",
    "compression": "^1.7.4",
    "pg": "^8.11.3",
    "pg-pool": "^3.6.1",
    "bcrypt": "^5.1.1",
    "express-rate-limit": "^6.10.0",
    "express-validator": "^7.0.1",
    "sharp": "^0.32.6",
    "dotenv": "^16.3.1",
    "joi": "^17.9.2",
    "winston": "^3.10.0",
    "morgan": "^1.10.0"
  },
  "devDependencies": {
    "typescript": "^5.2.2",
    "@types/express": "^4.17.17",
    "@types/node": "^20.5.9",
    "@types/pg": "^8.10.2",
    "@types/bcrypt": "^5.0.0",
    "@types/cors": "^2.8.13",
    "@types/compression": "^1.7.2",
    "@types/morgan": "^1.9.4",
    "nodemon": "^3.0.1",
    "ts-node": "^10.9.1",
    "concurrently": "^8.2.0",
    "eslint": "^8.47.0",
    "@typescript-eslint/eslint-plugin": "^6.4.1",
    "@typescript-eslint/parser": "^6.4.1",
    "prettier": "^3.0.2",
    "eslint-config-prettier": "^9.0.0",
    "eslint-plugin-prettier": "^5.0.0",
    "jest": "^29.6.2",
    "@types/jest": "^29.5.4",
    "ts-jest": "^29.1.1",
    "supertest": "^6.3.3",
    "@types/supertest": "^2.0.12"
  },
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=9.0.0"
  }
}
```

---

## 🔒 Security Considerations

### Vulnerable Dependencies Monitoring
```bash
# Regular security audits
npm audit
npm audit fix

# Use npm-check-updates for dependency updates
npx npm-check-updates -u
```

### Dependency Pinning Strategy
- **Patch versions**: Allow automatic updates (`^x.y.z`)
- **Minor versions**: Review before updating
- **Major versions**: Manual update with testing

### Production Dependencies Only
```dockerfile
# Dockerfile optimization
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
```

---

## 🚀 Installation & Setup

### Development Setup
```bash
# Clone and install
cd backend
npm install

# Development with hot reload
npm run dev

# Type checking
npm run type-check

# Testing
npm run test:watch
```

### Production Build
```bash
# Build TypeScript
npm run build

# Start production server
npm start

# Health check
curl http://localhost:3001/api/health
```

---

## 📊 Dependency Analysis

### Bundle Size Impact
- **Runtime dependencies**: ~15MB
- **Sharp binary**: ~8MB (largest dependency)
- **PostgreSQL client**: ~2MB
- **Express ecosystem**: ~3MB

### Performance Considerations
- **Sharp**: Native binaries, excellent performance
- **pg**: Connection pooling prevents connection overhead
- **bcrypt**: Configurable rounds (10-12 recommended)

### Alternative Considerations

#### Why Not Prisma/TypeORM?
- **Performance**: Raw SQL queries are faster
- **Complexity**: Simple queries don't need ORM abstraction
- **Bundle size**: ORMs add significant overhead
- **Control**: Direct query optimization needed for dashboard

#### Why Not Fastify?
- **Ecosystem**: Express has broader middleware support
- **Team familiarity**: More developers know Express
- **Stability**: Express is battle-tested for production

#### Why Sharp over alternatives?
- **ImageMagick**: Slower, more memory usage
- **Canvas**: Browser-only, limited server functionality
- **Jimp**: Pure JS, much slower than native Sharp

---

## 🔄 Update Strategy

### Monthly Updates
- Security patches (automated)
- Patch version updates
- Dependency audit review

### Quarterly Updates
- Minor version updates
- Performance benchmarking
- Security vulnerability assessment

### Yearly Updates
- Major version updates
- Technology stack review
- Performance optimization review

---

*Dependencies Guide Version: 1.0*  
*Last Updated: August 28, 2025*  
*Next Review: September 28, 2025*