# syntax=docker/dockerfile:1
# ---- web assets builder ----
FROM oven/bun:1.4.0 AS web-builder
WORKDIR /app
ENV LEFTHOOK=0
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN git init -q . && bun install --frozen-lockfile
COPY apps/web apps/web
COPY packages packages
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN cd apps/web && bun run build

# ---- api runtime ----
FROM oven/bun:1.4.0-slim AS api
WORKDIR /app
ENV NODE_ENV=production
ENV LEFTHOOK=0
RUN apt-get update -qq && apt-get install -y --no-install-recommends git ca-certificates curl openssl && rm -rf /var/lib/apt/lists/* && git config --global --add safe.directory '*'
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN git init -q . && bun install --frozen-lockfile
COPY apps/api apps/api
COPY packages packages
# prisma.config.ts resolves env("DATABASE_URL") at load time, so generate needs a
# placeholder URL here. It is scoped to this RUN; the real URL is injected at runtime.
RUN cd apps/api && DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/luma" bun x prisma generate --schema prisma/schema.prisma
USER bun
EXPOSE 4000
# Apply migrations and (idempotently) seed demo users at startup, then boot the API.
# Runs here so it works even when the host does not support pre-deploy commands.
CMD ["sh", "-c", "cd apps/api && bun x prisma migrate deploy && (bun x prisma db seed || echo '[warn] seed skipped') && bun src/index.ts"]

# ---- web (nginx serving the SPA) ----
FROM nginx:alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
