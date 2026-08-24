# ─────────────────────────────────────────────
#  FB Live Shop — Fly.io Production Dockerfile
#  Single container: Node.js backend + frontend
# ─────────────────────────────────────────────

FROM node:20-alpine AS base

# Install dumb-init for proper signal handling inside container
RUN apk add --no-cache dumb-init

WORKDIR /app

# ── Install dependencies (cached layer) ──────
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# ── Copy backend source ──────────────────────
COPY backend/ ./backend/

# ── Copy frontend (served as static files) ───
COPY frontend/ ./frontend/

# ── Create uploads directory ─────────────────
# Uploads are ephemeral on Fly.io free tier.
# For persistence, mount a Fly volume (see fly.toml).
RUN mkdir -p ./backend/uploads

# ── Runtime config ───────────────────────────
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Use dumb-init to handle signals correctly (graceful shutdown)
WORKDIR /app/backend
CMD ["dumb-init", "node", "server.js"]
