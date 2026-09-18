---
last_mapped_at: 2026-09-18
last_mapped_commit: f0b4afb5291a14359a9a36294218a196968642bb
---
# TESTING.md

**Analysis Date:** 2026-09-18

## Testing Framework

- **Bun Test**: The built-in Bun test runner is used across the monorepo (`bun test`).

## API Tests (`apps/api`)

- Unit tests are located alongside or within the related directories: `src/lib`, `src/middleware`, `src/routes`, `src/services`.
- Integration tests are available for major flows in the `src` root (e.g., `auth-flow.integration.test.ts`, `uploads.integration.test.ts`, `loans.integration.test.ts`, `manifest.integration.test.ts`, `ai.integration.test.ts`).
- Integration tests can be run via `bun run test:integration`.

## Shared Package Tests (`packages/types`)

- Schema validation tests exist in `packages/types/src/schemas.test.ts`.

## Type Checking

- Static type checking is strictly enforced using `tsc --noEmit` across apps and packages via the `check-types` script.

<!-- refreshed: 2026-09-18 -->
