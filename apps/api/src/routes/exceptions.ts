// Imports: the request/body Zod schemas for exceptions from @repo/types, Express types, Prisma,
// shared validation helpers, and the auth + RBAC guards that protect every route below.
import {
  exceptionApproveBodySchema,
  exceptionCommentBodySchema,
  exceptionDecisionBodySchema,
  exceptionListQuerySchema,
  exceptionRejectBodySchema,
} from "@repo/types";
import express, { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, mapZodIssuesToFields } from "../lib/validation.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";

// Create the Express router for the reviewer exception queue API.
const router = express.Router();

// Alias the shared cuid validator for validating exception ids in route params.
const CUID_SCHEMA = cuidSchema;

// Problem statement Module C (Exception Queue) + API contract §4: reviewer-only.
// Operator dashboard (Module G / ui-and-flow §4.1) must NOT use this endpoint for
// "Corrections needed" — operator uses GET /api/uploads (failedRows) + GET /api/loans?validationStatus=failed.
// Keeping this guard strict preserves RBAC and makes the 403 on operator intentional.

// SECURITY GUARD / RBAC ENFORCEMENT:
// This middleware ensures that ONLY users with the 'reviewer' role can access ANY
// of the routes in this file. If a 'data_operator' tries to hit this endpoint
// directly via API to approve their own errors, it instantly rejects them with a 403 Forbidden.
// This is how we enforce Separation of Duties at the network layer.
router.use(requireAuth, requireRole("reviewer"));

