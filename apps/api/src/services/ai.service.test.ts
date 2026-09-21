import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Unit tests for ai.service.ts — mocked prisma + mocked ai SDK.
 * Keep the same mock instance across tests; swap via mockImplementation().
 */

// Default generateObject response (a recommendation payload).
const generateObjectMock = mock(() =>
  Promise.resolve({
    object: {
      confidence: 0.9,
      fieldsToChange: [
        {
          currentValue: "342000",
          field: "currentBalance",
          source: "servicer_update",
          suggestedValue: "340000",
        },
      ],
      reasoning: "Servicer shows lower balance.",
      suggestion: "Set currentBalance to 340000",
    },
  } as never)
);
const generateTextMock = mock(() =>
  Promise.resolve({ text: "Batch summary text." } as never)
);

mock.module("ai", () => ({
  generateObject: generateObjectMock, // Swap the AI SDK module.
  generateText: generateTextMock,
}));

// ── Prisma fake ──
type FakePrisma = {
  $transaction: ReturnType<typeof mock>;
  auditLog: {
    create: ReturnType<typeof mock>;
    createMany: ReturnType<typeof mock>;
  };
  exception: {
    findUnique: ReturnType<typeof mock>;
    groupBy: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
    findMany: ReturnType<typeof mock>;
    createMany: ReturnType<typeof mock>;
  };
  loan: {
    count: ReturnType<typeof mock>;
    groupBy: ReturnType<typeof mock>;
    findMany: ReturnType<typeof mock>;
  };
  uploadBatch: {
    findUnique: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
};

// In-memory Prisma fake: every read/write resolves without a database.
const fakePrisma: FakePrisma = {
  $transaction: null as unknown as ReturnType<typeof mock>,
  auditLog: {
    create: mock(() => Promise.resolve({} as never)),
    createMany: mock(() => Promise.resolve({} as never)),
  },
  exception: {
    createMany: mock(() => Promise.resolve({} as never)),
    findMany: mock(() => Promise.resolve([] as never)),
    findUnique: mock(() => Promise.resolve(null as never)),
    groupBy: mock(() => Promise.resolve([] as never)),
    update: mock(() => Promise.resolve({} as never)),
  } as unknown as FakePrisma["exception"] & {
    groupBy: ReturnType<typeof mock>;
  },
  loan: {
    count: mock(() => Promise.resolve(0 as never)),
    findMany: mock(() => Promise.resolve([] as never)),
    groupBy: mock(() => Promise.resolve([] as never)),
  },
  uploadBatch: {
    findUnique: mock(() => Promise.resolve(null as never)),
    update: mock(() => Promise.resolve({} as never)),
  },
};

(
  fakePrisma as unknown as { $transaction: ReturnType<typeof mock> }
).$transaction = mock((cb: (tx: unknown) => Promise<unknown>) =>
  cb({
    auditLog: fakePrisma.auditLog, // Transactions forward to the fakes.
    exception: fakePrisma.exception,
    loan: fakePrisma.loan,
    uploadBatch: fakePrisma.uploadBatch,
  } as never)
) as never;

mock.module("../lib/prisma.js", () => ({
  prisma: fakePrisma as unknown as never, // Swap the real Prisma client.
}));

const { explainException, summarizeBatch, classifySeverity, suggestRule } =
  await import("./ai.service.js"); // Import the service after mocks are in place.
const { AiUnavailableError, NotFoundError, __resetAiModelCache } = await import(
  "../lib/ai.js" // Shared AI helpers plus a cache reset hook.
);

// Helper that applies only the env keys the service reads.
const setEnv = (overrides: Record<string, string | undefined>) => {
  for (const key of ["GEMINI_API_KEY", "MOCK_AI", "AI_MODEL_ID"] as const) {
    if (key in overrides) {
      const v = overrides[key];
      if (v === undefined) {
        delete (process.env as Record<string, string | undefined>)[key]; // Unset means removed.
      } else {
        process.env[key] = v;
      }
    }
  }
};

// Builds a loan shape the service understands, with per-test overrides.
const loanFixture = (overrides: Record<string, unknown> = {}) => ({
  borrowerId: "B-5001",
  borrowerState: "CA",
  creditGrade: "A",
  currentBalance: "342000.00" as unknown,
  daysPastDue: 0,
  documentStatus: "complete",
  id: "loan_1",
  interestRate: "6.75" as unknown,
  loanId: "L-10001",
  originalPrincipal: "350000.00" as unknown,
  paymentStatus: "current",
  servicerName: "First National",
  ...overrides,
});

// Builds an exception shape (with its loan) the service reads.
const exceptionFixture = (overrides: Record<string, unknown> = {}) => ({
  exceptionType: "balance_error",
  field: "currentBalance",
  id: "exc_1",
  loan: loanFixture(),
  loanId: "loan_1",
  message: "Current balance exceeds original principal",
  metadata: null,
  severity: "high",
  ...overrides,
});

// Default generateObject implementation restored by beforeEach.
const defaultGenerateObjectMockImpl = () =>
  Promise.resolve({
    object: {
      confidence: 0.9,
      fieldsToChange: [
        {
          currentValue: "342000",
          field: "currentBalance",
          source: "servicer_update",
          suggestedValue: "340000",
        },
      ],
      reasoning: "Servicer shows lower balance.",
      suggestion: "Set currentBalance to 340000",
    },
  } as never);

describe("ai.service", () => {
  // Reset all env, prisma fakes, and SDK implementations each test.
  beforeEach(() => {
    for (const k of ["GEMINI_API_KEY", "MOCK_AI", "AI_MODEL_ID"] as const) {
      delete (process.env as Record<string, string | undefined>)[k];
    }
    fakePrisma.exception.findUnique = mock(() =>
      Promise.resolve(null as never)
    );
    fakePrisma.exception.update = mock(() => Promise.resolve({} as never));
    fakePrisma.exception.findMany = mock(() => Promise.resolve([] as never));
    fakePrisma.exception.createMany = mock(() => Promise.resolve({} as never));
    fakePrisma.exception.groupBy = mock(() => Promise.resolve([] as never));
    fakePrisma.auditLog.create = mock(() => Promise.resolve({} as never));
    fakePrisma.auditLog.createMany = mock(() => Promise.resolve({} as never));
    fakePrisma.uploadBatch.findUnique = mock(() =>
      Promise.resolve(null as never)
    );
    fakePrisma.uploadBatch.update = mock(() => Promise.resolve({} as never));
    fakePrisma.loan.count = mock(() => Promise.resolve(0 as never));
    fakePrisma.loan.groupBy = mock(() => Promise.resolve([] as never));
    fakePrisma.loan.findMany = mock(() => Promise.resolve([] as never));
    (
      generateObjectMock as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation(defaultGenerateObjectMockImpl);
    (
      generateTextMock as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation(() =>
      Promise.resolve({ text: "Batch summary text." } as never)
    );
    process.env.MOCK_AI = "false"; // Default to the real-SDK path.
    process.env.GEMINI_API_KEY = "test-key-for-unit"; // With a fake key set.
    __resetAiModelCache(); // Clear cached model between tests.
  });

  it("explainException happy path saves recommendation + audit in transaction", async () => {
    fakePrisma.exception.findUnique = mock(
      () => Promise.resolve(exceptionFixture() as never) // A real-looking exception row.
    );
    const res = await explainException("exc_1", "reviewer_1");
    expect(res.exceptionId).toBe("exc_1");
    expect(res.recommendation.suggestion).toContain("340000"); // SDK output flows through.
    expect(res.recommendation.confidence).toBe(0.9);
    expect(res.recommendation.model).toBe("gemini-3.5-flash-lite"); // Real model id used.
    expect(res.recommendation.promptSummary).toContain("balance_error");
    expect(res.recommendation.timestamp).toBeDefined();
    expect(generateObjectMock).toHaveBeenCalled(); // SDK was called.
    const txCalls = (
      fakePrisma as unknown as { $transaction: ReturnType<typeof mock> }
    ).$transaction.mock.calls;
    expect(txCalls.length).toBe(1); // Update + audit ran in one transaction.
  });

  it("explainException throws NotFoundError when missing", async () => {
    fakePrisma.exception.findUnique = mock(
      () => Promise.resolve(null as never) // No exception row.
    );
    await expect(explainException("nope")).rejects.toBeInstanceOf(
      NotFoundError // Unknown ids surface a 404-style error.
    );
  });

  it("explainException throws AiUnavailableError when no key and not mock", async () => {
    setEnv({ GEMINI_API_KEY: undefined, MOCK_AI: "false" }); // No key, no mock.
    fakePrisma.exception.findUnique = mock(() =>
      Promise.resolve(exceptionFixture() as never)
    );
    await expect(explainException("exc_1")).rejects.toBeInstanceOf(
      AiUnavailableError // Missing config means AI is unavailable.
    );
  });

  it("explainException wraps generateObject failure as AiUnavailableError", async () => {
    fakePrisma.exception.findUnique = mock(() =>
      Promise.resolve(exceptionFixture() as never)
    );
    (
      generateObjectMock as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation(() => Promise.reject(new Error("quota exceeded"))); // SDK blows up.
    await expect(explainException("exc_1")).rejects.toBeInstanceOf(
      AiUnavailableError // Provider failures degrade gracefully.
    );
  });

  it("explainException uses MOCK_AI deterministic payload without calling SDK", async () => {
    setEnv({ MOCK_AI: "true" }); // Mock mode enabled.
    fakePrisma.exception.findUnique = mock(() =>
      Promise.resolve(exceptionFixture() as never)
    );
    let called = false;
    (
      generateObjectMock as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation(() => {
      called = true; // Track whether the SDK is touched.
      return Promise.reject(new Error("should not be called"));
    });
    const res = await explainException("exc_1", "reviewer_1");
    expect(res.recommendation.model).toContain("mock"); // Model id is prefixed as mock.
    expect(res.recommendation.reasoning).toContain("Mock AI"); // Deterministic reasoning.
    expect(called).toBe(false); // SDK never invoked.
  });

  it("explainException includes conflict metadata in prompt", async () => {
    const exc = exceptionFixture({
      exceptionType: "conflicting_source",
      field: "currentBalance",
      metadata: {
        conflictBatchId: "batch_servicer",
        field: "currentBalance",
        sourceValue: "340000",
        targetValue: "342000",
      },
    });
    fakePrisma.exception.findUnique = mock(() => Promise.resolve(exc as never));
    let capturedPrompt = "";
    (
      generateObjectMock as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation((args: { prompt: string }) => {
      capturedPrompt = args.prompt; // Capture what the SDK receives.
      return Promise.resolve({
        object: {
          confidence: 0.8,
          fieldsToChange: [
            { field: "currentBalance", suggestedValue: "340000" },
          ],
          reasoning: "r",
          suggestion: "s",
        },
      } as never);
    });
    await explainException("exc_1");
    expect(capturedPrompt).toContain("conflicting_source"); // Exception type is in the prompt.
    expect(capturedPrompt).toContain("340000"); // Conflict values are in the prompt.
  });

  it("classifySeverity returns current+suggested without mutating severity (G4)", async () => {
    fakePrisma.exception.findUnique = mock(() =>
      Promise.resolve(exceptionFixture({ severity: "high" }) as never)
    );
    (
      generateObjectMock as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation(() =>
      Promise.resolve({
        object: { reasoning: "material impact", suggestedSeverity: "critical" },
      } as never)
    );
    const res = await classifySeverity("exc_1", "reviewer_1");
    expect(res.currentSeverity).toBe("high"); // Original severity preserved.
    expect(res.suggestedSeverity).toBe("critical"); // AI suggestion returned.
    expect(res.reasoning).toBe("material impact");
    expect(fakePrisma.exception.update).not.toHaveBeenCalled(); // No DB mutation.
    expect(fakePrisma.auditLog.create).toHaveBeenCalled(); // Audited though.
  });

  it("classifySeverity throws NotFound when missing", async () => {
    fakePrisma.exception.findUnique = mock(() =>
      Promise.resolve(null as never)
    );
    await expect(classifySeverity("nope")).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("classifySeverity MOCK returns same severity deterministically", async () => {
    setEnv({ MOCK_AI: "true" });
    fakePrisma.exception.findUnique = mock(() =>
      Promise.resolve(exceptionFixture({ severity: "low" }) as never)
    );
    const res = await classifySeverity("exc_1");
    expect(res.suggestedSeverity).toBe("low"); // Mock agrees with current severity.
    expect(res.model).toContain("mock");
  });

  it("suggestRule returns rule with server-filled id/timestamp/note and audit", async () => {
    (
      generateObjectMock as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation(() =>
      Promise.resolve({
        object: {
          condition: { field: "interestRate", operator: "gt", value: 12 },
          description: "Flag high rate",
          exceptionType: "rate_out_of_range",
          name: "high_rate_check",
          severity: "high",
        },
      } as never)
    );
    const res = await suggestRule(
      "Flag any loan with rate > 12%",
      "operator_1"
    );
    expect(res.rule.id).toMatch(/^ai_rule_/); // Server-generated id.
    expect(res.rule.name).toBe("high_rate_check");
    expect(res.promptSummary).toContain("Flag any loan"); // Prompt truncated for audit.
    expect(res.note).toContain("AI-generated"); // Safety note attached.
    expect(res.timestamp).toBeDefined();
    expect(fakePrisma.auditLog.create).toHaveBeenCalled(); // Rule generation audited.
  });

  it("suggestRule MOCK returns canned rule without SDK", async () => {
    setEnv({ MOCK_AI: "true" });
    const res = await suggestRule("Flag something");
    expect(res.rule.exceptionType).toBe("rate_out_of_range"); // Canned type.
    expect(res.model).toContain("mock");
    // mock condition is structured (field/operator/value), not empty
    expect((res.rule.condition as { field?: string }).field).toBe(
      "interestRate" // Canned condition is valid JSON logic.
    );
  });

  it("suggestRule treats schema-invalid condition as AiUnavailableError", async () => {
    // generateObject enforces suggestRuleGenerationSchema; an empty condition
    // fails the structured ruleComparatorSchema, so the SDK throws -> service degrades gracefully.
    (
      generateObjectMock as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation(() =>
      Promise.reject(new Error("NoObjectGeneratedError: condition is invalid"))
    );
    await expect(suggestRule("Flag something")).rejects.toBeInstanceOf(
      AiUnavailableError // Schema failures surface as unavailable.
    );
  });

  it("suggestRule propagates AiUnavailableError when no key", async () => {
    setEnv({ GEMINI_API_KEY: undefined, MOCK_AI: "false" });
    await expect(suggestRule("Flag ...")).rejects.toBeInstanceOf(
      AiUnavailableError
    );
  });

  it("summarizeBatch returns summary with mock without SDK", async () => {
    setEnv({ MOCK_AI: "true" });
    fakePrisma.uploadBatch.findUnique = mock(() =>
      Promise.resolve({ id: "batch_1" } as never)
    );
    fakePrisma.loan.count = mock(() => Promise.resolve(2 as never));
    fakePrisma.exception.groupBy = mock(() => Promise.resolve([] as never));
    const res = await summarizeBatch("batch_1", "reviewer_1");
    expect(res.batchId).toBe("batch_1");
    expect(res.summary).toContain("Mock summary"); // Deterministic mock text.
    expect(res.model).toContain("mock");
  });

  it("summarizeBatch throws NotFound when batch missing", async () => {
    fakePrisma.uploadBatch.findUnique = mock(() =>
      Promise.resolve(null as never)
    );
    await expect(summarizeBatch("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("summarizeBatch uses generateText and audits when actor provided", async () => {
    fakePrisma.uploadBatch.findUnique = mock(() =>
      Promise.resolve({ id: "batch_1" } as never)
    );
    fakePrisma.loan.count = mock(() => Promise.resolve(5 as never));
    let exceptionGroupByCalls = 0;
    fakePrisma.exception.groupBy = mock(() => {
      exceptionGroupByCalls += 1;
      if (exceptionGroupByCalls === 1) {
        return Promise.resolve([
          { _count: { exceptionType: 1 }, exceptionType: "missing_field" }, // First groupBy is by type.
        ] as never);
      }
      return Promise.resolve([] as never); // Second groupBy is by severity.
    });
    (
      generateTextMock as unknown as {
        mockImplementation: (fn: unknown) => void;
      }
    ).mockImplementation(() =>
      Promise.resolve({ text: "Detailed summary." } as never)
    );
    const res = await summarizeBatch("batch_1", "reviewer_1");
    expect(res.summary).toBe("Detailed summary."); // generateText output returned.
    expect(fakePrisma.auditLog.create).toHaveBeenCalled(); // Summary is audited.
  });
});
