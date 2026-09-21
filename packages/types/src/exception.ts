import { z } from "zod"; // Zod v4 runtime validation backing all exception review contracts.
import {
  aiDecisionSchema,
  exceptionStatusSchema,
  exceptionTypeSchema,
  severitySchema,
} from "./common.js"; // Shared enums reused so exception workflows use the same vocabulary as loans and audit.

// aiRecommendationFieldChangeSchema: describes one suggested field edit produced by the AI model.
export const aiRecommendationFieldChangeSchema = z.object({
  currentValue: z.string().nullable().optional(), // The value currently on the record, when known.
  field: z.string(), // The loan field the AI wants to change.
  source: z.string().optional(), // Which source file/data point drove this suggestion.
  suggestedValue: z.string(), // The corrected value the AI proposes for that field.
});
export type AiRecommendationFieldChange = z.infer<
  typeof aiRecommendationFieldChangeSchema
>; // One atomic change a reviewer may accept as-is or override.

// aiRecommendationSchema: full AI output with provenance metadata so reviewers can trust and interrogate it.
export const aiRecommendationSchema = z.object({
  confidence: z.number().min(0).max(1), // Model confidence clamped to a valid probability range.
  fieldsToChange: z.array(aiRecommendationFieldChangeSchema), // List of proposed field edits.
  model: z.string(), // Model name/version, for provenance and audit.
  promptSummary: z.string(), // What prompt was sent, so output is explainable.
  reasoning: z.string(), // Model rationale exposed in the review UI.
  suggestion: z.string(), // One-line human-readable summary of the suggestion.
  timestamp: z.string(), // ISO generation time, for provenance.
});
export type AiRecommendation = z.infer<typeof aiRecommendationSchema>; // Shape stored on every AI-generated exception.

// exceptionLoanSchema: minimal loan snapshot embedded in exception lists for context without a full join.
export const exceptionLoanSchema = z.object({
  borrowerId: z.string().nullable(), // Borrower identifier for display on the exception card.
  id: z.string(), // The loan's internal id.
  loanId: z.string().nullable(), // The loan's own cross-file identifier.
  validationStatus: z.string().optional(), // Last known validation state, when loaded.
});
export type ExceptionLoan = z.infer<typeof exceptionLoanSchema>; // Lightweight loan reference in list responses.

// exceptionListItemSchema: shape for exception list endpoints, pairing the exception with its loan and AI data.
export const exceptionListItemSchema = z.object({
  aiRecommendation: aiRecommendationSchema.nullable().optional(), // AI suggestion when the model ran for this exception.
  createdAt: z.string(), // ISO timestamp the exception was created.
  exceptionType: exceptionTypeSchema, // Machine-readable reason for triage/filtering.
  field: z.string().nullable(), // The affected loan field, if any.
  id: z.string(), // Exception record id.
  loan: exceptionLoanSchema, // The loan this exception belongs to.
  message: z.string(), // Human-readable explanation for reviewers.
  severity: severitySchema, // Priority weight shown in list cards.
  status: exceptionStatusSchema, // Lifecycle state driving the review workflow.
});
export type ExceptionListItem = z.infer<typeof exceptionListItemSchema>; // Exception row contract for queues/dashboards.

export const exceptionDetailSchema = z.object({
  aiRecommendation: aiRecommendationSchema.nullable(), // Full AI suggestion or null when the model did not run.
  correctedValue: z.string().nullable(), // Reviewer-supplied fix when the exception was corrected.
  createdAt: z.string(), // ISO timestamp the exception was raised.
  exceptionType: exceptionTypeSchema, // Machine-readable reason this exception exists.
  field: z.string().nullable(), // The loan field the exception concerns, if any.
  id: z.string(), // Exception record id for routing.
  // Minimal loan context embedded in the detail response.
  loan: z.object({
    id: z.string(), // Internal loan id this exception belongs to.
    loanId: z.string().nullable(), // Cross-file loan identifier for display.
  }),
  message: z.string(), // Human-readable explanation shown to reviewers.
  reviewedAt: z.string().nullable(), // ISO timestamp the review concluded, once done.
  reviewerId: z.string().nullable(), // Which reviewer acted on this exception.
  reviewerNote: z.string().nullable(), // Free-text note justifying the decision.
  severity: severitySchema, // Priority weight driving triage.
  status: exceptionStatusSchema, // Open/reviewed lifecycle state.
  updatedAt: z.string(), // ISO timestamp of the last update.
});
export type ExceptionDetail = z.infer<typeof exceptionDetailSchema>; // The full exception contract for the review screen.

