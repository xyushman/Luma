// Imports: the verified-loan list query schema, Express types, Prisma, validation helpers, and the
// auth + RBAC guards that protect the consumer/reviewer export and listing endpoints.
import { verifiedLoanListQuerySchema } from "@repo/types";
import express, { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, mapZodIssuesToFields } from "../lib/validation.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";

// Create the Express router for verified-loan listing, detail, and export endpoints.
const router = express.Router();

// Alias the shared cuid validator for verified-loan id path params.
const CUID_SCHEMA = cuidSchema;

// The 30 column headers for the CSV export. Prefixes distinguish loan identity fields (loan_),
// canonical verified fields (canonical_), and top-level verified-record metadata.
const CSV_COLUMNS: string[] = [
  "id",
  "loanId",
  "loan_loanId",
  "loan_borrowerId",
  "canonical_borrowerId",
  "canonical_loanType",
  "canonical_originationDate",
  "canonical_maturityDate",
  "canonical_originalPrincipal",
  "canonical_currentBalance",
  "canonical_interestRate",
  "canonical_termMonths",
  "canonical_borrowerState",
  "canonical_loanPurpose",
  "canonical_creditGrade",
  "canonical_employmentLength",
  "canonical_incomeBand",
  "canonical_paymentStatus",
  "canonical_daysPastDue",
  "canonical_servicerName",
  "canonical_lastPaymentDate",
  "canonical_documentStatus",
  "canonical_sourceSystem",
  "sourceBatchRef",
  "validationResult",
  "reviewerDecision",
  "aiRecommendationUsed",
  "verifiedAt",
  "recordHash",
  "verifiedById",
];

// Escapes one CSV field to guard against CSV injection: formula characters are neutralized with a
// leading apostrophe, and values containing commas/quotes/newlines are double-quoted per RFC 4180.
const escapeCsvField = (value: string | null | undefined): string => {
  if (value === null || value === undefined) {
    return ""; // Absent values export as an empty cell.
  }
  let str = String(value);
  // If the value starts with a spreadsheet formula trigger, prefix it to prevent formula execution.
  if (
    str.length > 0 &&
    (str[0] === "=" ||
      str[0] === "+" ||
      str[0] === "-" ||
      str[0] === "@" ||
      str[0] === "\t" ||
      str[0] === "\r")
  ) {
    str = `'${str}`;
  }
  // Wrap values containing separators or quotes; escape embedded quotes by doubling them.
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str; // Plain values pass through untouched.
};

// Flattens one VerifiedLoan row into a single CSV line of 30 comma-separated fields.
const flattenVerifiedLoanForCsv = (vl: {
  aiRecommendationUsed: boolean;
  canonicalData: unknown;
  id: string;
  loan: { borrowerId: string | null; loanId: string | null };
  loanId: string;
  recordHash: string;
  reviewerDecision: string | null;
  sourceBatchRef: string;
  validationResult: string;
  verifiedAt: Date;
  verifiedById: string;
}): string => {
  // Unwrap the stored canonical verification snapshot, defaulting to an empty object.
  const canonical =
    (vl.canonicalData as Record<string, unknown> | null) === null
      ? {}
      : (vl.canonicalData as Record<string, unknown>);
  // Assemble the 30 values in the same order as CSV_COLUMNS.
  const fields = [
    vl.id,
    vl.loanId,
    vl.loan.loanId,
    vl.loan.borrowerId,
    canonical.borrowerId,
    canonical.loanType,
    canonical.originationDate,
    canonical.maturityDate,
    canonical.originalPrincipal,
    canonical.currentBalance,
    canonical.interestRate,
    canonical.termMonths,
    canonical.borrowerState,
    canonical.loanPurpose,
    canonical.creditGrade,
    canonical.employmentLength,
    canonical.incomeBand,
    canonical.paymentStatus,
    canonical.daysPastDue,
    canonical.servicerName,
    canonical.lastPaymentDate,
    canonical.documentStatus,
    canonical.sourceSystem,
    vl.sourceBatchRef,
    vl.validationResult,
    vl.reviewerDecision,
    String(vl.aiRecommendationUsed),
    vl.verifiedAt.toISOString(),
    vl.recordHash,
    vl.verifiedById,
  ];
  // Escape each value and join with commas into one record line.
  return fields.map((v) => escapeCsvField(v as string)).join(",");
};

