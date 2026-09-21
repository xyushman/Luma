import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { normalizeRow } from "./ingestion.service.js";

describe("6k Loan Tape CSV verification", () => {
  // Plausible locations for the generated tape, order = preference.
  const candidatePaths = [
    path.resolve(process.cwd(), "loan_tape_6k.csv"),
    path.resolve(process.cwd(), "../../loan_tape_6k.csv"),
    path.resolve(process.cwd(), "sample-files/loan_tape_6k.csv"),
    path.resolve(process.cwd(), "../../sample-files/loan_tape_6k.csv"),
    path.resolve(import.meta.dirname, "../../../../../loan_tape_6k.csv"),
    path.resolve(import.meta.dirname, "../../../../loan_tape_6k.csv"),
    path.resolve(import.meta.dirname, "../../../loan_tape_6k.csv"),
  ];
  // Use the first existing file, or fall back to the first candidate for the error message.
  const csvPath =
    candidatePaths.find((p) => fs.existsSync(p)) ?? candidatePaths[0] ?? "";

  it("exists and has exactly 6001 lines with 21 columns", () => {
    expect(fs.existsSync(csvPath)).toBe(true); // The tape must exist.
    const content = fs.readFileSync(csvPath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(6001); // 6000 data rows + 1 header line.

    const [header] = lines;
    const headers = (header ?? "").split(",");
    expect(headers.length).toBe(21); // Fannie/Freddie-compatible column count.
    expect(headers[0]).toBe("loan_id"); // Header order starts with loan_id.
    expect(headers[1]).toBe("borrower_id");
    expect(headers[20]).toBe("source_system"); // Last column is source_system.
  });

  it("normalizes correctly and catches expected failedRows", () => {
    const content = fs.readFileSync(csvPath, "utf8");
    const lines = content.trim().split("\n");
    const [header] = lines;
    const headers = (header ?? "").split(",");

    let normalizedCount = 0;
    let failedCount = 0;

    for (let i = 1; i < lines.length; i += 1) {
      // Skip the header row.
      const line = lines[i];
      if (!line) {
        continue; // Skipping blank lines.
      }
      const values = line.split(",");
      const row: Record<string, string> = {};
      for (const [idx, h] of headers.entries()) {
        row[h] = values[idx] ?? ""; // Pair each header with its value.
      }

      const res = normalizeRow(row, "test_batch", i + 1); // Normalize as the pipeline would.
      if (res.success) {
        normalizedCount += 1; // Count successful rows.
      } else {
        failedCount += 1; // Count injectable anomalies.
      }
    }

    expect(normalizedCount).toBe(5970); // 5970 rows pass normalization.
    expect(failedCount).toBe(30); // 30 seeded-bad rows are caught.
  });
});