// GET / list endpoint: reviewer exception queue with status/severity/type/search/batch filters.
router.get("/", async (req: Request, res: Response): Promise<void> => {
  // Validate every query parameter against the shared list schema before touching the DB.
  const parsed = exceptionListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    // Return field-level validation messages so clients can fix their query.
    res.status(400).json({
      code: "BAD_REQUEST",
      error: "Invalid query",
      fields: mapZodIssuesToFields(parsed.error.issues),
    });
    return;
  }

  const { page, limit, status, severity, type, search, batchId } = parsed.data;

  // Start building the exception-level filter; each optional param narrows it.
  const where: Record<string, unknown> = {};
  if (status) {
    where.status = status; // Filter by review state: open, approved, rejected.
  }
  if (severity) {
    where.severity = severity; // Filter by severity bucket (critical/high/medium/low).
  }
  if (type) {
    where.exceptionType = type; // Filter by the exact validation rule that fired.
  }

  // Build the nested loan-level filter separately since search/batch apply to the loan.
  const loanWhere: Record<string, unknown> = {};
  if (search) {
    // Case-insensitive substring match on the loan and borrower ids for keyword search.
    loanWhere.OR = [
      { loanId: { contains: search, mode: "insensitive" } },
      { borrowerId: { contains: search, mode: "insensitive" } },
    ];
  }
  if (batchId) {
    loanWhere.sourceBatchId = batchId; // Narrow to one source upload batch.
  }
  // Attach the loan filter as a relation condition only when at least one part is present.
  if (Object.keys(loanWhere).length > 0) {
    where.loan = loanWhere;
  }

  // Convert page/limit into a skip offset for pagination.
  const skip = (page - 1) * limit;

  // Run the total count and page fetch in parallel for a single round trip.
  const [total, exceptions] = await Promise.all([
    prisma.exception.count({ where: where as never }),
    prisma.exception.findMany({
      include: {
        loan: {
          select: {
            borrowerId: true,
            id: true,
            loanId: true,
            validationStatus: true, // Let the reviewer know the loan's current validation state.
          },
        },
      },
      orderBy: { createdAt: "desc" }, // Newest exceptions surface first in the queue.
      skip,
      take: limit,
      where: where as never,
    }),
  ]);

  // Map each exception to the slim JSON shape consumed by the reviewer queue UI.
  const data = exceptions.map((exc) => ({
    aiRecommendation: (exc.aiRecommendation as unknown) ?? null,
    createdAt: exc.createdAt.toISOString(),
    exceptionType: exc.exceptionType,
    field: exc.field,
    id: exc.id,
    loan: {
      borrowerId: exc.loan.borrowerId,
      id: exc.loan.id,
      loanId: exc.loan.loanId,
      validationStatus: exc.loan.validationStatus,
    },
    message: exc.message,
    severity: exc.severity,
    status: exc.status,
  }));

  // Return the page plus pagination metadata for the queue rendering.
  res.json({
    data,
    pagination: {
      limit,
      page,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// GET /:id detail endpoint: full exception record plus a lightweight loan reference.
router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const rawId = (req.params as { id: string }).id;
  // Validate the path id is a real cuid to keep malformed requests out of the DB.
  const parsedId = CUID_SCHEMA.safeParse(rawId);
  if (!parsedId.success) {
    res.status(400).json({
      code: "BAD_REQUEST",
      error: "Invalid exception id",
      fields: { id: "Must be a valid cuid" },
    });
    return;
  }

  // Load the exception with only the loan identifiers the reviewer needs to orient.
  const exception = await prisma.exception.findUnique({
    include: {
      loan: { select: { id: true, loanId: true } },
    },
    where: { id: parsedId.data },
  });

  // Unknown id returns 404 so the UI can surface a missing-record state.
  if (!exception) {
    res.status(404).json({ code: "NOT_FOUND", error: "Exception not found" });
    return;
  }

  res.json({
    aiRecommendation: (exception.aiRecommendation as unknown) ?? null,
    correctedValue: exception.correctedValue,
    createdAt: exception.createdAt.toISOString(),
    exceptionType: exception.exceptionType,
    field: exception.field,
    id: exception.id,
    loan: {
      id: exception.loan.id,
      loanId: exception.loan.loanId,
    },
    message: exception.message,
    reviewedAt: exception.reviewedAt
      ? exception.reviewedAt.toISOString() // Serialize only when a review actually happened.
      : null,
    reviewerId: exception.reviewerId,
    reviewerNote: exception.reviewerNote,
    severity: exception.severity,
    status: exception.status,
    updatedAt: exception.updatedAt.toISOString(),
  });
});

// POST /:id/comment: reviewer attaches a free-form note to an exception.
router.post(
  "/:id/comment",
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    // Validate the exception id from the path is a real cuid before touching the DB.
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    // Reject malformed ids with 400 rather than surfacing any database behavior.
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid exception id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    // Validate the comment body so note is a required string, nothing else is trusted.
    const parsedBody = exceptionCommentBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsedBody.error.issues),
      });
      return;
    }

    const exceptionId = parsedId.data;
    const { user } = req;
    // Already authed via router.use(requireAuth), but narrow the type and fail closed anyway.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const existing = await prisma.exception.findUnique({
      where: { id: exceptionId },
    });
    // The requested exception must exist; otherwise 404 keeps the queue honest.
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", error: "Exception not found" });
      return;
    }

    // Persist the note and its audit event in one transaction so they never split.
    const updated = await prisma.$transaction(async (tx) => {
      // Stamp the note and reviewer id onto the exception row.
      const exc = await tx.exception.update({
        data: {
          reviewerId: user.id,
          reviewerNote: parsedBody.data.note,
        },
        where: { id: exceptionId },
      });

      // Record REVIEWER_COMMENT for the audit trail with the note text preserved.
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          eventType: "REVIEWER_COMMENT",
          exceptionId,
          loanId: existing.loanId,
          metadata: { note: parsedBody.data.note },
        },
      });

      return exc;
    });

    res.json({
      id: updated.id,
      reviewerNote: updated.reviewerNote,
      updatedAt: updated.updatedAt.toISOString(),
    });
  }
);

