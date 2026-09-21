import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

// Dedicated Postgres test database (docker compose luma-postgres).
const TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/luma_test";

type PrismaClient = InstanceType<
  typeof import("./generated/prisma/client.js")["PrismaClient"]
>;

interface TestServer {
  address: () => string | AddressInfo | null;
  close: () => void;
}

interface AppModule {
  createApp: () => { listen: (port: number) => TestServer };
}

let appModule: AppModule;
let prisma: PrismaClient;
let server: TestServer;
let baseUrl: string;

// Unique marker so test rows are identifiable and cleanable.
const RUN_TAG = `loans_it_${Date.now()}`;
const APP_ROOT = join(import.meta.dir, "..");

// Signs in via Better Auth and returns the session cookie.
const signIn = async (email: string, password: string): Promise<string> => {
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = setCookie.split(";")[0] ?? ""; // First cookie is the session token.
  expect(token).toContain("session_token=");
  return token;
};

// Creates a user, assigns a role, and returns their email + session cookie.
const createUser = async (
  prefix: string,
  role: string
): Promise<{ email: string; cookie: string }> => {
  const email = `${prefix}_${RUN_TAG}@luma.dev`;
  const signUpRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    body: JSON.stringify({
      email,
      name: `${role} IT`,
      password: "password",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect([200, 422].includes(signUpRes.status)).toBe(true); // Re-runs may already have the user.
  await prisma.user.update({ data: { role }, where: { email } });
  const cookie = await signIn(email, "password");
  return { cookie, email };
};

// Uploads a small tape as an operator and waits until the pipeline settles.
const uploadLoanTape = async (cookie: string): Promise<string> => {
  const csvHeader =
    "loan_id,borrower_id,loan_type,origination_date,maturity_date,original_principal,current_balance,interest_rate,term_months,borrower_state,loan_purpose,credit_grade,employment_length,income_band,payment_status,days_past_due,servicer_name,last_payment_date,last_updated_at,document_status,source_system";
  const row = (n: number): string =>
    `L-${RUN_TAG}-${n},B-${RUN_TAG}-${n},mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`;
  const csvContent = [csvHeader, row(1), row(2)].join("\n");

  const form = new FormData();
  form.append(
    "file",
    new File([csvContent], `tape_${RUN_TAG}.csv`, { type: "text/csv" })
  );
  form.append("fileType", "loan_tape");
  const uploadRes = await fetch(`${baseUrl}/api/uploads`, {
    body: form,
    headers: { cookie },
    method: "POST",
  });
  expect(uploadRes.status).toBe(202);
  const { batchId } = (await uploadRes.json()) as { batchId: string };

  for (let index = 0; index < 20; index += 1) {
    await new Promise((r) => setTimeout(r, 500)); // Poll until the batch settles.
    const detailRes = await fetch(`${baseUrl}/api/uploads/${batchId}`, {
      headers: { cookie },
    });
    if (detailRes.status === 200) {
      const detail = (await detailRes.json()) as { status: string };
      if (detail.status === "done" || detail.status === "failed") {
        break;
      }
    }
  }
  return batchId;
};

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL; // Point the app at the test DB.

  // Apply all pending migrations before booting the app.
  const migrate = Bun.spawnSync(["bunx", "prisma", "migrate", "deploy"], {
    cwd: APP_ROOT,
    env: process.env as Record<string, string>,
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(migrate.exitCode).toBe(0); // Migrations must succeed.

  appModule = (await import("./app.js")) as unknown as AppModule;
  const clientModule = await import("./generated/prisma/client.js");
  const adapterModule = await import("@prisma/adapter-pg");
  const adapter = new adapterModule.PrismaPg({
    connectionString: TEST_DATABASE_URL, // Prisma connects via the Pg adapter.
  });
  prisma = new clientModule.PrismaClient({ adapter });

  const app = appModule.createApp();
  server = app.listen(0); // Listen on an ephemeral port.
  const addr = server.address() as AddressInfo;
  baseUrl = `http://localhost:${addr.port}`; // Real HTTP base for the tests.
});

// Delete all rows, audits, and users created by this run.
afterAll(async () => {
  const batchIds = (
    await prisma.uploadBatch.findMany({
      select: { id: true },
      where: { fileName: { contains: RUN_TAG } },
    })
  ).map((b) => b.id);
  const loanIds = (
    await prisma.loan.findMany({
      select: { id: true },
      where: { sourceBatchId: { in: batchIds } },
    })
  ).map((l) => l.id);

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { loanId: { in: loanIds } },
        { batchId: { in: batchIds } },
        { verifiedLoan: { loanId: { in: loanIds } } },
        {
          actorId: {
            in: await prisma.user
              .findMany({
                select: { id: true },
                where: { email: { contains: RUN_TAG } },
              })
              .then((rows) => rows.map((r) => r.id)), // Audits by our test users too.
          },
        },
      ],
    },
  });
  await prisma.verifiedLoan.deleteMany({
    where: { loanId: { in: loanIds } },
  });
  await prisma.loan.deleteMany({ where: { id: { in: loanIds } } });
  await prisma.uploadBatch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.user.deleteMany({
    where: { email: { contains: RUN_TAG } },
  });
  await prisma.$disconnect();
  if (server) {
    server.close();
  }
});

