# SAI Dashboard Backend - Multi-stage Docker Build
FROM node:18-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Development stage
FROM base AS development

ENV NODE_ENV=development
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
CMD ["dumb-init", "npm", "run", "dev"]

# Build stage
FROM base AS build

COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm prune --production

# Production stage
FROM base AS production

ENV NODE_ENV=production
USER node

# Copy built application and production dependencies
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

EXPOSE 3001

CMD ["dumb-init", "node", "dist/index.js"]