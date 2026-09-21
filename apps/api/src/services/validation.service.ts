// Imports the Prisma client and the shared validation threshold configuration.
import { prisma } from "../lib/prisma.js";
import {
  defaultThresholds,
  type ValidationThresholds,
} from "../lib/validation-thresholds.js";

// Validation reads and persists 5,000 loans at a time to keep queries and transactions bounded.
export const VALIDATION_CHUNK_SIZE = 5000;

// Shape of one rule violation produced by the per-loan checks.
export interface ValidationException {
  exceptionType: string;
  field: string | null;
  message: string;
  severity: string;
}

// The 50 official US state codes plus DC; anything else is treated as an invalid borrower state.
const VALID_US_STATES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

// Structural subset of a loan used by the per-loan rule checks; keeps tests easy to construct.
interface LoanLike {
  borrowerId: string | null;
  borrowerState: string | null;
  currentBalance: unknown;
  daysPastDue: number | null;
  documentStatus: string | null;
  id: string;
  interestRate: unknown;
  lastUpdatedAt: Date | null;
  loanId: string | null;
  maturityDate: Date | null;
  originalPrincipal: unknown;
  originationDate: Date | null;
  paymentStatus: string | null;
  sourceBatchId: string;
}

// Converts Prisma's numeric (Decimal) field values into plain JS numbers for comparisons.
const decimalToNumber = (value: unknown): number | null => {
  // Nullish cells mean "missing" and are not passed to the numeric rules.
  if (value === null || value === undefined) {
    return null;
  }
  // Plain numbers (unit tests, already-parsed values) pass through untouched.
  if (typeof value === "number") {
    return value;
  }
  const n = Number(String(value));
  // Reject garbage so a bad value reads as missing instead of poisoning the rules.
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    return null;
  }
  return n;
};

