# Build & Development Tooling Guide

**Comprehensive tooling configuration for SAI Dashboard development workflow**

---

## 🛠️ Development Environment Setup

### Prerequisites
```bash
# Required versions
node --version    # v18.17.0 or higher
npm --version     # v9.6.0 or higher
git --version     # v2.34.0 or higher

# Optional but recommended
docker --version  # v24.0.0 or higher
```

### Project Structure
```
sai-dashboard/
├── backend/
│   ├── src/
│   ├── dist/           # Built TypeScript output
│   ├── package.json
│   ├── tsconfig.json
│   ├── .eslintrc.js
│   └── Dockerfile
├── frontend/
│   ├── src/
│   ├── dist/           # Built React output
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── docs/
```

---

## 🎯 TypeScript Configuration

### Backend TypeScript Config
```json
// backend/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "removeComments": false,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "baseUrl": "./src",
    "paths": {
      "@/*": ["*"],
      "@/types/*": ["types/*"],
      "@/utils/*": ["utils/*"],
      "@/services/*": ["services/*"]
    }
  },
  "include": [
    "src/**/*",
    "types/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.spec.ts"
  ]
}
```

### Frontend TypeScript Config
```json
// frontend/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": "./src",
    "paths": {
      "@/*": ["*"],
      "@/components/*": ["components/*"],
      "@/contexts/*": ["contexts/*"],
      "@/hooks/*": ["hooks/*"],
      "@/utils/*": ["utils/*"],
      "@/types/*": ["types/*"]
    }
  },
  "include": [
    "src",
    "vite.config.ts"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ],
  "references": [
    { "path": "./tsconfig.node.json" }
  ]
}
```

---

## 🎨 Code Quality Tools

### ESLint Configuration
```js
// backend/.eslintrc.js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist/**/*'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 'error',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/prefer-const': 'error',
    'prefer-const': 'off', // Handled by TypeScript rule
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
  },
};
```

```js
// frontend/.eslintrc.js
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:prettier/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.js'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['react-refresh', '@typescript-eslint'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    'react/prop-types': 'off', // Using TypeScript for prop validation
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};
```

### Prettier Configuration
```json
// .prettierrc (shared for both frontend and backend)
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "avoid",
  "endOfLine": "lf",
  "quoteProps": "as-needed",
  "jsxSingleQuote": true,
  "proseWrap": "preserve"
}
```

```
# .prettierignore
node_modules
dist
coverage
*.min.js
*.min.css
.env*
docker-compose*.yml
```

---

## ⚡ Vite Configuration (Frontend)

### Main Vite Config
```ts
// frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  
  // Path resolution
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/contexts': path.resolve(__dirname, './src/contexts'),
      '@/hooks': path.resolve(__dirname, './src/hooks'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/types': path.resolve(__dirname, './src/types'),
    },
  },

  // Development server
  server: {
    port: 3000,
    host: true, // Allow external connections
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
    open: true, // Auto-open browser
  },

  // Build configuration
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2020',
    
    // Chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          query: ['@tanstack/react-query'],
          ui: ['@headlessui/react', '@heroicons/react'],
        },
      },
    },
    
    // Size warnings
    chunkSizeWarningLimit: 600,
  },

  // Preview server (for testing production builds)
  preview: {
    port: 3000,
    host: true,
  },

  // Environment variables
  envPrefix: 'VITE_',

  // CSS configuration
  css: {
    postcss: './postcss.config.js',
    devSourcemap: true,
  },
});
```

### PostCSS Configuration
```js
// frontend/postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    ...(process.env.NODE_ENV === 'production' ? { cssnano: {} } : {}),
  },
};
```

---

## 🧪 Testing Configuration

### Jest Configuration (Backend)
```js
// backend/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts', // Entry point
    '!src/**/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 10000,
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

### Vitest Configuration (Frontend)
```ts
// frontend/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    css: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### Test Setup Files
```ts
// backend/src/__tests__/setup.ts
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Global test configuration
global.console = {
  ...console,
  // Suppress console.log in tests
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
```

```ts
// frontend/src/__tests__/setup.ts
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock environment variables
Object.defineProperty(window, 'ENV', {
  value: {
    NODE_ENV: 'test',
    VITE_API_URL: 'http://localhost:3001',
  },
});
```

---

## 🚀 Build Scripts

### Root Package.json Scripts
```json
{
  "name": "sai-dashboard",
  "private": true,
  "workspaces": ["frontend", "backend"],
  "scripts": {
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:backend": "cd backend && npm run dev",
    "dev:frontend": "cd frontend && npm run dev",
    
    "build": "npm run build:backend && npm run build:frontend",
    "build:backend": "cd backend && npm run build",
    "build:frontend": "cd frontend && npm run build",
    
    "test": "npm run test:backend && npm run test:frontend",
    "test:backend": "cd backend && npm test",
    "test:frontend": "cd frontend && npm test",
    
    "test:watch": "concurrently \"npm run test:watch:backend\" \"npm run test:watch:frontend\"",
    "test:watch:backend": "cd backend && npm run test:watch",
    "test:watch:frontend": "cd frontend && npm run test:watch",
    
    "lint": "npm run lint:backend && npm run lint:frontend",
    "lint:backend": "cd backend && npm run lint",
    "lint:frontend": "cd frontend && npm run lint",
    
    "lint:fix": "npm run lint:fix:backend && npm run lint:fix:frontend",
    "lint:fix:backend": "cd backend && npm run lint:fix",
    "lint:fix:frontend": "cd frontend && npm run lint:fix",
    
    "type-check": "npm run type-check:backend && npm run type-check:frontend",
    "type-check:backend": "cd backend && npm run type-check",
    "type-check:frontend": "cd frontend && npm run type-check",
    
    "clean": "npm run clean:backend && npm run clean:frontend",
    "clean:backend": "cd backend && rm -rf dist coverage",
    "clean:frontend": "cd frontend && rm -rf dist coverage",
    
    "docker:build": "docker-compose build",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
```

