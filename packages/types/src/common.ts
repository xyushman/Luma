import { z } from "zod"; // Zod v4 imports: every schema in this package validates against these runtime checks.

// roleSchema: enumerates the three user roles and doubles as the RBAC contract shared by auth, API guards, and the UI.
export const roleSchema = z.enum([
  "data_operator", // Back-office staff who upload files and drive the ingest/validation pipelines.
  "reviewer", // Trusted user who approves/rejects exceptions and patches loan data.
  "data_consumer", // Default read-only viewer; aligned with the better-auth defaultRole set below.
]);
export type Role = z.infer<typeof roleSchema>; // Infers a literal union type so TypeScript autocompletes the three roles.

/** Mirrors the Prisma User.role default and the better-auth admin() defaultRole. */
export const DEFAULT_USER_ROLE: Role = "data_consumer"; // Fallback role when a user has none assigned, keeping access secure by default.

export const batchStatusSchema = z.enum([
  "pending", // Upload/batch created but ingest has not started.
  "processing", // Rows are being read, normalized, and imported right now.
  "done", // Batch finished successfully and is available for review.
  "failed", // Batch stopped early (e.g. fatal schema error) and needs attention.
]);
export type BatchStatus = z.infer<typeof batchStatusSchema>; // Literal union driving the upload pipeline state machine.

export const fileTypeSchema = z.enum([
  "loan_tape", // The main lender-originated loan data file (columns of loan fields).
  "servicer_update", // Follow-up file from the servicer correcting/refreshing loan fields.
  "document_manifest", // Maps borrower documents to loans for document status checks.
  "fannie_mae", // GSE-formatted file; layout handled by the Fannie parsing module.
  "freddie_mac", // GSE-formatted file; layout handled by the Freddie parsing module.
]);
export type FileType = z.infer<typeof fileTypeSchema>; // Drives which parser and schema the import pipeline selects.

export const validationStatusSchema = z.enum([
  "pending", // Loan row imported but validation rules have not run yet.
  "passed", // All validation rules passed with no exceptions.
  "failed", // One or more rules failed; may or may not need manual review.
  "review", // Rules passed but something flagged the loan for human review.
]);
export type ValidationStatus = z.infer<typeof validationStatusSchema>; // Per-loan validation state shown in list/detail screens.

export const importStatusSchema = z.enum(["imported", "failed"]); // Coarse ingest outcome: the row made it into the DB or it did not.
export type ImportStatus = z.infer<typeof importStatusSchema>; // Used on loan detail to signal import success for that record.

export const exceptionTypeSchema = z.enum([
  "missing_field", // A required column was absent or empty for this row.
  "duplicate", // The same record was found more than once across files.
  "date_error", // A date field is malformed, out of range, or contradictory.
  "balance_error", // Principal balance fails a consistency/rounding check.
  "rate_out_of_range", // Interest rate lies outside the accepted business bounds.
  "status_inconsistency", // Payment/document statuses contradict one another.
  "stale_record", // The source data is older than the current record.
  "conflicting_source", // Two sources disagree on the same field's value.
  "invalid_state", // A field captured a state outside its allowed domain.
]);
export type ExceptionType = z.infer<typeof exceptionTypeSchema>; // Machine-readable enum used for filtering/aggregation in the UI.

export const severitySchema = z.enum(["critical", "high", "medium", "low"]); // Prioritization weight attached to each exception.
export type Severity = z.infer<typeof severitySchema>; // Drives triage sorting and dashboard charts.

export const exceptionStatusSchema = z.enum([
  "open", // Exception detected but not yet reviewed.
  "approved", // Reviewer accepted the AI suggestion or supplied correction.
  "rejected", // Reviewer dismissed the exception as a non-issue.
  "corrected", // Reviewer edited the field directly to resolve it.
]);
export type ExceptionStatus = z.infer<typeof exceptionStatusSchema>; // Reviewer workflow lifecycle for each exception.

export const auditEventTypeSchema = z.enum([
  "FILE_UPLOADED", // A data file was uploaded into the system.
  "LOAN_IMPORTED", // A loan row was imported from a batch.
  "INGESTION_COMPLETED", // A batch finished ingesting its source rows.
  "VALIDATION_RUN", // Validation rules executed against imported loans.
  "EXCEPTION_CREATED", // A new exception was raised by a rule.
  "AI_RECOMMENDATION", // The AI model produced a recommendation.
  "REVIEWER_COMMENT", // A reviewer left a note on an exception.
  "FIELD_EDITED", // A loan field was patched by a reviewer.
  "LOAN_APPROVED", // Reviewer approved the verified record for a loan.
  "LOAN_REJECTED", // Reviewer rejected the verified record for a loan.
  "VERIFIED_RECORD_CREATED", // A canonical verified record was finalized.
  "RECORD_EXPORTED", // A verified record was exported downstream.
]);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>; // Canonical action vocabulary recorded in the audit log.

export const validationResultSchema = z.enum(["passed", "passed_with_review"]); // Final outcome of a verified loan record.
export type ValidationResult = z.infer<typeof validationResultSchema>; // Used to label verified records as clean or reviewed.

export const reviewerDecisionSchema = z.enum([
  "approved", // Reviewer accepted the record as-is.
  "approved_with_edits", // Reviewer accepted it but changed one or more fields first.
]);
export type ReviewerDecision = z.infer<typeof reviewerDecisionSchema>; // Captures how a record passed review for the audit trail.

export const aiDecisionSchema = z.enum(["accepted", "edited", "rejected"]); // How a reviewer ruled on the AI's recommendation.
export type AiDecision = z.infer<typeof aiDecisionSchema>; // Feeds the exception decision body used by the review endpoint.