// Produces a canonical string key for an original-principal value so combos compare consistently.
const toPrincipalKey = (value: unknown): string => {
  const num = decimalToNumber(value);
  if (num !== null) {
    // Numeric values resolve to their string form so 1000 and 1000.0 match.
    return String(num);
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
};

// Builds the borrower+principal+date identity key; identical combos across rows signal duplicates.
const buildBorrowerComboKey = (
  borrowerId: string,
  originalPrincipal: unknown,
  originationDate: Date | null
): string =>
  `${borrowerId}|${toPrincipalKey(originalPrincipal)}|${originationDate?.toISOString() ?? ""}`;

// Flags maturity dates that fall before origination, an impossible loan contract.
const checkDateRules = (
  loan: LoanLike,
  exceptions: ValidationException[]
): void => {
  // Skip if either date is missing; a separate missing-field rule covers presence.
  if (!(loan.originationDate && loan.maturityDate)) {
    return;
  }
  // Maturity on or after origination is the valid ordering, so nothing to flag.
  if (loan.maturityDate.getTime() >= loan.originationDate.getTime()) {
    return;
  }
  exceptions.push({
    exceptionType: "date_error",
    field: "maturityDate",
    message: "maturity_date is before origination_date",
    severity: "high",
  });
};

// Flags negative principal and a current balance that exceeds the original principal.
const checkBalanceRules = (
  principal: number | null,
  balance: number | null,
  exceptions: ValidationException[]
): void => {
  // Negative principal is impossible and is always a critical data error.
  if (principal !== null && principal < 0) {
    exceptions.push({
      exceptionType: "balance_error",
      field: "originalPrincipal",
      message: "original_principal is negative",
      severity: "critical",
    });
  }
  // A balance growing beyond the original principal implies bad servicing math.
  if (
    principal !== null &&
    balance !== null &&
    principal >= 0 &&
    balance > principal
  ) {
    exceptions.push({
      exceptionType: "balance_error",
      field: "currentBalance",
      message: "current_balance exceeds original_principal",
      severity: "critical",
    });
  }
};

// Flags interest rates that fall outside the configured [min, max] band.
const checkRateRule = (
  loan: LoanLike,
  thresholds: ValidationThresholds,
  exceptions: ValidationException[]
): void => {
  const rate = decimalToNumber(loan.interestRate);
  // No rate value means unknown, which is not an out-of-range condition.
  if (rate === null) {
    return;
  }
  // In-band rates are fine; only genuinely out-of-range rates get flagged.
  if (
    rate >= thresholds.interestRateMin &&
    rate <= thresholds.interestRateMax
  ) {
    return;
  }
  exceptions.push({
    exceptionType: "rate_out_of_range",
    field: "interestRate",
    message: `interest_rate ${rate} outside range [${thresholds.interestRateMin}, ${thresholds.interestRateMax}]`,
    severity: "high",
  });
};

// Checks payment_status against days_past_due and balance for internally impossible states.
const checkPaymentRules = (
  loan: LoanLike,
  balance: number | null,
  exceptions: ValidationException[]
): void => {
  // Only enforce status/dpd consistency when both halves of the signal exist.
  if (loan.paymentStatus && loan.daysPastDue !== null) {
    const status = loan.paymentStatus.toLowerCase();
    const dpd = loan.daysPastDue;
    // "current" but with overdue months is contradictory.
    if (status === "current" && dpd > 0) {
      exceptions.push({
        exceptionType: "status_inconsistency",
        field: "paymentStatus",
        message: "payment_status current but days_past_due > 0",
        severity: "medium",
      });
      // "delinquent"/"late" but zero days past due is likewise impossible.
    } else if ((status === "delinquent" || status === "late") && dpd === 0) {
      exceptions.push({
        exceptionType: "status_inconsistency",
        field: "paymentStatus",
        message: `payment_status ${status} but days_past_due is 0`,
        severity: "medium",
      });
    }
  }

  // A closed loan must be fully paid; a remaining balance contradicts closure.
  if (
    loan.paymentStatus &&
    loan.paymentStatus.toLowerCase() === "closed" &&
    balance !== null &&
    balance > 0
  ) {
    exceptions.push({
      exceptionType: "status_inconsistency",
      field: "currentBalance",
      message: "loan is closed but current_balance > 0",
      severity: "medium",
    });
  }
};

// Runs the full set of per-loan validation rules and returns any violations found.
export const runPerLoanRules = (
  loan: LoanLike,
  thresholds: ValidationThresholds = defaultThresholds
): ValidationException[] => {
  // Accumulates every violation discovered for this single loan.
  const exceptions: ValidationException[] = [];

  // loan_id is the identity anchor across the workflow; missing it is critical.
  if (!loan.loanId) {
    exceptions.push({
      exceptionType: "missing_field",
      field: "loanId",
      message: "loan_id is required",
      severity: "critical",
    });
  }

  checkDateRules(loan, exceptions);

  // Convert the numeric columns once and feed them to the balance/rate/payment rules.
  const principal = decimalToNumber(loan.originalPrincipal);
  const balance = decimalToNumber(loan.currentBalance);
  checkBalanceRules(principal, balance, exceptions);
  checkRateRule(loan, thresholds, exceptions);
  checkPaymentRules(loan, balance, exceptions);

  // document_status drives the downstream document-manifest flow, so it is required.
  if (!loan.documentStatus) {
    exceptions.push({
      exceptionType: "missing_field",
      field: "documentStatus",
      message: "document_status is required",
      severity: "high",
    });
  }

  if (loan.lastUpdatedAt) {
    // Convert age into whole days for the staleness comparison.
    const daysAgo =
      (Date.now() - loan.lastUpdatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo > thresholds.staleDaysThreshold) {
      exceptions.push({
        exceptionType: "stale_record",
        field: "lastUpdatedAt",
        message: `record is stale (last_updated_at ${Math.floor(daysAgo)} days ago)`,
        // Staleness is a warning, not a data-integrity blocker.
        severity: "low",
      });
    }
  }

  if (loan.borrowerState) {
    // Normalize to uppercase before checking against the official state list.
    const state = loan.borrowerState.toUpperCase().trim();
    if (!VALID_US_STATES.has(state)) {
      exceptions.push({
        exceptionType: "invalid_state",
        field: "borrowerState",
        message: `borrower_state ${loan.borrowerState} is not a valid US state code`,
        severity: "medium",
      });
    }
  }

  return exceptions;
};

// Aggregated data for batch-level duplicate detection across all of a batch's loans.
interface BatchDuplicateSets {
  borrowerCounts: Map<string, number>;
  duplicateCombos: Set<string>;
  duplicateLoanIds: Set<string>;
  spikedBorrowers: Set<string>;
}

// Scans the whole batch in chunks and builds the duplicate/spike detection sets.
const collectBatchDuplicateSets = async (
  batchId: string,
  thresholds: ValidationThresholds
): Promise<BatchDuplicateSets> => {
  const loanIdCounts = new Map<string, number>();
  const borrowerComboCounts = new Map<string, number>();
  const borrowerCounts = new Map<string, number>();
  // Offset for windowed reads; incremented once a chunk is consumed.
  let countSkip = 0;
  // Paged while-loop fetches all loans without loading the batch into memory at once.
  while (true) {
    const loans: {
      borrowerId: string | null;
      id: string;
      loanId: string | null;
      originalPrincipal: unknown;
      originationDate: Date | null;
    }[] = (await prisma.loan.findMany({
      // Row order is stable so paging cannot skip or duplicate rows between windows.
      orderBy: { sourceRowNumber: "asc" },
      select: {
        borrowerId: true,
        id: true,
        loanId: true,
        originalPrincipal: true,
        originationDate: true,
      },
      skip: countSkip,
      take: VALIDATION_CHUNK_SIZE,
      where: { sourceBatchId: batchId },
    })) as unknown as {
      borrowerId: string | null;
      id: string;
      loanId: string | null;
      originalPrincipal: unknown;
      originationDate: Date | null;
    }[];
    // An empty page means the batch is fully consumed.
    if (loans.length === 0) {
      break;
    }
    for (const loan of loans) {
      if (loan.loanId) {
        loanIdCounts.set(loan.loanId, (loanIdCounts.get(loan.loanId) ?? 0) + 1);
      }
      if (loan.borrowerId) {
        const comboKey = buildBorrowerComboKey(
          loan.borrowerId,
          loan.originalPrincipal,
          loan.originationDate
        );
        borrowerComboCounts.set(
          comboKey,
          (borrowerComboCounts.get(comboKey) ?? 0) + 1
        );
        borrowerCounts.set(
          loan.borrowerId,
          (borrowerCounts.get(loan.borrowerId) ?? 0) + 1
        );
      }
    }
    // A short page is the last one; stop paging.
    if (loans.length < VALIDATION_CHUNK_SIZE) {
      break;
    }
    countSkip += VALIDATION_CHUNK_SIZE;
  }
  return {
    borrowerCounts,
    // Any borrower combo seen twice or more is a likely duplicate loan.
    duplicateCombos: new Set(
      [...borrowerComboCounts.entries()]
        .filter(([, c]) => c > 1)
        .map(([k]) => k)
    ),
    duplicateLoanIds: new Set(
      [...loanIdCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id)
    ),
    // Borrowers appearing more than the threshold flag a possible data spike.
    spikedBorrowers: new Set(
      [...borrowerCounts.entries()]
        .filter(([, c]) => c > thresholds.duplicateBorrowerThreshold)
        .map(([id]) => id)
    ),
  };
};

// Orchestrates validation: collects duplicate sets, then processes every loan in chunks.
export const runBatch = async (
  batchId: string,
  thresholds: ValidationThresholds = defaultThresholds
): Promise<{ exceptionCount: number; loanCount: number }> => {
  let exceptionCount = 0;
  let loanCount = 0;

  // Batch-level duplicates must be known before the per-loan rules can tag them.
  const duplicateSets = await collectBatchDuplicateSets(batchId, thresholds);

  let skip = 0;
  // Page through loans until a chunk signals it was the last one.
  while (true) {
    const chunkResult = await processValidationChunk(
      batchId,
      skip,
      duplicateSets,
      thresholds
    );
    if (chunkResult === null) {
      break;
    }
    exceptionCount += chunkResult.exceptionCount;
    loanCount += chunkResult.loanCount;
    if (chunkResult.isLast) {
      break;
    }
    skip += VALIDATION_CHUNK_SIZE;
  }

  return { exceptionCount, loanCount };
};

// Validates one 5,000-loan window, tagging duplicates from the precomputed sets.
const processValidationChunk = async (
  batchId: string,
  skip: number,
  duplicateSets: BatchDuplicateSets,
  thresholds: ValidationThresholds
): Promise<{
  exceptionCount: number;
  isLast: boolean;
  loanCount: number;
} | null> => {
  const loans = await prisma.loan.findMany({
    // Stable ordering keeps paging deterministic and chunk windows non-overlapping.
    orderBy: [{ sourceRowNumber: "asc" }, { id: "asc" }],
    skip,
    take: VALIDATION_CHUNK_SIZE,
    where: { sourceBatchId: batchId },
  });
  // An empty read signals the batch is exhausted; null tells runBatch to stop.
  if (loans.length === 0) {
    return null;
  }

  const { duplicateLoanIds, duplicateCombos, spikedBorrowers, borrowerCounts } =
    duplicateSets;

  const allExceptions: Array<{
    exceptionType: string;
    field: string | null;
    loanId: string;
    message: string;
    severity: string;
  }> = [];
  const loanStatusUpdates: Array<{ id: string; status: string }> = [];

  for (const loan of loans) {
    const perLoan = runPerLoanRules(loan as unknown as LoanLike, thresholds);

    // A loanId seen multiple times in the batch is a hard duplicate.
    if (loan.loanId && duplicateLoanIds.has(loan.loanId)) {
      perLoan.push({
        exceptionType: "duplicate",
        field: "loanId",
        message: `duplicate loan_id ${loan.loanId}`,
        severity: "critical",
      });
    }

    if (loan.borrowerId) {
      const comboKey = buildBorrowerComboKey(
        loan.borrowerId,
        loan.originalPrincipal,
        loan.originationDate
      );
      // Same borrower+principal+date combo twice is a likely duplicate.
      if (duplicateCombos.has(comboKey)) {
        perLoan.push({
          exceptionType: "duplicate",
          field: "borrowerId",
          message: `duplicate borrower combo ${loan.borrowerId}`,
          severity: "critical",
        });
      }
      // A borrower beyond the spike threshold may indicate concentrated risk.
      if (spikedBorrowers.has(loan.borrowerId)) {
        perLoan.push({
          exceptionType: "duplicate",
          field: "borrowerId",
          message: `borrower ${loan.borrowerId} appears ${borrowerCounts.get(loan.borrowerId)} times (threshold ${thresholds.duplicateBorrowerThreshold})`,
          severity: "critical",
        });
      }
    }

    if (perLoan.length > 0) {
      // Flatten this loan's violations into the chunk-level insert list.
      for (const exc of perLoan) {
        allExceptions.push({
          exceptionType: exc.exceptionType,
          field: exc.field,
          loanId: loan.id,
          message: exc.message,
          severity: exc.severity,
        });
      }
      loanStatusUpdates.push({ id: loan.id, status: "failed" });
    } else {
      loanStatusUpdates.push({ id: loan.id, status: "passed" });
    }
  }

  await persistValidationChunk(
    batchId,
    loans.length,
    allExceptions,
    loanStatusUpdates
  );

  return {
    exceptionCount: allExceptions.length,
    isLast: loans.length < VALIDATION_CHUNK_SIZE,
    loanCount: loans.length,
  };
};

// Persists exception rows, loan validation statuses, and the VALIDATION_RUN audit atomically.
const persistValidationChunk = async (
  batchId: string,
  loansLength: number,
  allExceptions: Array<{
    exceptionType: string;
    field: string | null;
    loanId: string;
    message: string;
    severity: string;
  }>,
  loanStatusUpdates: Array<{ id: string; status: string }>
): Promise<void> => {
  const failedIds = loanStatusUpdates
    .filter((u) => u.status === "failed")
    .map((u) => u.id);
  const passedIds = loanStatusUpdates
    .filter((u) => u.status === "passed")
    .map((u) => u.id);

  await prisma.$transaction(async (tx) => {
    if (allExceptions.length > 0) {
      // Bulk-insert exception rows; all start open for reviewer triage.
      await tx.exception.createMany({
        data: allExceptions.map((exc) => ({
          exceptionType: exc.exceptionType,
          field: exc.field,
          loanId: exc.loanId,
          message: exc.message,
          severity: exc.severity,
          status: "open",
        })),
      });
    }
    if (failedIds.length > 0) {
      await (
        tx.loan as unknown as {
          updateMany: (args: unknown) => Promise<unknown>;
        }
      ).updateMany({
        // Flag failed loans so the review queue can filter them instantly.
        data: { validationStatus: "failed" },
        where: { id: { in: failedIds } },
      });
    }
    if (passedIds.length > 0) {
      await (
        tx.loan as unknown as {
          updateMany: (args: unknown) => Promise<unknown>;
        }
      ).updateMany({
        data: { validationStatus: "passed" },
        where: { id: { in: passedIds } },
      });
    }
    await tx.auditLog.create({
      data: {
        batchId,
        eventType: "VALIDATION_RUN",
        metadata: {
          exceptionCount: allExceptions.length,
          loanCount: loansLength,
        },
      },
    });
  });
};

// Entry point: marks the batch validating, runs rules unless already done, then closes the stage.
export const validateBatch = async (batchId: string): Promise<void> => {
  process.stdout.write(
    `[Validation] Batch ${batchId}: Starting automated validation checks...\n`
  );
  try {
    const batchBefore = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });
    const metaBefore =
      (batchBefore?.metadata as Record<string, unknown> | null) ?? {};
    // Publish the validating stage before any rule work so the UI reflects the live state.
    await prisma.uploadBatch.update({
      data: {
        metadata: {
          ...metaBefore,
          pipelineStage: "validating",
          pipelineStep: 4,
          stageMessage:
            "Running automated validation rules and duplicate checks...",
        },
      },
      where: { id: batchId },
    });
  } catch {
    // ignore
  }

  // Idempotency guard: if exception rows already exist for this batch, skip re-running.
  const existingExceptions = await prisma.exception.count({
    where: { loan: { sourceBatchId: batchId } },
  });
  if (existingExceptions > 0) {
    process.stdout.write(
      `[Validation] Batch ${batchId}: Exceptions already computed (${existingExceptions}), skipping.\n`
    );
  } else {
    await runBatch(batchId);
  }

  try {
    const batchAfter = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });
    const metaAfter =
      (batchAfter?.metadata as Record<string, unknown> | null) ?? {};
    // Validation finished: advance the batch to completed/done for the next stage.
    await prisma.uploadBatch.update({
      data: {
        metadata: {
          ...metaAfter,
          pipelineStage: "completed",
          pipelineStep: 5,
          stageMessage:
            "Ingestion and automated validation completed successfully.",
        },
        status: "done",
      },
      where: { id: batchId },
    });
  } catch {
    // ignore
  }

  process.stdout.write(
    `[Validation] Batch ${batchId}: Completed validation checks.\n`
  );
};
