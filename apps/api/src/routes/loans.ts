// Imports: shared Zod schemas for loan queries and field patches, Express types, Prisma, validation
// helpers, the auth/RBAC guards, and the verification service with its typed error class.
import { loanFieldsPatchBodySchema, loanListQuerySchema } from "@repo/types";
import express, { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, mapZodIssuesToFields } from "../lib/validation.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  VerificationError,
  verifyLoan,
} from "../services/verification.service.js";

// Create the Express router for all loan CRUD and verification endpoints.
const router = express.Router();

// Alias the shared cuid validator for loan id path params.
const CUID_SCHEMA = cuidSchema;

// Whitelist of editable fields for PATCH /:id/fields; any other key is rejected outright so
// reviewers cannot touch immutable or risky loan columns through this endpoint.
const LOAN_FIELD_MAP: Record<string, string> = {
  borrowerState: "borrowerState",
  creditGrade: "creditGrade",
  currentBalance: "currentBalance",
  documentStatus: "documentStatus",
  interestRate: "interestRate",
  paymentStatus: "paymentStatus",
  servicerName: "servicerName",
};

// Coerce a reviewer-provided string to the domain type, rejecting bad numbers with null.
const coerceFieldValue = (field: string, value: string): unknown => {
  // Money/rate fields are the only ones that should arrive as decimals.
  if (field === "currentBalance" || field === "interestRate") {
    const trimmed = value.trim();
    // Empty string means clear the field rather than store a bad number.
    if (trimmed === "") {
      return null;
    }
    const num = Number(trimmed);
    // Negative, NaN, or infinite values are invalid for money/rate and get cleared.
    if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) {
      return null;
    }
    return trimmed; // Valid numeric string passes through for the DB to parse.
  }
  return value; // Non-numeric fields keep their raw string value.
};

