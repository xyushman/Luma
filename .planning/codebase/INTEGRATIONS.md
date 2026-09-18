---
last_mapped_at: 2026-09-18
last_mapped_commit: f0b4afb5291a14359a9a36294218a196968642bb
---
# INTEGRATIONS.md

**Analysis Date:** 2026-09-18

## External Services

### Database

- **PostgreSQL**: Primary relational database. Accessed via Prisma (`@prisma/client` and `@prisma/adapter-pg`). Configured in `apps/api/src/lib/prisma.ts`.

### Authentication

- **better-auth**: Handles user authentication, sessions, and roles. Configured in `apps/api/src/lib/auth.ts` on the backend, and used via `apps/web/src/lib/auth-client.ts` on the frontend.

### AI / Machine Learning

- **Google Generative AI (`@ai-sdk/google`)**: Used for document extraction and manifestation logic. Accessed in `apps/api/src/lib/ai.ts` using the Vercel AI SDK (`ai`).

## Internal APIs

- The `web` app communicates with the `api` app via REST, using `axios` combined with `@tanstack/react-query` in `apps/web/src/lib/api.ts`.

<!-- refreshed: 2026-09-18 -->
