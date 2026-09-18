---
last_mapped_at: 2026-09-18
last_mapped_commit: f0b4afb5291a14359a9a36294218a196968642bb
---
# CONVENTIONS.md

**Analysis Date:** 2026-09-18

## Code Style & Linting

- **Formatter / Linter**: Biome (`biome check`) is the authoritative source for formatting and linting. Configured in `biome.jsonc`.
- **Pre-commit**: Handled via `lefthook.yml`.
- **Project Rules**: Enforced by Ultracite (documented in `AGENTS.md`).

## TypeScript Rules

- Explicit types used when they enhance clarity.
- `unknown` is preferred over `any`.
- Const assertions (`as const`) used for immutable literal types.
- TypeScript strict mode is enabled.

## React & Frontend Patterns

- Functional components exclusively.
- React Router 7 for routing.
- React Query for data fetching and caching with Axios.
- Tailwind v4 for styling.

## Backend Patterns

- Express 5 handles routing.
- Separation of concerns: Routes handle HTTP and invoke Services which hold the business logic.
- Prisma 7 used as ORM with PostgreSQL adapter.
- Zod is strictly used for payload validation via shared `@repo/types`.

## Error Handling

- Meaningful `Error` objects thrown, caught with appropriate HTTP status codes in Express middleware.

<!-- refreshed: 2026-09-18 -->