### Development Workflow Scripts
```bash
#!/bin/bash
# scripts/dev-setup.sh - Development environment setup

set -e

echo "🚀 Setting up SAI Dashboard development environment..."

# Check prerequisites
echo "📋 Checking prerequisites..."
node --version || { echo "❌ Node.js not found. Please install Node.js 18+"; exit 1; }
npm --version || { echo "❌ npm not found."; exit 1; }

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Setup environment
echo "⚙️ Setting up environment..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ Created .env file from template"
  echo "⚠️  Please update .env with your configuration"
fi

# Create cache directory
echo "📁 Creating cache directory..."
sudo mkdir -p /mnt/raid1/n8n/backup/images/{by-date,by-execution,by-status}
sudo chown -R $(whoami) /mnt/raid1/n8n/backup/images

# Database setup reminder
echo "🗄️ Database setup required:"
echo "   1. Create read-only user: sai_dashboard_readonly"
echo "   2. Grant permissions as documented in database/schema-analysis.md"
echo "   3. Update .env with database credentials"

# Build and test
echo "🔨 Running initial build and test..."
npm run build
npm run test

echo "✅ Development environment ready!"
echo "🎯 Run 'npm run dev' to start development servers"
```

```bash
#!/bin/bash
# scripts/production-build.sh - Production build script

set -e

echo "🏗️ Building SAI Dashboard for production..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
npm run clean

# Type checking
echo "🔍 Running type checks..."
npm run type-check

# Linting
echo "📏 Running linters..."
npm run lint

# Testing
echo "🧪 Running tests..."
npm run test

# Build
echo "🔨 Building production assets..."
npm run build

# Build Docker images
echo "🐳 Building Docker images..."
docker-compose build

# Size analysis
echo "📊 Build size analysis:"
echo "Backend dist size: $(du -sh backend/dist | cut -f1)"
echo "Frontend dist size: $(du -sh frontend/dist | cut -f1)"

echo "✅ Production build complete!"
echo "🚀 Run 'docker-compose up -d' to deploy"
```

---

## 🐳 Docker Configuration

### Multi-stage Dockerfile (Backend)
```dockerfile
# backend/Dockerfile
FROM node:18-alpine AS base
WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Build stage
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:18-alpine AS production
WORKDIR /app

# Add dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodeuser -u 1001

# Copy built application
COPY --from=deps --chown=nodeuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodeuser:nodejs /app/dist ./dist
COPY --chown=nodeuser:nodejs package*.json ./

USER nodeuser

EXPOSE 3001
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node dist/healthcheck.js

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

### Multi-stage Dockerfile (Frontend)
```dockerfile
# frontend/Dockerfile
FROM node:18-alpine AS base
WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package*.json ./
RUN npm ci

# Build stage
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Production stage
FROM nginx:alpine AS production

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built app
COPY --from=builder /app/dist /usr/share/nginx/html

# Add health check
RUN apk add --no-cache curl
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:80 || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### Docker Compose Override for Development
```yaml
# docker-compose.override.yml (automatically loaded in development)
version: '3.8'

services:
  sai-dashboard-api:
    build:
      target: base
    volumes:
      - ./backend:/app
      - /app/node_modules
    command: npm run dev
    environment:
      - NODE_ENV=development
      - LOG_LEVEL=debug

  sai-dashboard-ui:
    build:
      target: base
    volumes:
      - ./frontend:/app
      - /app/node_modules
    command: npm run dev
    ports:
      - "3000:3000" # Vite dev server
```

---

## 🔄 CI/CD Pipeline

### GitHub Actions Workflow
```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

env:
  NODE_VERSION: '18'

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Type checking
        run: npm run type-check
      
      - name: Lint
        run: npm run lint
      
      - name: Test
        run: npm run test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db
      
      - name: Build
        run: npm run build
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          directory: ./coverage/

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run security audit
        run: npm audit --audit-level moderate
      
      - name: Run Snyk to check for vulnerabilities
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

  build-and-deploy:
    needs: [test, security]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Build Docker images
        run: docker-compose build
      
      - name: Deploy to staging
        run: |
          echo "🚀 Deploy to staging server"
          # Add deployment script here
```

---

## 📊 Performance Monitoring

### Bundle Analysis
```json
// package.json script additions
{
  "scripts": {
    "analyze:frontend": "cd frontend && npm run build && npx vite-bundle-analyzer dist",
    "analyze:backend": "cd backend && npx webpack-bundle-analyzer dist/stats.json"
  }
}
```

### Performance Budgets
```js
// frontend/vite.config.ts - Performance budgets
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react')) return 'react-vendor';
            if (id.includes('@tanstack')) return 'query-vendor';
            return 'vendor';
          }
        },
      },
    },
    
    // Performance budgets
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'FILE_NAME_CONFLICT') return;
        warn(warning);
      },
    },
  },
});
```

---

This comprehensive build tooling setup provides a robust foundation for developing, testing, and deploying the SAI Dashboard with optimal developer experience and production performance.

---

*Build Tooling Guide Version: 1.0*  
*Last Updated: August 28, 2025*