// Imports: Node's fs for streaming, csv-parser for row parsing, Prisma for DB access, and the validation pipeline entry point.
import fs from "node:fs";
import csv from "csv-parser";
import { prisma } from "../lib/prisma.js";
import { validateBatch } from "./validation.service.js";

// Inserts are flushed every 5,000 rows to keep transactions small and memory bounded.
export const CHUNK_SIZE = 5000;
// Failed rows stored in batch metadata are capped so error payloads never bloat the record.
export const MAX_FAILED_ROWS_STORED = 1000;

// Matches a UTF-8 Byte-Order-Mark at the start of a cell so it can be stripped before parsing.
const BOM_REGEX = /^\uFEFF/;

// All recognized CSV header spellings (lowercased, separators removed); at least one must match for the file to be treated as a loan tape.
const KNOWN_COLUMNS = new Set([
  "loan_id",
  "loanid",
  "borrower_id",
  "borrowerid",
  "loan_type",
  "loantype",
  "origination_date",
  "originationdate",
  "maturity_date",
  "maturitydate",
  "original_principal",
  "originalprincipal",
  "current_balance",
  "currentbalance",
  "interest_rate",
  "interestrate",
  "term_months",
  "termmonths",
  "borrower_state",
  "borrowerstate",
  "loan_purpose",
  "loanpurpose",
  "credit_grade",
  "creditgrade",
  "employment_length",
  "employmentlength",
  "income_band",
  "incomeband",
  "payment_status",
  "paymentstatus",
  "days_past_due",
  "dayspastdue",
  "servicer_name",
  "servicername",
  "last_payment_date",
  "lastpaymentdate",
  "last_updated_at",
  "lastupdatedat",
  "document_status",
  "documentstatus",
  "source_system",
  "sourcesystem",
]);

// Shape of a rejected source row: the raw text, the reason, and its 1-based line number.
export interface FailedRow {
  rawData: string;
  reason: string;
  rowNumber: number;
}

// Normalized, database-ready loan record after CSV aliases are collapsed into canonical fields.
export interface LoanCreateData {
  borrowerId: string | null;
  borrowerState: string | null;
  creditGrade: string | null;
  currentBalance: number | null;
  daysPastDue: number | null;
  documentStatus: string | null;
  employmentLength: string | null;
  incomeBand: string | null;
  interestRate: number | null;
  lastPaymentDate: Date | null;
  lastUpdatedAt: Date | null;
  loanId: string | null;
  loanPurpose: string | null;
  loanType: string | null;
  maturityDate: Date | null;
  originalPrincipal: number | null;
  originationDate: Date | null;
  paymentStatus: string | null;
  servicerName: string | null;
  sourceBatchId: string;
  sourceRowNumber: number;
  sourceSystem: string | null;
  termMonths: number | null;
}

export interface NormalizeSuccess {
  data: LoanCreateData;
  failedRow?: never;
  success: true;
}

export interface NormalizeFailure {
  data?: never;
  failedRow: FailedRow;
  success: false;
}

// Discriminated union so callers know whether normalization produced data or a failed row.
export type NormalizeResult = NormalizeSuccess | NormalizeFailure;

// Converts any cell into a clean string, stripping a leading BOM and outer whitespace.
const stripBomAndTrim = (value: unknown): string => {
  // Nullish cells become "" so downstream parsers always receive a uniform value.
  if (value === null || value === undefined) {
    return "";
  }
  // String coercion plus BOM/whitespace removal guards against Excel-style placement artifacts.
  return String(value).replace(BOM_REGEX, "").trim();
};

// Mirrors stripBomAndTrim but collapses blank results to null for optional database columns.
export const cleanString = (value: unknown): string | null => {
  const s = stripBomAndTrim(value);
  // Empty means "no value" in the source file, which we record as SQL NULL, not "".
  return s === "" ? null : s;
};