// GET / list endpoint: paged loans with batch/status/search filters; consumer role is auto-scoped.
router.get(
  "/",
  requireAuth,
  requireRole("data_operator", "reviewer", "data_consumer"),
  async (req: Request, res: Response): Promise<void> => {
    // Validate all query parameters (page, limit, batchId, validationStatus, search).
    const parsed = loanListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      // Return 400 with per-field validation messages.
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid query",
        fields: mapZodIssuesToFields(parsed.error.issues),
      });
      return;
    }

    const { user } = req;
    // requireAuth already ran, but narrow the type and fail closed if missing.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const { page, limit, batchId, validationStatus, search } = parsed.data;
    // Start with an empty filter and add only the conditions the caller supplied.
    const where: Record<string, unknown> = {};
    if (batchId) {
      where.sourceBatchId = batchId; // Only loans from one upload batch.
    }
    if (validationStatus) {
      where.validationStatus = validationStatus; // staged/processing/validation/failed/passed.
    }
    if (search) {
      // OR of several lookup keys so search works across ids and the servicer name.
      where.OR = [
        { id: { equals: search } },
        { loanId: { contains: search, mode: "insensitive" } },
        { borrowerId: { contains: search, mode: "insensitive" } },
        { servicerName: { contains: search, mode: "insensitive" } },
      ];
    }
    // Data consumers only ever see verified loans — deny-by-default scoping.
    if (user.role === "data_consumer") {
      where.verifiedRecord = { isNot: null };
    }

    // Convert page/limit to a skip offset.
    const skip = (page - 1) * limit;

    // Fetch the total count and the current page concurrently.
    const [total, loans] = await Promise.all([
      prisma.loan.count({ where: where as never }),
      prisma.loan.findMany({
        include: {
          _count: { select: { exceptions: true } }, // Exception count for list badges.
          sourceBatch: { select: { fileName: true, id: true } }, // Provenance info.
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        where: where as never,
      }),
    ]);

    // Project rows to the list shape, stringifying numeric columns so consumers get stable JSON.
    const data = loans.map(
      (loan: {
        _count: { exceptions: number };
        borrowerId: string | null;
        borrowerState: string | null;
        currentBalance: unknown;
        id: string;
        interestRate: unknown;
        loanId: string | null;
        loanType: string | null;
        originalPrincipal: unknown;
        paymentStatus: string | null;
        sourceBatch: { fileName: string; id: string };
        sourceRowNumber: number;
        validationStatus: string;
      }) => ({
        borrowerId: loan.borrowerId,
        borrowerState: loan.borrowerState,
        currentBalance:
          loan.currentBalance !== null && loan.currentBalance !== undefined
            ? String(loan.currentBalance)
            : null,
        exceptionCount: loan._count.exceptions,
        id: loan.id,
        interestRate:
          loan.interestRate !== null && loan.interestRate !== undefined
            ? String(loan.interestRate)
            : null,
        loanId: loan.loanId,
        loanType: loan.loanType,
        originalPrincipal:
          loan.originalPrincipal !== null &&
          loan.originalPrincipal !== undefined
            ? String(loan.originalPrincipal)
            : null,
        paymentStatus: loan.paymentStatus,
        sourceBatch: {
          fileName: loan.sourceBatch.fileName,
          id: loan.sourceBatch.id,
        },
        sourceRowNumber: loan.sourceRowNumber,
        validationStatus: loan.validationStatus,
      })
    );

    // Return the page with pagination metadata for the table UI.
    res.json({
      data,
      pagination: {
        limit,
        page,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }
);

// GET /:id detail endpoint: full loan with its exceptions, source batch, and verified record.
router.get(
  "/:id",
  requireAuth,
  requireRole("data_operator", "reviewer", "data_consumer"),
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    // Validate the loan id path param as a cuid before querying.
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid loan id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    const { user } = req;
    // Narrow the type from the guaranteed requireAuth user; fail closed if absent.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    // Load the loan with its exception history, provenance, and the immutable verified record.
    const loan = await prisma.loan.findUnique({
      include: {
        exceptions: {
          orderBy: { createdAt: "asc" }, // Chronological exception trail for the detail view.
        },
        sourceBatch: { select: { fileName: true, id: true } },
        verifiedRecord: {
          select: {
            id: true,
            recordHash: true, // SHA-256 fingerprint of the 20 canonical fields.
            validationResult: true,
            verifiedAt: true,
            verifiedById: true,
          },
        },
      },
      where: { id: parsedId.data },
    });

    if (!loan) {
      res.status(404).json({ code: "NOT_FOUND", error: "Loan not found" });
      return;
    }

    // Data consumers may only inspect loans that have been verified
    // (api-contract.md: "data_consumer (verified only)").
    if (user.role === "data_consumer" && !loan.verifiedRecord) {
      res.status(403).json({
        code: "FORBIDDEN",
        error: "Loan has not been verified",
      });
      return;
    }

    res.json({
      borrowerId: loan.borrowerId,
      borrowerState: loan.borrowerState,
      creditGrade: loan.creditGrade,
      currentBalance:
        loan.currentBalance !== null && loan.currentBalance !== undefined
          ? String(loan.currentBalance) // Numeric columns serialized as strings for consistency.
          : null,
      daysPastDue: loan.daysPastDue,
      documentStatus: loan.documentStatus,
      employmentLength: loan.employmentLength,
      // Map the loan's exceptions into the compact shape the detail view renders.
      exceptions: loan.exceptions.map((exc) => ({
        aiRecommendation: (exc.aiRecommendation as unknown) ?? null,
        correctedValue: exc.correctedValue ?? null,
        createdAt: exc.createdAt.toISOString(),
        exceptionType: exc.exceptionType,
        field: exc.field,
        id: exc.id,
        message: exc.message,
        metadata: (exc.metadata as unknown) ?? null,
        severity: exc.severity,
        status: exc.status,
      })),
      id: loan.id,
      importStatus: loan.importStatus,
      incomeBand: loan.incomeBand,
      interestRate:
        loan.interestRate !== null && loan.interestRate !== undefined
          ? String(loan.interestRate)
          : null,
      lastPaymentDate: loan.lastPaymentDate
        ? loan.lastPaymentDate.toISOString()
        : null,
      lastUpdatedAt: loan.lastUpdatedAt
        ? loan.lastUpdatedAt.toISOString()
        : null,
      loanId: loan.loanId,
      loanPurpose: loan.loanPurpose,
      loanType: loan.loanType,
      maturityDate: loan.maturityDate ? loan.maturityDate.toISOString() : null,
      originalPrincipal:
        loan.originalPrincipal !== null && loan.originalPrincipal !== undefined
          ? String(loan.originalPrincipal)
          : null,
      originationDate: loan.originationDate
        ? loan.originationDate.toISOString()
        : null,
      paymentStatus: loan.paymentStatus,
      servicerName: loan.servicerName,
      sourceBatch: {
        fileName: loan.sourceBatch.fileName,
        id: loan.sourceBatch.id,
      },
      sourceRowNumber: loan.sourceRowNumber,
      sourceSystem: loan.sourceSystem,
      termMonths: loan.termMonths,
      validationStatus: loan.validationStatus,
      // Include the verified record fingerprint only when this loan was actually verified.
      verifiedRecord: loan.verifiedRecord
        ? {
            id: loan.verifiedRecord.id,
            recordHash: loan.verifiedRecord.recordHash,
            validationResult: loan.verifiedRecord.validationResult,
            verifiedAt: loan.verifiedRecord.verifiedAt.toISOString(),
            verifiedById: loan.verifiedRecord.verifiedById,
          }
        : null,
    });
  }
);

// PATCH /:id/fields: reviewer-only bulk field correction, restricted to the LOAN_FIELD_MAP whitelist.
router.patch(
  "/:id/fields",
  requireAuth,
  requireRole("reviewer"),
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    // Validate the loan id path param as a cuid.
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid loan id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    // Validate the patch body so only whitelisted field names and a reason string arrive.
    const parsedBody = loanFieldsPatchBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsedBody.error.issues),
      });
      return;
    }

    const { user } = req;
    // requireRole("reviewer") already ran, but narrow the type and stay fail-closed.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const loanId = parsedId.data;
    const { fields, reason } = parsedBody.data;

    // Load the loan first so we can diff old vs new values for the audit log.
    const loan = await prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) {
      res.status(404).json({ code: "NOT_FOUND", error: "Loan not found" });
      return;
    }

    // Accumulate the actual DB values to write plus per-field before/after info for auditing.
    const dataToUpdate: Record<string, unknown> = {};
    const updatedFields: string[] = [];
    const editsForAudit: Array<{
      field: string;
      newValue: string;
      oldValue: string | null;
    }> = [];

    // Walk each requested field, mapping through the whitelist and type-coercing values.
    for (const [field, newValue] of Object.entries(fields)) {
      const dbField = LOAN_FIELD_MAP[field];
      // Any field not on the whitelist is rejected rather than silently dropped.
      if (!dbField) {
        res.status(400).json({
          code: "BAD_REQUEST",
          error: `Field ${field} is not editable`,
          fields: { [field]: "Not editable" },
        });
        return;
      }
      // Numeric fields get an extra validation pass that rejects bad numbers entirely.
      if (field === "currentBalance" || field === "interestRate") {
        const coerced = coerceFieldValue(field, newValue);
        if (coerced === null) {
          res.status(400).json({
            code: "BAD_REQUEST",
            error: `Invalid numeric value for ${field}`,
            fields: { [field]: "Must be a valid non-negative number" },
          });
          return;
        }
      }
      // Capture the pre-edit value, normalized to a string, so the audit shows the delta.
      const oldRaw = (loan as unknown as Record<string, unknown>)[dbField];
      const oldValue =
        oldRaw === null || oldRaw === undefined ? null : String(oldRaw);
      // Stage the coerced new value into the update payload.
      dataToUpdate[dbField] = coerceFieldValue(field, newValue);
      updatedFields.push(field);
      // Record the before/after pair for the FIELD_EDITED audit row.
      editsForAudit.push({ field, newValue, oldValue });
    }

    // Apply the field update and write its audit trail in a single transaction.
    const updated = (await prisma.$transaction(async (tx) => {
      // Persist only the whitelisted, coerced column changes onto the loan.
      const result = await tx.loan.update({
        data: dataToUpdate,
        where: { id: loanId },
      });

      // Write one FIELD_EDITED audit row per edited field, each with before/after and reason.
      await tx.auditLog.createMany({
        data: editsForAudit.map((edit) => ({
          actorId: user.id,
          eventType: "FIELD_EDITED",
          loanId,
          metadata: {
            field: edit.field,
            newValue: edit.newValue,
            oldValue: edit.oldValue,
            reason,
          },
        })),
      });

      return result;
    })) as unknown as { updatedAt: Date; id: string };

    res.json({
      id: updated.id,
      updatedAt: updated.updatedAt.toISOString(),
      updatedFields,
    });
  }
);

// POST /:id/verify: reviewer triggers the verification step, producing the immutable VerifiedLoan.
router.post(
  "/:id/verify",
  requireAuth,
  requireRole("reviewer"),
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    // Validate the loan id path param as a cuid.
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid loan id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    const { user } = req;
    // reviewer-only route already enforced by requireRole; narrow the type defensively.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    try {
      // Hash the loan's 20 canonical fields and create the verified record as the acting reviewer.
      const verified = await verifyLoan(parsedId.data, user.id);
      // 201 Created signals a new verified record was produced.
      res.status(201).json({ verifiedLoan: verified });
    } catch (err) {
      // Domain errors carry their own status/code; translate them straight into the response.
      if (err instanceof VerificationError) {
        res.status(err.statusCode).json({ code: err.code, error: err.message });
        return;
      }
      throw err; // Anything unexpected bubbles to the global error handler.
    }
  }
);

export default router;
