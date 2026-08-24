# ─────────────────────────────────────────────────────
#  FB Live Shop — Production Dockerfile
#  Works on Render.com free tier
#  Single container: Node.js backend + static frontend
# ─────────────────────────────────────────────────────

FROM node:20-alpine

# dumb-init: proper PID 1 / signal handling in containers
RUN apk add --no-cache dumb-init

WORKDIR /app

# ── Install production dependencies only (cached layer) ──
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# ── Copy backend source ───────────────────────────────────
COPY backend/ ./backend/

# ── Copy frontend (served as static files by Express) ─────
COPY frontend/ ./frontend/

# ── Copy database schema ──────────────────────────────────
COPY database/ ./database/

# ── Uploads directory (ephemeral — resets on redeploy) ────
RUN mkdir -p ./backend/uploads

# ── Runtime ───────────────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/backend
CMD ["dumb-init", "node", "server.js"]
