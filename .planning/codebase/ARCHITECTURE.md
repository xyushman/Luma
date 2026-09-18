---
last_mapped_at: 2026-09-18
last_mapped_commit: f0b4afb5291a14359a9a36294218a196968642bb
---
# ARCHITECTURE.md

**Analysis Date:** 2026-09-18

## High-Level Architecture

Luma follows a client-server architecture inside a monorepo setup.

### Client (`apps/web`)

- **Pattern**: Single Page Application (SPA).
- **Core Abstractions**:
  - React components structured into views/pages in `app/`.
  - Reusable UI components in `components/`.
  - Client state management utilizing React hooks in `hooks/`.
  - Data fetching and caching via React Query and Axios (`lib/api.ts`).

### Server (`apps/api`)

- **Pattern**: RESTful Express API.
- **Core Abstractions**:
  - **Routes (`routes/`)**: Define the endpoints and map them to handlers.
  - **Middleware (`middleware/`)**: Global and route-specific logic (e.g., auth checks, error handling, file uploads).
  - **Services (`services/`)**: Core business logic separating controller from data layers.
  - **Lib (`lib/`)**: Shared utilities like `prisma`, `auth`, `ai`, and `env` config.

### Shared (`packages/`)

- **`@repo/types`**: Zod schemas used by both backend (for validation) and frontend (for type safety and form validation).

## Data Flow

1. **Frontend Request**: The Web app sends a REST HTTP request using `axios` wrapped by `react-query`.
2. **Backend Routing**: Express receives the request in `apps/api`, routes it through auth/validation middlewares.
3. **Business Logic**: Controllers/Routes invoke logic inside `services/`.
4. **Data Layer**: Services query the Postgres database via Prisma.
5. **Response**: Data is returned to the frontend, updating the `react-query` cache and triggering React component re-renders.

<!-- refreshed: 2026-09-18 -->
