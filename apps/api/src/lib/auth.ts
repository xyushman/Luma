// Imports: Better Auth core, its Prisma adapter, its admin plugin, and the shared Prisma client.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { prisma } from "./prisma.js";

// Create the single shared Better Auth instance; /api/auth routes and the seed script both use it.
export const auth = betterAuth({
  advanced: {
    // Cookie policy for cross-origin deployments; sameSite=none plus secure is required when hosts differ.
    defaultCookieAttributes:
      process.env.CROSS_ORIGIN_COOKIES === "true"
        ? { sameSite: "none", secure: true }
        : undefined,
  },
  // Persist sessions, accounts, and users in Postgres through the singleton Prisma client.
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Enable the challenge's email+password sign-in flow (Better Auth's core credential method).
  emailAndPassword: { enabled: true },
  // Admin plugin adds role management and the role field used by the app's RBAC.
  plugins: [
    admin({
      // Only the "admin" role is allowed the admin plugin's user-management features.
      adminRoles: ["admin"],
      // Fresh sign-ups land on the least-privileged role; seed.ts later pins real roles.
      defaultRole: "data_consumer",
    }),
  ],
  // Secret signs session tokens; assertBootEnv already guarantees it is set and at least 32 chars.
  secret: process.env.BETTER_AUTH_SECRET,
  // Trusted origins guard against cookie/CSRF abuse by rejecting requests from unknown hosts.
  trustedOrigins: [
    // Always trust the main frontend origin so its session cookies are honored.
    process.env.FRONTEND_URL ?? "http://localhost:3000",
    // Extend trust to optional extra frontend origins, trimmed and de-duplicated by the filter.
    ...(process.env.EXTRA_FRONTEND_URLS ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter((url) => url.length > 0),
  ],
});
