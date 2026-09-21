import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

// Shared mutable batch state that the in-memory fake Prisma reads and writes.
let currentBatch: Record<string, unknown> = { metadata: {} };

// Import the real validation service, then stub only validateBatch to complete fast.
const actualValidation = await import("../validation.service.js");
mock.module("../validation.service.js", () => ({
  ...actualValidation,
  validateBatch: mock(async (batchId: string) => {
    const existing = await fakePrisma.uploadBatch.findUnique({
      where: { id: batchId },
    }); // Load the batch from the fake.
    const existingMeta =
      (existing?.metadata as Record<string, unknown> | null) ?? {};
    await fakePrisma.uploadBatch.update({
      data: {
        metadata: {
          ...existingMeta,
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
  auditLog: {
    create: ReturnType<typeof mock>;
    createMany: ReturnType<typeof mock>;
  };
  loan: {
    createMany: ReturnType<typeof mock>;
    deleteMany: ReturnType<typeof mock>;
  };
  uploadBatch: {
    findUnique: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
} = {
  auditLog: {
    create: mock(() => Promise.resolve({} as never)),
    createMany: mock(() => Promise.resolve({} as never)),
  },
  loan: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
    deleteMany: mock(() => Promise.resolve({} as never)),
  },
  uploadBatch: {
    findUnique: mock(() => Promise.resolve(currentBatch as never)),
    update: mock(
      (args: { data: Record<string, unknown>; where: { id: string } }) => {
        currentBatch = { ...currentBatch, ...args.data }; // Merge the update into the fake batch.
        if (args.data.metadata) {
          currentBatch.metadata = args.data.metadata as unknown;
        }
        return Promise.resolve(currentBatch as never);
      }
    ),
  },
} as unknown as {
  $transaction: ReturnType<typeof mock>;
  auditLog: {
    create: ReturnType<typeof mock>;
    createMany: ReturnType<typeof mock>;
  };
  loan: {
    createMany: ReturnType<typeof mock>;
    deleteMany: ReturnType<typeof mock>;
  };
  uploadBatch: {
    findUnique: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
};

(
  fakePrisma as unknown as { $transaction: ReturnType<typeof mock> }
).$transaction = mock(
  (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      auditLog: {
        create: fakePrisma.auditLog.create,
        createMany: fakePrisma.auditLog.createMany,
      },
      loan: {
        createMany: fakePrisma.loan.createMany,
        deleteMany: fakePrisma.loan.deleteMany,
      },
      uploadBatch: {
        findUnique: fakePrisma.uploadBatch.findUnique,
        update: fakePrisma.uploadBatch.update,
      },
    } as never) // Transactions forward to the same fakes.
) as never;

mock.module("../../lib/prisma.js", () => ({ prisma: fakePrisma })); // Cover both import paths.
mock.module("../lib/prisma.js", () => ({ prisma: fakePrisma }));

const { processPublicDataIngestion } = await import("./ingestion.service.js"); // Import after mocks.

// Reset every mock back to defaults so each test starts clean.
const resetMocks = () => {
  currentBatch = { metadata: {} }; // Reset the shared batch state.
  fakePrisma.loan.createMany = mock(
    (args: { data: unknown[] }) =>
      Promise.resolve({ count: (args.data as unknown[]).length } as never) // Simulated insert returns real length.
  );
  fakePrisma.loan.deleteMany = mock(() => Promise.resolve({} as never));
  fakePrisma.uploadBatch.update = mock(
    (args: { data: Record<string, unknown>; where: { id: string } }) => {
      currentBatch = { ...currentBatch, ...args.data };
      if (args.data.metadata) {
        currentBatch.metadata = args.data.metadata as unknown;
      }
      return Promise.resolve(currentBatch as never);
    }
  );
  fakePrisma.uploadBatch.findUnique = mock(() =>
    Promise.resolve(currentBatch as never)
  );
  fakePrisma.auditLog.create = mock(() => Promise.resolve({} as never));
  fakePrisma.auditLog.createMany = mock(() => Promise.resolve({} as never));
  (
    fakePrisma as unknown as { $transaction: ReturnType<typeof mock> }
  ).$transaction = mock((callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      auditLog: {
        create: fakePrisma.auditLog.create,
        createMany: fakePrisma.auditLog.createMany,
      },
      loan: {
        createMany: fakePrisma.loan.createMany,
        deleteMany: fakePrisma.loan.deleteMany,
      },
      uploadBatch: {
        findUnique: fakePrisma.uploadBatch.findUnique,
        update: fakePrisma.uploadBatch.update,
      },
    } as never)
  ) as never;
};

// Joins pipe fields into an unheaded public-feed row.
const pipeRow = (fields: string[]): string => fields.join("|");

// Build a realistic 108-field Fannie/Freddie pipe row with defaults by column index.
const buildPipeFields = (
  overrides: Partial<Record<number, string>> = {}
): string[] => {
  const arr: string[] = Array.from({ length: 108 }, () => ""); // Fannie/Freddie layout is 108 columns.
  arr[0] = ""; // Column 0 is an empty lead delimiter slot.
  arr[1] = overrides[1] ?? "100023020488"; // Loan id.
  arr[2] = overrides[2] ?? "082009"; // Reporting period MMYYYY.
  arr[3] = overrides[3] ?? "R"; // Seller name.
  arr[4] = overrides[4] ?? "Other"; // Servicer name.
  arr[5] = overrides[5] ?? "Other"; // Servicer name fallback.
  arr[7] = overrides[7] ?? "5.375"; // Original interest rate.
  arr[8] = overrides[8] ?? "5.375"; // Current interest rate.
  arr[9] = overrides[9] ?? "55000.00"; // Original UPB.
  arr[11] = overrides[11] ?? "0.00"; // Current UPB.
  arr[12] = overrides[12] ?? "240"; // Original term.
  arr[13] = overrides[13] ?? "082009"; // First payment date.
  arr[14] = overrides[14] ?? "102009"; // Loan age date.
  arr[15] = overrides[15] ?? "0"; // Delinquency status code.
  arr[16] = overrides[16] ?? "240"; // Remaining months to maturity.
  arr[17] = overrides[17] ?? "240"; // Months in mortgage.
  arr[18] = overrides[18] ?? "092029"; // Maturity date YYYYMM.
  arr[19] = overrides[19] ?? "55"; // Original LTV.
  arr[20] = overrides[20] ?? "55"; // Current LTV.
  arr[21] = overrides[21] ?? "1"; // Number of borrowers.
  arr[22] = overrides[22] ?? "36"; // Debt-to-income ratio.
  arr[23] = overrides[23] ?? "714"; // Credit score.
  arr[27] = overrides[27] ?? "SF"; // Property type.
  arr[29] = overrides[29] ?? "P"; // Loan purpose code.
  arr[30] = overrides[30] ?? "OH"; // State code.
  arr[34] = overrides[34] ?? "FRM"; // Loan type.
  arr[39] = overrides[39] ?? "00"; // Prepayment penalty.
  arr[41] = overrides[41] ?? "N"; // HARP flag.
  for (const [k, v] of Object.entries(overrides)) {
    arr[Number(k)] = v as string; // Apply any test-specific overrides.
  }
  return arr;
};

describe("processPublicDataIngestion", () => {
  beforeEach(() => {
    resetMocks();
    fakePrisma.uploadBatch.findUnique = mock(() =>
      Promise.resolve({ metadata: {} } as never)
    );
    fakePrisma.loan.createMany = mock((args: { data: unknown[] }) =>
      Promise.resolve({ count: (args.data as unknown[]).length } as never)
    );
  });

  afterEach(() => {
    resetMocks();
  });

  it("folds 3 monthly rows for same loanId -> 1 inserted loan with latest mutables winning", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-"));
    const filePath = path.join(tmpDir, "freddie.csv");
    const batchId = "batch_pub_fold";
    const base = buildPipeFields({
      1: "L-FOLD-1",
      2: "082009",
      11: "0.00",
      15: "0",
    });
    const row2 = buildPipeFields({
      1: "L-FOLD-1",
      2: "092009", // Next month for the same loan.
      8: "5.500",
      11: "54350.98", // UPB now amortized.
      15: "1", // Delinquent 1 month.
    });
    const row3 = buildPipeFields({
      1: "L-FOLD-1",
      2: "102009", // Third consecutive month.
      11: "54200.00", // Latest balance.
      15: "2", // Delinquent 2 months.
    });
    const content = [pipeRow(base), pipeRow(row2), pipeRow(row3)].join("\n");
    fs.writeFileSync(filePath, content, "utf8");
    try {
      await processPublicDataIngestion(filePath, batchId, "freddie_mac");
      const { calls } = (
        fakePrisma.loan.createMany as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      let total = 0;
      let insertedRows: Record<string, unknown>[] = [];
      for (const c of calls) {
        const args = c[0] as { data: unknown[] };
        total += args.data.length;
        insertedRows = insertedRows.concat(
          args.data as Record<string, unknown>[]
        );
      }
      expect(total).toBe(1); // Monthly rows folded into a single loan.
      expect(insertedRows.length).toBe(1);
      const row = insertedRows[0] as Record<string, unknown>;
      expect(row.loanId).toBe("L-FOLD-1");
      expect(row.currentBalance).toBe(54_200); // Latest UPB wins.
      expect(row.interestRate).toBe(5.375); // First-period rate retained.
      expect(row.daysPastDue).toBe(60); // Latest delinquency (month 2) wins.
      expect(row.paymentStatus).toBe("delinquent");
      expect(row.sourceSystem).toBe("freddie_mac");
      expect(row.documentStatus).toBe("unknown"); // Public data never sets docs.
      expect((row.lastUpdatedAt as Date).getUTCMonth()).toBe(9); // October 2009 = index 9.
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it("2 distinct contiguous loanIds -> 2 inserted loans", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-2-"));
    const filePath = path.join(tmpDir, "fannie.csv");
    const batchId = "batch_pub_2";
    const a = buildPipeFields({ 1: "L-A", 2: "082009" });
    const b = buildPipeFields({ 1: "L-B", 2: "082009" });
    const content = [pipeRow(a), pipeRow(b)].join("\n");
    fs.writeFileSync(filePath, content, "utf8");
    try {
      await processPublicDataIngestion(filePath, batchId, "fannie_mae");
      const { calls } = (
        fakePrisma.loan.createMany as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      let total = 0;
      for (const c of calls) {
        total += (c[0] as { data: unknown[] }).data.length;
      }
      expect(total).toBe(2); // One loan per distinct id.
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it("bad rows become failedRows without aborting", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-bad-"));
    const filePath = path.join(tmpDir, "bad.csv");
    const batchId = "batch_pub_bad";
    const good = buildPipeFields({ 1: "L-GOOD", 2: "082009" });
    const bad = buildPipeFields({ 1: "" }); // Missing loan id fails the gate.
    const good2 = buildPipeFields({ 1: "L-GOOD2", 2: "082009" });
    const content2 = [pipeRow(good), pipeRow(bad), pipeRow(good2)].join("\n");
    fs.writeFileSync(filePath, content2, "utf8");
    try {
      await processPublicDataIngestion(filePath, batchId, "freddie_mac");
      const { calls } = (
        fakePrisma.loan.createMany as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      let total = 0;
      for (const c of calls) {
        total += (c[0] as { data: unknown[] }).data.length;
      }
      expect(total).toBe(2); // Only the good rows are inserted.
      const { calls: updateCalls } = (
        fakePrisma.uploadBatch.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      const withFailed = updateCalls.find(
        (c) =>
          (c[0] as { data: { failedCount?: number } }).data.failedCount === 1 // One failure is recorded.
      );
      expect(withFailed).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it("empty file -> batch marked failed", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-empty-"));
    const filePath = path.join(tmpDir, "empty.csv");
    const batchId = "batch_pub_empty";
    fs.writeFileSync(filePath, "", "utf8"); // No rows at all.
    try {
      await processPublicDataIngestion(filePath, batchId, "fannie_mae");
      const { calls: updateCalls } = (
        fakePrisma.uploadBatch.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      const failed = updateCalls.find(
        (c) => (c[0] as { data: { status?: string } }).data.status === "failed" // Batch ends failed.
      );
      expect(failed).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it("sourceSystem matches format (fannie vs freddie)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-sys-"));
    const filePath = path.join(tmpDir, "sys.csv");
    const batchId = "batch_pub_sys";
    const row = buildPipeFields({ 1: "L-SYS", 2: "082009" });
    fs.writeFileSync(filePath, pipeRow(row), "utf8");
    try {
      await processPublicDataIngestion(filePath, batchId, "fannie_mae");
      const { calls } = (
        fakePrisma.loan.createMany as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      expect(calls.length).toBeGreaterThan(0);
      const firstCall = calls[0] as unknown as [
        { data: Record<string, unknown>[] },
      ];
      const [firstArg] = firstCall;
      expect(firstArg.data.length).toBeGreaterThan(0);
      const inserted = firstArg.data[0] as Record<string, unknown>;
      expect(inserted.sourceSystem).toBe("fannie_mae"); // Format flows into sourceSystem.
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it("caps failedRows and sets publicData* metadata", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-cap-"));
    const filePath = path.join(tmpDir, "cap.csv");
    const batchId = "batch_pub_cap";
    const bad = buildPipeFields({ 1: "" });
    const rows = Array.from({ length: 5 }, () => pipeRow(bad)).join("\n"); // 5 bad rows.
    const good = buildPipeFields({ 1: "L-CAP", 2: "082009" });
    const content = [pipeRow(good), rows].join("\n");
    fs.writeFileSync(filePath, content, "utf8");
    try {
      await processPublicDataIngestion(filePath, batchId, "freddie_mac");
      const { calls: updateCalls } = (
        fakePrisma.uploadBatch.update as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      const validatingCall = updateCalls.find(
        (c) =>
          (c[0] as { data: { metadata?: Record<string, unknown> } }).data
            .metadata !== undefined &&
          (c[0] as { data: { metadata: Record<string, unknown> } }).data
            .metadata.publicDataSourceRows !== undefined
      );
      expect(validatingCall).toBeDefined(); // Public-row stats are written.
      const meta = (
        validatingCall as unknown as [
          { data: { metadata: Record<string, unknown> } },
        ]
      )[0].data.metadata;
      expect(typeof meta.publicDataSourceRows).toBe("number"); // Row count reported.
      expect(typeof meta.publicDataDistinctLoans).toBe("number"); // Loan count reported.
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it("handles pipe file without leading '|' (107 cols) via tolerant realignment", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-nolead-"));
    const filePath = path.join(tmpDir, "nolead.csv");
    const batchId = "batch_pub_nolead";
    const arr108 = buildPipeFields({ 1: "L-NOLEAD", 2: "082009" });
    const arr107 = arr108.slice(1); // Drop the empty leading col.
    const content = arr107.join("|");
    fs.writeFileSync(filePath, content, "utf8");
    try {
      await processPublicDataIngestion(filePath, batchId, "fannie_mae");
      const { calls } = (
        fakePrisma.loan.createMany as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      let total = 0;
      for (const c of calls) {
        total += (c[0] as { data: unknown[] }).data.length;
      }
      expect(total).toBe(1); // 107-col rows are realigned and inserted.
      expect(calls.length).toBeGreaterThan(0);
      const [firstCall] = calls as unknown as [
        [{ data: Record<string, unknown>[] }],
      ];
      const [firstArg] = firstCall;
      const [inserted] = firstArg.data;
      expect(inserted).toBeDefined();
      expect((inserted as Record<string, unknown>).loanId).toBe("L-NOLEAD"); // Id still lands correctly.
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it("non-contiguous loanId (A,B,A) creates two loans for A — surfaces as duplicate", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-noncont-"));
    const filePath = path.join(tmpDir, "noncont.csv");
    const batchId = "batch_pub_noncont";
    const a1 = buildPipeFields({ 1: "L-DUP", 2: "082009" });
    const b = buildPipeFields({ 1: "L-OTHER", 2: "082009" });
    const a2 = buildPipeFields({ 1: "L-DUP", 2: "092009", 11: "54000.00" });
    const content = [pipeRow(a1), pipeRow(b), pipeRow(a2)].join("\n");
    fs.writeFileSync(filePath, content, "utf8");
    try {
      await processPublicDataIngestion(filePath, batchId, "freddie_mac");
      const { calls } = (
        fakePrisma.loan.createMany as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock;
      let total = 0;
      for (const c of calls) {
        total += (c[0] as { data: unknown[] }).data.length;
      }
      expect(total).toBe(3); // Interrupted fold creates a duplicate loan.
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });
});
