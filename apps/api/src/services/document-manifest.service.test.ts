import { describe, expect, it } from "bun:test";
import {
  buildApplyWindows,
  buildOrphanCleanupWhere,
  decideManifestStatus,
  type ManifestRow,
  normalizeManifestRow,
  validateManifestHeaders,
} from "./document-manifest.service.js";

describe("buildApplyWindows", () => {
  it("keeps each loan's rows together and respects the window cap", () => {
    const group = (loanId: string, count: number, startAt = 0): ManifestRow[] =>
      Array.from({ length: count }, (_, i) => ({
        available: true,
        documentType: "deed",
        loanId,
        rowNumber: startAt + i + 1,
      }));

    // 3 + 2 + 9999 + 1 rows: cap is 5000 → [3,2] window, [9999] intact
    // oversized single-group window, [1] window.
    const groups = [
      group("A", 3),
      group("B", 2),
      group("BIG", 9999),
      group("C", 1),
    ];
    const windows = buildApplyWindows(groups);
    expect(windows.length).toBe(3); // Windows: [A+B], [BIG], [C].
    expect(windows[0]?.length).toBe(5); // Small groups merge into one window.
    expect(windows[1]?.length).toBe(9999); // Oversized group keeps its own window.
    expect(windows[2]?.length).toBe(1); // Trailing group gets its own window.
    // Loan B's rows must never be split across windows.
    const bRows = windows.flat().filter((r) => r.loanId === "B");
    expect(bRows.length).toBe(2); // B appears exactly twice, together.
  });

  it("returns empty for no groups and single window for small input", () => {
    expect(buildApplyWindows([])).toEqual([]); // No input, no windows.
    const one = buildApplyWindows([
      [{ available: true, documentType: "d", loanId: "L", rowNumber: 1 }],
    ]);
    expect(one.length).toBe(1); // Tiny input fits one window.
  });
});

// Helper that builds a manifest row with per-call fields.
const mkRow = (
  loanId: string,
  available: boolean,
  documentType: string | null = "deed",
  rowNumber = 1
): ManifestRow => ({
  available,
  documentType,
  loanId,
  rowNumber,
});

describe("normalizeManifestRow", () => {
  it("parses a valid snake_case row", () => {
    const result = normalizeManifestRow(
      { available: "true", document_type: "deed_of_trust", loan_id: "L-1" }, // Standard CSV columns.
      2
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.row.loanId).toBe("L-1"); // Loan id maps through.
      expect(result.row.documentType).toBe("deed_of_trust");
      expect(result.row.available).toBe(true); // "true" boolean-coerces.
      expect(result.row.rowNumber).toBe(2); // Source row number preserved.
    }
  });

  it("accepts camelCase header variants with BOM handled upstream", () => {
    const result = normalizeManifestRow(
      { available: "y", documentType: "title", loanId: "L-2" }, // camelCase headers.
      3
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.row.available).toBe(true); // "y" counts as true.
      expect(result.row.documentType).toBe("title");
    }
  });

  it("normalizes Title Case / spaced headers the same way as the header gate", () => {
    // validateManifestHeaders accepts "Loan Id, Document Type, Available";
    // row parsing must agree or the batch would complete with all rows failed.
    const result = normalizeManifestRow(
      { Available: "no", "Document Type": "deed", "Loan Id": "L-3" }, // Title Case headers.
      4
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.row.loanId).toBe("L-3");
      expect(result.row.documentType).toBe("deed");
      expect(result.row.available).toBe(false); // "no" counts as false.
    }
  });

  it("coerces the full boolean matrix", () => {
    const trueValues = ["1", "true", "TRUE", "Y", "yes"];
    for (const v of trueValues) {
      const result = normalizeManifestRow(
        { available: v, document_type: "x", loan_id: "L" },
        1
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.row.available).toBe(true); // All truthy spellings coerce.
      }
    }
    const falseValues = ["0", "false", "FALSE", "N", "no"];
    for (const v of falseValues) {
      const result = normalizeManifestRow(
        { available: v, document_type: "x", loan_id: "L" },
        1
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.row.available).toBe(false); // All falsy spellings coerce.
      }
    }
  });

  it("fails on missing loan_id", () => {
    const result = normalizeManifestRow(
      { available: "true", document_type: "deed" }, // No loan id at all.
      4
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedRow.reason).toContain("loan_id"); // Reason names the gap.
      expect(result.failedRow.rowNumber).toBe(4);
      expect(JSON.parse(result.failedRow.rawData)).toEqual({
        available: "true", // Raw input is preserved for inspection.
        document_type: "deed",
      });
    }
  });

  it("fails on invalid boolean values", () => {
    for (const v of ["maybe", "", "2", "-1"]) {
      const result = normalizeManifestRow(
        { available: v, document_type: "deed", loan_id: "L-1" },
        5
      );
      expect(result.success).toBe(false); // Unsupported spelling fails.
      if (!result.success) {
        expect(result.failedRow.reason).toContain("available"); // Reason points at the field.
      }
    }
  });
});