describe("GET /api/loans consumer scoping (integration)", () => {
  let operatorCookie = "";
  let reviewerCookie = "";
  let consumerCookie = "";
  let batchId = "";
  let loanOneId = "";
  let loanTwoId = "";

  // Set up one user per role plus a two-loan tape to test against.
  beforeAll(async () => {
    const operator = await createUser("operator_it", "data_operator");
    operatorCookie = operator.cookie;
    const reviewer = await createUser("reviewer_it", "reviewer");
    reviewerCookie = reviewer.cookie;
    const consumer = await createUser("consumer_it", "data_consumer");
    consumerCookie = consumer.cookie;
    batchId = await uploadLoanTape(operatorCookie);

    const loans = await prisma.loan.findMany({
      orderBy: { sourceRowNumber: "asc" },
      where: { sourceBatchId: batchId },
    });
    loanOneId = loans[0]?.id ?? ""; // First loan row.
    loanTwoId = loans[1]?.id ?? ""; // Second loan row.
    expect(loanOneId).not.toBe("");
    expect(loanTwoId).not.toBe("");
  });

  it("consumer list returns zero unverified loans while operator sees both", async () => {
    const operatorRes = await fetch(
      `${baseUrl}/api/loans?batchId=${batchId}&limit=100`,
      {
        headers: { cookie: operatorCookie },
      }
    );
    expect(operatorRes.status).toBe(200);
    const operatorBody = (await operatorRes.json()) as {
      data: unknown[];
      pagination: { total: number };
    };
    expect(operatorBody.pagination.total).toBe(2); // Operator sees all loans.

    const consumerRes = await fetch(
      `${baseUrl}/api/loans?batchId=${batchId}&limit=100`,
      {
        headers: { cookie: consumerCookie },
      }
    );
    expect(consumerRes.status).toBe(200);
    const consumerBody = (await consumerRes.json()) as {
      data: unknown[];
      pagination: { total: number };
    };
    expect(consumerBody.pagination.total).toBe(0); // Unverified loans are hidden from consumers.
  });

  it("consumer detail on unverified loan returns 403 while reviewer gets 200", async () => {
    const consumerRes = await fetch(`${baseUrl}/api/loans/${loanOneId}`, {
      headers: { cookie: consumerCookie },
    });
    expect(consumerRes.status).toBe(403); // Consumer blocked on unverified loan.

    const reviewerRes = await fetch(`${baseUrl}/api/loans/${loanOneId}`, {
      headers: { cookie: reviewerCookie },
    });
    expect(reviewerRes.status).toBe(200); // Reviewer can see it.
  });

  it("consumer detail on verified loan returns 200 and list includes it", async () => {
    // Verify loan one directly through the API as reviewer
    // (all exceptions are closed — none exist on these clean rows)
    const verifyRes = await fetch(`${baseUrl}/api/loans/${loanOneId}/verify`, {
      headers: { cookie: reviewerCookie },
      method: "POST",
    });
    expect(verifyRes.status).toBe(201);

    const consumerDetailRes = await fetch(`${baseUrl}/api/loans/${loanOneId}`, {
      headers: { cookie: consumerCookie },
    });
    expect(consumerDetailRes.status).toBe(200); // Consumers can see verified loans.
    const detailBody = (await consumerDetailRes.json()) as {
      verifiedRecord: { recordHash: string } | null;
    };
    expect(detailBody.verifiedRecord?.recordHash).toBeDefined(); // Verification hash present.

    const listRes = await fetch(
      `${baseUrl}/api/loans?batchId=${batchId}&limit=100`,
      {
        headers: { cookie: consumerCookie },
      }
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: Array<{ id: string }>;
      pagination: { total: number };
    };
    expect(listBody.pagination.total).toBe(1); // Only the verified loan appears.
    expect(listBody.data[0]?.id).toBe(loanOneId);

    // Loan two remains unverified — still 403 for consumer
    const loanTwoRes = await fetch(`${baseUrl}/api/loans/${loanTwoId}`, {
      headers: { cookie: consumerCookie },
    });
    expect(loanTwoRes.status).toBe(403); // Still blocked.
  });

  it("PATCH fields updates the loan and writes FIELD_EDITED audit inside a transaction", async () => {
    const before = await prisma.loan.findUnique({ where: { id: loanTwoId } });
    expect(before?.paymentStatus).toBe("current"); // Baseline state.

    const patchRes = await fetch(`${baseUrl}/api/loans/${loanTwoId}/fields`, {
      body: JSON.stringify({
        fields: { currentBalance: "341000.50", paymentStatus: "late" }, // Two editable fields.
        reason: "corrected per servicer update",
      }),
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "PATCH",
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { updatedFields: string[] };
    expect(patchBody.updatedFields.sort()).toEqual([
      "currentBalance",
      "paymentStatus",
    ]);

    const after = await prisma.loan.findUnique({ where: { id: loanTwoId } });
    expect(after?.paymentStatus).toBe("late"); // DB reflects the new status.
    expect(Number(after?.currentBalance)).toBe(341_000.5); // Balance updated too.

    const audits = await prisma.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      where: { eventType: "FIELD_EDITED", loanId: loanTwoId },
    });
    expect(audits.length).toBe(2); // One audit per edited field.
    const byField = new Map(
      audits.map((a) => [
        (a.metadata as Record<string, unknown>).field as string,
        a.metadata as Record<string, unknown>,
      ])
    );
    expect(byField.get("currentBalance")).toBeDefined();
    expect(byField.get("currentBalance")?.oldValue).toBe("342000"); // Old value captured.
    expect(byField.get("currentBalance")?.newValue).toBe("341000.50"); // New value captured.
    expect(byField.get("currentBalance")?.reason).toBe(
      "corrected per servicer update" // Reason is preserved.
    );
    expect(byField.get("paymentStatus")?.oldValue).toBe("current");
    expect(byField.get("paymentStatus")?.newValue).toBe("late");

    // Non-reviewers get 403
    const consumerPatch = await fetch(
      `${baseUrl}/api/loans/${loanTwoId}/fields`,
      {
        body: JSON.stringify({ fields: { paymentStatus: "x" }, reason: "x" }),
        headers: { "content-type": "application/json", cookie: consumerCookie },
        method: "PATCH",
      }
    );
    expect(consumerPatch.status).toBe(403); // Consumers cannot edit.
  });

  it("PATCH rejects non-editable keys, empty bodies and invalid cuids", async () => {
    const resLoanId = await fetch(`${baseUrl}/api/loans/${loanTwoId}/fields`, {
      body: JSON.stringify({
        fields: { originationDate: "2026-01-01" }, // Not an editable field.
        reason: "should fail",
      }),
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "PATCH",
    });
    expect(resLoanId.status).toBe(400); // Whitelist rejects it.

    const resEmpty = await fetch(`${baseUrl}/api/loans/${loanTwoId}/fields`, {
      body: JSON.stringify({ fields: {}, reason: "x" }), // No fields supplied.
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "PATCH",
    });
    expect(resEmpty.status).toBe(400);

    const resCuid = await fetch(`${baseUrl}/api/loans/not-a-cuid/fields`, {
      body: JSON.stringify({ fields: { paymentStatus: "x" }, reason: "x" }),
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "PATCH",
    });
    expect(resCuid.status).toBe(400); // Malformed id is rejected early.
  });
});
