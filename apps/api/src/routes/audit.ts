// Imports: audit query schema, Express types, Prisma, role normalizer for actor output, validation
// helpers, and the auth + RBAC guards for the audit trail endpoint.
import { auditListQuerySchema } from "@repo/types";
import express, { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { normalizeRole } from "../lib/roles.js";
import { cuidSchema, mapZodIssuesToFields } from "../lib/validation.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";

// Create the Express router for the loan audit-trail endpoint.
const router = express.Router();

// Alias the shared cuid validator for the loan id path param.
const CUID_SCHEMA = cuidSchema;

// GET /:loanId endpoint: returns the full audit trail for one loan, oldest event first.
router.get(
  "/:loanId",
  requireAuth,
  requireRole("data_operator", "reviewer", "data_consumer"),
  async (req: Request, res: Response): Promise<void> => {
    const rawLoanId = (req.params as { loanId: string }).loanId;
    // Validate the loan id path param as a cuid before querying.
    const parsedId = CUID_SCHEMA.safeParse(rawLoanId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid loanId",
        fields: { loanId: "Must be a valid cuid" },
      });
      return;
    }

    // Validate the pagination query params (page/limit).
    const parsedQuery = auditListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid query",
        fields: mapZodIssuesToFields(parsedQuery.error.issues),
      });
      return;
    }

    const { page, limit } = parsedQuery.data;
    const loanId = parsedId.data;

    // Confirm the loan exists so a bogus id does not silently return an empty trail.
    const loan = await prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) {
      res.status(404).json({ code: "NOT_FOUND", error: "Loan not found" });
      return;
    }

    // Convert page/limit into a skip offset for pagination.
    const skip = (page - 1) * limit;

    // Fetch the total log count and the current page in parallel.
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where: { loanId } }),
      prisma.auditLog.findMany({
        include: {
          actor: { select: { id: true, name: true, role: true } }, // Join the acting user.
        },
        orderBy: { createdAt: "asc" }, // Ascending order = true chronological narrative.
        skip,
        take: limit,
        where: { loanId },
      }),
    ]);

    // Map logs to output shape, normalizing the actor's role so it matches the app role union.
    const data = logs.map((log) => {
      const actorRole = log.actor ? normalizeRole(log.actor.role) : null;
      return {
        actor: log.actor
          ? {
              id: log.actor.id,
              name: log.actor.name,
              role: actorRole,
            }
          : null,
        createdAt: log.createdAt.toISOString(),
        eventType: log.eventType,
        id: log.id,
        metadata: (log.metadata as unknown) ?? null, // Event-specific details, when stored.
      };
    });

    // Return the page plus pagination metadata for the timeline viewer.
    res.json({
      data,
      loanId,
      pagination: {
        limit,
        page,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }
);

export default router;
