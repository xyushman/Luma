// Import zod so thresholds can be parsed, validated, and defaulted from stored rows or test input.
import { z } from "zod";

// Schema for the tunable validation thresholds that live in ValidationSetting rows.
const thresholdsSchema = z.object({
  // Max loans per borrower before the duplicate-borrower rule fires; default is 5.
  duplicateBorrowerThreshold: z.number().int().positive().default(5),
  // Interest rates above 40% trigger the rate-max validation rule.
  interestRateMax: z.number().default(40),
  // Floor of 0% so impossible negative rates are caught by the rate-min rule.
  interestRateMin: z.number().default(0),
  // Data not updated for over 90 days is flagged as stale by the stale-data rule.
  staleDaysThreshold: z.number().int().positive().default(90),
});

// Export the inferred TypeScript shape so consumers get full type safety on thresholds.
export type ValidationThresholds = z.infer<typeof thresholdsSchema>;

// Parse raw stored settings (e.g. a ValidationSetting JSON blob) or fall back to defaults when absent.
export const loadThresholds = (raw?: unknown): ValidationThresholds => {
  // No stored settings means every threshold keeps its documented default.
  if (raw === undefined || raw === null) {
    return thresholdsSchema.parse({});
  }
  // Validate and normalize whatever settings were stored against the schema.
  return thresholdsSchema.parse(raw);
};

// Precomputed default object for code paths that want constants without a DB read.
export const defaultThresholds: ValidationThresholds = thresholdsSchema.parse(
  {}
);
