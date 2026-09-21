// Imports the Prisma client only; conflict detection is pure DB reads plus comparison logic.
import { prisma } from "../lib/prisma.js";

// Conflict comparison processes servicer rows in windows of 5,000 to bound memory.
export const CHUNK_SIZE = 5000;

// The fields on which a servicer update can disagree with the original loan tape.
const COMPARABLE_FIELDS = [
  "originalPrincipal",
  "currentBalance",
  "interestRate",
  "termMonths",
  "daysPastDue",
  "paymentStatus",
  "borrowerState",
  "creditGrade",
  "servicerName",
  "documentStatus",
] as const;

// Type-level union of the comparable field names for the row shapes below.
type ComparableField = (typeof COMPARABLE_FIELDS)[number];

// Of the comparable fields, the ones that represent numeric values for comparison.
const numericFields = new Set<string>([
  "originalPrincipal",
  "currentBalance",
  "interestRate",
  "termMonths",
  "daysPastDue",
]);

// Normalizes a value to a comparable string; numeric fields parse so "1,000" equals 1000.
const normalizeForCompare = (value: unknown, field: string): string | null => {
  // Nullish is "missing" and compares specially rather than as a value.
  if (value === null || value === undefined) {
    return null;
  }
  // Dates canonicalize to UTC ISO so identical instants always match.
  if (value instanceof Date) {
    return value.toISOString();
  }
  const raw = String(value).trim();
  if (raw === "") {
    return null;
  }
  if (numericFields.has(field)) {
    // Strip thousands separators so formatted and raw numerics align.
    const n = Number(raw.replace(/,/g, ""));
    // Non-numeric garbage falls back to a lowercase string comparison.
    if (Number.isNaN(n) || !Number.isFinite(n)) {
      return raw.toLowerCase();
    }
    return String(n);
  }
  return raw.toLowerCase();
};

// Decides whether two field values genuinely differ after normalization.
const valuesDiffer = (a: unknown, b: unknown, field: string): boolean => {
  const na = normalizeForCompare(a, field);
  const nb = normalizeForCompare(b, field);
  // Both missing is agreement, not a conflict.
  if (na === null && nb === null) {
    return false;
  }
  // One side present and the other missing is a divergence worth flagging.
  if (na === null || nb === null) {
    return true;
  }
  return na !== nb;
};

// A servicer-update loan row plus the comparable fields projected from the DB.
type ServicerLoanRow = {
  id: string;
  loanId: string | null;
  sourceRowNumber: number;
} & Record<ComparableField, unknown>;

// A loan-tape row with the comparable fields needed for the baseline comparison.
type TapeLoanRow = {
  id: string;
  loanId: string | null;
} & Record<ComparableField, unknown>;

