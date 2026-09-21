import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Shared mutable batch state that the in-memory fake Prisma reads and writes.
let currentBatch: Record<string, unknown> = { metadata: {} };

// Import the real validation service, then stub only validateBatch to complete fast.
const actualValidation = await import("./validation.service.js");
mock.module("./validation.service.js", () => ({
  ...actualValidation,
  validateBatch: mock(async (batchId: string) => {
    const existing = await fakePrisma.uploadBatch.findUnique({
      where: { id: batchId },
    }); // Load the batch state from the fake.
    const existingMeta =
      (existing?.metadata as Record<string, unknown> | null) ?? {}; // Default metadata.
    await fakePrisma.uploadBatch.update({
      data: {
        ...existing, // Preserve existing batch fields.
        metadata: {
          ...existingMeta, // Preserve existing metadata.
          pipelineStage: "completed", // Mark validation stage complete.
          pipelineStep: 5,
        },
        status: "done", // Simulate a finished batch.
      },
      where: { id: batchId },
    });
  }),
})); // Stub out validateBatch so ingestion tests stay DB-free.

const fakePrisma: {
  $transaction: ReturnType<typeof mock>;
  auditLog: { create: ReturnType<typeof mock> };
  loan: { createMany: ReturnType<typeof mock> };
  uploadBatch: {
    findUnique: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
} = {
  auditLog: {
    create: mock(() => Promise.resolve({} as never)),
  },
  loan: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  uploadBatch: {
    findUnique: mock(() => Promise.resolve(currentBatch as never)),
    update: mock(
      (args: { data: Record<string, unknown>; where: { id: string } }) => {
        currentBatch = { ...currentBatch, ...args.data }; // Merge the update into the fake batch.
        return Promise.resolve(currentBatch as never);
      }
    ),
  },
} as unknown as {
  $transaction: ReturnType<typeof mock>;
  auditLog: { create: ReturnType<typeof mock> };
  loan: { createMany: ReturnType<typeof mock> };
  uploadBatch: {
    findUnique: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
};

(
  fakePrisma as unknown as {
    $transaction: ReturnType<typeof mock>;
  }
).$transaction = mock(
  (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      auditLog: { create: fakePrisma.auditLog.create },
      loan: { createMany: fakePrisma.loan.createMany },
      uploadBatch: {
        findUnique: fakePrisma.uploadBatch.findUnique,
        update: fakePrisma.uploadBatch.update,
      },
    } as never) // Transactions forward to the same fakes.
) as never;

mock.module("../lib/prisma.js", () => ({ prisma: fakePrisma })); // Swap the real Prisma client.

// Pull in the real ingestion functions plus the chunking constants under test.
const {
  parseDate,
  parseDecimal,
  parseIntSafe,
  normalizeRow,
  processStreamAndNormalize,
  CHUNK_SIZE,
  MAX_FAILED_ROWS_STORED,
} = await import("./ingestion.service.js");

// Reset every mock back to defaults so each test starts clean.
const resetMocks = () => {
  currentBatch = { metadata: {} }; // Reset the shared batch state.
  fakePrisma.loan.createMany = mock(() =>
    Promise.resolve({ count: 0 } as never)
  );
  fakePrisma.uploadBatch.update = mock(
    (args: { data: Record<string, unknown>; where: { id: string } }) => {
      currentBatch = { ...currentBatch, ...args.data }; // Merge the update into the fake batch.
      return Promise.resolve(currentBatch as never);
    }
  );
  fakePrisma.uploadBatch.findUnique = mock(() =>
    Promise.resolve(currentBatch as never)
  );
  fakePrisma.auditLog.create = mock(() => Promise.resolve({} as never));
  (
    fakePrisma as unknown as { $transaction: ReturnType<typeof mock> }
  ).$transaction = mock((callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      auditLog: { create: fakePrisma.auditLog.create },
      loan: { createMany: fakePrisma.loan.createMany },
      uploadBatch: {
        findUnique: fakePrisma.uploadBatch.findUnique,
        update: fakePrisma.uploadBatch.update,
      },
    } as never)
  ) as never;
};

