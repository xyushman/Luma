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

const router = express.Router();

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

router.get("/", async (req: Request, res: Response): Promise<void> => {
  const parsed = exceptionListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      code: "BAD_REQUEST",
      error: "Invalid query",
      fields: mapZodIssuesToFields(parsed.error.issues),
    });
    return;
  }

  const { page, limit, status, severity, type, search, batchId } = parsed.data;

  const where: Record<string, unknown> = {};
  if (status) {
    where.status = status;
  }
  if (severity) {
    where.severity = severity;
  }
  if (type) {
    where.exceptionType = type;
  }

  const loanWhere: Record<string, unknown> = {};
  if (search) {
    loanWhere.OR = [
      { loanId: { contains: search, mode: "insensitive" } },
      { borrowerId: { contains: search, mode: "insensitive" } },
    ];
  }
  if (batchId) {
    loanWhere.sourceBatchId = batchId;
  }
  if (Object.keys(loanWhere).length > 0) {
    where.loan = loanWhere;
  }

  const skip = (page - 1) * limit;

  const [total, exceptions] = await Promise.all([
    prisma.exception.count({ where: where as never }),
    prisma.exception.findMany({
      include: {
        loan: {
          select: {
            borrowerId: true,
            id: true,
            loanId: true,
            validationStatus: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      where: where as never,
    }),
  ]);

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

router.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const rawId = (req.params as { id: string }).id;
  const parsedId = CUID_SCHEMA.safeParse(rawId);
  if (!parsedId.success) {
    res.status(400).json({
      code: "BAD_REQUEST",
      error: "Invalid exception id",
      fields: { id: "Must be a valid cuid" },
    });
    return;
  }

  const exception = await prisma.exception.findUnique({
    include: {
      loan: { select: { id: true, loanId: true } },
    },
    where: { id: parsedId.data },
  });

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
      ? exception.reviewedAt.toISOString()
      : null,
    reviewerId: exception.reviewerId,
    reviewerNote: exception.reviewerNote,
    severity: exception.severity,
    status: exception.status,
    updatedAt: exception.updatedAt.toISOString(),
  });
});

router.post(
  "/:id/comment",
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid exception id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

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
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const existing = await prisma.exception.findUnique({
      where: { id: exceptionId },
    });
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", error: "Exception not found" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const exc = await tx.exception.update({
        data: {
          reviewerId: user.id,
          reviewerNote: parsedBody.data.note,
        },
        where: { id: exceptionId },
      });

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

function coerceLoanFieldValue(fieldName: string, value: string): unknown {
  if (
    fieldName === "currentBalance" ||
    fieldName === "interestRate" ||
    fieldName === "originalPrincipal"
  ) {
    return Number(value) || value;
  }
  if (fieldName === "termMonths" || fieldName === "daysPastDue") {
    return Number.parseInt(value, 10) || 0;
  }
  return value;
}

async function syncApprovedCorrectionToLoan(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  loanId: string,
  field: string | null,
  correctedValue: string | null
): Promise<void> {
  if (!(field && correctedValue && VALID_LOAN_FIELDS.has(field))) {
    return;
  }
  const coerced = coerceLoanFieldValue(field, correctedValue);
  await tx.loan.update({
    data: { [field]: coerced as never },
    where: { id: loanId },
  });
}

async function syncLoanValidationStatus(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  loanId: string,
  exceptionId: string
): Promise<void> {
  const remainingOpen = await tx.exception.count({
    where: {
      id: { not: exceptionId },
      loanId,
      status: "open",
    },
  });
  if (remainingOpen === 0) {
    await tx.loan.update({
      data: { validationStatus: "passed" },
      where: { id: loanId },
    });
  }
}

router.post(
  "/:id/approve",
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid exception id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    const parsedBody = exceptionApproveBodySchema.safeParse(req.body ?? {});
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
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const existing = await prisma.exception.findUnique({
      where: { id: exceptionId },
    });
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", error: "Exception not found" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
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

      const finalCorrected =
        parsedBody.data.correctedValue ?? existing.correctedValue;
      await syncApprovedCorrectionToLoan(
        tx,
        existing.loanId,
        existing.field,
        finalCorrected
      );
      await syncLoanValidationStatus(tx, existing.loanId, exceptionId);

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

router.post(
  "/:id/reject",
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid exception id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    const parsedBody = exceptionRejectBodySchema.safeParse(req.body);
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
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const existing = await prisma.exception.findUnique({
      where: { id: exceptionId },
    });
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", error: "Exception not found" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const exc = await tx.exception.update({
        data: {
          reviewedAt: new Date(),
          reviewerId: user.id,
          reviewerNote: parsedBody.data.note,
          status: "rejected",
        },
        where: { id: exceptionId },
      });

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

router.post(
  "/:id/decision",
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid exception id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    const parsedBody = exceptionDecisionBodySchema.safeParse(req.body);
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
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const existing = await prisma.exception.findUnique({
      where: { id: exceptionId },
    });
    if (!existing) {
      res.status(404).json({ code: "NOT_FOUND", error: "Exception not found" });
      return;
    }

    const nowIso = new Date().toISOString();

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        eventType: "AI_RECOMMENDATION",
        exceptionId,
        loanId: existing.loanId,
        metadata: {
          aiDecision: parsedBody.data.decision,
          editedValue: parsedBody.data.editedValue ?? null,
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