// exceptionCommentBodySchema: request shape for adding a review comment to an exception.
export const exceptionCommentBodySchema = z.object({
  note: z.string().min(1).max(2000), // Comment text must be non-empty and at most 2000 chars.
});
export type ExceptionCommentBody = z.infer<typeof exceptionCommentBodySchema>; // Body contract for the comment endpoint.

// exceptionApproveBodySchema: request shape for approving an exception, optionally with a corrected value.
export const exceptionApproveBodySchema = z.object({
  correctedValue: z.string().optional(), // New value to apply on approval, when the record must change.
  note: z.string().min(1).max(2000).optional(), // Optional approval note, bounded in length.
});
export type ExceptionApproveBody = z.infer<typeof exceptionApproveBodySchema>; // Body contract for the approve endpoint.

// exceptionRejectBodySchema: request shape for rejecting an exception, requiring an explanation.
export const exceptionRejectBodySchema = z.object({
  note: z.string().min(1).max(2000), // Rejection reason is mandatory and length-capped.
});
export type ExceptionRejectBody = z.infer<typeof exceptionRejectBodySchema>; // Body contract for the reject endpoint.

// exceptionDecisionBodySchema: reviewer's verdict on the AI recommendation, with a cross-field rule.
export const exceptionDecisionBodySchema = z
  .object({
    decision: aiDecisionSchema, // accepted, edited, or rejected.
    editedValue: z.string().nullable().optional(), // The manual value a reviewer substitutes, for the "edited" path.
  })
  .superRefine((data, ctx) => {
    if (data.decision === "edited" && !data.editedValue) {
      // Rule: "edited" without a value is meaningless.
      ctx.addIssue({
        code: "custom", // Marks this as a custom Zod validation issue.
        message: "editedValue is required when decision is edited", // Clear API error surfaced to the client.
        path: ["editedValue"], // Points the error at the offending field.
      });
    }
  });
export type ExceptionDecisionBody = z.infer<typeof exceptionDecisionBodySchema>; // Enforces the edited-value invariant at the API boundary.

export const exceptionDecisionResponseSchema = z.object({
  aiDecision: aiDecisionSchema, // Echoes the recorded review decision.
  exceptionId: z.string(), // The exception that was reviewed.
  recordedAt: z.string(), // ISO timestamp the decision was persisted.
});
export type ExceptionDecisionResponse = z.infer<
  typeof exceptionDecisionResponseSchema
>; // Response contract for the decision endpoint.

export const exceptionListQuerySchema = z.object({
  batchId: z.string().optional(), // Filter to exceptions from one upload batch.
  limit: z.coerce.number().int().min(1).max(100).default(20), // Page size coerced from string, bounded, defaults to 20.
  page: z.coerce.number().int().min(1).default(1), // 1-based page number coerced from string.
  search: z.string().optional(), // Free-text search over exception messages.
  severity: severitySchema.optional(), // Optional severity filter.
  status: exceptionStatusSchema.optional(), // Optional status filter.
  type: exceptionTypeSchema.optional(), // Optional exception-type filter.
});
export type ExceptionListQuery = z.infer<typeof exceptionListQuerySchema>; // Parsed query params for the exception list endpoint.

export const aiExplainRequestSchema = z.object({
  exceptionId: z.string().min(1), // The exception whose AI reasoning should be explained; must be non-empty.
});
export type AiExplainRequest = z.infer<typeof aiExplainRequestSchema>; // Body/param contract for the explain endpoint.

// aiExplainResponseSchema: AI explanation payload carrying the same provenance metadata as every AI call.
export const aiExplainResponseSchema = z.object({
  code: z.string().optional(), // Optional error code when generation fails gracefully.
  error: z.string().optional(), // Optional friendly error message.
  exceptionId: z.string(), // The exception this explanation refers to.
  recommendation: aiRecommendationSchema.nullable(), // Full AI recommendation, or null when unavailable.
});
export type AiExplainResponse = z.infer<typeof aiExplainResponseSchema>; // Response contract for the explain endpoint.

export const aiSummarizeBatchRequestSchema = z.object({
  batchId: z.string().min(1), // The batch whose contents are summarized; must be non-empty.
});
export type AiSummarizeBatchRequest = z.infer<
  typeof aiSummarizeBatchRequestSchema
