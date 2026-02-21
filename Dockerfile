FROM node:20-alpine AS base

# Stage 1: Install all dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

# Stage 2: Build backend + frontend, then prune dev deps
FROM deps AS builder
COPY . .
RUN npm run build:backend
RUN VITE_BASE_PATH=/dashboard/ VITE_API_URL=/dashboard/api npm run build:frontend
RUN npm prune --omit=dev

# Stage 3: Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache curl
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/package.json ./

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3001/dashboard/api/health || exit 1
CMD ["node", "backend/dist/index.js"]