// Parses a money/rate cell into a number, tolerating thousands separators and blank cells.
export const parseDecimal = (value: unknown): number | null => {
  // Nullish cells are treated as missing rather than throwing a parse error.
  if (value === null || value === undefined) {
    return null;
  }
  // Strip commas (e.g. "1,234.56") so Number() can parse the currency value.
  const str = stripBomAndTrim(value).replace(/,/g, "");
  // Blank after cleaning means the source simply had no value here.
  if (str === "") {
    return null;
  }
  const n = Number(str);
  // Reject NaN and Infinity so garbage text can never become a loan balance.
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    return null;
  }
  return n;
};

// Parses an integer column (days past due, term months); same guards as parseDecimal.
export const parseIntSafe = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const str = stripBomAndTrim(value).replace(/,/g, "");
  if (str === "") {
    return null;
  }
  const n = Number(str);
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    return null;
  }
  // Truncate instead of rounding so fractional source values never inflate a count.
  return Math.trunc(n);
};

// Parses a date cell; returns null instead of throwing when the text is blank or unparseable.
export const parseDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const str = stripBomAndTrim(value);
  if (str === "") {
    return null;
  }
  // The Date constructor accepts many textual formats; invalid input yields an invalid Date.
  const d = new Date(str);
  // getTime() is NaN for invalid dates, which we convert to null to signal a missing value.
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
};

// Identity-critical dates must be valid: a non-empty bad value fails the whole row.
const parseDateField = (value: unknown, fieldName: string): Date | null => {
  const str = stripBomAndTrim(value);
  // Blank is acceptable, so only non-empty invalid dates raise an error.
  if (str === "") {
    return null;
  }
  const parsed = parseDate(str);
  if (parsed === null) {
    // Throwing lets the caller attach the failing row to a FailedRow record.
    throw new Error(`invalid date format ${fieldName}: ${str}`);
  }
  return parsed;
};

// Normalizes one raw CSV row into DB-ready LoanCreateData, or a FailedRow on missing ids or bad dates.
export const normalizeRow = (
  raw: Record<string, string>,
  batchId: string,
  rowNumber: number
): NormalizeResult => {
  try {
    // Treat the row as string|undefined so optional cells can be checked with nullish coalescing.
    const rawRecord = raw as Record<string, string | undefined>;
    // Support both snake_case and camelCase aliases for the loan id.
    const loanId = cleanString(rawRecord.loan_id ?? rawRecord.loanId);
    // borrower_id is optional but is an alternative identity when loan_id is absent.
    const borrowerId = cleanString(
      rawRecord.borrower_id ?? rawRecord.borrowerId
    );

    // At least one of loan_id/borrower_id must exist so the row can be traced through the pipeline.
    if (!(loanId || borrowerId)) {
      const reason = "missing loan_id and borrower_id";
      const failedRow: FailedRow = {
        rawData: JSON.stringify(raw),
        reason,
        rowNumber,
      };
      return { failedRow, success: false };
    }

    // List of date columns to parse; an invalid value here is a hard failure for the row.
    const dateFields: Array<{ key: string; value: unknown }> = [
      { key: "origination_date", value: raw.origination_date },
      { key: "maturity_date", value: raw.maturity_date },
      { key: "last_payment_date", value: raw.last_payment_date },
      { key: "last_updated_at", value: raw.last_updated_at },
    ];
    const parsedDates: Record<string, Date | null> = {};
    for (const { key, value } of dateFields) {
      try {
        parsedDates[key] = parseDateField(value, key);
      } catch (err) {
        // Convert the thrown date error into a FailedRow for this source line.
        const reason = err instanceof Error ? err.message : String(err);
        const failedRow: FailedRow = {
          rawData: JSON.stringify(raw),
          reason,
          rowNumber,
        };
        return { failedRow, success: false };
      }
    }
    const originationDate = parsedDates.origination_date as Date | null;
    const maturityDate = parsedDates.maturity_date as Date | null;
    const lastPaymentDate = parsedDates.last_payment_date as Date | null;
    const lastUpdatedAt = parsedDates.last_updated_at as Date | null;

    // Assemble the normalized record; each field parses its own cell type independently.
    const data: LoanCreateData = {
      borrowerId,
      borrowerState: cleanString(raw.borrower_state),
      creditGrade: cleanString(raw.credit_grade),
      currentBalance: parseDecimal(raw.current_balance),
      daysPastDue: parseIntSafe(raw.days_past_due),
      documentStatus: cleanString(raw.document_status),
      employmentLength: cleanString(raw.employment_length),
      incomeBand: cleanString(raw.income_band),
      interestRate: parseDecimal(raw.interest_rate),
      lastPaymentDate,
      lastUpdatedAt,
      loanId,
      loanPurpose: cleanString(raw.loan_purpose),
      loanType: cleanString(raw.loan_type),
      maturityDate,
      originalPrincipal: parseDecimal(raw.original_principal),
      originationDate,
      paymentStatus: cleanString(raw.payment_status),
      servicerName: cleanString(raw.servicer_name),
      sourceBatchId: batchId,
      sourceRowNumber: rowNumber,
      sourceSystem: cleanString(raw.source_system),
      termMonths: parseIntSafe(raw.term_months),
    };

    // Success carries the data; the union type lets callers narrow safely.
    return { data, success: true };
  } catch (err) {
    // Defensive catch: any unexpected error becomes a FailedRow instead of a crash.
    const reason = err instanceof Error ? err.message : String(err);
    const failedRow: FailedRow = {
      rawData: JSON.stringify(raw),
      reason,
      rowNumber,
    };
    return { failedRow, success: false };
  }
};