// Projects a VerifiedLoan into its JSON detail/list shape for API responses and JSON export.
const flattenVerifiedLoanForJson = (vl: {
  aiRecommendationUsed: boolean;
  canonicalData: unknown;
  id: string;
  loan: { borrowerId: string | null; loanId: string | null };
  loanId: string;
  recordHash: string;
  reviewerDecision: string | null;
  sourceBatchRef: string;
  validationResult: string;
  verifiedAt: Date;
  verifiedById: string;
}): Record<string, unknown> => ({
  aiRecommendationUsed: vl.aiRecommendationUsed,
  canonicalData: vl.canonicalData,
  id: vl.id,
  loan: { borrowerId: vl.loan.borrowerId, loanId: vl.loan.loanId },
  loanId: vl.loanId,
  recordHash: vl.recordHash,
  reviewerDecision: vl.reviewerDecision,
  sourceBatchRef: vl.sourceBatchRef,
  validationResult: vl.validationResult,
  verifiedAt: vl.verifiedAt.toISOString(),
  verifiedById: vl.verifiedById,
});

// Streaming export chunks 5000 rows at a time so memory stays O(1) regardless of dataset size.
const EXPORT_PAGE_SIZE = 5000;

// Fixed relation include for export queries; `as const` keeps the object shape literal.
const EXPORT_INCLUDE = {
  loan: {
    select: { borrowerId: true, loanId: true, sourceBatchId: true },
  },
} as const;

