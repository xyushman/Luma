import type { ExceptionStatus, ExceptionType, Severity } from "@repo/types"; // Status/type/severity shared enums

// Serializable filter state for the exception queue; "" means "no filter" for a field.
export interface ExceptionListFilters {
  batchId: string; // Restricts the queue to one upload batch
  page: number; // 1-based page number for pagination
  search: string; // Free-text search on loan/borrower identifiers
  severity: Severity | ""; // critical/high/medium/low or unfiltered
  status: ExceptionStatus | ""; // open/approved/rejected/corrected or unfiltered
  type: ExceptionType | ""; // Exception category or unfiltered
}

// Default filter set: first page, no criteria, but status defaults to "open"
// so reviewers land on actionable queue items instead of the full archive.
export const EMPTY_EXCEPTION_FILTERS: ExceptionListFilters = {
  batchId: "",
  page: 1,
  search: "",
  severity: "",
  status: "open", // Open by default so the queue starts in its most useful state
  type: "",
};
