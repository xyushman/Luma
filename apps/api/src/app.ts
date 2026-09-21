// Shared API response types plus third-party Express middleware and utility packages.
import type { HealthResponse, MeResponse } from "@repo/types";
import { toNodeHandler } from "better-auth/node";
import compression from "compression";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import morgan from "morgan";
// Internal modules: auth instance, env boot checks, request guard, and the feature routers.
import { auth } from "./lib/auth.js";
import { assertBootEnv } from "./lib/env.js";
import { requireAuth } from "./middleware/require-auth.js";
import aiRouter from "./routes/ai.js";
import auditRouter from "./routes/audit.js";
import exceptionsRouter from "./routes/exceptions.js";
import loansRouter from "./routes/loans.js";
import summaryRouter from "./routes/summary.js";
import uploadsRouter from "./routes/uploads.js";
import verifiedLoansRouter from "./routes/verified-loans.js";

// Builds and wires the whole Express app: security middleware, CORS, routers, health/me, error handling.
export const createApp = (): Express => {
  // Fail fast at boot if critical env vars are missing, before any request can be served.
  assertBootEnv();

  // Create the Express server instance that every route and middleware mounts onto.
  const app = express();

  // The main CORS origin is the frontend, defaulting to the local dev server when unset.
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  // Parse the optional EXTRA_FRONTEND_URLS comma list, trimming entries and dropping empties.
  const extraOrigins = (process.env.EXTRA_FRONTEND_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  // Combine main and extra frontend origins into the single CORS allowlist used below.
  const allowedOrigins = [frontendUrl, ...extraOrigins];

  // Security hardening: helmet sets safe HTTP headers, compression shrinks payloads, morgan logs requests.
  app.use(helmet());
  app.use(compression());
  app.use(morgan("combined"));

  // CORS with credentials: only allowlisted frontend origins may send/read cookies for this API.
  app.use(
    cors({
      credentials: true,
      origin: allowedOrigins,
    })
  );

  // Better Auth handles every /api/auth route (sign-in, sign-up, session, admin endpoints).
  app.all("/api/auth/*splat", toNodeHandler(auth));
  // *splat matches the whole auth subtree; mounting before express.json keeps raw bodies available.

  // Parse JSON request bodies afterwards so feature routers receive ready-made req.body objects.
  app.use(express.json());

  // Uploads router: file intake and the batch lifecycle (staged -> processing -> validated).
  app.use("/api/uploads", uploadsRouter);
  // Exceptions router: the reviewer exception queue with AI explanations and fixes.
  app.use("/api/exceptions", exceptionsRouter);
  // Loans router: raw imported loan records for internal inspection.
  app.use("/api/loans", loansRouter);
  // Verified loans router: final verified records for consumers, including CSV export.
  app.use("/api/verified-loans", verifiedLoansRouter);
  // Audit router: read access to the immutable audit trail.
  app.use("/api/audit", auditRouter);
  // Summary router: aggregate dashboards for consumers and operators.
  app.use("/api/summary", summaryRouter);
  // AI router: Gemini-driven explanation/fix generation for the review queue.
  app.use("/api/ai", aiRouter);

  // Liveness probe for load balancers and uptime checks; returns status plus current server time.
  app.get("/api/health", (_req, res) => {
    // Compose the typed health payload with a UTC timestamp as a freshness signal.
    const body: HealthResponse = {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
    // Send the health payload as JSON to the caller.
    res.json(body);
  });

  // Own-profile endpoint; requireAuth verifies the session and attaches the user before the handler.
  app.get("/api/me", requireAuth, (req, res) => {
    // Get the authenticated user object that requireAuth attached to the request.
    const { user } = req;
    // Defense in depth: if the user is somehow absent, reject with 401 instead of crashing.
    if (!user) {
      // Standard unauthenticated response the client can map to a sign-in redirect.
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }
    // Project only safe profile fields for the client; never expose tokens or internals.
    const body: MeResponse = {
      email: user.email,
      id: user.id,
      name: user.name,
      role: user.role,
    };
    // Send the sanitized profile back to the client as JSON.
    res.json(body);
  });

  // Global error middleware: centralizes every unexpected error into clean, safe JSON responses.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ): void => {
      // Multer errors expose a "code" property; feature-detect it rather than trusting types around unknown.
      if (err !== null && typeof err === "object" && "code" in err) {
        // Pull the multer error code so we can map it to the correct HTTP status.
        const { code } = err as { code: string };
        if (code === "LIMIT_FILE_SIZE") {
          // File exceeds the upload size limit; answer with 413 Payload Too Large.
          res
            .status(413)
            .json({ code: "PAYLOAD_TOO_LARGE", error: "File too large" });
          return;
        }
        if (
          code === "LIMIT_UNEXPECTED_FILE" ||
          code === "LIMIT_FIELD_KEY" ||
          code === "LIMIT_FIELD_VALUE"
        ) {
          // Malformed upload shape (unexpected files, bad field names) is a client error, answer 400.
          res
            .status(400)
            .json({ code: "BAD_REQUEST", error: "Invalid upload" });
          return;
        }
      }
      // Fall back on any object error that at least carries a string message.
      if (
        err !== null &&
        typeof err === "object" &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
      ) {
        // Generic 500 that never leaks internals; real detail stays in server logs.
        res
          .status(500)
          .json({ code: "INTERNAL_ERROR", error: "Internal server error" });
        return;
      }
      // Last resort for non-object throw values (strings/numbers): identical, leak-free 500.
      res
        .status(500)
        .json({ code: "INTERNAL_ERROR", error: "Internal server error" });
    }
  );

  // Hand the fully configured app to index.ts, which calls listen() on the chosen port.
  return app;
};
