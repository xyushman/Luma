// Imports: the Postgres driver adapter for Prisma 7 and the generated Prisma client.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Stash the client on globalThis (dev only) so hot reloads share one instance instead of many.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Build a PrismaClient wired to the Postgres connection string read from the environment.
const createPrismaClient = (): PrismaClient => {
  // Pull the Postgres connection string that the driver adapter will connect through.
  const connectionString = process.env.DATABASE_URL;

  // Refuse to construct a client without a URL so failures surface immediately, not on first query.
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  // Use the Prisma Pg driver adapter (Prisma 7 style) instead of a baked-in connection URL.
  const adapter = new PrismaPg({ connectionString });
  // Return a client whose queries flow through that adapter to Postgres.
  return new PrismaClient({ adapter });
};

// Export one shared instance: reuse a cached global one when present, otherwise create it once.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Outside production, cache the client on globalThis so module reloads do not open extra connections.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