describe("parseDate", () => {
  it("parses valid ISO date", () => {
    const d = parseDate("2022-03-15");
    expect(d).toBeInstanceOf(Date); // A real date string becomes a Date.
    expect(d?.toISOString().startsWith("2022-03-15")).toBe(true); // Date content is preserved.
  });

  it("parses valid date with time", () => {
    const d = parseDate("2026-08-20T00:00:00.000Z"); // Full timestamp input.
    expect(d).toBeInstanceOf(Date);
    expect(d?.getFullYear()).toBe(2026); // Year is extracted correctly.
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull(); // Empty strings mean no date.
    expect(parseDate("   ")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseDate(null)).toBeNull(); // Null is not a date.
    expect(parseDate(undefined)).toBeNull();
  });

  it("returns null for invalid date when not expecting throw", () => {
    const result = parseDate("not-a-date"); // Garbage should not crash.
    expect(result).toBeNull();
  });

  it("returns null for invalid date (pure, no throw)", () => {
    expect(parseDate("not-a-date")).toBeNull(); // Pure path never throws.
  });
});

describe("parseDecimal", () => {
  it("parses valid decimal string", () => {
    expect(parseDecimal("350000.00")).toBe(350_000); // Whole-dollar string parses.
    expect(parseDecimal("6.75")).toBe(6.75); // Fractional value parses.
  });

  it("parses numeric input", () => {
    expect(parseDecimal(123.45)).toBe(123.45); // Numbers pass through.
  });

  it("returns null for empty string", () => {
    expect(parseDecimal("")).toBeNull(); // Empty means no number.
    expect(parseDecimal("   ")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(parseDecimal("abc")).toBeNull(); // Non-numeric input is null.
    expect(parseDecimal("12abc")).toBeNull();
  });

  it("handles commas", () => {
    expect(parseDecimal("350,000.00")).toBe(350_000); // Thousands separators are stripped.
  });
});

describe("parseIntSafe", () => {
  it("parses valid int string", () => {
    expect(parseIntSafe("360")).toBe(360);
    expect(parseIntSafe("0")).toBe(0);
  });

  it("truncates decimals", () => {
    expect(parseIntSafe("360.9")).toBe(360); // Decimal input floors to an integer.
  });

  it("returns null for empty", () => {
    expect(parseIntSafe("")).toBeNull();
    expect(parseIntSafe("   ")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(parseIntSafe("abc")).toBeNull(); // Non-numeric input is null.
    expect(parseIntSafe("NaN")).toBeNull(); // NaN string is rejected.
  });

  it("returns null for null/undefined", () => {
    expect(parseIntSafe(null)).toBeNull();
    expect(parseIntSafe(undefined)).toBeNull();
  });
});

describe("normalizeRow", () => {
  const batchId = "batch_123";
  const rowNumber = 2;

  // A complete, valid CSV row in snake_case as normalization expects it.
  const baseRow: Record<string, string> = {
    borrower_id: "B-5001",
    borrower_state: "CA",
    credit_grade: "A",
    current_balance: "342000.00",
    days_past_due: "0",
    document_status: "complete",
    employment_length: "5-10 years",
    income_band: "100k-150k",
    interest_rate: "6.75",
    last_payment_date: "2026-08-01",
    last_updated_at: "2026-08-20",
    loan_id: "L-10001",
    loan_purpose: "purchase",
    loan_type: "mortgage",
    maturity_date: "2052-03-15",
    original_principal: "350000.00",
    origination_date: "2022-03-15",
    payment_status: "current",
    servicer_name: "First National",
    source_system: "origination",
    term_months: "360",
  };

  it("happy path full row -> correct Loan createMany input shape", () => {
    const result = normalizeRow({ ...baseRow }, batchId, rowNumber);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("expected success"); // Guard for TS narrowing.
    }
    const { data } = result;
    expect(data.loanId).toBe("L-10001"); // Loan id is carried over.
    expect(data.borrowerId).toBe("B-5001");
    expect(data.sourceBatchId).toBe(batchId); // Batch provenance is attached.
    expect(data.sourceRowNumber).toBe(rowNumber); // Original row number is kept.
    expect(data.loanType).toBe("mortgage");
    expect(data.originationDate).toBeInstanceOf(Date); // Dates are parsed to Date objects.
    expect(data.maturityDate).toBeInstanceOf(Date);
    expect(data.originalPrincipal).toBe(350_000); // Currency strings become numbers.
    expect(data.currentBalance).toBe(342_000);
    expect(data.interestRate).toBe(6.75);
    expect(data.termMonths).toBe(360);
    expect(data.borrowerState).toBe("CA");
    expect(data.loanPurpose).toBe("purchase");
    expect(data.creditGrade).toBe("A");
    expect(data.employmentLength).toBe("5-10 years"); // Free-text fields pass through.
    expect(data.incomeBand).toBe("100k-150k");
    expect(data.paymentStatus).toBe("current");
    expect(data.daysPastDue).toBe(0);
    expect(data.servicerName).toBe("First National");
    expect(data.lastPaymentDate).toBeInstanceOf(Date);
    expect(data.lastUpdatedAt).toBeInstanceOf(Date);
    expect(data.documentStatus).toBe("complete");
    expect(data.sourceSystem).toBe("origination");
    // dates as Date|null check
    expect(data.originationDate?.toISOString().startsWith("2022-03-15")).toBe(
      true // The parsed date keeps the exact day.
    );
  });

  it("row missing both ids -> failure entry with reason containing loan_id", () => {
    const bad = { ...baseRow, borrower_id: "  ", loan_id: "" };
    const result = normalizeRow(bad, batchId, 5);
    expect(result.success).toBe(false); // Missing ids mean a failed row.
    if (result.success) {
      throw new Error("expected failure");
    }
    expect(result.failedRow.rowNumber).toBe(5); // The failing row is identified.
    expect(result.failedRow.rawData).toBe(JSON.stringify(bad)); // Raw CSV is preserved.
    expect(result.failedRow.reason.toLowerCase()).toContain("loan_id"); // Reason names the missing id.
  });

  it("invalid origination_date -> failure entry", () => {
    const bad = { ...baseRow, origination_date: "not-a-date" };
    const result = normalizeRow(bad, batchId, 6);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected failure");
    }
    expect(result.failedRow.reason.toLowerCase()).toContain(
      "invalid date format" // Unparseable dates are reported.
    );
    expect(result.failedRow.reason.toLowerCase()).toContain("origination_date"); // Field name is included.
    expect(result.failedRow.rawData).toBe(JSON.stringify(bad));
  });

  it("invalid maturity_date -> failure", () => {
    // 13-40-2022 is actually invalid (month 13, day 40) but Date parsing may be lenient? Use clearly invalid
    const bad2 = { ...baseRow, maturity_date: "not-a-date" };
    const result = normalizeRow(bad2, batchId, 7);
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected failure");
    }
    expect(result.failedRow.reason.toLowerCase()).toContain(
      "invalid date format" // Same invalid-date handling as origination.
    );
  });

  it("empty dates become null not failure", () => {
    const row = { ...baseRow, maturity_date: "   ", origination_date: "" };
    const result = normalizeRow(row, batchId, 8);
    expect(result.success).toBe(true); // Blank dates are tolerated.
    if (!result.success) {
      throw new Error("expected success");
    }
    expect(result.data.originationDate).toBeNull(); // Empty maps to null.
    expect(result.data.maturityDate).toBeNull();
  });

  it("garbage numbers become null not failure", () => {
    const row = {
      ...baseRow,
      original_principal: "abc",
      term_months: "not-a-number",
    };
    const result = normalizeRow(row, batchId, 9);
    expect(result.success).toBe(true); // Bad numbers are tolerated.
    if (!result.success) {
      throw new Error("expected success");
    }
    expect(result.data.originalPrincipal).toBeNull(); // They become null.
    expect(result.data.termMonths).toBeNull();
  });

  it("never throws - returns failure object instead", () => {
    const row = { ...baseRow, borrower_id: "", loan_id: "" };
    expect(() => normalizeRow(row, batchId, 10)).not.toThrow(); // Errors are captured, not thrown.
    const result = normalizeRow(row, batchId, 10);
    expect(result.success).toBe(false);
  });
});

