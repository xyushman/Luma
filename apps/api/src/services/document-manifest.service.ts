// Imports Node's fs for streaming, csv-parser for row parsing, Prisma for DB writes, and shared ingestion helpers.
import fs from "node:fs";
import csv from "csv-parser";
import { prisma } from "../lib/prisma.js";
import { cleanString, MAX_FAILED_ROWS_STORED } from "./ingestion.service.js";

// Apply windows stay capped at 5,000 rows while keeping each loan's rows together.
export const MANIFEST_CHUNK_SIZE = 5000;

// Matches a UTF-8 Byte-Order-Mark at the start of a header/cell so it can be stripped.
const BOM_REGEX = /^\uFEFF/;

export const DOCUMENT_STATUS_COMPLETE = "complete";
export const DOCUMENT_STATUS_MISSING = "missing";

/** Minimal normalized representation of one manifest CSV row. */
export interface ManifestRow {
  available: boolean | null;
  documentType: string | null;
  loanId: string;
  rowNumber: number;
}

export interface ManifestFailedRow {
  rawData: string;
  reason: string;
  rowNumber: number;
}

export type NormalizeManifestResult =
  | { failedRow?: never; row: ManifestRow; success: true }
  | { failedRow: ManifestFailedRow; row?: never; success: false };

export interface ManifestDecision {
  documentStatus: string;
  missingDocumentTypes: string[];
  sourceRowNumbers: number[];
}

export interface TapeLoanMatch {
  documentStatus: string | null;
  id: string;
  loanId: string | null;
}

/**
 * Decides the aggregate documentStatus for a tape loan given all its
 * manifest rows: any unavailable document -> missing; otherwise complete.
 */
export const decideManifestStatus = (rows: ManifestRow[]): ManifestDecision => {
  // A loan is only complete if every one of its documents is available.
  const missingDocumentTypes = rows
    .filter((r) => r.available === false)
    .map((r) => r.documentType ?? "unknown");
  return {
    // Any unavailable document forces the whole loan to "missing".
    documentStatus:
      missingDocumentTypes.length > 0
        ? DOCUMENT_STATUS_MISSING
        : DOCUMENT_STATUS_COMPLETE,
    missingDocumentTypes,
    // Source line numbers are retained so the audit trail points back to manifest rows.
    sourceRowNumbers: rows.map((r) => r.rowNumber),
  };
};

/**
 * Returns orphan-cleanup metadata predicates for a replayed manifest batch.
 * Only open, unreviewed exceptions created by a PREVIOUS run of this same
 * manifest batch are eligible for deletion (G3: never touch reviewed state).
 */
export const buildOrphanCleanupWhere = (
  manifestBatchId: string
): Record<string, unknown> => ({
  exceptionType: "missing_field",
  metadata: {
    equals: manifestBatchId,
    path: ["manifestBatchId"],
  },
  reviewerId: null,
  status: "open",
});

