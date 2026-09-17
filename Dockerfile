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
RUN cd apps/api && bun x prisma generate --schema prisma/schema.prisma
USER bun
EXPOSE 4000
CMD ["bun", "apps/api/src/index.ts"]

# ---- web (nginx serving the SPA) ----
FROM nginx:alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
