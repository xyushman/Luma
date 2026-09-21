import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import type { AddressInfo } from "node:net";

// In-memory Prisma fake so the loan routes run without a DB.
const fakePrisma = {
  $transaction: mock(
    async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        auditLog: { createMany: fakePrisma.auditLog.createMany },
        loan: { update: fakePrisma.loan.update },
      }) as never // Run the callback with the fake transaction client.
  ),
  auditLog: { createMany: mock(() => Promise.resolve({ count: 1 }) as never) },
  loan: {
    findUnique: mock(() => Promise.resolve(null as never)),
    update: mock(
      () =>
        Promise.resolve({
          id: "c8x9y2z1a2b3c4d5e6f7g8h9",
          updatedAt: new Date("2026-08-26T10:00:00.000Z"),
        }) as never // Successful update returns the loan id and timestamp.
    ),
  },
  verifiedLoan: { count: mock(() => Promise.resolve(0)) },
};

// Fake Better Auth with a stubbable getSession for simulating sessions.
const fakeAuth = {
  api: {
    getSession: mock(() => Promise.resolve(null as never)),
  },
};

mock.module("../lib/prisma.js", () => ({ prisma: fakePrisma })); // Swap the real Prisma client.
mock.module("../lib/auth.js", () => ({ auth: fakeAuth })); // Swap the real auth client.
mock.module("../services/verification.service.js", () => ({
  VerificationError: class VerificationError extends Error {
    code: string;
    statusCode: number;
    constructor(message: string, statusCode = 409, code = "CONFLICT") {
      super(message);
      this.code = code;
      this.statusCode = statusCode; // Verification conflicts map to 409 by default.
    }
  },
  verifyLoan: mock(() => Promise.resolve({} as never)),
})); // Fake verification service so verify routes are fully isolated.

const { createApp } = await import("../app.js"); // Build the real Express app over the fakes.

// Full session payload for the seeded reviewer account.
const reviewerSession = {
  session: { expiresAt: new Date(), id: "sess_rev", userId: "user_rev" },
  user: {
    email: "reviewer@luma.dev",
    emailVerified: false,
    id: "user_rev",
    image: null,
    name: "Reviewer User",
    role: "reviewer",
  },
};

// Full session payload for the seeded operator account.
const operatorSession = {
  session: { expiresAt: new Date(), id: "sess_op", userId: "user_op" },
  user: {
    email: "operator@luma.dev",
    emailVerified: false,
    id: "user_op",
    image: null,
    name: "Operator User",
    role: "data_operator",
  },
};

// Full session payload for the seeded consumer account.
const consumerSession = {
  session: { expiresAt: new Date(), id: "sess_con", userId: "user_con" },
  user: {
    email: "consumer@luma.dev",
    emailVerified: false,
    id: "user_con",
    image: null,
    name: "Consumer User",
    role: "data_consumer",
  },
};

let app: ReturnType<typeof createApp>;
let server: {
  address: () => string | AddressInfo | null;
  close: (cb?: () => void) => void;
};
let baseUrl: string;

beforeAll(() => {
  app = createApp();
  server = app.listen(0); // Listen on an ephemeral port.
  const addr = server.address() as AddressInfo;
  baseUrl = `http://localhost:${addr.port}`; // Real HTTP base for the tests.
});

afterAll(() => {
  server.close(); // Shut the server down after the suite.
});

beforeEach(() => {
  fakeAuth.api.getSession = mock(
    () => Promise.resolve(reviewerSession as never) // Default to a reviewer session.
  );
  fakePrisma.loan.findUnique = mock(() =>
    Promise.resolve({
      borrowerState: "CA",
      currentBalance: 100_000, // Existing balance the audit compares against.
      id: "c8x9y2z1a2b3c4d5e6f7g8h9",
      interestRate: 5.5,
      loanId: "L-1",
      paymentStatus: "current",
      servicerName: null,
      documentStatus: "complete",
      creditGrade: "A",
    } as never)
  ); // Reset the loaded loan fixture before every test.
  fakePrisma.loan.update = mock(
    () =>
      Promise.resolve({
        id: "c8x9y2z1a2b3c4d5e6f7g8h9",
        updatedAt: new Date("2026-08-26T10:00:00.000Z"),
      }) as never
  );
  fakePrisma.auditLog.createMany = mock(
    () => Promise.resolve({ count: 1 }) as never
  );
  fakePrisma.$transaction = mock(
    async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        auditLog: { createMany: fakePrisma.auditLog.createMany },
        loan: { update: fakePrisma.loan.update },
      }) as never
  );
});

// Helper that PATCHes a loan's editable fields with a given session cookie.
const patchFields = (body: unknown, token: string): Promise<Response> =>
  fetch(`${baseUrl}/api/loans/c8x9y2z1a2b3c4d5e6f7g8h9/fields`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie: token },
    method: "PATCH",
  });

