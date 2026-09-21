import { z } from "zod"; // Zod v4 runtime validation for cross-cutting API response contracts.
import { roleSchema } from "./common.js"; // Reuses the role enum so auth responses match the RBAC vocabulary.

// paginationMetaSchema: the pagination block embedded in every paged response for consistent client handling.
export const paginationMetaSchema = z.object({
  limit: z.number().int().min(1), // Items per page, validated on output too.
  page: z.number().int().min(1), // Current 1-based page number.
  total: z.number().int().nonnegative(), // Total items across all pages.
  totalPages: z.number().int().nonnegative(), // Derived count of pages.
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>; // Shared pagination shape used app-wide.

// paginationQuerySchema: the query-string side of pagination, coercing strings to integers.
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20), // Page size coerced from string, clamped to 100, default 20.
  page: z.coerce.number().int().min(1).default(1), // Page number coerced from string, 1-based.
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>; // Query params accepted by list endpoints.

// paginatedResponseSchema: generic factory wrapping any item schema in the standard paged envelope.
export const paginatedResponseSchema = <T extends z.ZodTypeAny>(
  itemSchema: T // The schema of one page item.
) =>
  z.object({
    data: z.array(itemSchema), // The paged items, each validated against itemSchema.
    pagination: paginationMetaSchema, // The standard pagination metadata block.
  }); // Reduce duplication by building list responses from one envelope.

export const errorCodeSchema = z.enum([
  "BAD_REQUEST", // Request shape was invalid before validation.
  "UNAUTHORIZED", // No valid credentials were presented.
  "FORBIDDEN", // Authenticated but not allowed to do this.
  "NOT_FOUND", // The requested resource does not exist.
  "CONFLICT", // Request conflicts with current state.
  "PAYLOAD_TOO_LARGE", // Upload exceeded the size limit.
  "UNSUPPORTED_MEDIA_TYPE", // File content type was not accepted.
  "VALIDATION_ERROR", // Zod/validation rules rejected the payload.
  "INTERNAL_ERROR", // Unhandled server failure.
  "AI_UNAVAILABLE", // The AI service could not be reached.
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>; // Machine-readable error enum used by client handling.

// errorResponseSchema: uniform error envelope so the React app can map every API failure the same way.
export const errorResponseSchema = z.object({
  code: z.string(), // Error code for programmatic handling.
  error: z.string(), // Human-readable message for the UI.
  fields: z.record(z.string(), z.string()).optional(), // Per-field error messages when validation fails.
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>; // The error body contract for all endpoints.

export const healthResponseSchema = z.object({
  status: z.literal("ok"), // Literal value guarantees the endpoint only ever reports "ok" when healthy.
  timestamp: z.string(), // ISO time the health check ran.
});
export type HealthResponse = z.infer<typeof healthResponseSchema>; // Probe response used by load balancers/uptime checks.

export const authOkResponseSchema = z.object({
  ok: z.literal(true), // Literal forces success responses to always carry ok = true.
});
export type AuthOkResponse = z.infer<typeof authOkResponseSchema>; // Simple success marker for auth endpoints.

// meResponseSchema: the current authenticated user, including role for RBAC decisions in the UI.
export const meResponseSchema = z.object({
  email: z.email(), // Zod v4 email format check on the user's address.
  id: z.string(), // User id for API calls.
  name: z.string(), // Display name.
  role: roleSchema, // RBAC role that drives what the UI shows and enables.
});
export type MeResponse = z.infer<typeof meResponseSchema>; // Response contract for the /me endpoint.