const normalizeHeaderKey = (header: string): string =>
  header
    .replace(BOM_REGEX, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

// Parses the available column into a boolean, accepting common truthy/falsy spellings.
const parseAvailable = (raw: unknown): boolean | null => {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  // Truthy spellings: 1/true/y/yes.
  if (["1", "true", "y", "yes"].includes(v)) {
    return true;
  }
  // Falsy spellings: 0/false/n/no.
  if (["0", "false", "n", "no"].includes(v)) {
    return false;
  }
  // Anything else cannot be interpreted as an availability signal.
  return null;
};

export const normalizeManifestRow = (
  raw: Record<string, string>,
  rowNumber: number
): NormalizeManifestResult => {
  // Normalize row keys the same way validateManifestHeaders normalizes
  // header names (review Warn fix): a file passing the header gate with
  // "Loan Id,Document Type,Available" must not fail every row because
  // get() compared against raw BOM-stripped keys only.
  const norm = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [normalizeHeaderKey(key), value])
  );
  // Local helper to read the first non-empty value among alias spellings.
  const get = (...keys: string[]): string => {
    for (const key of keys) {
      const value = norm[key];
      if (value !== undefined && value !== "") {
        return value;
      }
    }
    return "";
  };

  const rawLoanId = cleanString(get("loanid"));
  const documentType = cleanString(get("documenttype", "document"));
  const availableRaw = get("available", "isavailable", "availability");
  const available = parseAvailable(availableRaw);

  // Central failure helper to produce a NormalizeManifestResult for the caller.
  const fail = (reason: string): NormalizeManifestResult => ({
    failedRow: {
      rawData: JSON.stringify(raw),
      reason,
      rowNumber,
    },
    success: false,
  });

  // A manifest row must identify which loan it belongs to.
  if (!rawLoanId) {
    return fail("missing loan_id in manifest row");
  }

  // An unparseable availability value fails the row so it cannot silently be treated as complete.
  if (available === null) {
    return fail(
      `invalid available value "${availableRaw}" (use true/false/y/n/1/0)`
    );
  }

  // Healthy rows become a normalized ManifestRow for later aggregation.
  return {
    row: {
      available,
      documentType,
      loanId: rawLoanId,
      rowNumber,
    },
    success: true,
  };
};

const REQUIRED_LOAN_ID_HEADERS = new Set(["loanid", "loan_id"]);
const REQUIRED_AVAILABLE_HEADERS = new Set([
  "available",
  "isavailable",
  "documentavailable",
  "availability",
]);

// Validates that the manifest CSV carries the two columns the pipeline depends on.
export const validateManifestHeaders = (headers: string[]): string | null => {
  if (headers.length === 0) {
    return null;
  }
  const normalized = headers.map(normalizeHeaderKey);
  const hasLoanId = normalized.some((h) => REQUIRED_LOAN_ID_HEADERS.has(h));
  const hasAvailable = normalized.some((h) =>
    REQUIRED_AVAILABLE_HEADERS.has(h)
  );

  const missingColumns: string[] = [];
  if (!hasLoanId) {
    missingColumns.push("loan_id");
  }
  if (!hasAvailable) {
    missingColumns.push("available");
  }

  if (missingColumns.length > 0) {
    // Return a descriptive message that the caller turns into a batch failure.
    return `CSV header mismatch: file is missing required manifest column(s): ${missingColumns.join(", ")} (found: ${headers.slice(0, 5).join(", ")})`;
  }
  return null;
};

interface ApplyOutcome {
  loansUpdated: number;
  /** businessIds presented whose count minus matched tape rows (duplicates/single-row windows make these differ) */
  matchedLoanIds: number;
  missingLoansCreated: number;
  unmatchedBusinessIds: number;
}

/**
 * Splits complete per-loanId groups into windows whose combined row count
 * stays under MANIFEST_CHUNK_SIZE (E3). A loan's rows are never split:
 * a single larger-than-window group occupies its own window intact.
 */
export const buildApplyWindows = (groups: ManifestRow[][]): ManifestRow[][] => {
  const windows: ManifestRow[][] = [];
  let current: ManifestRow[] = [];
  for (const group of groups) {
    // A group would overflow the window cap: close this window and start fresh.
    if (
      current.length > 0 &&
      current.length + group.length > MANIFEST_CHUNK_SIZE
    ) {
      windows.push(current);
      current = [];
    }
    // Add each row of the group to the open window, never splitting the group.
    for (const row of group) {
      current.push(row);
    }
  }
  // Flush whatever remains once every group has been assigned to a window.
  if (current.length > 0) {
    windows.push(current);
  }
  return windows;
};

interface ChunkOperations {
  exceptionsToCreate: Array<{
    exceptionType: string;
    field: string;
    loanId: string;
    message: string;
    metadata: Record<string, unknown>;
    severity: string;
    status: string;
  }>;
  fieldEditedAuditLogs: Array<{
    eventType: string;
    loanId: string;
    metadata: Record<string, unknown>;
  }>;
  loansByTargetStatus: Map<string, string[]>;
}

