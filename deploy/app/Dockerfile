# syntax=docker/dockerfile:1
# The HMIS application images, built from the repository root by deploy/compose.yml:
#   migrate  applies the database migrations (as the owner role), then exits
#   api      the NestJS API (never reachable from outside the server)
#   web      the Next.js web app (behind Caddy)
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
# openssl: Prisma's migration engine needs it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@12.16.1 \
 && npm cache clean --force
WORKDIR /app

# Everything is installed and built once, here.
FROM base AS build
COPY . .
# The download cache survives between builds, so an update fetches only what changed.
# (`prisma generate` reads the config, which wants a database address; nothing connects to it.)
RUN --mount=type=cache,id=hmis-pnpm,target=/pnpm-store \
    DATABASE_URL=postgresql://build@localhost/build pnpm install --frozen-lockfile --store-dir /pnpm-store
RUN pnpm --filter api build
RUN NEXT_STANDALONE=1 pnpm --filter web build

# Migrations: the Prisma CLI with the migration files.
FROM build AS migrate
WORKDIR /app/packages/db
USER node
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# The API's production dependencies only.
FROM base AS api-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=hmis-pnpm,target=/pnpm-store \
    pnpm install --prod --frozen-lockfile --ignore-scripts --filter "api..." --store-dir /pnpm-store

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production API_PORT=4000
WORKDIR /app
COPY --from=api-deps /app ./
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]

# Next.js standalone server: only the files the server needs.
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