// Explicit whitelist of loan columns a reviewer correction may write back; anything not listed
// is rejected outright so corrections can never be injected into risky loan keys.
const VALID_LOAN_FIELDS = new Set([
  "borrowerId",
  "loanId",
  "loanType",
  "borrowerState",
  "creditGrade",
  "currentBalance",
  "interestRate",
  "originalPrincipal",
  "termMonths",
  "paymentStatus",
  "daysPastDue",
  "servicerName",
  "documentStatus",
  "sourceSystem",
]);

// Convert a reviewer-supplied correction string into the right DB type for a field.
function coerceLoanFieldValue(fieldName: string, value: string): unknown {
  // Money/rate fields: parse to a number, but keep the string when parsing fails.
  if (
    fieldName === "currentBalance" ||
    fieldName === "interestRate" ||
    fieldName === "originalPrincipal"
  ) {
    return Number(value) || value;
  }
  // Whole-number fields parse as integers, defaulting to zero on garbage input.
  if (fieldName === "termMonths" || fieldName === "daysPastDue") {
    return Number.parseInt(value, 10) || 0;
  }
  return value; // All other whitelisted fields stay as typed strings.
}

// Writes an approved correction value back onto the loan, but only through the whitelist.
async function syncApprovedCorrectionToLoan(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  loanId: string,
  field: string | null,
  correctedValue: string | null
): Promise<void> {
  // Bail unless both values exist AND the field is on the allowlist; guards against injection.
  if (!(field && correctedValue && VALID_LOAN_FIELDS.has(field))) {
    return;
  }
  const coerced = coerceLoanFieldValue(field, correctedValue);
  // Apply the corrected value to only that one whitelisted column.
  await tx.loan.update({
    data: { [field]: coerced as never },
    where: { id: loanId },
  });
}

// After an approval, auto-recovers the loan's validation status to passed when no exceptions remain.
async function syncLoanValidationStatus(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  loanId: string,
  exceptionId: string
): Promise<void> {
  // Count every open exception that is NOT the one just approved for this loan.
  const remainingOpen = await tx.exception.count({
    where: {
      id: { not: exceptionId },
      loanId,
      status: "open",
    },
  });
  // Only when zero are left open can the loan be deemed validated.
  if (remainingOpen === 0) {
    await tx.loan.update({
      data: { validationStatus: "passed" },
      where: { id: loanId },
    });
  }
}

// POST /:id/approve: reviewer marks an exception approved, optionally supplying a corrected value
// that is written back to the loan, then the loan's validation status auto-recovers to passed.
router.post(
  "/:id/approve",
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    // Validate the exception id from the path is a real cuid before touching the DB.
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    // Reject malformed ids with 400 rather than surfacing any database behavior.
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid exception id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    const parsedBody = exceptionApproveBodySchema.safeParse(req.body ?? {});
    // Approve body validated; defaults handle the optional correctedValue and note.
    if (!parsedBody.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsedBody.error.issues),
      });
      return;
    }

    const exceptionId = parsedId.data;
    const { user } = req;
    // Already authed via router.use(requireAuth), but narrow the type and fail closed anyway.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const existing = await prisma.exception.findUnique({
      where: { id: exceptionId },
    });
    // The requested exception must exist; otherwise 404 keeps the queue honest.
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", error: "Exception not found" });
      return;
    }

    // Run the approval, correction write-back, and audit row atomically in one transaction.
    const updated = await prisma.$transaction(async (tx) => {
      // Mark the exception approved, keeping any prior correction or note when not resupplied.
      const exc = await tx.exception.update({
        data: {
          correctedValue:
            parsedBody.data.correctedValue ?? existing.correctedValue,
          reviewedAt: new Date(),
          reviewerId: user.id,
          reviewerNote: parsedBody.data.note ?? existing.reviewerNote,
          status: "approved",
        },
        where: { id: exceptionId },
      });

      // Resolve the final correction: the incoming one wins, else the previously stored one.
      const finalCorrected =
        parsedBody.data.correctedValue ?? existing.correctedValue;
      // Write the correction back onto the loan only if its field is on the allowed whitelist.
      await syncApprovedCorrectionToLoan(
        tx,
        existing.loanId,
        existing.field,
        finalCorrected
      );
      // Recovery: flip the loan to passed once this was the last open exception.
      await syncLoanValidationStatus(tx, existing.loanId, exceptionId);

      // Record the LOAN_APPROVED decision for the audit trail with the values used.
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          eventType: "LOAN_APPROVED",
          exceptionId,
          loanId: existing.loanId,
          metadata: {
            correctedValue: parsedBody.data.correctedValue ?? null,
            note: parsedBody.data.note ?? null,
          },
        },
      });

      return exc;
    });

    res.json({
      id: updated.id,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
      reviewerId: updated.reviewerId,
      status: updated.status,
    });
  }
);

