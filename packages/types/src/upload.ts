import { z } from "zod"; // Zod v4 runtime validation for all upload/batch contracts.
import {
  batchStatusSchema,
  exceptionTypeSchema,
  fileTypeSchema,
  severitySchema,
} from "./common.js"; // Shared enums reused so upload and exception data agree on vocabulary.

// pipelineStageSchema: ordered stages a batch moves through from upload to completion or failure.
export const pipelineStageSchema = z.enum([
  "staged", // File received and awaiting processing.
  "verifying_schema", // Headers and layout being checked against the file type.
  "ingesting", // Rows are being parsed and inserted.
  "validating", // Business rules running against imported loans.
  "completed", // All stages finished successfully.
  "failed", // The pipeline stopped on an unrecoverable error.
]);
export type PipelineStage = z.infer<typeof pipelineStageSchema>; // Tracks and reports live pipeline progress.

// failedRowSchema: describes a single source row the pipeline could not import.
export const failedRowSchema = z.object({
  rawData: z.string(), // The raw row text preserved verbatim for debugging.
  reason: z.string(), // Human-readable failure explanation.
  rowNumber: z.number().int().positive(), // 1-based position of the row in the source file.
});
export type FailedRow = z.infer<typeof failedRowSchema>; // Supplies the downloadable failure report.

// PipelineProgressMetadata: free-form interface (not a Zod schema) tracking live ingest/reconcile progress.
export interface PipelineProgressMetadata {
  error?: string; // Fatal error message when the pipeline dies.
  failedRows?: FailedRow[]; // Detail of recent failed rows.
  failedRowsTruncated?: boolean; // Flags that failedRows was capped for size.
  pipelineStage?: PipelineStage; // Current stage of the batch.
  pipelineStep?: number; // Index of the step within the current stage.
  publicDataAppliedLoans?: number; // Loans whose public data was applied.
  publicDataDistinctLoans?: number; // Distinct loans seen in public data.
  publicDataFoldedLoans?: number; // Loans merged from public data sources.
  publicDataLayout?: string; // Which GSE layout (Fannie/Freddie) applied.
  publicDataSourceRows?: number; // Rows read from public data sources.
  publicDataUnmappedNonEmpty?: number; // Rows that had data but no loan mapping.
  skippedDuplicates?: number; // Duplicate rows skipped during ingest.
  stageMessage?: string; // Free-text progress message for the UI.
  totalFailedRows?: number; // Grand total of failed rows for the batch.
}

// uploadBatchSchema: the persisted upload record carrying counts, status, and optional metadata.
export const uploadBatchSchema = z.object({
  createdAt: z.string(), // ISO timestamp the batch was created.
  failedCount: z.number().int().nonnegative(), // Number of rows that failed import.
  failedRows: z.array(failedRowSchema).optional(), // Sample of failed rows, when stored.
  fileName: z.string(), // Original uploaded file name.
  fileType: fileTypeSchema, // Which parser/layout this file used.
  id: z.string(), // Batch id used across API routes.
  metadata: z.unknown().nullable().optional(), // Opaque metadata (progress, stats) left loosely typed.
  processedCount: z.number().int().nonnegative().optional(), // Rows consumed so far, when known.
  recordCount: z.number().int().nonnegative(), // Total row count declared in the file.
  status: batchStatusSchema, // Lifecycle state (pending/processing/done/failed).
  updatedAt: z.string().optional(), // ISO timestamp of the last update.
  uploadedById: z.string().optional(), // Who uploaded the file, when recorded.
});
export type UploadBatch = z.infer<typeof uploadBatchSchema>; // The batch contract returned by upload endpoints.

// createUploadResponseSchema: response returned right after an upload is registered.
export const createUploadResponseSchema = z.object({
  batchId: z.string(), // Id to use for subsequent progress polling.
  fileName: z.string(), // Echo of the uploaded file name.
  fileType: fileTypeSchema, // Confirms which type the server detected.
  message: z.string(), // User-facing confirmation text.
  status: batchStatusSchema, // Initial batch status (typically pending).
});
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>; // Response contract for upload creation.

export const createUploadBodySchema = z.object({
  fileType: fileTypeSchema, // Which upload type the client claims the file is.
});
export type CreateUploadBody = z.infer<typeof createUploadBodySchema>; // Body contract for initiating an upload.

export const listUploadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20), // Page size coerced from string, bounded, defaults to 20.
  page: z.coerce.number().int().min(1).default(1), // 1-based page number coerced from string.
  status: batchStatusSchema.optional(), // Optional filter by batch status.
});
export type ListUploadsQuery = z.infer<typeof listUploadsQuerySchema>; // Query params for the upload list endpoint.

export const getBatchResponseSchema = uploadBatchSchema; // Re-exports the same shape as the batch detail response.
export type GetBatchResponse = z.infer<typeof getBatchResponseSchema>; // Type alias for the batch detail endpoint.

// batchSummarySchema: per-batch aggregates shown on dashboards after validation completes.
export const batchSummarySchema = z.object({
  batchId: z.string(), // The batch these numbers belong to.
  // Severity histogram of exceptions.
  exceptionsBySeverity: z.record(
    severitySchema, // Key constrained to the four severity levels.
    z.number().int().nonnegative() // Count per severity bucket, never negative.
  ),
  // Type histogram of exceptions.
  exceptionsByType: z.record(
    exceptionTypeSchema, // Key constrained to known exception types.
    z.number().int().nonnegative() // Count per exception type, never negative.
  ),
  failedValidation: z.number().int().nonnegative(), // Rows that failed validation.
  passedValidation: z.number().int().nonnegative(), // Rows that passed validation.
  totalImported: z.number().int().nonnegative(), // Total rows imported into loans.
});
export type BatchSummary = z.infer<typeof batchSummarySchema>; // Aggregate contract feeding the batch summary UI.
