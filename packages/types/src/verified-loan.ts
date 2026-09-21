import { z } from "zod"; // Zod v4 runtime validation for verified-loan records.
import { reviewerDecisionSchema, validationResultSchema } from "./common.js"; // Decision/outcome enums reused for verified records.
import { aiRecommendationSchema } from "./exception.js"; // Reuses the AI recommendation shape stored on verified loans.

// canonicalDataSchema: the ~20 normalized loan fields that survive verification; decimals are strings so JSON never loses precision.
export const canonicalDataSchema = z.object({
  borrowerId: z.string().nullable(), // Normalized borrower identifier after reconciliation.
  borrowerState: z.string().nullable(), // Borrower state code.
  creditGrade: z.string().nullable(), // Borrower credit grade.
  currentBalance: z.string().nullable(), // Balance kept as a string to preserve exactness.
  daysPastDue: z.number().int().nullable(), // Whole-number delinquency days.
  documentStatus: z.string().nullable(), // Document completeness status.
  employmentLength: z.string().nullable(), // Standardized tenure label.
  incomeBand: z.string().nullable(), // Standardized income bracket.
  interestRate: z.string().nullable(), // Rate as a precision-safe string.
  lastPaymentDate: z.string().nullable(), // ISO date of last payment.
  loanId: z.string().nullable(), // Cross-file loan identifier.
  loanPurpose: z.string().nullable(), // Stated loan purpose.
  loanType: z.string().nullable(), // Loan product classification.
  maturityDate: z.string().nullable(), // ISO term end date.
  originalPrincipal: z.string().nullable(), // Precision-safe original amount.
  originationDate: z.string().nullable(), // ISO origination date.
  paymentStatus: z.string().nullable(), // Payment standing after reconciliation.
  servicerName: z.string().nullable(), // Servicer managing the loan.
  sourceSystem: z.string().nullable(), // Origin system of the winning value.
  termMonths: z.number().int().nullable(), // Whole-month contract term.
});
export type CanonicalData = z.infer<typeof canonicalDataSchema>; // The immutable field snapshot a verified record guarantees.

// verifiedLoanListItemSchema: summary row for verified-loan lists, pairing hashes with the review decision.
export const verifiedLoanListItemSchema = z.object({
  aiRecommendationUsed: z.boolean(), // Whether the AI suggestion was consulted on this record.
  id: z.string(), // Verified record id.
  // Compact loan reference embedded for list cards.
  loan: z.object({
    borrowerId: z.string().nullable(), // Borrower identifier for display.
    loanId: z.string().nullable(), // Loan identifier for routing.
  }),
  loanId: z.string(), // Loan the verified record covers.
  recordHash: z.string(), // Content hash proving immutability.
  reviewerDecision: reviewerDecisionSchema.nullable().optional(), // How review concluded, when known.
  sourceBatchRef: z.string(), // Which source file generated this record.
  validationResult: validationResultSchema, // passed / passed_with_review outcome.
  verifiedAt: z.string(), // ISO timestamp verification completed.
  verifiedById: z.string(), // Reviewer accountable for this record.
});
export type VerifiedLoanListItem = z.infer<typeof verifiedLoanListItemSchema>; // Row contract for verified-loan lists.

// verifiedLoanDetailSchema: full verified record including the canonical snapshot and AI provenance.
export const verifiedLoanDetailSchema = z.object({
  aiDecision: z.enum(["accepted", "edited", "rejected"]).nullable().optional(), // Reviewer's ruling on the AI suggestion.
  aiRecommendation: aiRecommendationSchema.nullable().optional(), // The AI output behind this record, when consulted.
  aiRecommendationUsed: z.boolean(), // Flag indicating AI was part of this verification.
  canonicalData: canonicalDataSchema, // The final normalized field snapshot.
  id: z.string(), // Verified record id.
  loanId: z.string(), // The loan this record finalizes.
  recordHash: z.string(), // Immutability hash of the whole record.
  reviewerDecision: reviewerDecisionSchema.nullable().optional(), // Final review verdict, when recorded.
  reviewerNote: z.string().nullable().optional(), // Reviewer's free-text rationale.
  sourceBatchRef: z.string(), // Source file reference for provenance.
  validationResult: validationResultSchema, // Overall validation outcome.
  verifiedAt: z.string(), // ISO timestamp of verification.
  verifiedById: z.string(), // Reviewer id responsible.
  verifiedByName: z.string().nullable().optional(), // Reviewer display name for the UI.
});
export type VerifiedLoanDetail = z.infer<typeof verifiedLoanDetailSchema>; // Full detail contract for the verified-record screen.

export const verifiedLoanListQuerySchema = z.object({
  aiRecommendationUsed: z.coerce.boolean().optional(), // Filter records by whether AI was used, coerced from query string.
  batchId: z.string().optional(), // Filter to a specific source batch.
  limit: z.coerce.number().int().min(1).max(100).default(20), // Page size coerced from string, bounded, defaults to 20.
  page: z.coerce.number().int().min(1).default(1), // 1-based page number coerced from string.
  search: z.string().optional(), // Free-text search over verified records.
  validationResult: validationResultSchema.optional(), // Optional outcome filter.
});
export type VerifiedLoanListQuery = z.infer<typeof verifiedLoanListQuerySchema>; // Parsed query params for verified-loan lists.

// verifiedLoanListResponseSchema: paged response contract with pagination meta plus an overall quality score.
export const verifiedLoanListResponseSchema = z.object({
  data: z.array(verifiedLoanListItemSchema), // The paged list of verified loans.
  // Consistent pagination block shared with other list endpoints.
  pagination: z.object({
    limit: z.number().int().min(1), // Items per page, validated on output too.
    page: z.number().int().min(1), // Current page number.
    total: z.number().int().nonnegative(), // Total items across all pages.
    totalPages: z.number().int().nonnegative(), // Derived page count.
  }),
  qualityScore: z.number().min(0).max(100), // Aggregate data quality score for the whole view.
});
export type VerifiedLoanListResponse = z.infer<
  typeof verifiedLoanListResponseSchema
>; // Response contract wrapping the verified-loan page and quality score.