// Decides, for every matched loan in this window, what exceptions/status updates to write.
const prepareChunkOperations = (
  byLoanId: Map<string, ManifestRow[]>,
  tapeByLoanId: Map<string, TapeLoanMatch>,
  manifestBatchId: string
): ChunkOperations => {
  const exceptionsToCreate: ChunkOperations["exceptionsToCreate"] = [];
  const loansByTargetStatus = new Map<string, string[]>();
  const fieldEditedAuditLogs: ChunkOperations["fieldEditedAuditLogs"] = [];

  for (const [businessId, rows] of byLoanId) {
    const tapeRow = tapeByLoanId.get(businessId);
    // Rows with no tape match cannot affect anything; they are counted as unmatched.
    if (!tapeRow) {
      continue;
    }

    const decision = decideManifestStatus(rows);

    // A loan with unavailable documents gets an open missing_field exception.
    if (
      decision.documentStatus === DOCUMENT_STATUS_MISSING &&
      decision.missingDocumentTypes.length > 0
    ) {
      exceptionsToCreate.push({
        exceptionType: "missing_field",
        field: "documentStatus",
        loanId: tapeRow.id,
        message: `documents missing per manifest: ${decision.missingDocumentTypes.join(", ")}`,
        metadata: {
          manifestBatchId,
          missingDocumentTypes: decision.missingDocumentTypes,
          sourceRowNumbers: decision.sourceRowNumbers,
        },
        severity: "medium",
        status: "open",
      });
    }

    // No status change means this loan needs no write in this window.
    if (tapeRow.documentStatus === decision.documentStatus) {
      continue;
    }

    const oldValue =
      tapeRow.documentStatus === null ? null : String(tapeRow.documentStatus);

    // Group loan ids by the status they should transition to for one updateMany.
    const statusGroup = loansByTargetStatus.get(decision.documentStatus);
    if (statusGroup) {
      statusGroup.push(tapeRow.id);
    } else {
      loansByTargetStatus.set(decision.documentStatus, [tapeRow.id]);
    }

    // Every automated documentStatus change is audited with before/after values.
    fieldEditedAuditLogs.push({
      eventType: "FIELD_EDITED",
      loanId: tapeRow.id,
      metadata: {
        field: "documentStatus",
        manifestBatchId,
        newValue: decision.documentStatus,
        oldValue,
        reason: `document_manifest applied: ${decision.missingDocumentTypes.length} missing of ${rows.length} entries`,
        source: "system:document_manifest",
      },
    });
  }

  return { exceptionsToCreate, fieldEditedAuditLogs, loansByTargetStatus };
};

