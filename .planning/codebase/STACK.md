---
last_mapped_at: 2026-09-18
last_mapped_commit: f0b4afb5291a14359a9a36294218a196968642bb
---
# STACK.md

**Analysis Date:** 2026-09-18

## Overview

Luma is a monorepo containing a web frontend and an API backend, powered by Bun and Turbo.

## Core Technologies

- **Runtime:** Node.js (engines >= 24), Bun (v1.4.0)
- **Package Manager:** Bun
- **Monorepo Tooling:** Turbo (v2.x)
- **Language:** TypeScript

## Apps

### Web (`apps/web`)

- **Framework:** React 19, Vite
- **Styling:** Tailwind CSS (v4), `shadcn/ui`, `clsx`, `tailwind-merge`
- **Data Fetching:** `@tanstack/react-query`, `axios`
- **Routing:** `react-router-dom`
- **Authentication:** `better-auth`
- **Charts:** `recharts`
- **Icons:** `lucide-react`, `remixicon`

### API (`apps/api`)

- **Framework:** Express 5
- **Runtime:** Bun
- **Database ORM:** Prisma 7 with `@prisma/adapter-pg`
- **Authentication:** `better-auth`
- **Validation:** Zod
- **AI Integration:** `@ai-sdk/google`, `ai`
- **Utilities:** `multer`, `csv-parser`, `compression`, `helmet`, `cors`, `morgan`

## Packages

- **`@repo/types`:** Shared types using `zod`.
- **`@repo/typescript-config`:** Shared TypeScript configurations.

## Tooling

- **Linter/Formatter:** Biome, `ultracite`
- **Git Hooks:** Lefthook
- **Docker:** `docker-compose.yml`, `docker-compose.prod.yml`

<!-- refreshed: 2026-09-18 -->
