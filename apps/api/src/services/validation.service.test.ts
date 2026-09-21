import { describe, expect, it, mock } from "bun:test";

// In-memory Prisma fake: every DB call resolves without touching a database.
const fakePrisma: Record<string, unknown> = {
  $transaction: mock(
    async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        auditLog: { create: mock(() => Promise.resolve({})) },
        exception: { createMany: mock(() => Promise.resolve({})) },
        loan: {
          findMany: mock(() => Promise.resolve([])),
          update: mock(() => Promise.resolve({})),
        },
      } as never) // Run the transaction callback with the fake client.
  ),
  loan: { findMany: mock(() => Promise.resolve([])) },
};

mock.module("../lib/prisma.js", () => ({ prisma: fakePrisma as never })); // Swap the real Prisma client.
mock.module("../lib/validation-thresholds.js", () => ({
  defaultThresholds: {
    duplicateBorrowerThreshold: 5, // Borrower appearing more than 5 times is suspect.
    interestRateMax: 40,
    interestRateMin: 0,
    staleDaysThreshold: 90, // Records older than 90 days are stale.
  },
  loadThresholds: () => ({
    duplicateBorrowerThreshold: 5,
    interestRateMax: 40,
    interestRateMin: 0,
    staleDaysThreshold: 90,
  }),
})); // Swap the real threshold loader for fixed constants.

const { runPerLoanRules } = await import("./validation.service.js"); // Import the rule runner after mocks.

describe("runPerLoanRules", () => {
  // A fully valid loan every rule-based test mutates from.
  const baseLoan = {
    borrowerId: "B-5001",
    borrowerState: "CA", // CA is a known valid state.
    currentBalance: 342_000, // Balance below the principal is fine.
    daysPastDue: 0,
    documentStatus: "complete",
    id: "loan_1",
    interestRate: 6.75, // Within the allowed 0-40 range.
    lastUpdatedAt: new Date(), // Fresh enough to not be stale.
    loanId: "L-10001",
    maturityDate: new Date("2052-03-15"),
    originalPrincipal: 350_000,
    originationDate: new Date("2022-03-15"),
    paymentStatus: "current",
    sourceBatchId: "batch_1",
  };

  it("passes clean loan", () => {
    const result = runPerLoanRules(baseLoan);
    expect(result.length).toBe(0); // A valid loan must raise zero exceptions.
  });

  it("missing loanId -> missing_field critical", () => {
    const result = runPerLoanRules({ ...baseLoan, loanId: null });
    expect(
      result.some(
        (r) => r.exceptionType === "missing_field" && r.field === "loanId"
      )
    ).toBe(true); // A null loanId produces a missing_field exception.
    expect(result.find((r) => r.field === "loanId")?.severity).toBe("critical"); // Missing id is critical.
  });

  it("maturity before origination -> date_error high", () => {
    const result = runPerLoanRules({
      ...baseLoan,
      maturityDate: new Date("2020-01-01"), // Maturity predates origination.
      originationDate: new Date("2022-03-15"),
    });
    expect(result.some((r) => r.exceptionType === "date_error")).toBe(true); // Bad date ordering trips date_error.
  });

  it("negative principal -> balance_error critical", () => {
    const result = runPerLoanRules({ ...baseLoan, originalPrincipal: -100 });
    expect(
      result.some(
        (r) =>
          r.exceptionType === "balance_error" && r.field === "originalPrincipal"
      )
    ).toBe(true); // Negative principal trips balance_error on the right field.
  });

  it("balance exceeds principal -> balance_error", () => {
    const result = runPerLoanRules({
      ...baseLoan,
      currentBalance: 400_000, // Balance greater than the 350k principal.
      originalPrincipal: 350_000,
    });
    expect(result.some((r) => r.field === "currentBalance")).toBe(true); // Balance flag points at currentBalance.
  });

  it("interest rate out of range -> rate_out_of_range", () => {
    const result = runPerLoanRules({ ...baseLoan, interestRate: 50 });
    expect(result.some((r) => r.exceptionType === "rate_out_of_range")).toBe(
      true // 50% exceeds the configured 40 max.
    );
  });

  it("current but daysPastDue >0 -> status_inconsistency", () => {
    const result = runPerLoanRules({
      ...baseLoan,
      daysPastDue: 5,
      paymentStatus: "current", // Current loans cannot have days past due.
    });
    expect(result.some((r) => r.exceptionType === "status_inconsistency")).toBe(
      true
    );
  });

  it("closed with balance -> status_inconsistency", () => {
    const result = runPerLoanRules({
      ...baseLoan,
      currentBalance: 100, // Closed loans must be paid to zero.
      paymentStatus: "closed",
    });
    expect(result.some((r) => r.message.includes("closed"))).toBe(true); // Message names the closed state.
  });

  it("missing documentStatus -> missing_field", () => {
    const result = runPerLoanRules({ ...baseLoan, documentStatus: null });
    expect(result.some((r) => r.field === "documentStatus")).toBe(true); // Null doc status is a missing field.
  });

  it("stale record -> stale_record low", () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // Date 100 days in the past.
    const result = runPerLoanRules({ ...baseLoan, lastUpdatedAt: old });
    expect(result.some((r) => r.exceptionType === "stale_record")).toBe(true); // Old updates trip stale_record.
    expect(
      result.find((r) => r.exceptionType === "stale_record")?.severity
    ).toBe("low"); // Staleness is only low severity.
  });

  it("invalid state -> invalid_state", () => {
    const result = runPerLoanRules({ ...baseLoan, borrowerState: "XX" });
    expect(result.some((r) => r.exceptionType === "invalid_state")).toBe(true); // Unknown states fail validation.
  });

  it("valid state passes", () => {
    const result = runPerLoanRules({ ...baseLoan, borrowerState: "NY" });
    expect(result.some((r) => r.exceptionType === "invalid_state")).toBe(false); // NY is a valid state.
  });

  it("duplicate thresholds create extra exception via runBatch (covered in integration)", () => {
    // per-loan alone cannot detect duplicates; verified in integration batch test
    expect(
      runPerLoanRules(baseLoan).filter((r) => r.exceptionType === "duplicate")
        .length // Per-loan rules never flag duplicates.
    ).toBe(0);
  });
});

describe("runBatch basic", () => {
  it("empty batch returns zeros", async () => {
    const { runBatch } = await import("./validation.service.js"); // Lazy import to keep mocks in place.
    // Mock findMany to return empty
    const prisma = (await import("../lib/prisma.js")).prisma as unknown as {
      loan: { findMany: ReturnType<typeof mock> };
    };
    prisma.loan.findMany = mock(() => Promise.resolve([] as never)); // No loans exist in the batch.
    const result = await runBatch("batch_empty");
    expect(result.loanCount).toBe(0); // Zero loans processed.
    expect(result.exceptionCount).toBe(0); // Zero exceptions raised.
  });
});