>; // Request contract for the batch-summary endpoint.

// aiSummarizeBatchResponseSchema: AI summary of a whole batch with provenance for auditability.
export const aiSummarizeBatchResponseSchema = z.object({
  batchId: z.string(), // Which batch this summary covers.
  code: z.string().optional(), // Optional error code on partial failure.
  error: z.string().optional(), // Optional error message for the caller.
  model: z.string(), // Model used, for provenance.
  summary: z.string().nullable(), // The generated summary, or null if generation failed.
  timestamp: z.string(), // ISO generation time for provenance.
});
export type AiSummarizeBatchResponse = z.infer<
  typeof aiSummarizeBatchResponseSchema
>; // Response contract for the batch-summary endpoint.

export const aiClassifySeverityRequestSchema = z.object({
  exceptionId: z.string().min(1), // The exception to re-score; must be non-empty.
});
export type AiClassifySeverityRequest = z.infer<
  typeof aiClassifySeverityRequestSchema
>; // Request contract for the severity classifier.

// aiClassifySeverityResponseSchema: AI severity re-scoring output with the model and reasoning attached.
export const aiClassifySeverityResponseSchema = z.object({
  code: z.string().optional(), // Optional error code on graceful failure.
  currentSeverity: severitySchema, // The severity already on the record.
  error: z.string().optional(), // Optional error message.
  exceptionId: z.string(), // The exception being scored.
  model: z.string(), // Model name, for provenance.
  reasoning: z.string().nullable(), // Why the AI chose that severity, when provided.
  suggestedSeverity: severitySchema.nullable(), // AI's recommended severity, or null when uncertain.
  timestamp: z.string(), // ISO generation time for provenance.
});
export type AiClassifySeverityResponse = z.infer<
  typeof aiClassifySeverityResponseSchema
>; // Response contract for the severity classifier.

export const aiDraftNoteRequestSchema = z.object({
  exceptionId: z.string().min(1), // The exception to draft a note for; must be non-empty.
});
export type AiDraftNoteRequest = z.infer<typeof aiDraftNoteRequestSchema>; // Request contract for the draft-note endpoint.

// aiDraftNoteResponseSchema: AI-drafted reviewer note with model and prompt metadata for trust.
export const aiDraftNoteResponseSchema = z.object({
  code: z.string().optional(), // Optional error code on graceful failure.
  error: z.string().optional(), // Optional error message.
  exceptionId: z.string(), // The exception the note targets.
  model: z.string(), // Model name, for provenance.
  note: z.string().nullable(), // The drafted note, or null when generation failed.
  promptSummary: z.string(), // What prompt was sent, making the output auditable.
  timestamp: z.string(), // ISO generation time for provenance.
});
export type AiDraftNoteResponse = z.infer<typeof aiDraftNoteResponseSchema>; // Response contract for the draft-note endpoint.

export const aiSuggestRuleRequestSchema = z.object({
  prompt: z.string().min(1).max(500), // Free-form user prompt describing the rule to suggest.
});
export type AiSuggestRuleRequest = z.infer<typeof aiSuggestRuleRequestSchema>; // Request contract for the rule-suggestion endpoint.

// aiSuggestRuleResponseSchema: AI-proposed validation rule with provenance and a structured rule body.
export const aiSuggestRuleResponseSchema = z.object({
  code: z.string().optional(), // Optional error code on graceful failure.
  error: z.string().optional(), // Optional error message.
  model: z.string(), // Model name, for provenance.
  note: z.string().optional(), // Optional supporting explanation for the suggestion.
  promptSummary: z.string(), // The prompt that produced this suggestion.
  rule: z
    .object({
      condition: z.unknown(), // Rule condition left loosely typed for flexible JSON.
      description: z.string(), // Human-readable rule description.
      exceptionType: exceptionTypeSchema, // What exception kind this rule produces.
      id: z.string(), // Rule id for referencing later.
      name: z.string(), // Short rule name.
      severity: severitySchema, // Default severity the rule assigns.
    })
    .nullable(), // The proposed rule, or null when the model could not produce one.
  timestamp: z.string(), // ISO generation time for provenance.
});
export type AiSuggestRuleResponse = z.infer<typeof aiSuggestRuleResponseSchema>; // Response contract for the rule-suggestion endpoint.
