# syntax=docker/dockerfile:1.7
# Employee Portal — production image.
#   docker compose -f docker-compose.prod.yml build
# Multi-stage: dependencies → build (Next.js standalone + bundled CLI) → a
# small runtime with only what's needed to run. No secrets at build time.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Explicit demo target only; the default final image remains production.
FROM deps AS demo
ENV NODE_ENV=development NEXT_TELEMETRY_DISABLED=1
COPY --chown=node:node . .
RUN chown node:node /app
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "dev", "-H", "0.0.0.0"]

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:cli

FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apk add --no-cache tini
# Files stay owned by root (read-only for the app); the app runs as "node".
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/content ./content
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Apply pending migrations, then start the server. A failed migration stops
# the container instead of running new code against an old schema.
CMD ["sh", "-c", "node dist/migrate.mjs && exec node server.js"]
