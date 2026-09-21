import { afterEach, describe, expect, it } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/auth.js"; // Real Better Auth instance whose getSession we stub.
import { requireAuth } from "./require-auth.js";

interface SessionPayload {
  session: { expiresAt: Date; id: string; userId: string };
  user: { email: string; id: string; name: string; role?: string | null };
}

// Build a fake auth payload; role is optional to test fail-closed behavior.
const sessionFixture = (role?: string | null): SessionPayload => ({
  session: { expiresAt: new Date(), id: "sess_1", userId: "user_1" },
  user: {
    email: "reviewer@luma.dev",
    id: "user_1",
    name: "Reviewer User",
    role,
  },
});

const originalGetSession = auth.api.getSession; // Save the original so tests can restore it.

afterEach(() => {
  (
    auth.api as unknown as {
      getSession: typeof originalGetSession;
    }
  ).getSession = originalGetSession; // Restore the real getSession after every test.
});

const stubGetSession = (
  impl: (headers: unknown) => Promise<SessionPayload | null>
) => {
  interface GetSessionArgs {
    headers: unknown;
  }
  (
    auth.api as unknown as {
      getSession: (args: GetSessionArgs) => Promise<SessionPayload | null>;
    }
  ).getSession = impl; // Replace getSession with the test's implementation.
};

interface ResState {
  body: unknown;
  statusCode: number;
}

// Minimal fake Express response capturing status and JSON body.
const createRes = (): { res: Response; state: ResState } => {
  const state: ResState = { body: undefined, statusCode: 0 };
  const res = {
    json(payload: unknown) {
      state.body = payload; // Record the JSON payload sent.
      return this;
    },
    status(code: number) {
      state.statusCode = code; // Record the status code set.
      return this;
    },
  };
  return { res: res as unknown as Response, state };
};

const createReq = (): Request => ({ headers: {} }) as unknown as Request; // Bare request with empty headers.

// Invoke a middleware and report whether it called next() and what it wrote.
const runMiddleware = async (
  middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>
): Promise<{ calledNext: boolean; req: Request; state: ResState }> => {
  const req = createReq();
  const { res, state } = createRes();
  let calledNext = false;
  await middleware(req, res, () => {
    calledNext = true; // Mark that the middleware handed the request onward.
  });
  return { calledNext, req, state };
};

describe("requireAuth", () => {
  it("returns 401 UNAUTHENTICATED and skips next when there is no session", async () => {
    stubGetSession(() => Promise.resolve(null)); // Simulate an anonymous request.
    const { calledNext, state } = await runMiddleware(requireAuth);
    expect(state.statusCode).toBe(401); // No session must be rejected with 401.
    expect(state.body).toEqual({
      code: "UNAUTHENTICATED",
      error: "Unauthorized", // Contract error shape for the client.
    });
    expect(calledNext).toBe(false); // The request must not reach protected handlers.
  });

  it("passes request headers to better-auth getSession", async () => {
    let received: unknown = null;
    stubGetSession((headers) => {
      received = headers; // Capture whatever the middleware forwarded.
      return Promise.resolve(sessionFixture("reviewer"));
    });
    await runMiddleware(requireAuth);
    const args = received as { headers: unknown };
    expect(args.headers).toBeInstanceOf(Headers); // Auth must receive an actual Headers object.
  });

  it("attaches typed user with contract Role and calls next", async () => {
    stubGetSession(() => Promise.resolve(sessionFixture("reviewer")));
    const { calledNext, req } = await runMiddleware(requireAuth);
    expect(calledNext).toBe(true); // Valid session must continue down the chain.
    expect(req.user?.id).toBe("user_1"); // User id is attached to the request.
    expect(req.user?.email).toBe("reviewer@luma.dev"); // Email is attached to the request.
    expect(req.user?.role).toBe("reviewer"); // Role is attached to the request.
    expect(req.session?.userId).toBe("user_1"); // Raw session data is also attached.
  });

  it("returns 401 when session user has no role", async () => {
    stubGetSession(() => Promise.resolve(sessionFixture(null)));
    const { calledNext, state } = await runMiddleware(requireAuth);
    expect(state.statusCode).toBe(401); // A user without a role is denied auth.
    expect(calledNext).toBe(false); // Such users never pass the guard.
  });

  it("returns 401 for an unknown role string (fail-closed)", async () => {
    stubGetSession(() => Promise.resolve(sessionFixture("space_wizard")));
    const { calledNext, state } = await runMiddleware(requireAuth);
    expect(state.statusCode).toBe(401); // Unknown roles fail closed for safety.
    expect(calledNext).toBe(false);
  });
});
