# ============================================================
# OpenClaw Dashboard — Multi-Stage Dockerfile
# ============================================================
# Coolify: Repo pullen → dieses Dockerfile bauen → fertig.
# ============================================================

# ── Stage 1: Frontend bauen ────────────────────────────────
FROM node:20-alpine AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production Server ─────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache tini wget

WORKDIR /app

# Server-Dependencies installieren
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev

# Server-Code
COPY server/ ./

# Frontend-Build aus Stage 1 reinkopieren
COPY --from=frontend /build/dist ./public

# Non-root User + Data-Verzeichnis mit korrekten Permissions
RUN addgroup -g 1001 -S dash && \
    adduser -u 1001 -S dash -G dash && \
    mkdir -p /app/data/results && \
    chown -R dash:dash /app
USER dash

ENV NODE_ENV=production
EXPOSE 3200

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3200/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
