import { z } from "zod"; // Zod v4 runtime validation used to parse and type every loan contract.
import {
  exceptionStatusSchema,
  exceptionTypeSchema,
  importStatusSchema,
  severitySchema,
  validationResultSchema,
  validationStatusSchema,
} from "./common.js"; // Shared enums reused here so loan statuses stay consistent across the whole contract.

// loanEditableFieldSchema: whitelists the loan fields a reviewer may patch; limits the edit surface exposed by PATCH endpoints.
export const loanEditableFieldSchema = z.enum([
  "currentBalance", // Outstanding principal; edits update the stored string balance.
  "interestRate", // Annual rate; must stay in the accepted business range.
  "paymentStatus", // Payment standing; changing it re-triggers validation review.
  "documentStatus", // Borrower document completeness state.
  "borrowerState", // Two-letter borrower state code.
  "servicerName", // The servicer that manages the loan.
  "creditGrade", // Borrower credit grade used for risk scoring.
]);
export type LoanEditableField = z.infer<typeof loanEditableFieldSchema>; // Reviewers and the API guard use this narrowed union.

// loanSourceBatchSchema: identifies which uploaded file a loan row came from, enabling full provenance lookups.
export const loanSourceBatchSchema = z.object({
  fileName: z.string(), // Original uploaded file name for traceability.
  id: z.string(), // Database id of the upload batch that carried the row.
});
export type LoanSourceBatch = z.infer<typeof loanSourceBatchSchema>; // Embedded in loan list/detail responses for drill-down.

// loanListItemSchema: summary shape for GET /loans lists, joining loan fields with the latest validation state.
export const loanListItemSchema = z.object({
  borrowerId: z.string().nullable(), // External borrower identifier; null when unmapped.
  borrowerState: z.string().nullable(), // Borrower state code, if provided.
  currentBalance: z.string().nullable(), // Stored as a string so JSON never loses numeric precision.
  exceptionCount: z.number().int().nonnegative(), // Count of open exceptions shown in the list badge.
  id: z.string(), // Internal loan record id.
  interestRate: z.string().nullable(), // Rate as a decimal string for precision.
  loanId: z.string().nullable(), // The loan's own identifier across data files.
  loanType: z.string().nullable(), // Free-form loan classification label.
  originalPrincipal: z.string().nullable(), // Original principal as a precision-safe string.
  paymentStatus: z.string().nullable(), // Current payment standing.
  sourceBatch: loanSourceBatchSchema, // Where this row came from.
  sourceRowNumber: z.number().int().positive(), // 1-based row index in the source file.
  validationStatus: validationStatusSchema, // Latest validation state for filtering/sorting.
});
export type LoanListItem = z.infer<typeof loanListItemSchema>; // List rows typed consistently for table rendering.

// loanExceptionItemSchema: exception summary shown in loan detail, including any AI suggestion attached to it.
export const loanExceptionItemSchema = z.object({
  aiRecommendation: z.unknown().nullable(), // Opaque AI payload; typed as unknown until a concrete model shape is needed.
  correctedValue: z.string().nullable().optional(), // Reviewer-supplied fix when the record was corrected.
  createdAt: z.string(), // ISO timestamp of when the exception was raised.
  exceptionType: exceptionTypeSchema, // Machine-readable reason this exception exists.
  field: z.string().nullable(), // The loan field the exception concerns, when applicable.
  id: z.string(), // Exception record id for deep links.
  message: z.string(), // Human-readable description for reviewers.
  metadata: z.unknown().nullable(), // Rule-specific extra context, left loosely typed.
  severity: severitySchema, // Priority weight used to sort the exception.
  status: exceptionStatusSchema, // Open/reviewed lifecycle state.
});
export type LoanExceptionItem = z.infer<typeof loanExceptionItemSchema>; // Exception card contract on the loan detail screen.

