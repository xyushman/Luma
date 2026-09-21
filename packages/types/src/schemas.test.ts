import { describe, expect, it } from "bun:test"; // Vitest/bun:test basics: group tests, assert, and declare cases.
import {
  batchSummarySchema,
  exceptionDecisionBodySchema,
  loanListQuerySchema,
  uploadBatchSchema,
  verifiedLoanListItemSchema,
} from "./index.js"; // Imports the same public surface consumers use, proving the barrel exports fully work.

// Tests the batch summary contract, which dashboards rely on for exception histograms and counters.
describe("batchSummarySchema", () => {
  it("accepts valid summary with all 9 exception types", () => {
    const valid = {
      batchId: "clx_batch_001", // Any well-formed batch id.
      exceptionsBySeverity: {
        critical: 75, // Every severity key must be present for the record schema.
        high: 91,
        low: 20,
        medium: 60,
      }, // All four severity buckets supplied.
      exceptionsByType: {
        balance_error: 41, // Each of the nine known exception types gets a count.
        conflicting_source: 0, // Zero is allowed, proving nonnegative (not positive) is enforced.
        date_error: 22,
        duplicate: 34,
        invalid_state: 12,
        missing_field: 89,
        rate_out_of_range: 18,
        stale_record: 15,
        status_inconsistency: 27,
      }, // Super-set of the enum's exact members, so the record passes.
      failedValidation: 246, // Nonnegative integer counter.
      passedValidation: 742, // Nonnegative integer counter.
      totalImported: 988, // Sum that must match reality; schema just bounds it.
    }; // Fully valid payload for the summary endpoint.
    expect(batchSummarySchema.safeParse(valid).success).toBe(true); // safeParse returns success without throwing.
  });

  it("rejects unknown exception type", () => {
    const invalid = {
      batchId: "clx_batch_001", // Id stays fine; the type map is the problem.
      exceptionsBySeverity: { critical: 1, high: 0, low: 0, medium: 0 }, // Severity map is complete and valid.
      exceptionsByType: { unknown_type: 1 } as never, // Unknown key not in the enum; cast silences TS so the schema is the guard.
      failedValidation: 1,
      passedValidation: 0,
      totalImported: 0,
    }; // Payload sabotaged by an out-of-vocabulary exception type.
    expect(batchSummarySchema.safeParse(invalid).success).toBe(false); // The enum key restricts the record, so parsing fails.
  });
});

// Covers the list query contract, especially string-to-number coercion used on real query params.
describe("loanListQuerySchema", () => {
  it("coerces page string to number and defaults limit", () => {
    const parsed = loanListQuerySchema.parse({ page: "2" }); // Real browsers send strings; Zod coerce turns "2" into 2.
    expect(parsed.page).toBe(2); // Coercion produced the numeric page value.
    expect(parsed.limit).toBe(20); // Omitted limit falls back to the schema default of 20.
  });

  it("rejects page 0", () => {
    expect(() => loanListQuerySchema.parse({ page: 0 })).toThrow(); // min(1) guard fails on page zero, which is invalid.
  });
});

// Exercises the cross-field refinement on the AI decision body.
describe("exceptionDecisionBodySchema", () => {
  it("requires editedValue when decision is edited", () => {
    expect(
      exceptionDecisionBodySchema.safeParse({
        decision: "edited", // The edited verdict.
        editedValue: null, // But no replacement value supplied.
      }).success
    ).toBe(false); // superRefine fires: edited without editedValue must fail.
    expect(
      exceptionDecisionBodySchema.safeParse({
        decision: "edited", // Same verdict...
        editedValue: "340000", // ...now with a concrete replacement value.
      }).success
    ).toBe(true); // The invariant is satisfied, so parsing succeeds.
  });

  it("allows accepted without editedValue", () => {
    expect(
      exceptionDecisionBodySchema.safeParse({ decision: "accepted" }).success
    ).toBe(true); // accepted/rejected need no editedValue, so this is valid.
  });
});

// Verifies the reviewer-decision field on the verified loan list item.
describe("verifiedLoanListItemSchema", () => {
  it("rejects invalid reviewerDecision", () => {
    const base = {
      aiRecommendationUsed: false, // Keep every other field valid.
      id: "vl_1", // Shape string id.
      loan: { borrowerId: "B-1", loanId: "L-1" }, // Compact loan reference.
      loanId: "loan_1", // Loan this record covers.
      recordHash: "abc", // Arbitrary hash accepted by z.string().
      sourceBatchRef: "loan_tape.csv (batch_1)", // Free-form provenance label.
      validationResult: "passed" as const, // Const assertion keeps the literal type.
      verifiedAt: "2026-08-25T12:00:00.000Z", // ISO timestamp.
      verifiedById: "user_1", // Reviewer id.
    }; // Baseline payload all fields pass.
    expect(
      verifiedLoanListItemSchema.safeParse({
        ...base,
        reviewerDecision: "rejected_for_fun", // Bogus value outside the allowed enum.
      } as never).success
    ).toBe(false); // The reviewerDecision enum rejects the unknown value.
    expect(
      verifiedLoanListItemSchema.safeParse({
        ...base,
        reviewerDecision: "approved", // A real enum member.
      }).success
    ).toBe(true); // Known decisions parse cleanly.
  });
});

// Confirms the upload batch contract rejects unknown file types.
describe("uploadBatchSchema", () => {
  it("rejects invalid fileType", () => {
    expect(
      uploadBatchSchema.safeParse({
        createdAt: "2026-08-25T10:00:00.000Z", // Valid ISO timestamp.
        failedCount: 0, // Nonnegative counter.
        fileName: "test.csv", // Normal name.
        fileType: "invalid", // An unknown type not in the FileType enum.
        id: "batch_1", // Normal batch id.
        recordCount: 10, // Declared row count.
        status: "pending", // Valid status value.
      } as never).success
    ).toBe(false); // fileType schema tightens the contract, so the payload fails.
  });
});