// Streams verified loans to the response in paged chunks, writing each row as it is read.
async function streamVerifiedLoanExport(
  res: Response,
  options: { batchId?: string; exportFormat: "csv" | "json" },
  where: Record<string, unknown>
): Promise<number> {
  const { exportFormat } = options;
  // Copy the filter so later pagination reuses the caller's original conditions.
  const whereForExport = { ...where } as Record<string, unknown>;
  // Fetch the first page of up to 5000 rows to seed the stream.
  const firstPage = await prisma.verifiedLoan.findMany({
    include: EXPORT_INCLUDE,
    orderBy: { verifiedAt: "desc" },
    skip: 0,
    take: EXPORT_PAGE_SIZE,
    where: whereForExport as never,
  });

  let totalExported = firstPage.length;
  // If a full page came back, more pages almost certainly exist to follow.
  const hasMore = firstPage.length === EXPORT_PAGE_SIZE;

  // Date-stamp the filename so each export drops into a distinct archive file.
  const dateStr = new Date().toISOString().slice(0, 10);
  if (exportFormat === "json") {
    res.setHeader("Content-Type", "application/json");
  } else {
    res.setHeader("Content-Type", "text/csv");
  }
  // Attachment disposition forces a download rather than inline browser rendering.
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="verified_loans_${dateStr}.${exportFormat}"`
  );

  // Track whether the first item was written so JSON arrays get correct comma separation.
  let first = true;
  // Serialize and write one verified loan; JSON gets comma-separated objects, CSV gets lines.
  const writeItem = (vl: unknown) => {
    if (exportFormat === "json") {
      if (!first) {
        res.write(","); // JSON array element separator after the first item.
      }
      first = false;
      res.write(JSON.stringify(flattenVerifiedLoanForJson(vl as never)));
    } else {
      res.write(
        `${flattenVerifiedLoanForCsv(vl as unknown as Parameters<typeof flattenVerifiedLoanForCsv>[0])}\n`
      );
    }
  };

  if (exportFormat === "json") {
    res.write("["); // Open the JSON top-level array.
  } else {
    res.write(`${CSV_COLUMNS.join(",")}\n`); // CSV header row first.
  }
  // Write out the already-fetched first page.
  for (const vl of firstPage) {
    writeItem(vl);
  }

  if (hasMore) {
    // Walk remaining pages by increasing skip offsets until a short page signals the end.
    let offset = EXPORT_PAGE_SIZE;
    while (true) {
      const page = await prisma.verifiedLoan.findMany({
        include: EXPORT_INCLUDE,
        orderBy: { verifiedAt: "desc" },
        skip: offset,
        take: EXPORT_PAGE_SIZE,
        where: whereForExport as never,
      });
      if (page.length === 0) {
        break; // No more rows to fetch.
      }
      for (const vl of page) {
        writeItem(vl);
      }
      totalExported += page.length;
      if (page.length < EXPORT_PAGE_SIZE) {
        break; // Last partial page reached, stop iterating.
      }
      offset += EXPORT_PAGE_SIZE;
    }
  }

  if (exportFormat === "json") {
    res.write("]"); // Close the JSON array.
  }
  res.end(); // Finalize the response so the client sees the complete streamed file.
  return totalExported; // Report the count so the caller can log RECORD_EXPORTED.
}

// GET /export endpoint: streams verified loans as an attachment for consumer/reviewer downloads.
router.get(
  "/export",
  requireAuth,
  requireRole("data_consumer", "reviewer"),
  async (req: Request, res: Response): Promise<void> => {
    // Read the optional batchId and format query params directly off the raw query object.
    const { batchId, format } = req.query as {
      batchId?: string;
      format?: string;
    };
    // Only an explicit "json" requests JSON; everything else falls back to CSV.
    const exportFormat = format === "json" ? "json" : "csv";

    if (batchId) {
      // When scoping to a batch, its id must be a real cuid before filtering.
      const parsed = CUID_SCHEMA.safeParse(batchId);
      if (!parsed.success) {
        res.status(400).json({
          code: "BAD_REQUEST",
          error: "Invalid batchId",
          fields: { batchId: "Must be a valid cuid" },
        });
        return;
      }
    }

    const { user } = req;
    // requireAuth already ran; narrow the type and stay fail-closed.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const where: Record<string, unknown> = {};
    if (batchId) {
      where.loan = { sourceBatchId: batchId }; // Relation filter down to one source batch.
    }

    // Stream the export; this function writes chunks to the response as pages are fetched.
    const totalExported = await streamVerifiedLoanExport(
      res,
      { batchId, exportFormat },
      where
    );

    // Audit the download so the trail records who exported which data and how many rows.
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        batchId: batchId ?? null,
        eventType: "RECORD_EXPORTED",
        metadata: {
          batchId: batchId ?? null,
          count: totalExported,
          format: exportFormat,
        },
      },
    });
  }
);

// GET / list endpoint: paged verified loans for consumer/reviewer, with an overall quality score.
router.get(
  "/",
  requireAuth,
  requireRole("data_consumer", "reviewer"),
  async (req: Request, res: Response): Promise<void> => {
    // Validate query params (page, limit, validationResult, aiRecommendationUsed, search, batchId).
    const parsed = verifiedLoanListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid query",
        fields: mapZodIssuesToFields(parsed.error.issues),
      });
      return;
    }

    const {
      page,
      limit,
      validationResult,
      aiRecommendationUsed,
      search,
      batchId,
    } = parsed.data;

    // Top-level filters apply to the VerifiedLoan columns themselves.
    const where: Record<string, unknown> = {};
    if (validationResult) {
      where.validationResult = validationResult; // passed/failed from the last validation.
    }
    if (aiRecommendationUsed !== undefined) {
      where.aiRecommendationUsed = aiRecommendationUsed; // Whether an AI rec was used.
    }

    // Loan-relation filters build separately and attach only when present.
    const loanWhere: Record<string, unknown> = {};
    if (search) {
      loanWhere.loanId = { contains: search, mode: "insensitive" };
    }
    if (batchId) {
      loanWhere.sourceBatchId = batchId;
    }
    if (Object.keys(loanWhere).length > 0) {
      where.loan = loanWhere;
    }

    const skip = (page - 1) * limit;

    // Run four queries concurrently: filtered page count, total loans, the page, and global verified.
    const [total, totalImported, verifiedLoans, globalVerified] =
      await Promise.all([
        prisma.verifiedLoan.count({ where: where as never }),
        prisma.loan.count(), // All imported loans, used as the quality denominator.
        prisma.verifiedLoan.findMany({
          include: {
            loan: { select: { borrowerId: true, loanId: true } }, // Loan identity for the card.
          },
          orderBy: { verifiedAt: "desc" },
          skip,
          take: limit,
          where: where as never,
        }),
        prisma.verifiedLoan.count(), // Globally verified count for the quality score.
      ]);

    // qualityScore = verified/total, rounded to two decimals; 0 when nothing was imported.
    const realQualityScore =
      totalImported > 0
        ? Math.round((globalVerified / totalImported) * 100 * 100) / 100
        : 0;

    // Project verified rows to the compact shape consumers consume.
    const data = verifiedLoans.map((vl) => ({
      aiRecommendationUsed: vl.aiRecommendationUsed,
      id: vl.id,
      loan: {
        borrowerId: vl.loan.borrowerId,
        loanId: vl.loan.loanId,
      },
      loanId: vl.loanId,
      recordHash: vl.recordHash, // Provenance fingerprint for downstream audits.
      reviewerDecision: vl.reviewerDecision,
      sourceBatchRef: vl.sourceBatchRef,
      validationResult: vl.validationResult,
      verifiedAt: vl.verifiedAt.toISOString(),
      verifiedById: vl.verifiedById,
    }));

    res.json({
      data,
      pagination: {
        limit,
        page,
        total,
        totalPages: Math.ceil(total / limit),
      },
      qualityScore: realQualityScore,
    });
  }
);

// GET /:id detail endpoint: one verified loan plus the AI decision context reconstructed from logs.
router.get(
  "/:id",
  requireAuth,
  requireRole("data_consumer", "reviewer"),
  async (req: Request, res: Response): Promise<void> => {
    const rawId = (req.params as { id: string }).id;
    // Validate the verified loan id path param as a cuid.
    const parsedId = CUID_SCHEMA.safeParse(rawId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid verified loan id",
        fields: { id: "Must be a valid cuid" },
      });
      return;
    }

    // Load the verified record, including the reviewer's display name when one is stored.
    const verified = await prisma.verifiedLoan.findUnique({
      include: {
        verifiedBy: { select: { name: true } },
      },
      where: { id: parsedId.data },
    });

    if (!verified) {
      res
        .status(404)
        .json({ code: "NOT_FOUND", error: "Verified loan not found" });
      return;
    }

    // Reviewer decision context + AI recommendation outcome come from the
    // loan's audit trail (same source as the audit viewer) — newest first.
    const decisionLogs = await prisma.auditLog.findMany({
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5, // Only the latest few events are needed for the context pane.
      where: {
        eventType: {
          in: ["LOAN_APPROVED", "LOAN_REJECTED", "AI_RECOMMENDATION"],
        },
        loanId: verified.loanId, // Audit rows identify their loan by the original loanId.
      },
    });

    // Locate the most recent approve/reject log to expose reviewer decision + note.
    const decisionLog = decisionLogs.find(
      (log) =>
        log.eventType === "LOAN_APPROVED" || log.eventType === "LOAN_REJECTED"
    );
    // Locate the latest AI recommendation audit event separately.
    const aiLog = decisionLogs.find(
      (log) => log.eventType === "AI_RECOMMENDATION"
    );
    // Read the AI outcome (accepted/edited/rejected) from that audit event's metadata.
    const aiMeta = (aiLog?.metadata ?? {}) as {
      aiDecision?: "accepted" | "edited" | "rejected";
    };

    // Original suggestion: latest AI_RECOMMENDATION recommendation stored on
    // the loan's exceptions, matched to the audit decision when present.
    const exceptionWithRec = await prisma.exception.findFirst({
      orderBy: { updatedAt: "desc" }, // Most recently updated exception with a stored suggestion.
      where: {
        aiRecommendation: { not: {} }, // Only rows that actually carry an AI recommendation object.
        loanId: verified.loanId,
      },
    });

    res.json({
      aiDecision: aiMeta.aiDecision ?? null,
      aiRecommendation: (exceptionWithRec?.aiRecommendation as unknown) ?? null,
      aiRecommendationUsed: verified.aiRecommendationUsed,
      canonicalData: verified.canonicalData as unknown, // Stored canonical verification snapshot.
      id: verified.id,
      loanId: verified.loanId,
      recordHash: verified.recordHash,
      reviewerDecision: verified.reviewerDecision,
      reviewerNote: decisionLog
        ? String(
            (decisionLog.metadata as { note?: unknown } | null)?.note ?? ""
          ) || null // Pull the note out of the decision audit metadata, else null.
        : null,
      sourceBatchRef: verified.sourceBatchRef,
      validationResult: verified.validationResult,
      verifiedAt: verified.verifiedAt.toISOString(),
      verifiedById: verified.verifiedById,
      verifiedByName: verified.verifiedBy?.name ?? null,
    });
  }
);

export default router;
