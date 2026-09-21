import { z } from "zod"; // Zod v4 runtime validation for audit-trail contracts.
import {
  auditEventTypeSchema,
  exceptionTypeSchema,
  roleSchema,
  severitySchema,
} from "./common.js"; // Shared enums reused so audit records use the same role/event vocabulary as the rest of the app.

// auditActorSchema: identifies who or what performed an action, including their role at the time.
export const auditActorSchema = z.object({
  id: z.string(), // User or system id that performed the action.
  name: z.string(), // Display name captured for the log.
  role: roleSchema.nullable(), // Role at action time; null for system actors.
});
export type AuditActor = z.infer<typeof auditActorSchema>; // Actor identity embedded in every audit entry.

// auditLogEntrySchema: one immutable audit event; before/after field snapshots ride along in metadata.
export const auditLogEntrySchema = z.object({
  actor: auditActorSchema.nullable(), // Who acted; null when unauthenticated/system.
  createdAt: z.string(), // ISO timestamp the event occurred.
  eventType: auditEventTypeSchema, // Canonical action name from the audit vocabulary.
  id: z.string(), // Audit entry id for reference.
  metadata: z.unknown().nullable().optional(), // Flexible bag for before/after payloads and extra context.
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>; // The audit log contract consumed by the UI.

export const auditTrailResponseSchema = z.object({
  data: z.array(auditLogEntrySchema), // Paged audit entries for a loan.
  loanId: z.string(), // The loan this trail belongs to.
  // Standard pagination block shared across list endpoints.
  pagination: z.object({
    limit: z.number().int().min(1), // Items per page, validated on output too.
    page: z.number().int().min(1), // Current page number.
    total: z.number().int().nonnegative(), // Total entries across pages.
    totalPages: z.number().int().nonnegative(), // Derived page count.
  }),
});
export type AuditTrailResponse = z.infer<typeof auditTrailResponseSchema>; // Response contract for a loan's audit trail.

export const auditListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50), // Page size coerced from string; defaults to 50 for logs.
  page: z.coerce.number().int().min(1).default(1), // 1-based page number coerced from string.
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>; // Query params for audit list endpoints.

// summaryOverviewSchema: headline counters for the dashboard overview card.
export const summaryOverviewSchema = z.object({
  openExceptions: z.number().int().nonnegative(), // Exceptions still awaiting review.
  qualityScore: z.number().min(0).max(100), // Overall data quality percentage.
  totalBatches: z.number().int().nonnegative(), // Upload batches processed so far.
  totalExceptions: z.number().int().nonnegative(), // All exceptions ever raised.
  totalLoansImported: z.number().int().nonnegative(), // Loans successfully imported.
  verifiedLoans: z.number().int().nonnegative(), // Loans finalized into verified records.
});
export type SummaryOverview = z.infer<typeof summaryOverviewSchema>; // KPI block returned by the summary endpoint.

// summaryResponseSchema: dashboard summary with severity/type histograms and recent activity feed.
export const summaryResponseSchema = z.object({
  // Severity histogram for charts.
  exceptionsBySeverity: z.record(
    severitySchema, // Key constrained to the four severity levels.
    z.number().int().nonnegative() // Count per severity bucket.
  ),
  // Type histogram for charts.
  exceptionsByType: z.record(
    exceptionTypeSchema, // Key constrained to known exception types.
    z.number().int().nonnegative() // Count per exception type.
  ),
  overview: summaryOverviewSchema, // The headline KPI counters.
  // Latest audit entries shown in the activity feed.
  recentActivity: z.array(
    z.object({
      actor: z.string().nullable(), // Actor display name or null for system events.
      eventType: auditEventTypeSchema, // Which canonical action occurred.
      loanId: z.string().nullable().optional(), // Related loan id when the event touches one.
      timestamp: z.string(), // ISO time of the activity.
    })
  ),
});
export type SummaryResponse = z.infer<typeof summaryResponseSchema>; // Full dashboard summary contract.
