# syntax=docker/dockerfile:1

# ---- Stage 1: build the frontend ----
FROM node:20-bookworm AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: install backend production deps ----
FROM node:20-bookworm AS backend-deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 3: final lightweight runtime image ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend

COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./public

RUN mkdir -p /data && chown -R node:node /data /app/backend
USER node

ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
