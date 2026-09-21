// Imports: load .env into the process and expose Prisma's config helper functions.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 config file: declares the datasource, migration path, seed script, and schema location.
export default defineConfig({
  datasource: {
    // Point Prisma at Postgres using the DATABASE_URL environment variable.
    url: env("DATABASE_URL"),
  },
  migrations: {
    // Keep versioned schema migrations in prisma/migrations for reproducible databases.
    path: "prisma/migrations",
    // After migrate, run the seed script so the demo roles are created automatically.
    seed: "bun src/seed.ts",
  },
  // Use prisma/schema.prisma as the single source of truth for the data model.
  schema: "prisma/schema.prisma",
});