// Detects a blank source line so it can be skipped instead of counted as a failure.
const isEmptyRow = (row: Record<string, string>): boolean => {
  const values = Object.values(row);
  // No cells at all means the row never existed.
  if (values.length === 0) {
    return true;
  }
  // A row is empty if every cell is nullish or whitespace-only.
  return values.every(
    (v) => v === null || v === undefined || String(v).trim() === ""
  );
};

// Entry point for CSV ingestion: streams the file, normalizes each row, flushes inserts, then hands off to the next pipeline stage.
export const processStreamAndNormalize = async (
  filePath: string,
  batchId: string
): Promise<void> => {
  // Log so operators can trace a batch from queue pickup through completion.
  process.stdout.write(
    `[Ingestion] Batch ${batchId}: Starting streaming ingestion from ${filePath}\n`
  );

  // Mark the batch as schema-verifying before reading a single data row.
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
          pipelineStage: "verifying_schema",
          pipelineStep: 2,
          stageMessage: "Inspecting CSV headers and verifying schema...",
        },
        status: "processing",
      },
      where: { id: batchId },
    });
  } catch {
    // if batch not found, continue - pipeline error handling will deal with it
  }

  const failedRows: FailedRow[] = [];
  // Total rejected source rows, potentially exceeding the stored cap, for accurate reporting.
  let totalFailedRows = 0;
  // Buffer of normalized rows awaiting a chunk flush.
  let chunk: LoanCreateData[] = [];
  // First source line number in the current chunk, for the audit trail.
  let chunkStartRow: number | null = null;
  // Last source line number in the current chunk, for the audit trail.
  let chunkEndRow: number | null = null;
  // 1-based position; the header occupies row 1, so data rows start at 2.
  let currentRowNumber = 1;
  // Number of rows actually inserted; skipDuplicates may make this lower than normalized count.
  let processedCount = 0;
  // Healthy normalized rows, reported in the final success tally.
  let totalValidNormalized = 0;
  // Latch that flips once on the first failure so every later step short-circuits.
  let hasFailed = false;
  // Captures a header-gate mismatch to fail the batch with an actionable message.
  let headerValidationError: string | null = null;

  // Marks the whole batch failed: records the error in metadata and deletes the uploaded file.
  const markFailed = async (error: unknown): Promise<void> => {
    // Only the first failure is recorded; later concurrent errors must not overwrite it.
    if (hasFailed) {
      return;
    }
    // Latch the flag so streams and loops stop doing further work.
    hasFailed = true;
    const message = error instanceof Error ? error.message : String(error);
    // Surface the reason on stderr where the pipeline runner can capture it.
    process.stderr.write(`[Ingestion] Batch ${batchId} FAILED: ${message}\n`);

    const recordCount = totalValidNormalized + totalFailedRows;
    // Flag whether row-level failures were cut off by the storage cap.
    const truncated = totalFailedRows > MAX_FAILED_ROWS_STORED;

    let existingMeta: Record<string, unknown> = {};
    try {
      const existing = await prisma.uploadBatch.findUnique({
        where: { id: batchId },
      });
      existingMeta =
        (existing?.metadata as Record<string, unknown> | null) ?? {};
    } catch {
      // ignore
    }

    const nextMeta: Record<string, unknown> = {
      ...existingMeta,
      error: message,
      // Persist only the newest stored failures to keep the metadata JSON small.
      failedRows: failedRows.slice(0, MAX_FAILED_ROWS_STORED),
      pipelineStage: "failed",
      stageMessage: message,
    };
    if (truncated) {
      // Note that storage was truncated and expose the real failure count.
      nextMeta.failedRowsTruncated = true;
      nextMeta.totalFailedRows = totalFailedRows;
    }

    try {
      await prisma.uploadBatch.update({
        data: {
          failedCount: totalFailedRows,
          metadata: nextMeta as never,
          recordCount,
          status: "failed",
        },
        where: { id: batchId },
      });
    } catch {
      // ignore
    }

    try {
      // Remove the uploaded file so a failed batch never leaks out-of-date source data.
      await fs.promises.unlink(filePath).catch(() => {
        // ignore ENOENT
      });
    } catch {
      // ignore
    }
  };

  // Tracks the highest source row confirmed persisted so a failure message can say where it stopped.
  let lastSuccessfulRowEnd: number | null = null;

  // Writes one accumulated chunk of normalized loans to the database inside a single transaction.
  const flushChunk = async (): Promise<void> => {
    // Nothing to write yet; the row-window bookkeeping stays untouched.
    if (chunk.length === 0) {
      return;
    }
    // Copy the buffer so the clears below can't invalidate data mid-transaction.
    const toInsert = [...chunk];
    const rowStart = chunkStartRow as number;
    const rowEnd = chunkEndRow as number;
    chunk = [];
    chunkStartRow = null;
    chunkEndRow = null;
    try {
      // Insert plus progress tracking must commit together so the audit trail is exact.
      await prisma.$transaction(async (tx) => {
        // Bulk insert; skipDuplicates ignores rows already present for this batch source.
        const result = await tx.loan.createMany({
          data: toInsert as unknown as never[],
          skipDuplicates: true,
        });
        const inserted = (result as unknown as { count: number }).count;
        // Only actual inserts count as processed; duplicate skips are reported separately.
        processedCount += inserted;
        // Remember the deepest persisted row for a cleaner failure message later.
        lastSuccessfulRowEnd = rowEnd;
        await tx.auditLog.create({
          data: {
            batchId,
            eventType: "LOAN_IMPORTED",
            metadata: { inserted, rowEnd, rowStart },
          },
        });
        const existing = await tx.uploadBatch.findUnique({
          where: { id: batchId },
        });
        const existingMeta =
          (existing?.metadata as Record<string, unknown> | null) ?? {};
        // Keep pipeline progress in metadata so the UI always shows the live stage.
        await tx.uploadBatch.update({
          data: {
            metadata: {
              ...existingMeta,
              pipelineStage: "ingesting",
              pipelineStep: 3,
              stageMessage: `Ingesting and normalizing loans (${processedCount} rows inserted)...`,
            },
            processedCount,
          },
          where: { id: batchId },
        });
      });
      process.stdout.write(
        `[Ingestion] Batch ${batchId}: Flushed chunk (rows ${rowStart}..${rowEnd}, inserted: ${toInsert.length}, total: ${processedCount})\n`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        const existing = await prisma.uploadBatch.findUnique({
          where: { id: batchId },
        });
        const existingMeta =
          (existing?.metadata as Record<string, unknown> | null) ?? {};
        // Record where the batch died so a retry can resume or reason about the data.
        await prisma.uploadBatch.update({
          data: {
            metadata: {
              ...existingMeta,
              error: message,
              lastSuccessfulRowEnd,
            },
            status: "failed",
          },
          where: { id: batchId },
        });
        hasFailed = true;
        // Roll back rows already written for this batch to avoid partial ingestion.
        await prisma.loan.deleteMany({ where: { sourceBatchId: batchId } });
      } catch {
        // If even the failure bookkeeping fails, fall back to the generic markFailed path.
        await markFailed(err);
      }
      // Re-throw so the pipeline runner sees the flush failure and cancels the stream.
      throw err;
    }
  };

  let readStream: fs.ReadStream | null = null;
  let csvStream: NodeJS.ReadableStream | null = null;

  // Force-closes the file and parser streams so a failing run releases its handles.
  const destroyStreams = (): void => {
    try {
      if (readStream) {
        readStream.destroy();
      }
      if (csvStream) {
        (csvStream as unknown as { destroy: () => void }).destroy();
      }
    } catch {
      // ignore
    }
  };

  // Processes one parsed row: normalize it, tally failures, or buffer it on the chunk window.
  const handleRow = (row: Record<string, string>, rowNumber: number): void => {
    let result: NormalizeResult;
    try {
      result = normalizeRow(row, batchId, rowNumber);
    } catch (err) {
      // A normalization throw (unexpected) is still a per-row failure, not a batch failure.
      const reason = err instanceof Error ? err.message : String(err);
      totalFailedRows += 1;
      if (failedRows.length < MAX_FAILED_ROWS_STORED) {
        failedRows.push({
          rawData: JSON.stringify(row),
          reason,
          rowNumber,
        });
      }
      return;
    }

    if (!result.success) {
      // NormalizeResult.failed case: count and store the rejected row with its reason.
      totalFailedRows += 1;
      if (failedRows.length < MAX_FAILED_ROWS_STORED) {
        failedRows.push(result.failedRow);
      }
      return;
    }

    // Healthy row: track it for the valid tally and extend the current chunk window.
    totalValidNormalized += 1;
    if (chunkStartRow === null) {
      chunkStartRow = rowNumber;
    }
    chunkEndRow = rowNumber;
    chunk.push(result.data);
  };

  // Runs after the final row: flushes leftovers, writes final tallies, and advances the stage to validating.
  const finalizeSuccess = async (): Promise<void> => {
    if (chunk.length > 0) {
      await flushChunk();
      // If flushing failed the batch is now marked failed; stop the success path.
      if (hasFailed) {
        return;
      }
    }

    const failedCount = totalFailedRows;
    // recordCount includes rejections so an empty-but-valid file is still measurable.
    const recordCount = totalValidNormalized + failedCount;
    const truncated = totalFailedRows > MAX_FAILED_ROWS_STORED;

    let existingMeta: Record<string, unknown> = {};
    try {
      const batch = await prisma.uploadBatch.findUnique({
        where: { id: batchId },
      });
      existingMeta = (batch?.metadata as Record<string, unknown> | null) ?? {};
    } catch {
      // ignore
    }

    const nextMetadata: Record<string, unknown> = {
      ...existingMeta,
      failedRows,
      // Hand the batch to the validation stage, which runs right after ingestion.
      pipelineStage: "validating",
      pipelineStep: 4,
      stageMessage:
        "Running automated validation rules and duplicate checks...",
    };
    if (truncated) {
      (nextMetadata as Record<string, unknown>).failedRowsTruncated = true;
      (nextMetadata as Record<string, unknown>).totalFailedRows =
        totalFailedRows;
    }

    // Rows counted but never inserted were duplicates caught by skipDuplicates.
    const skippedDuplicates = Math.max(
      0,
      recordCount - processedCount - failedCount
    );
    (nextMetadata as Record<string, unknown>).skippedDuplicates =
      skippedDuplicates;

    try {
      // Final stats and the audit write commit atomically so reporting can't drift from the batch.
      await prisma.$transaction(async (tx) => {
        await tx.uploadBatch.update({
          data: {
            failedCount,
            metadata: nextMetadata as never,
            processedCount,
            recordCount,
            status: "processing",
          },
          where: { id: batchId },
        });
        await tx.auditLog.create({
          data: {
            batchId,
            eventType: "INGESTION_COMPLETED",
            metadata: {
              failedCount,
              skippedDuplicates,
              totalRows: recordCount,
              validInserted: processedCount,
            },
          },
        });
      });
      process.stdout.write(
        `[Ingestion] Batch ${batchId} SUCCESS: ${processedCount} valid loans imported (${failedCount} failed rows).\n`
      );
    } catch (err) {
      // Even a success-path write failure fails the batch cleanly.
      await markFailed(err);
      return;
    }

    try {
      // Ingestion is complete, so the raw upload is no longer needed on disk.
      await fs.promises.unlink(filePath).catch(() => {
        // ignore ENOENT
      });
    } catch {
      // ignore
    }
  };

  // Consumes the parsed row stream one row at a time, batching as the chunk fills.
  const processRows = async (): Promise<void> => {
    for await (const row of csvStream as unknown as AsyncIterable<
      Record<string, string>
    >) {
      // Bail immediately once a failure has been latched earlier.
      if (hasFailed) {
        break;
      }
      // A bad header gate aborts the whole run with the stored mismatch message.
      if (headerValidationError) {
        await markFailed(new Error(headerValidationError));
        break;
      }
      currentRowNumber += 1;
      const rowNumber = currentRowNumber;

      // Skip fully blank source lines instead of counting them as failures.
      if (isEmptyRow(row as Record<string, string>)) {
        continue;
      }

      handleRow(row as Record<string, string>, rowNumber);

      // A full chunk is flushed immediately to keep memory flat on large files.
      if (chunk.length >= CHUNK_SIZE) {
        await flushChunk();
        if (hasFailed) {
          break;
        }
      }
    }
  };

  try {
    // Open the uploaded CSV and pipe it through csv-parser for row-object output.
    readStream = fs.createReadStream(filePath);
    csvStream = readStream.pipe(
      csv({
        // Clean each header on read so BOM/whitespace never breaks column matching.
        mapHeaders: ({ header }: { header: string }) =>
          header.replace(BOM_REGEX, "").trim(),
        // Trim every cell value so later comparisons don't trip on padding.
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
      process.stdout.write(
        `[Ingestion] Batch ${batchId}: Detected CSV headers: [${headers.join(", ")}]\n`
      );
      // Normalize headers to compare against the known-alias set case-insensitively.
      const normalized = headers.map((h) =>
        h
          .replace(BOM_REGEX, "")
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, "")
      );
      const hasRecognizedColumn = normalized.some((h) => KNOWN_COLUMNS.has(h));
      // Reject non-loan CSVs early so downstream rows don't all fail obscurely.
      if (!hasRecognizedColumn && headers.length > 0) {
        headerValidationError = `CSV header mismatch: File does not contain recognized loan columns (found: ${headers.slice(0, 5).join(", ")}). Expected columns such as loan_id, borrower_id, original_principal, etc.`;
        process.stderr.write(
          `[Ingestion] Batch ${batchId}: ${headerValidationError}\n`
        );
      }
    });

    // Rejects on readStream/csvStream errors so the processing race can surface stream failures.
    const streamErrorPromise = new Promise<never>((_resolve, reject) => {
      readStream?.on("error", reject);
      (
        csvStream as unknown as {
          on: (event: string, handler: (err: Error) => void) => unknown;
        }
      ).on("error", reject);
    });

    // Rows and stream errors race; whichever finishes first ends the ingestion loop.
    await Promise.race([processRows(), streamErrorPromise]);

    // If a header check failed but nothing latched hasFailed, fail the batch now.
    if (headerValidationError && !hasFailed) {
      await markFailed(new Error(headerValidationError));
    }

    // Zero valid rows is an empty or garbage file: fail with an actionable message.
    if (!hasFailed && totalValidNormalized === 0) {
      const reason =
        totalFailedRows > 0
          ? `All ${totalFailedRows} rows failed normalization. Ensure CSV contains valid loan identifiers (loan_id/borrower_id).`
          : "The uploaded CSV file is empty or contains no valid data rows.";
      await markFailed(new Error(`Ingestion failed: ${reason}`));
    }

    if (hasFailed) {
      destroyStreams();
      return;
    }

    await finalizeSuccess();

    // Pull fresh batch metadata to learn which downstream stage should run.
    const batchForPostIngest = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });
    // Default to loan_tape so unknown file types still validate instead of being skipped.
    const fileType =
      (batchForPostIngest?.fileType as string | undefined) ?? "loan_tape";

    // Marks the batch as fully done with the given success message.
    const setPipelineCompleted = async (metaMessage: string): Promise<void> => {
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
              pipelineStage: "completed",
              pipelineStep: 5,
              stageMessage: metaMessage,
            },
            status: "done",
          },
          where: { id: batchId },
        });
      } catch {
        // ignore
      }
    };

    // A servicer_update file goes on to conflict spotting against the original loan tape.
    if (fileType === "servicer_update") {
      try {
        // Dynamic import keeps the heavy conflict service out of the hot ingestion path.
        const { detectServicerConflicts } = await import(
          "./conflict-detection.service.js"
        );
        await detectServicerConflicts(batchId);
        await setPipelineCompleted(
          "Ingestion and servicer conflict detection completed successfully."
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          const existing = await prisma.uploadBatch.findUnique({
            where: { id: batchId },
          });
          const existingMeta =
            (existing?.metadata as Record<string, unknown> | null) ?? {};
          // A conflict-detection crash still records the stage so operators see where it broke.
          await prisma.uploadBatch.update({
            data: {
              metadata: {
                ...existingMeta,
                conflictError: message,
                pipelineStage: "failed",
                stageMessage: message,
              },
              status: "failed",
            },
            where: { id: batchId },
          });
        } catch {
          // ignore
        }
      }
    } else if (fileType === "loan_tape") {
      try {
        // Loan tapes move straight into automated rule-based validation.
        await validateBatch(batchId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          const existing = await prisma.uploadBatch.findUnique({
            where: { id: batchId },
          });
          const existingMeta =
            (existing?.metadata as Record<string, unknown> | null) ?? {};
          // Validation errors are recorded but the batch stays done so stats remain visible.
          await prisma.uploadBatch.update({
            data: {
              metadata: {
                ...existingMeta,
                pipelineStage: "completed",
                pipelineStep: 5,
                validationError: message,
              },
              status: "done",
            },
            where: { id: batchId },
          });
        } catch {
          // ignore metadata update failure; ingestion itself remains done
        }
      }
    } else {
      // Unknown file types have no downstream stage; just close the batch.
      await setPipelineCompleted("Ingestion completed successfully.");
    }
  } catch (err) {
    // Wraps the whole pipeline: any unexpected error fails the batch and closes streams.
    await markFailed(err);
    destroyStreams();
  }
};
