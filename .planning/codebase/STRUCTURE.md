---
last_mapped_at: 2026-09-18
last_mapped_commit: f0b4afb5291a14359a9a36294218a196968642bb
---
# STRUCTURE.md

**Analysis Date:** 2026-09-18

## Directory Layout

### Root `.`

- `.planning/`: GSD Planning and context directory.
- `apps/`: Main applications (API, Web).
- `packages/`: Shared packages used across apps.
- `scripts/`: Project utility scripts.
- `data/` & `docs/`: Data resources and documentation.
- `AGENTS.md`: Code generation rules (Ultracite configuration, rules).
- `package.json`, `bun.lock`: Monorepo dependencies.
- `turbo.json`: Turborepo configuration.
- `biome.jsonc`: Linter and formatter configuration.
- `docker-compose.yml`, `docker-compose.prod.yml`: Docker configuration.

### `apps/api/` (Backend Express App)

- `src/`
  - `index.ts`, `app.ts`: Application entry points.
  - `routes/`: Express route definitions.
  - `services/`: Business logic.
  - `middleware/`: Express middleware.
  - `lib/`: Utilities, Prisma instance, AI sdk setup.
  - `types/`: Backend specific types.
  - `*.integration.test.ts`: Integration tests for key flows.

### `apps/web/` (Frontend React App)

- `src/`
  - `main.tsx`: React DOM entry point.
  - `app/`: React Router pages and views.
  - `components/`: UI components (like Shadcn components).
  - `hooks/`: Custom React hooks.
  - `lib/`: Utilities, Axios config, Better Auth client setup.

### `packages/`

- `types/`: Shared types and Zod schemas (`src/index.ts`).
- `typescript-config/`: Base `tsconfig.json` files for the monorepo.

<!-- refreshed: 2026-09-18 -->