// Finds per-field conflicts between a servicer_update batch and the original loan tape loans.
export const detectServicerConflicts = async (
  servicerBatchId: string
): Promise<{
  exceptionsCreated: number;
  loansAffected: number;
  matchedRows: number;
  unmatchedLoanIds: number;
}> => {
  // Load the servicer batch so we can verify its type and read prior-stage metadata.
  const batch = await prisma.uploadBatch.findUnique({
    where: { id: servicerBatchId },
  });
  if (!batch) {
    throw new Error(`Batch ${servicerBatchId} not found`);
  }
  // Only servicer_update uploads flow through conflict detection; other types no-op.
  if (batch.fileType !== "servicer_update") {
    return {
      exceptionsCreated: 0,
      loansAffected: 0,
      matchedRows: 0,
      unmatchedLoanIds: 0,
    };
  }

  const existingMeta = (batch.metadata as Record<string, unknown> | null) ?? {};

  // Idempotency: a prior completed run returns its stored results instead of running again.
  if (existingMeta.conflictStage === "done") {
    process.stdout.write(
      `[Conflict] Batch ${servicerBatchId}: already completed, skipping.\n`
    );
    return {
      exceptionsCreated:
        (existingMeta.conflictExceptionsCreated as number | undefined) ?? 0,
      loansAffected:
        (existingMeta.conflictLoansAffected as number | undefined) ?? 0,
      matchedRows:
        (existingMeta.conflictMatchedRows as number | undefined) ?? 0,
      unmatchedLoanIds:
        (existingMeta.conflictUnmatchedLoanIds as number | undefined) ?? 0,
    };
  }

  // A stage left at "detecting" means a prior run crashed mid-flight.
  if (existingMeta.conflictStage === "detecting") {
    process.stdout.write(
      `[Conflict] Batch ${servicerBatchId}: cleaning orphaned conflicts from prior run.\n`
    );
    try {
      // Delete only open, unreviewed conflicts left over from the interrupted run.
      await prisma.exception.deleteMany({
        where: {
          exceptionType: "conflicting_source",
          metadata: {
            equals: servicerBatchId,
            path: ["conflictBatchId"],
          },
          reviewerId: null,
          status: "open",
        } as never,
      });
    } catch {
      // best-effort cleanup
    }
  }

  try {
    // Mark the stage detecting so a crash can be detected and cleaned next run.
    await prisma.uploadBatch.update({
      data: {
        metadata: {
          ...existingMeta,
          conflictStage: "detecting",
        } as never,
      },
      where: { id: servicerBatchId },
    });
  } catch {
    // proceed anyway
  }

  const servicerSelect: Record<string, boolean> = {
    id: true,
    loanId: true,
    sourceRowNumber: true,
  };
  // Project every comparable field onto servicer rows.
  for (const f of COMPARABLE_FIELDS) {
    servicerSelect[f] = true;
  }

  const tapeSelect: Record<string, boolean> = {
    id: true,
    loanId: true,
  };
  for (const f of COMPARABLE_FIELDS) {
    tapeSelect[f] = true;
  }

  let skip = 0;
  let totalExceptions = 0;
  let totalLoansAffected = 0;
  let totalMatched = 0;
  let totalUnmatched = 0;
  // De-duplicates affected loan ids for the final "loans with conflicts" count.
  const affectedLoanIds = new Set<string>();

  // Page over servicer rows in chunks until the batch is exhausted.
  while (true) {
    const servicerRows = (await prisma.loan.findMany({
      // Stable ordering keeps chunk boundaries deterministic.
      orderBy: { sourceRowNumber: "asc" },
      select: servicerSelect as never,
      skip,
      take: CHUNK_SIZE,
      where: { sourceBatchId: servicerBatchId },
    })) as unknown as ServicerLoanRow[];

    if (servicerRows.length === 0) {
      break;
    }

    // Collect the distinct trimmed loanIds present in this servicer window.
    const loanIds = [
      ...new Set(
        servicerRows
          .map((r) => r.loanId?.trim())
          .filter((id): id is string => Boolean(id))
      ),
    ];

    if (loanIds.length === 0) {
      // Window had no usable ids; advance and continue or stop at the end.
      skip += CHUNK_SIZE;
      if (servicerRows.length < CHUNK_SIZE) {
        break;
      }
      continue;
    }

    // Pull matching tape rows; ordering by newest createdAt keeps the latest tape row.
    const tapeRows = (await prisma.loan.findMany({
      orderBy: { createdAt: "desc" },
      select: tapeSelect as never,
      where: {
        loanId: { in: loanIds },
        sourceBatch: { fileType: "loan_tape" },
      },
    })) as unknown as TapeLoanRow[];

    const tapeByLoanId = new Map<string, TapeLoanRow>();
    for (const row of tapeRows) {
      const key = row.loanId?.trim();
      // First row wins, which is the most recent tape row due to the ordering.
      if (key && !tapeByLoanId.has(key)) {
        tapeByLoanId.set(key, row);
      }
    }

    const exceptionsToCreate: Array<{
      exceptionType: string;
      field: string;
      loanId: string;
      message: string;
      metadata: Record<string, unknown>;
      severity: string;
      status: string;
    }> = [];

    for (const sRow of servicerRows) {
      const loanId = sRow.loanId?.trim();
      if (!loanId) {
        continue;
      }
      const tapeRow = tapeByLoanId.get(loanId);
      if (!tapeRow) {
        // No tape match for this id; counted as unmatched, not an exception.
        totalUnmatched += 1;
        continue;
      }
      totalMatched += 1;

      for (const field of COMPARABLE_FIELDS) {
        const sVal = sRow[field];
        const tVal = tapeRow[field];
        if (!valuesDiffer(tVal, sVal, field)) {
          continue;
        }

        const tStr =
          tVal === null || tVal === undefined ? "null" : String(tVal);
        const sStr =
          sVal === null || sVal === undefined ? "null" : String(sVal);

        // The exception is raised against the ORIGINAL tape loan, carrying conflict metadata.
        exceptionsToCreate.push({
          exceptionType: "conflicting_source",
          field,
          loanId: tapeRow.id,
          message: `servicer_update reports ${field}='${sStr}' but loan tape has '${tStr}'`,
          metadata: {
            conflictBatchId: servicerBatchId,
            conflictField: field,
            sourceFileType: "servicer_update",
            sourceLoanRow: sRow.id,
            sourceRowNumber: sRow.sourceRowNumber,
            sourceValue: sVal === undefined ? null : sVal,
            targetValue: tVal === undefined ? null : tVal,
          },
          severity: "high",
          status: "open",
        });
      }
    }

    if (exceptionsToCreate.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          const createdExceptions = await tx.exception.createManyAndReturn({
            data: exceptionsToCreate as never,
            select: { id: true, loanId: true },
            skipDuplicates: false,
          });

          // Audit each created exception so the review trail is complete.
          if (createdExceptions.length > 0) {
            await tx.auditLog.createMany({
              data: createdExceptions.map((exc) => ({
                eventType: "EXCEPTION_CREATED",
                exceptionId: exc.id,
                loanId: exc.loanId,
                metadata: {
                  conflictBatchId: servicerBatchId,
                  exceptionType: "conflicting_source",
                },
              })) as never,
            });
          }
        },
        // Bulk conflict writes on 5k+ row servicer files exceed the 5s default
        { maxWait: 5000, timeout: 30_000 }
      );

      totalExceptions += exceptionsToCreate.length;
      for (const e of exceptionsToCreate) {
        affectedLoanIds.add(e.loanId);
      }
    }

    skip += CHUNK_SIZE;
    if (servicerRows.length < CHUNK_SIZE) {
      break;
    }
  }

  totalLoansAffected = affectedLoanIds.size;

  try {
    // Persist the final conflict stats back onto the batch metadata.
    const fresh = await prisma.uploadBatch.findUnique({
      where: { id: servicerBatchId },
    });
    const freshMeta = (fresh?.metadata as Record<string, unknown> | null) ?? {};
    await prisma.uploadBatch.update({
      data: {
        metadata: {
          ...freshMeta,
          conflictExceptionsCreated: totalExceptions,
          conflictLoansAffected: totalLoansAffected,
          conflictMatchedRows: totalMatched,
          conflictStage: "done",
          conflictUnmatchedLoanIds: totalUnmatched,
          pipelineStage: "completed",
          stageMessage:
            "Ingestion and servicer conflict detection completed successfully.",
        } as never,
        status: "done",
      },
      where: { id: servicerBatchId },
    });
  } catch {
    // best-effort
  }

  process.stdout.write(
    `[Conflict] Batch ${servicerBatchId}: ${totalExceptions} conflicting_source exceptions across ${totalLoansAffected} loans (${totalMatched} matched, ${totalUnmatched} unmatched).\n`
  );

  return {
    exceptionsCreated: totalExceptions,
    loansAffected: totalLoansAffected,
    matchedRows: totalMatched,
    unmatchedLoanIds: totalUnmatched,
  };
};
