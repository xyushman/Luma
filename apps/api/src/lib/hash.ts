// Node's built-in SHA-256 hasher; no external crypto dependency needed.
import { createHash } from "node:crypto";

/**
 * Deterministic canonicalization per security rules S5.
 * - Sorted keys (alphabetical) for stable ordering
 * - Undefined values omitted (no `undefined` in JSON)
 * - Decimal-like values already stringified before calling
 * - No locale formatting, no pretty-print spaces
 */
// Sort keys and drop undefined so the same logical record always serializes byte-identically.
export const canonicalize = (data: Record<string, unknown>): string => {
  // Alphabetical key order guarantees the output is stable regardless of insertion order.
  const sortedKeys = Object.keys(data).sort();
  // Build a fresh object that will hold only the defined fields, in sorted order.
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    // Read each field once; skipping undefined keeps it out of the serialized output.
    const value = data[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  // Compact JSON (no spaces) so identical input always yields an identical string.
  return JSON.stringify(sorted);
};

// Hash a normalized record to a lowercase hex string so equal records always produce equal hashes.
export const computeRecordHash = (
  canonicalData: Record<string, unknown>
): string =>
  // SHA-256 over the canonical JSON, hex-encoded for compact storage and easy comparison.
  createHash("sha256").update(canonicalize(canonicalData)).digest("hex");

/**
 * Normalize a Decimal / number / string monetary value to a stable string.
 * Preserves scale without locale formatting. Used before hashing.
 * - Prisma Decimal -> String(decimal) (e.g. "350000.00")
 * - number -> String(number)
 * - string trimmed -> as-is
 * - null/undefined -> null
 */
// Keep monetary fields stable for hashing: numbers stringify consistently and strings get trimmed.
export const normalizeDecimalString = (value: unknown): string | null => {
  // Missing values stay null so the hash genuinely reflects the absence of data.
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    // Trim whitespace and treat empty strings as absent so hashes do not vary by padding.
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  // Numbers and Prisma Decimals become plain strings with scale intact and no locale separators.
  return String(value);
};

// Normalize dates to a stable YYYY-MM-DD string (or null) so hashing is locale- and format-independent.
export const normalizeDateString = (
  value: Date | string | null | undefined
): string | null => {
  // Absent dates map to null so the record hash truthfully reflects missing data.
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    // Trim date strings; an empty value becomes null instead of corrupting the hash.
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (value instanceof Date) {
    // Reject invalid Date objects (NaN time) rather than hashing garbage.
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    // Take only the YYYY-MM-DD portion so the same day hashes identically across timezones.
    return value.toISOString().slice(0, 10);
  }
  // Anything unparseable is treated as missing rather than crashing the hashing pipeline.
  return null;
};
