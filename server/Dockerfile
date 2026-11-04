# The build context is the repo root (npm workspaces share a single package-lock.json).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w server
COPY server server
RUN npm run build -w server

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
# Production dependencies only: no TypeScript, Jest or other dev tooling.
RUN npm ci -w server --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist server/dist
WORKDIR /app/server
USER node
EXPOSE 4750
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://localhost:4750/api/health || exit 1
# Migrations are applied on every start (idempotent), then the server starts.
CMD ["sh", "-c", "node dist/database/migrate.js up && node dist/server.js"]