const applyChunk = async (
  manifestBatchId: string,
  chunkRows: ManifestRow[]
): Promise<ApplyOutcome> => {
  // Group every manifest row belonging to the same tape business loanId,
  // preserving first-seen order and merging duplicates across the chunk.
  const byLoanId = new Map<string, ManifestRow[]>();
  for (const row of chunkRows) {
    const existing = byLoanId.get(row.loanId);
    if (existing) {
      existing.push(row);
    } else {
      byLoanId.set(row.loanId, [row]);
    }
  }

  const businessIds = [...byLoanId.keys()];
  if (businessIds.length === 0) {
    // No loan ids to process; nothing to write in this window.
    return {
      loansUpdated: 0,
      matchedLoanIds: 0,
      missingLoansCreated: 0,
      unmatchedBusinessIds: 0,
    };
  }

  // Fetch tape rows for these business ids; newest createdAt picks the latest tape row.
  const tapeRows = (await prisma.loan.findMany({
    orderBy: { createdAt: "desc" },
    select: { documentStatus: true, id: true, loanId: true },
    where: {
      loanId: { in: businessIds },
      sourceBatch: { fileType: "loan_tape" },
    },
  })) as unknown as TapeLoanMatch[];

  const tapeByLoanId = new Map<string, TapeLoanMatch>();
  for (const row of tapeRows) {
    const key = row.loanId?.trim();
    // First row wins due to ordering, giving us the most recent tape loan per id.
    if (key && !tapeByLoanId.has(key)) {
      tapeByLoanId.set(key, row);
    }
  }

  let loansUpdated = 0;
  let missingLoansCreated = 0;

  const { exceptionsToCreate, fieldEditedAuditLogs, loansByTargetStatus } =
    prepareChunkOperations(byLoanId, tapeByLoanId, manifestBatchId);

  // Status updates, audits, and exceptions commit in one transaction per window.
  await prisma.$transaction(
    async (tx) => {
      for (const [targetStatus, ids] of loansByTargetStatus) {
        if (ids.length > 0) {
          // Bulk-set documentStatus on all loans moving to one target status.
          await tx.loan.updateMany({
            data: { documentStatus: targetStatus },
            where: { id: { in: ids } },
          });
          loansUpdated += ids.length;
        }
      }

      if (fieldEditedAuditLogs.length > 0) {
        await tx.auditLog.createMany({
          data: fieldEditedAuditLogs as never,
        });
      }

      if (exceptionsToCreate.length > 0) {
        const createdExceptions = await tx.exception.createManyAndReturn({
          data: exceptionsToCreate as never,
          select: { id: true, loanId: true },
        });

        // Audit each missing-document exception so reviewers can trace its origin.
        if (createdExceptions.length > 0) {
          await tx.auditLog.createMany({
            data: createdExceptions.map((exc) => ({
              eventType: "EXCEPTION_CREATED",
              exceptionId: exc.id,
              loanId: exc.loanId,
              metadata: {
                exceptionType: "missing_field",
                manifestBatchId,
              },
            })) as never,
          });
        }
        missingLoansCreated = createdExceptions.length;
      }
    },
    // Large manifest windows justify a longer transaction queue wait.
    { maxWait: 10_000, timeout: 30_000 }
  );

  return {
    loansUpdated,
    matchedLoanIds: tapeByLoanId.size,
    missingLoansCreated,
    unmatchedBusinessIds: businessIds.length - tapeByLoanId.size,
  };
};