export const loanDetailSchema = z.object({
  borrowerId: z.string().nullable(), // External borrower identifier; null when unmapped.
  borrowerState: z.string().nullable(), // Borrower state code for lending/risk context.
  creditGrade: z.string().nullable(), // Borrower credit grade for risk scoring.
  currentBalance: z.string().nullable(), // Precision-safe string, never a float.
  daysPastDue: z.number().int().nullable(), // Integer days delinquent, when computed.
  documentStatus: z.string().nullable(), // Borrower document completeness flag.
  employmentLength: z.string().nullable(), // Standardized employment tenure label.
  exceptions: z.array(loanExceptionItemSchema), // All exceptions attached to this loan.
  id: z.string(), // Internal loan record id.
  importStatus: importStatusSchema, // Whether the source row made it into the DB.
  incomeBand: z.string().nullable(), // Standardized income bracket for underwriting.
  interestRate: z.string().nullable(), // Rate as a decimal string to preserve precision.
  lastPaymentDate: z.string().nullable(), // ISO date of the most recent payment.
  lastUpdatedAt: z.string().nullable(), // ISO timestamp of the newest field change.
  loanId: z.string().nullable(), // TuLoans-style identifier used across files.
  loanPurpose: z.string().nullable(), // Stated purpose for the loan.
  loanType: z.string().nullable(), // Free-form classification of the loan product.
  maturityDate: z.string().nullable(), // ISO end-of-term date.
  originalPrincipal: z.string().nullable(), // Precision-safe original principal amount.
  originationDate: z.string().nullable(), // ISO date the loan was originated.
  paymentStatus: z.string().nullable(), // Latest payment standing from source files.
  servicerName: z.string().nullable(), // The servicer currently managing the loan.
  sourceBatch: loanSourceBatchSchema, // Provenance: which file/row produced this record.
  sourceRowNumber: z.number().int().positive(), // 1-based row number in that source file.
  sourceSystem: z.string().nullable(), // Origin system name (lender, servicer, GSE).
  termMonths: z.number().int().nullable(), // Contract term in whole months.
  validationStatus: validationStatusSchema, // Latest validation state for this loan.
  verifiedRecord: z
    .object({
      id: z.string(), // The verified record's id.
      recordHash: z.string(), // Content hash proving the snapshot is immutable.
      validationResult: validationResultSchema, // passed / passed_with_review outcome.
      verifiedAt: z.string(), // ISO timestamp the record was finalized.
      verifiedById: z.string(), // Which reviewer completed the verification.
    })
    .passthrough() // Tolerates any extra stored columns not in this contract.
    .nullable(), // Null until the loan has actually been verified.
});
export type LoanDetail = z.infer<typeof loanDetailSchema>; // The full loan detail contract fed to the detail screen.

export const loanFieldsPatchBodySchema = z.object({
  fields: z
    .partialRecord(loanEditableFieldSchema.or(z.never()), z.string()) // Maps only editable field names to string values; key type is that whitelist.
    .refine((fields) => Object.keys(fields).length > 0, {
      message: "At least one field must be provided", // Guard: reject empty patch bodies instead of no-op updates.
    }),
  reason: z.string().min(1, "Reason is required").max(500), // Mandatory audit justification, capped at 500 chars.
});
export type LoanFieldsPatchBody = z.infer<typeof loanFieldsPatchBodySchema>; // Request body contract for the loan field patch endpoint.

// loanFieldsPatchResponseSchema: contract for what PATCH returns so the UI can reflect the applied changes.
export const loanFieldsPatchResponseSchema = z.object({
  id: z.string(), // The loan whose fields were updated.
  updatedAt: z.string(), // ISO timestamp of the patch for optimistic UI refresh.
  updatedFields: z.array(loanEditableFieldSchema), // Which whitelisted fields actually changed.
});
export type LoanFieldsPatchResponse = z.infer<
  typeof loanFieldsPatchResponseSchema
>; // Response typed so clients know exactly which edits succeeded.

// loanVerifyResponseSchema: contract for confirming a loan has been verified into a canonical record.
export const loanVerifyResponseSchema = z.object({
  verifiedLoan: z.object({
    id: z.string(), // New verified loan record id.
    loanId: z.string(), // The loan this verified record covers.
    recordHash: z.string(), // Immutability hash of the verified snapshot.
    validationResult: validationResultSchema, // Overall passed / passed_with_review outcome.
    verifiedAt: z.string(), // ISO timestamp verification completed.
    verifiedById: z.string(), // Reviewer accountable for this verification.
  }),
});
export type LoanVerifyResponse = z.infer<typeof loanVerifyResponseSchema>; // Used by the verify endpoint and its happy-path UI.

// loanListQuerySchema: query-string contract for the loans list endpoint, with coercion for pagination params.
export const loanListQuerySchema = z.object({
  batchId: z.string().optional(), // Filter loans to a specific upload batch when present.
  limit: z.coerce.number().int().min(1).max(100).default(20), // Page size coerced from string; bounded, defaults to 20.
  page: z.coerce.number().int().min(1).default(1), // Page number coerced from string; 1-based.
  search: z.string().optional(), // Optional free-text search term.
  validationStatus: validationStatusSchema.optional(), // Optional status filter for the list.
});
export type LoanListQuery = z.infer<typeof loanListQuerySchema>; // Parsed query params shared between API and web client.
