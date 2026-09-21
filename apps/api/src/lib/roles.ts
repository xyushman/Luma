// Import the app's Role union so normalization returns exactly the three contract values.
import type { Role } from "@repo/types";

/**
 * Narrow better-auth's `string` role to the app contract `Role`.
 * Unknown or non-standard values fail closed (return null -> 401).
 * Supported Better Auth roles outside the app set (e.g. "admin") are treated as unsupported.
 */
// Map Better Auth's loose string role onto the app's strict three-role contract; anything else fails closed.
export const normalizeRole = (
  value: string | null | undefined
): Role | null => {
  // Accept only the three app roles; anything else is rejected below.
  if (
    value === "data_operator" ||
    value === "reviewer" ||
    value === "data_consumer"
  ) {
    // Signal success by returning the validated role unchanged.
    return value;
  }
  // Log any non-empty unknown value so role misconfiguration becomes visible in the console.
  if (value !== null && value !== undefined && value !== "") {
    process.stderr.write(`[roles] unsupported role "${value}" rejected\n`);
  }
  // Return null for unknown roles so the auth guard can fail closed (401) instead of mis-authorizing.
  return null;
};
