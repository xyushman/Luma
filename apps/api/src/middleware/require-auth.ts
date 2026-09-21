// Imports: converts Node request headers for Better Auth, Express types, the auth instance that
// validates sessions, and a normalizer that maps the DB role string to one of the app roles.
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/auth.js";
import { normalizeRole } from "../lib/roles.js";

// Authentication middleware: resolves the Better Auth session from the request headers and, when
// valid, attaches the normalized user and session to the request for route handlers downstream.
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Ask Better Auth to validate the caller's session by forwarding the raw incoming headers.
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  // Fail closed: no valid session means the caller is unauthenticated, so reject with 401.
  if (!session) {
    res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
    return;
  }

  // Map the raw role string to a known app role; unknown roles come back as null (fail closed).
  const role = normalizeRole(session.user.role);

  // A role that failed to normalize means the account is in a state we cannot trust, so deny access.
  if (!role) {
    res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
    return;
  }

  // Attach the authenticated user (with normalized role) and the raw session to the request.
  req.user = { ...session.user, role };
  req.session = session.session;
  next(); // Session is valid, so pass control to the next middleware or route handler.
};
