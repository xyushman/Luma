import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { meResponseSchema, type Role } from "@repo/types";

/**
 * Integration tests run in their OWN process (`bun run test:integration`)
 * so the Prisma client inside the app binds to the isolated luma_test DB,
 * never the dev database. Migrations are applied before any app import.
 */

// Dedicated Postgres test database (docker compose luma-postgres).
const TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/luma_test";

type PrismaClient = InstanceType<
  typeof import("./generated/prisma/client.js")["PrismaClient"]
>;

interface TestServer {
  address: () => AddressInfo;
  close: () => void;
}

interface AppModule {
  createApp: () => { listen: (port: number) => TestServer };
}

let appModule: AppModule;
let prisma: PrismaClient;
let server: TestServer;
let baseUrl: string;

// Unique marker so test rows are identifiable and cleanable.
const RUN_TAG = `it_${Date.now()}`;

const APP_ROOT = join(import.meta.dir, "..");

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL; // Point the app at the test DB.

  // Apply all pending migrations before booting the app.
  const migrate = Bun.spawnSync(["bunx", "prisma", "migrate", "deploy"], {
    cwd: APP_ROOT,
    env: process.env as Record<string, string>,
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(migrate.exitCode).toBe(0); // Migrations must succeed.

  appModule = (await import("./app.js")) as unknown as AppModule;
  const clientModule = await import("./generated/prisma/client.js");
  const adapterModule = await import("@prisma/adapter-pg");
  const adapter = new adapterModule.PrismaPg({
    connectionString: TEST_DATABASE_URL, // Prisma connects via the Pg adapter.
  });
  prisma = new clientModule.PrismaClient({ adapter });

  server = appModule.createApp().listen(0); // Listen on an ephemeral port.
  baseUrl = `http://localhost:${server.address().port}`; // Real HTTP base.
});

// Clean up users created by this run, then close the server.
afterAll(async () => {
  await prisma?.user.deleteMany({ where: { email: { contains: RUN_TAG } } });
  await prisma?.$disconnect();
  if (server) {
    server.close();
  }
});

interface SessionUser {
  email: string;
  id: string;
  name: string;
  role: Role | string;
}

// Signs up a fresh test user.
const signUp = async (email: string): Promise<Response> => {
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    body: JSON.stringify({ email, name: "IT User", password: "password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response;
};

// Signs in and returns just the session token cookie.
const signIn = async (email: string): Promise<string> => {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password: "password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const sessionToken = setCookie.split(";")[0] ?? ""; // First cookie is the token.
  expect(sessionToken).toContain("session_token=");
  return sessionToken;
};

describe("auth flow + /api/me (integration)", () => {
  it("serves /api/health without auth", async () => {
    const response = await fetch(`${baseUrl}/api/health`); // Public endpoint.
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok"); // Health reports ok.
  });

  it("returns 401 UNAUTHENTICATED from /api/me without a session", async () => {
    const response = await fetch(`${baseUrl}/api/me`); // No cookie attached.
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("UNAUTHENTICATED"); // Standard error code.
  });

  it("signs up, assigns operator role, and /api/me returns contract shape", async () => {
    const email = `operator_${RUN_TAG}@luma.dev`;
    const signUpResponse = await signUp(email);
    expect(signUpResponse.status).toBe(200); // New user created.

    await prisma.user.update({
      data: { role: "data_operator" }, // Promote the fresh user.
      where: { email },
    });

    const cookie = await signIn(email);
    const meResponse = await fetch(`${baseUrl}/api/me`, {
      headers: { cookie },
    });
    expect(meResponse.status).toBe(200); // Session recognized.

    const body: unknown = await meResponse.json();
    const parsed = meResponseSchema.safeParse(body); // Validate the contract shape.
    expect(parsed.success).toBe(true);
    const user = body as SessionUser;
    expect(user.role).toBe("data_operator"); // Role round-trips.
    expect(user.email).toBe(email);
  });

  it("rejects bad credentials with 401", async () => {
    const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      body: JSON.stringify({
        email: `ghost_${RUN_TAG}@luma.dev`, // Never signed up.
        password: "wrong",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(401); // Bad login is rejected.
  });

  it("emits CORS credentials header for the frontend origin", async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: "http://localhost:3000" }, // Frontend origin.
    });
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true" // CORS allows credentialed requests.
    );
  });

  it("seed produces the 3 demo users with correct roles", async () => {
    const seed = Bun.spawnSync(["bun", "src/seed.ts"], {
      cwd: APP_ROOT,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, // Seed the test DB.
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(seed.exitCode).toBe(0);

    const users = await prisma.user.findMany({
      select: { email: true, role: true },
      where: { email: { contains: "@luma.dev" } },
    });

    // Role expectations for the demo accounts.
    const expected: Record<string, string> = {
      "consumer@luma.dev": "data_consumer",
      "operator@luma.dev": "data_operator",
      "reviewer@luma.dev": "reviewer",
    };

    expect(users.length).toBeGreaterThanOrEqual(3);
    for (const [email, role] of Object.entries(expected)) {
      const found = users.find((entry) => entry.email === email);
      expect(found).toBeTruthy(); // Demo user exists.
      expect(found?.role).toBe(role); // Role is correct.
    }

    const seededCount = await prisma.user.count({
      where: { email: { contains: "@luma.dev" } },
    });
    expect(seededCount).toBeGreaterThanOrEqual(3); // At least the 3 demo users.
  });
});
