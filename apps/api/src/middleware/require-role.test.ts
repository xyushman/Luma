import { describe, expect, it } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { requireRole } from "./require-role.js";

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

// Build a fake request optionally carrying an authenticated user with a role.
const createReq = (user?: {
  email: string;
  id: string;
  name: string;
  role: string;
}): Request =>
  ({
    headers: {},
    user: user
      ? {
          email: user.email,
          emailVerified: false,
          id: user.id,
          name: user.name,
          role: user.role as "reviewer" | "data_operator" | "data_consumer",
        }
      : undefined,
  }) as unknown as Request;

// Invoke a middleware and report whether it called next() and what it wrote.
const runMiddleware = async (
  middleware: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void | Promise<void>,
  user?: { email: string; id: string; name: string; role: string }
): Promise<{ calledNext: boolean; req: Request; state: ResState }> => {
  const req = createReq(user);
  const { res, state } = createRes();
  let calledNext = false;
  await middleware(req, res, () => {
    calledNext = true; // Mark that the middleware handed the request onward.
  });
  return { calledNext, req, state };
};

describe("requireRole", () => {
  describe("single role guard", () => {
    const reviewerOnly = requireRole("reviewer"); // Guard accepting only reviewers.

    it("returns 401 when there is no user (requireAuth not run)", async () => {
      const { calledNext, state } = await runMiddleware(reviewerOnly);
      expect(state.statusCode).toBe(401); // Missing user means auth never ran, so 401.
      expect(calledNext).toBe(false); // Deny access when identity is unknown.
    });

    it("returns 403 FORBIDDEN for an authenticated wrong role", async () => {
      const { calledNext, state } = await runMiddleware(reviewerOnly, {
        email: "operator@luma.dev",
        id: "user_1",
        name: "Operator User",
        role: "data_operator",
      });
      expect(state.statusCode).toBe(403); // Authenticated but wrong role gets 403.
      expect(state.body).toEqual({ code: "FORBIDDEN", error: "Forbidden" }); // Contract error shape for the client.
      expect(calledNext).toBe(false); // Must not continue past a forbidden role.
    });

    it("calls next and attaches user when role matches", async () => {
      const { calledNext, req } = await runMiddleware(reviewerOnly, {
        email: "operator@luma.dev",
        id: "user_1",
        name: "Operator User",
        role: "reviewer", // The account role matches the guard.
      });
      expect(calledNext).toBe(true); // Matching role proceeds down the chain.
      expect(req.user?.role).toBe("reviewer");
    });
  });

  describe("multi-role guard", () => {
    const operatorOrReviewer = requireRole("data_operator", "reviewer"); // Guard allowing either role.

    it("allows any of the listed roles", async () => {
      const { calledNext, req } = await runMiddleware(operatorOrReviewer, {
        email: "operator@luma.dev",
        id: "user_1",
        name: "Operator User",
        role: "data_operator", // Operator is explicitly allowed.
      });
      expect(calledNext).toBe(true);
      expect(req.user?.role).toBe("data_operator");
    });

    it("still rejects roles outside the list", async () => {
      const { calledNext, state } = await runMiddleware(operatorOrReviewer, {
        email: "operator@luma.dev",
        id: "user_1",
        name: "Operator User",
        role: "data_consumer", // Consumer is not in the allowed list.
      });
      expect(state.statusCode).toBe(403);
      expect(calledNext).toBe(false);
    });
  });

  it("rejects every authenticated user when no roles are provided", async () => {
    const denyAll = requireRole(); // Guard created with no allowed roles.
    const { calledNext, state } = await runMiddleware(denyAll, {
      email: "operator@luma.dev",
      id: "user_1",
      name: "Operator User",
      role: "reviewer",
    });
    expect(state.statusCode).toBe(403); // Empty allow-list denies everyone.
    expect(calledNext).toBe(false);
  });
});