// POST /:id/reject: reviewer rejects an exception with a required note; no field write-back occurs.
router.post(
  "/:id/reject",
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    // Validate the exception id from the path is a real cuid before touching the DB.
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    // Reject malformed ids with 400 rather than surfacing any database behavior.
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid exception id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    const parsedBody = exceptionRejectBodySchema.safeParse(req.body);
    // Reject body must carry a note; anything else is invalid input.
    if (!parsedBody.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsedBody.error.issues),
      });
      return;
    }

    const exceptionId = parsedId.data;
    const { user } = req;
    // Already authed via router.use(requireAuth), but narrow the type and fail closed anyway.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const existing = await prisma.exception.findUnique({
      where: { id: exceptionId },
    });
    // The requested exception must exist; otherwise 404 keeps the queue honest.
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", error: "Exception not found" });
      return;
    }

    // Rejection state change and its audit event happen together.
    const updated = await prisma.$transaction(async (tx) => {
      // Flip the exception to rejected, stamping reviewer and time and the explanatory note.
      const exc = await tx.exception.update({
        data: {
          reviewedAt: new Date(),
          reviewerId: user.id,
          reviewerNote: parsedBody.data.note,
          status: "rejected",
        },
        where: { id: exceptionId },
      });

      // Log the LOAN_REJECTED decision so the audit trail shows why the value was not changed.
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          eventType: "LOAN_REJECTED",
          exceptionId,
          loanId: existing.loanId,
          metadata: { note: parsedBody.data.note },
        },
      });

      return exc;
    });

    res.json({
      id: updated.id,
      reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
      reviewerId: updated.reviewerId,
      status: updated.status,
    });
  }
);

// POST /:id/decision: reviewer records how the AI recommendation was resolved (accept/edit/reject);
// this is an audit-only endpoint, it does not mutate the exception or loan state.
router.post(
  "/:id/decision",
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    // Validate the exception id from the path is a real cuid before touching the DB.
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    // Reject malformed ids with 400 rather than surfacing any database behavior.
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid exception id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    const parsedBody = exceptionDecisionBodySchema.safeParse(req.body);
    // The decision must be one of the accepted AI-recommendation outcomes.
    if (!parsedBody.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsedBody.error.issues),
      });
      return;
    }

    const exceptionId = parsedId.data;
    const { user } = req;
    // Already authed via router.use(requireAuth), but narrow the type and fail closed anyway.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const existing = await prisma.exception.findUnique({
      where: { id: exceptionId },
    });
    // The requested exception must exist; otherwise 404 keeps the queue honest.
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", error: "Exception not found" });
      return;
    }

    // Capture the decision timestamp once so the audit row and response agree.
    const nowIso = new Date().toISOString();

    // Persist the AI_RECOMMENDATION decision event with what the reviewer chose.
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        eventType: "AI_RECOMMENDATION",
        exceptionId,
        loanId: existing.loanId,
        metadata: {
          aiDecision: parsedBody.data.decision,
          editedValue: parsedBody.data.editedValue ?? null, // Only relevant when "edited".
        },
      },
    });

    res.json({
      aiDecision: parsedBody.data.decision,
      exceptionId,
      recordedAt: nowIso,
    });
  }
);

export default router;
