// Import the shared Role type and Express middleware types used in the guard signature.
import type { Role } from "@repo/types";
import type { NextFunction, Request, Response } from "express";

// Export the shared Role type under an app alias so routes can type their allowed roles.
export type AppRole = Role;

// Role guard (RBAC): returns middleware that only lets a request through when the caller's
// normalized role is present in the allowed roles list for the route.
export const requireRole =
  (...roles: AppRole[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    // Read the user that requireAuth attached to the request earlier in the chain.
    const { user } = req;

    // Reject immediately if no user is attached, meaning the route ran without a valid session.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    // Look for the caller's role anywhere inside the allowed list for this route.
    const matchedRole = roles.find((role) => role === user.role);

    // Role not allowed for this endpoint, so deny with 403 to preserve separation of duties.
    if (!matchedRole) {
      res.status(403).json({ code: "FORBIDDEN", error: "Forbidden" });
      return;
    }

    // Reuse normalized role from requireAuth; if somehow missing, normalize defensively
    if (user.role !== matchedRole) {
      req.user = { ...user, role: matchedRole };
    }
    next(); // Role is allowed, so pass control to the actual route handler.
  };