// Entry point for document-manifest processing: validates headers, accumulates availability per loan, applies to tape loans.
export const processDocumentManifest = async (
  filePath: string,
  batchId: string
): Promise<void> => {
  // Log so operators can trace a manifest batch through the pipeline.
  process.stdout.write(
    `[Manifest] Batch ${batchId}: starting document-manifest processing from ${filePath}\n`
  );

  // Latch flag: once a failure occurs every later step short-circuits.
  let hasFailed = false;
  let readStream: fs.ReadStream | null = null;
  let csvStream: NodeJS.ReadableStream | null = null;

  // Force-closes the file and parser streams so a failing run releases its handles.
  const destroyStreams = (): void => {
    try {
      readStream?.destroy();
      (csvStream as unknown as { destroy: () => void } | null)?.destroy();
    } catch {
      // ignore
    }
  };

  // Marks the batch failed with the error message, writing it into batch metadata.
  const markFailed = async (
    error: unknown,
    opts?: { isRetryable?: boolean }
  ): Promise<void> => {
    // Only the first failure is recorded; later errors cannot overwrite its details.
    if (hasFailed) {
      return;
    }
    hasFailed = true;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[Manifest] Batch ${batchId} FAILED: ${message}\n`);

    try {
      const existing = await prisma.uploadBatch.findUnique({
        where: { id: batchId },
      });
      const existingMeta =
        (existing?.metadata as Record<string, unknown> | null) ?? {};
      await prisma.uploadBatch.update({
        data: {
          metadata: {
            ...existingMeta,
            error: message,
            manifestStage: "failed",
            stageMessage: message,
          },
          status: "failed",
        },
        where: { id: batchId },
      });
    } catch {
      // best-effort
    }

    // Header-mismatch errors keep the file on disk as they are not retryable.
    const isRetryable =
      opts?.isRetryable ?? !message.includes("header mismatch");
    // Preserve filePath for retryable failures so failed replay can reopen the file;
    // only unlink for non-retryable validation errors.
    if (!isRetryable) {
      await fs.promises.unlink(filePath).catch(() => {
        // ignore ENOENT
      });
    }
  };

  try {
    // Load the batch so we can read its metadata and confirm it exists.
    const batch = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    const existingMeta =
      (batch.metadata as Record<string, unknown> | null) ?? {};

    // Idempotency: a batch already fully applied is left untouched.
    if (existingMeta.manifestStage === "done") {
      process.stdout.write(
        `[Manifest] Batch ${batchId}: already completed, skipping.\n`
      );
      return;
    }

    // Replay guard: wipe orphans left behind by an interrupted previous run.
    // Replay guard (review Warn fix): "applying" catches hard crashes;
    // "failed" catches soft failures (markFailed overwrites the stage), so
    // a re-invoked failed batch also cleans its orphans before re-applying.
    // buildOrphanCleanupWhere is idempotent and scoped to open + unreviewed
    // same-batch exceptions (S3), and missing-exceptions are re-ensured
    // every run, so cleanup on "failed" cannot lose reviewed state.
    // Only clean orphans when a prior run reached "applying" or "failed", meaning
    // it may have left partial work behind. Fully "done" batches already returned above.
    if (
      existingMeta.manifestStage === "applying" ||
      existingMeta.manifestStage === "failed"
    ) {
      try {
        // Delete orphaned missing-document exceptions from the interrupted run.
        await prisma.exception.deleteMany({
          where: buildOrphanCleanupWhere(batchId) as never,
        });
      } catch {
        // best-effort cleanup
      }
    }

    // Move the batch to applying so a crash mid-run can be detected on retry.
    await prisma.uploadBatch.update({
      data: {
        metadata: {
          ...existingMeta,
          manifestStage: "applying",
          pipelineStage: "applying_manifest",
          stageMessage: "Applying document availability to matched loans...",
        },
        status: "processing",
      },
      where: { id: batchId },
    });

    let headerValidationError: string | null = null;
    const failedRows: ManifestFailedRow[] = [];
    let totalFailedRows = 0;
    let totalRows = 0;
    let totalApplied = 0;
    let totalMissingExceptioned = 0;
    let totalUnmatched = 0;

    // Open the uploaded manifest and pipe it through csv-parser.
    readStream = fs.createReadStream(filePath);
    csvStream = readStream.pipe(
      csv({
        // Clean each header on read so BOM/whitespace never breaks column matching.
        mapHeaders: ({ header }: { header: string }) =>
          header.replace(BOM_REGEX, "").trim(),
        // Trim each cell value so comparisons are insensitive to source padding.
        mapValues: ({
          value,
        }: {
          header: string;
          index: number;
          value: string;
        }) => (typeof value === "string" ? value.trim() : value),
      })
    );

    (
      csvStream as unknown as {
        on: (event: string, handler: (headers: string[]) => void) => void;
      }
    ).on("headers", (headers: string[]) => {
      // Gate the file on required columns before any row is applied.
      headerValidationError = validateManifestHeaders(headers);
      if (headerValidationError) {
        process.stderr.write(
          `[Manifest] Batch ${batchId}: ${headerValidationError}\n`
        );
      }
    });

    // Rejects on readStream/csvStream errors so the processing race can surface them.
    const streamErrorPromise = new Promise<never>((_resolve, reject) => {
      readStream?.on("error", reject);
      (
        csvStream as unknown as {
          on: (event: string, handler: (err: Error) => void) => unknown;
        }
      ).on("error", reject);
    });

    // Whole-file per-loanId accumulation (review Block fix): the verdict for
    // a loan must be decided from ALL its manifest rows. A size-triggered
    // chunk flush could split one loanId's rows across two windows and flip
    // documentStatus based on a partial group. Rows are tiny triples, so the
    // O(distinct-loan rows) buffer is bounded and safe; only applyChunk
    // windows stay capped at MANIFEST_CHUNK_SIZE.
    const rowsByLoanId = new Map<string, ManifestRow[]>();
    let currentRowNumber = 1;

    // Consumes the parsed row stream, normalizing each row and accumulating by loanId.
    const processRows = async (): Promise<void> => {
      for await (const raw of csvStream as unknown as AsyncIterable<
        Record<string, string>
      >) {
        currentRowNumber += 1;
        const rowNumber = currentRowNumber - 1;

        // Skip fully blank source lines instead of counting them as failures.
        if (
          Object.values(raw).every(
            (v) => v === null || v === undefined || String(v).trim() === ""
          )
        ) {
          continue;
        }

        totalRows += 1;
        const result = normalizeManifestRow(raw, rowNumber);

        if (!result.success) {
          // Rejected rows are tallied and capped in the stored failure list.
          totalFailedRows += 1;
          if (failedRows.length < MAX_FAILED_ROWS_STORED) {
            failedRows.push(result.failedRow);
          }
          continue;
        }

        // Append this row to its loan's accumulation bucket, creating the bucket on first sight.
        const loanRows = rowsByLoanId.get(result.row.loanId);
        if (loanRows) {
          loanRows.push(result.row);
        } else {
          rowsByLoanId.set(result.row.loanId, [result.row]);
        }
      }
    };

    await Promise.race([processRows(), streamErrorPromise]);
    // Contain a late stream rejection: if processRows wins the race the
    // rejected streamErrorPromise would otherwise surface as an unhandled
    // process-level rejection.
    streamErrorPromise.catch(() => {
      // already handled by the race above
    });

    if (headerValidationError) {
      // A header mismatch is fatal for the whole manifest batch.
      throw new Error(headerValidationError);
    }

    // Apply complete per-loan groups in capped windows (E3): feed applyChunk
    // batches of whole loanId groups whose combined rows stay under
    // MANIFEST_CHUNK_SIZE.
    for (const window of buildApplyWindows([...rowsByLoanId.values()])) {
      const outcome = await applyChunk(batchId, window);
      // Aggregate the outcome tallies across all windows for final metadata.
      totalApplied += outcome.loansUpdated;
      totalMissingExceptioned += outcome.missingLoansCreated;
      totalUnmatched += outcome.unmatchedBusinessIds;
    }

    const finalMetaSource = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });
    const finalMetaBase =
      (finalMetaSource?.metadata as Record<string, unknown> | null) ?? {};

    // Persist the final manifest summary and audit entry in one transaction.
    await prisma.$transaction(async (tx) => {
      await tx.uploadBatch.update({
        data: {
          failedCount: totalFailedRows,
          metadata: {
            ...finalMetaBase,
            failedRows: failedRows as unknown as never[],
            manifestAppliedLoans: totalApplied,
            manifestMissingExceptioned: totalMissingExceptioned,
            manifestStage: "done",
            manifestTotalRows: totalRows,
            manifestUnmatchedBusinessIds: totalUnmatched,
            pipelineStage: "completed",
            stageMessage: "Document manifest processed successfully.",
          },
          recordCount: totalRows,
          status: "done",
        },
        where: { id: batchId },
      });
      await tx.auditLog.create({
        data: {
          batchId,
          eventType: "INGESTION_COMPLETED",
          metadata: {
            appliedLoans: totalApplied,
            failedRows: totalFailedRows,
            manifestType: true,
            missingExceptioned: totalMissingExceptioned,
            totalRows,
          },
        },
      });
    });

    process.stdout.write(
      `[Manifest] Batch ${batchId} SUCCESS: ${totalRows} rows, ${totalApplied} loans updated, ${totalMissingExceptioned} missing-document exceptions.\n`
    );
    destroyStreams();
    // Processing finished, so the raw manifest file is no longer needed on disk.
    await fs.promises.unlink(filePath).catch(() => {
      // ignore ENOENT
    });
  } catch (err) {
    // Any error fails the batch and closes the open streams.
    await markFailed(err);
    destroyStreams();
  }
};
