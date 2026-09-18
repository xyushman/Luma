---
last_mapped_at: 2026-09-18
last_mapped_commit: f0b4afb5291a14359a9a36294218a196968642bb
---
# CONCERNS.md

**Analysis Date:** 2026-09-18

## Technical Debt & Areas of Concern

- **Missing Frontend Tests**: The `apps/web` application does not currently have a defined testing script in its `package.json`, implying a lack of unit or component tests on the frontend.
- **Integration Test Environment**: The API integration tests might depend on a live or local Postgres database setup (Prisma). It's important to ensure a clean DB state is maintained for test reliability.
- **AI Integration Fragility**: The API heavily relies on external Google Generative AI services (`@ai-sdk/google`). Proper fallback, timeout, and error handling for external API rate-limits/failures should be actively maintained.
- **Schema Duplication**: Types/Schemas are mostly shared via `@repo/types`, which is great, but any drift between Prisma schema types and Zod schemas needs to be manually monitored if not directly inferred.

<!-- refreshed: 2026-09-18 -->
