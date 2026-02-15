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

RUN apk add --no-cache tini wget su-exec

WORKDIR /app

# Server-Dependencies installieren
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev

# Server-Code
COPY server/ ./

# Frontend-Build aus Stage 1 reinkopieren
COPY --from=frontend /build/dist ./public

# Data-Verzeichnis vorbereiten
RUN mkdir -p /app/data/results && \
    chown -R node:node /app

# Entrypoint-Script (fixt Permissions beim Start, dann switch zu node)
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3200

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3200/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