describe("validateManifestHeaders", () => {
  it("accepts recognized headers", () => {
    expect(
      validateManifestHeaders(["loan_id", "document_type", "available"]) // Canonical names.
    ).toBeNull();
    expect(
      validateManifestHeaders(["Loan Id", "DOCUMENT TYPE", "Available"]) // Case-insensitive.
    ).toBeNull();
    expect(
      validateManifestHeaders(["loanid", "documenttype", "available"]) // Space-stripped names.
    ).toBeNull();
    expect(validateManifestHeaders(["\uFEFFloan_id", "available"])).toBeNull(); // BOM-prefixed header.
    expect(validateManifestHeaders([])).toBeNull(); // Empty header rows are tolerated.
  });

  it("rejects files without required manifest columns and reports missing names", () => {
    const error1 = validateManifestHeaders(["foo", "bar"]);
    expect(error1).toContain("header mismatch"); // Generic mismatch text.
    expect(error1).toContain("loan_id, available"); // All missing names listed.

    const error2 = validateManifestHeaders(["loan_id", "document_type"]);
    expect(error2).toContain("header mismatch");
    expect(error2).toContain("available"); // Only the missing one is named.

    const error3 = validateManifestHeaders(["document_type", "available"]);
    expect(error3).toContain("header mismatch");
    expect(error3).toContain("loan_id");
  });
});

describe("decideManifestStatus", () => {
  it("returns complete when all documents are available", () => {
    const decision = decideManifestStatus([
      mkRow("L-1", true, "deed"),
      mkRow("L-1", true, "title"),
    ]);
    expect(decision.documentStatus).toBe("complete"); // Every doc present.
    expect(decision.missingDocumentTypes).toEqual([]); // Nothing missing.
  });

  it("returns missing when any document is unavailable, listing them", () => {
    const decision = decideManifestStatus([
      mkRow("L-1", true, "deed", 3), // Deed is available.
      mkRow("L-1", false, "title", 4), // Title is missing.
      mkRow("L-1", false, "insurance", 7), // Insurance is missing.
    ]);
    expect(decision.documentStatus).toBe("missing"); // Any gap means missing.
    expect(decision.missingDocumentTypes).toEqual(["title", "insurance"]); // Types listed.
    expect(decision.sourceRowNumbers).toEqual([3, 4, 7]); // Source rows all listed.
  });

  it("falls back to 'unknown' for missing docs without a type", () => {
    const decision = decideManifestStatus([mkRow("L-1", false, null)]); // Missing with no type name.
    expect(decision.missingDocumentTypes).toEqual(["unknown"]); // Fallback label.
    expect(decision.documentStatus).toBe("missing");
  });
});

describe("buildOrphanCleanupWhere", () => {
  it("scopes deletion to open unreviewed exceptions of this manifest batch only", () => {
    const where = buildOrphanCleanupWhere("batch_123") as Record<
      string,
      unknown
    >;
    expect(where.exceptionType).toBe("missing_field"); // Only manifest-style exceptions.
    expect(where.reviewerId).toBeNull(); // Never touch reviewed exceptions.
    expect(where.status).toBe("open"); // Only open ones.
    expect(where.metadata).toEqual({
      equals: "batch_123", // Scoped to this exact batch.
      path: ["manifestBatchId"],
    });
  });
});