describe("PATCH /api/loans/:id/fields", () => {
  it("returns 400 for invalid cuid", async () => {
    const res = await fetch(`${baseUrl}/api/loans/not-a-cuid/fields`, {
      body: JSON.stringify({
        fields: { currentBalance: "10" },
        reason: "test",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(res.status).toBe(400); // Malformed loan ids are rejected early.
  });

  it("returns 400 for non-editable field keys with field map error", async () => {
    const res = await patchFields(
      {
        fields: { loanId: "hacked" } as Record<string, string>,
        reason: "test",
      }, // loanId is not in the editable whitelist.
      ""
    );
    expect(res.status).toBe(400); // Only whitelisted fields can be patched.
  });

  it("returns 400 for empty fields object", async () => {
    const res = await patchFields({ fields: {}, reason: "test" }, "");
    expect(res.status).toBe(400); // At least one field must be provided.
  });

  it("returns 400 for missing reason", async () => {
    const res = await patchFields({ fields: { currentBalance: "10" } }, "");
    expect(res.status).toBe(400); // A reason is required for the audit trail.
  });

  it("returns 400 for negative numeric values", async () => {
    const res = await patchFields(
      { fields: { currentBalance: "-5" }, reason: "test" },
      "" // Negative balances are never valid.
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("Invalid numeric"); // Error message names the problem.
  });

  it("updates a field and writes FIELD_EDITED audit inside one transaction", async () => {
    let txArg: unknown;
    const txLoanUpdate = mock(() =>
      Promise.resolve({
        id: "c8x9y2z1a2b3c4d5e6f7g8h9",
        updatedAt: new Date("2026-08-26T10:00:00.000Z"),
      })
    ); // Transaction-scoped loan update mock.
    const txAuditLogCreateMany = mock(() => Promise.resolve({ count: 1 }));
    // Transaction-scoped audit mock.

    fakePrisma.$transaction = mock((cb: (tx: unknown) => Promise<unknown>) => {
      txArg = cb; // Capture the callback for shape assertions.
      return cb({
        auditLog: { createMany: txAuditLogCreateMany },
        loan: { update: txLoanUpdate },
      }) as never;
    });

    const res = await patchFields(
      { fields: { currentBalance: "150000" }, reason: "servicer update" },
      ""
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { updatedFields: string[] };
    expect(json.updatedFields).toEqual(["currentBalance"]); // Response lists the changed field.

    expect(txLoanUpdate).toHaveBeenCalled(); // Update ran inside the transaction.
    expect(fakePrisma.loan.update).not.toHaveBeenCalled(); // Never bypassed onto global prisma.

    expect(txAuditLogCreateMany).toHaveBeenCalled(); // Audit ran inside the transaction.
    expect(fakePrisma.auditLog.createMany).not.toHaveBeenCalled();

    const calls = txAuditLogCreateMany.mock.calls as unknown as Array<{
      0: {
        data: Array<{ eventType: string; metadata: Record<string, unknown> }>;
      };
    }>;
    expect(calls.length).toBeGreaterThan(0);
    const auditPayload = calls[0]?.[0];
    expect(auditPayload?.data?.[0]?.eventType).toBe("FIELD_EDITED"); // Correct event type.
    expect(auditPayload?.data?.[0]?.metadata?.field).toBe("currentBalance"); // Field is recorded.
    expect(auditPayload?.data?.[0]?.metadata?.oldValue).toBe("100000"); // Old value is recorded.
    expect(auditPayload?.data?.[0]?.metadata?.newValue).toBe("150000"); // New value is recorded.
    expect(typeof txArg).toBe("function"); // A transaction callback was truly used.
  });

  it("rejects empty numeric strings with 400", async () => {
    const res = await patchFields(
      { fields: { interestRate: "" }, reason: "clear" },
      "" // Empty string cannot be coerced to a valid number.
    );
    expect(res.status).toBe(400);
    expect(fakePrisma.loan.update).not.toHaveBeenCalled(); // No write happens on bad input.
  });

  it("returns 403 for consumer and operator roles", async () => {
    fakeAuth.api.getSession = mock(
      () => Promise.resolve(consumerSession as never) // Consumer session.
    );
    const resConsumer = await patchFields(
      { fields: { currentBalance: "1" }, reason: "x" },
      ""
    );
    expect(resConsumer.status).toBe(403); // Consumers cannot edit fields.

    fakeAuth.api.getSession = mock(
      () => Promise.resolve(operatorSession as never) // Operator session.
    );
    const resOperator = await patchFields(
      { fields: { currentBalance: "1" }, reason: "x" },
      ""
    );
    expect(resOperator.status).toBe(403); // Operators cannot edit fields either.
  });
});