describe("CHUNK_SIZE", () => {
  it("exports CHUNK_SIZE as 5000", () => {
    expect(CHUNK_SIZE).toBe(5000); // Rows per DB batch insert.
  });

  it("exports MAX_FAILED_ROWS_STORED as 1000", () => {
    expect(MAX_FAILED_ROWS_STORED).toBe(1000); // Cap on stored failure details.
  });
});

describe("processStreamAndNormalize end-to-end", () => {
  beforeEach(() => {
    resetMocks();
    // default findUnique returns empty metadata
    fakePrisma.uploadBatch.findUnique = mock(() =>
      Promise.resolve({ metadata: {} } as never)
    );
    // default createMany returns count based on data length
    fakePrisma.loan.createMany = mock(
      (args: { data: unknown[] }) =>
        Promise.resolve({ count: (args.data as unknown[]).length } as never) // Simulated insert returns real length.
    );
    fakePrisma.uploadBatch.update = mock(() => Promise.resolve({} as never));
    fakePrisma.auditLog.create = mock(() => Promise.resolve({} as never));
  });

  afterEach(() => {
    mock.restore(); // Undo all module mocks after each test.
  });

  const csvHeader =
    "loan_id,borrower_id,loan_type,origination_date,maturity_date,original_principal,current_balance,interest_rate,term_months,borrower_state,loan_purpose,credit_grade,employment_length,income_band,payment_status,days_past_due,servicer_name,last_payment_date,last_updated_at,document_status,source_system";

  const validRow = (id: number) =>
    `L-1000${id},B-500${id},mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`;

  it("3 valid rows + 1 bad row -> createMany called with 3 rows, batch done with failedCount=1", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-")); // Unique temp dir per test.
    const filePath = path.join(tmpDir, "test.csv");
    const batchId = "batch_test_001";

    const badRow =
      ",,mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination";

    const csvContent = [
      csvHeader, // Header row is skipped by normalization.
      validRow(1),
      validRow(2),
      badRow, // This row is missing both ids.
      validRow(3),
    ].join("\n");

    fs.writeFileSync(filePath, csvContent, "utf8"); // Write the fixture CSV.

    try {
      await processStreamAndNormalize(filePath, batchId); // Run the whole ingestion path.

      // createMany should have been called at least once with 3 rows
      expect(fakePrisma.loan.createMany).toHaveBeenCalled();
      const { calls } = (
        fakePrisma.loan.createMany as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      // flatten all inserted rows across calls
      let totalInserted = 0;
      for (const call of calls) {
        const args = call[0] as { data: unknown[]; skipDuplicates: boolean };
        expect(args.skipDuplicates).toBe(true); // Chunks avoid duplicate re-inserts.
        totalInserted += args.data.length;
        // each data row should have sourceBatchId and sourceRowNumber
        for (const row of args.data as Record<string, unknown>[]) {
          expect(row.sourceBatchId).toBe(batchId);
          expect(typeof row.sourceRowNumber).toBe("number");
          expect((row.sourceRowNumber as number) >= 2).toBe(true); // Data rows start after the header.
        }
      }
      expect(totalInserted).toBe(3); // Only the 3 valid rows are inserted.

      // batch updated to done with failedCount=1, failedRows persisted
      expect(fakePrisma.uploadBatch.update).toHaveBeenCalled();
      const { calls: updateCalls } = (
        fakePrisma.uploadBatch.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      const doneCall = updateCalls.find(
        (c) => (c[0] as { data: { status?: string } }).data.status === "done" // Batch ends in done state.
      );
      expect(doneCall).toBeDefined();

      const countsCall = updateCalls.find(
        (c) =>
          (c[0] as { data: { recordCount?: number } }).data.recordCount !==
          undefined // Counts update carries recordCount.
      );
      expect(countsCall).toBeDefined();
      const [countsUpdate] = countsCall as unknown as [
        { where: { id: string }; data: Record<string, unknown> },
      ];
      expect(countsUpdate.where.id).toBe(batchId); // Counts target the right batch.
      expect(countsUpdate.data.failedCount).toBe(1); // One bad row counted.
      expect(countsUpdate.data.recordCount).toBe(4); // Four data rows total.
      expect(countsUpdate.data.processedCount).toBe(3); // Three processed successfully.
      const metadata = countsUpdate.data.metadata as Record<string, unknown>;
      expect(Array.isArray(metadata.failedRows)).toBe(true); // Failed rows stored as an array.
      expect((metadata.failedRows as unknown[]).length).toBe(1);
      const [failedEntry] = metadata.failedRows as Record<string, unknown>[];
      expect(failedEntry).toBeDefined();
      if (!failedEntry) {
        throw new Error("expected failedEntry");
      }
      expect(String(failedEntry.reason).toLowerCase()).toContain("loan_id"); // Reason reflects the bad row.

      // LOAN_IMPORTED audit logs written (one per chunk)
      const { calls: auditCalls } = (
        fakePrisma.auditLog.create as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      const loanImported = auditCalls.filter(
        (c) =>
          (c[0] as { data: { eventType: string } }).data.eventType ===
          "LOAN_IMPORTED" // Import audit per chunk.
      );
      expect(loanImported.length).toBe(1); // Single chunk -> one audit.
      const loanImportedEntry = loanImported[0] as unknown as [
        { data: { metadata: Record<string, unknown> } },
      ];
      const [loanImportedCall] = loanImportedEntry;
      const { metadata: loanMeta } = loanImportedCall.data;
      expect(loanMeta.inserted).toBe(3); // Audit reports inserted count.
      expect(typeof loanMeta.rowStart).toBe("number");
      expect(typeof loanMeta.rowEnd).toBe("number");

      // INGESTION_COMPLETED log present
      const completed = auditCalls.filter(
        (c) =>
          (c[0] as { data: { eventType: string } }).data.eventType ===
          "INGESTION_COMPLETED" // Final completion audit.
      );
      expect(completed.length).toBe(1);
      const completedEntry = completed[0] as unknown as [
        { data: { metadata: Record<string, unknown> } },
      ];
      const [completedCall] = completedEntry;
      const { metadata: compMeta } = completedCall.data;
      expect(compMeta.totalRows).toBe(4); // Completion audit totals the CSV.
      expect(compMeta.validInserted).toBe(3);
      expect(compMeta.failedCount).toBe(1);

      // initial processing status call present
      const firstUpdateEntry = updateCalls[0] as unknown as [
        { data: Record<string, unknown> },
      ];
      const [firstUpdate] = firstUpdateEntry;
      expect(firstUpdate.data.status).toBe("processing"); // First update flips to processing.
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true }); // Always clean up the temp dir.
    }
  });

  it("handles BOM and empty rows", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-bom-"));
    const filePath = path.join(tmpDir, "bom.csv");
    const batchId = "batch_bom_001";

    const bom = "\uFEFF"; // UTF-8 byte-order mark.
    const csvContent =
      bom +
      csvHeader +
      "\n" +
      validRow(1) +
      "\n" +
      "\n" + // empty row
      validRow(2) +
      "\n";

    fs.writeFileSync(filePath, csvContent, "utf8");

    try {
      await processStreamAndNormalize(filePath, batchId);
      const { calls } = (
        fakePrisma.loan.createMany as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      let total = 0;
      for (const c of calls) {
        total += (c[0] as { data: unknown[] }).data.length;
      }
      expect(total).toBe(2); // BOM and blank rows are skipped.

      const { calls: updateCalls } = (
        fakePrisma.uploadBatch.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      const countsCall = updateCalls.find(
        (c) =>
          (c[0] as { data: { recordCount?: number } }).data.recordCount !==
          undefined
      );
      expect(countsCall).toBeDefined();
      const [countsUpdate] = countsCall as unknown as [
        { data: Record<string, unknown> },
      ];
      expect(countsUpdate.data.recordCount).toBe(2); // Blank rows not counted.
      expect(countsUpdate.data.failedCount).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it("caps failedRows at 1000 and sets truncated flag", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-cap-"));
    const filePath = path.join(tmpDir, "cap.csv");
    const batchId = "batch_cap_001";

    const badRow =
      ",,mortgage,invalid-date,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination";
    const rows = Array.from({ length: 1005 }, () => badRow); // 1005 bad rows exceeds the cap.
    const csvContent = [csvHeader, ...rows].join("\n");
    fs.writeFileSync(filePath, csvContent, "utf8");

    try {
      await processStreamAndNormalize(filePath, batchId);
      const { calls: updateCalls } = (
        fakePrisma.uploadBatch.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      const lastEntry = updateCalls.at(-1) as unknown as [
        { data: Record<string, unknown> },
      ];
      const [last] = lastEntry;
      const meta = last.data.metadata as Record<string, unknown>;
      expect((meta.failedRows as unknown[]).length).toBe(1000); // Stored failures hit the cap.
      expect(meta.failedRowsTruncated).toBe(true); // Truncation flag is set.
      expect(meta.totalFailedRows).toBe(1005); // Total count is still accurate.
      expect(last.data.failedCount).toBe(1005);
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });
});

describe("processStreamAndNormalize error path", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("db error -> batch marked failed with error in metadata, no throw escapes", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-err-"));
    const filePath = path.join(tmpDir, "err.csv");
    const batchId = "batch_err_001";

    const csvHeader =
      "loan_id,borrower_id,loan_type,origination_date,maturity_date,original_principal,current_balance,interest_rate,term_months,borrower_state,loan_purpose,credit_grade,employment_length,income_band,payment_status,days_past_due,servicer_name,last_payment_date,last_updated_at,document_status,source_system";
    const validRow =
      "L-10001,B-5001,mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination";
    const csvContent = [csvHeader, validRow].join("\n");
    fs.writeFileSync(filePath, csvContent, "utf8");

    fakePrisma.uploadBatch.findUnique = mock(
      () => Promise.resolve({ metadata: { existing: "keep" } } as never) // Pre-existing metadata to preserve.
    );
    fakePrisma.loan.createMany = mock(
      () => Promise.reject(new Error("db boom")) // Force the insert to fail.
    );
    fakePrisma.uploadBatch.update = mock(() => Promise.resolve({} as never));
    fakePrisma.auditLog.create = mock(() => Promise.resolve({} as never));

    try {
      await expect(
        processStreamAndNormalize(filePath, batchId)
      ).resolves.toBeUndefined(); // DB errors are swallowed, not thrown.

      // should have marked failed at least once after error
      const { calls: updateCalls } = (
        fakePrisma.uploadBatch.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      // first is processing, later is failed
      const failedCall = updateCalls.find(
        (c) => (c[0] as { data: { status: string } }).data.status === "failed" // Batch flips to failed.
      );
      expect(failedCall).toBeDefined();
      const failedCallEntry = failedCall as unknown as [
        { data: { metadata: Record<string, unknown> } },
      ];
      const [failedArg] = failedCallEntry;
      const { data: failedData } = failedArg;
      expect(String(failedData.metadata.error).toLowerCase()).toContain(
        "db boom" // The error is recorded in metadata.
      );
      // existing metadata preserved
      expect(failedData.metadata.existing).toBe("keep"); // Old metadata survives the failure.

      // no throw escapes - we already asserted resolves
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
      resetMocks();
    }
  });

  it("stream error (missing file) -> batch marked failed", async () => {
    const batchId = "batch_missing_001";
    const missingPath = path.join(os.tmpdir(), `nonexistent-${Date.now()}.csv`); // Guaranteed missing file.

    fakePrisma.uploadBatch.findUnique = mock(() =>
      Promise.resolve({ metadata: {} } as never)
    );
    fakePrisma.uploadBatch.update = mock(() => Promise.resolve({} as never));

    await expect(
      processStreamAndNormalize(missingPath, batchId)
    ).resolves.toBeUndefined(); // Missing-file errors are swallowed too.

    const { calls: updateCalls } = (
      fakePrisma.uploadBatch.update as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock;
    const failed = updateCalls.find(
      (c) => (c[0] as { data: { status: string } }).data.status === "failed" // Batch still marked failed.
    );
    expect(failed).toBeDefined(); // The failed status update exists.
  });
});
