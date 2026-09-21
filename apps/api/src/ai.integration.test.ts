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
const RUN_TAG = `ai_it_${Date.now()}`;
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

// Uploads a CSV as the given user and returns the created batch id.
const uploadCsv = async (
  csvContent: string,
  fileName: string,
  fileType: string,
  cookie: string
): Promise<{ batchId: string }> => {
  const form = new FormData();
  form.append("file", new File([csvContent], fileName, { type: "text/csv" }));
  form.append("fileType", fileType);
  const res = await fetch(`${baseUrl}/api/uploads`, {
    body: form,
    headers: { cookie },
    method: "POST",
  });
  expect(res.status).toBe(202); // Accepted for async processing.
  const body = (await res.json()) as { batchId: string };
  expect(body.batchId).toBeDefined();
  return { batchId: body.batchId };
};

// Polls batch detail until the pipeline reaches a terminal status.
const pollUntilDone = async (
  batchId: string,
  cookie: string
): Promise<{ metadata?: Record<string, unknown>; status: string }> => {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await fetch(`${baseUrl}/api/uploads/${batchId}`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      metadata?: Record<string, unknown>;
      status: string;
    };
    if (body.status === "done" || body.status === "failed") {
      return body; // Terminal state reached.
    }
  }
  throw new Error(`Batch ${batchId} did not reach terminal status`);
};

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL; // Point the app at the test DB.
  process.env.MOCK_AI = "true"; // Deterministic pseudo-AI outputs.
  process.env.BETTER_AUTH_SECRET = "dummysupersecrethasatleast32characters!!"; // Auth needs a secret.

  // Apply all pending migrations before booting the app.
  const migrate = Bun.spawnSync(["bunx", "prisma@7", "migrate", "deploy"], {
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

// Delete every row this run created. S3 exception for test teardown.
afterAll(async () => {
  // S3 exception: test teardown only, never in src/services/ — scoped to luma_test + RUN_TAG.
  if (process.env.DATABASE_URL !== TEST_DATABASE_URL) {
    throw new Error("Refusing to delete — DATABASE_URL is not luma_test"); // Safety guard.
  }
  await prisma.exception.deleteMany({
    where: { loan: { sourceBatch: { fileName: { contains: RUN_TAG } } } },
  } as never);
  await prisma.loan.deleteMany({
    where: { sourceBatch: { fileName: { contains: RUN_TAG } } },
  } as never);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { batch: { fileName: { contains: RUN_TAG } } },
        { loan: { sourceBatch: { fileName: { contains: RUN_TAG } } } },
      ],
    } as never,
  } as never);
  await prisma.uploadBatch.deleteMany({
    where: { fileName: { contains: RUN_TAG } },
  } as never);
  await prisma.user.deleteMany({
    where: { email: { contains: RUN_TAG } },
  } as never);
  await prisma.$disconnect();
  if (server) {
    server.close();
  }
});

describe("AI endpoints + servicer conflict detection (integration, MOCK_AI)", () => {
  it("full flow: tape upload -> servicer conflicts -> AI explain/summarize/classify/suggest + RBAC + rate limit", async () => {
    // ── Users ──
    const operatorEmail = `operator_${RUN_TAG}@luma.dev`;
    const reviewerEmail = `reviewer_${RUN_TAG}@luma.dev`;
    const consumerEmail = `consumer_${RUN_TAG}@luma.dev`;

    // Create all three role users up front.
    for (const [email, role, name] of [
      [operatorEmail, "data_operator", "Operator AI"],
      [reviewerEmail, "reviewer", "Reviewer AI"],
      [consumerEmail, "data_consumer", "Consumer AI"],
    ] as const) {
      const signUp = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        body: JSON.stringify({ email, name, password: "password" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect([200, 422].includes(signUp.status)).toBe(true);
      await prisma.user.update({ data: { role }, where: { email } });
    }

    const operatorCookie = await signIn(operatorEmail, "password");
    const reviewerCookie = await signIn(reviewerEmail, "password");
    const consumerCookie = await signIn(consumerEmail, "password");

    // ── Loan tape ──
    const header =
      "loan_id,borrower_id,loan_type,origination_date,maturity_date,original_principal,current_balance,interest_rate,term_months,borrower_state,loan_purpose,credit_grade,employment_length,income_band,payment_status,days_past_due,servicer_name,last_payment_date,last_updated_at,document_status,source_system";
    const loanA = `L-${RUN_TAG}-A,B-${RUN_TAG}-A,mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`;
    const loanB = `L-${RUN_TAG}-B,B-${RUN_TAG}-B,mortgage,2022-03-15,2052-03-15,350000.00,340000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`;
    const tapeCsv = [header, loanA, loanB].join("\n"); // Two tape loans.

    const { batchId: tapeBatchId } = await uploadCsv(
      tapeCsv,
      `loan_tape_${RUN_TAG}.csv`,
      "loan_tape",
      operatorCookie
    );
    const tapeDone = await pollUntilDone(tapeBatchId, operatorCookie);
    expect(tapeDone.status).toBe("done"); // Tape ingested.

    // ── Servicer update: conflict on A (balance), identical on B, unknown loan ignored ──
    // servicer rows must include all comparable fields with matching values for "identical" to avoid sparse-null false conflicts
    const servicerHeader = header;
    const srvConflict = `L-${RUN_TAG}-A,B-${RUN_TAG}-A,mortgage,2022-03-15,2052-03-15,350000.00,340000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`; // Balance differs from tape A.
    const srvIdentical = `L-${RUN_TAG}-B,B-${RUN_TAG}-B,mortgage,2022-03-15,2052-03-15,350000.00,340000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`; // Matches tape B.
    const srvUnknown = `L-${RUN_TAG}-UNKNOWN,B-${RUN_TAG}-X,mortgage,2022-03-15,2052-03-15,350000.00,99999.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`; // No tape counterpart.
    const servicerCsv = [
      servicerHeader,
      srvConflict,
      srvIdentical,
      srvUnknown,
    ].join("\n");

    const { batchId: srvBatchId } = await uploadCsv(
      servicerCsv,
      `servicer_update_${RUN_TAG}.csv`,
      "servicer_update",
      operatorCookie
    );
    const srvDone = await pollUntilDone(srvBatchId, operatorCookie);
    expect(srvDone.status).toBe("done"); // Conflict pass completed.
    const srvMeta = srvDone.metadata as Record<string, unknown> | undefined;
    expect(srvMeta?.conflictStage).toBe("done"); // Conflict stage finished.
    expect(srvMeta?.conflictMatchedRows as number).toBeGreaterThanOrEqual(2); // Both known loans matched.
    expect(srvMeta?.conflictUnmatchedLoanIds as number).toBe(1); // Unknown loan unmatched.

    // ── Assert conflicts created on tape loan A, not B ──
    const tapeLoanA = await prisma.loan.findFirst({
      where: { loanId: `L-${RUN_TAG}-A` },
    });
    expect(tapeLoanA).not.toBeNull();
    const conflictsA = await prisma.exception.findMany({
      where: { exceptionType: "conflicting_source", loanId: tapeLoanA!.id },
    } as never);
    expect(conflictsA.length).toBeGreaterThanOrEqual(1); // At least the balance conflict.
    const balanceConflict = conflictsA.find(
      (c: { field: string | null }) => c.field === "currentBalance"
    ) as
      | {
          field: string | null;
          metadata: Record<string, unknown>;
          message: string;
        }
      | undefined;
    expect(balanceConflict).toBeDefined(); // Balance is the differing field.
    expect(String(balanceConflict!.message)).toContain("servicer_update"); // Message names the source.
    expect(balanceConflict!.metadata.conflictBatchId).toBe(srvBatchId); // Batch linkage recorded.
    expect(String(balanceConflict!.metadata.sourceValue)).toContain("340000"); // Servicer value.
    expect(String(balanceConflict!.metadata.targetValue)).toContain("342000"); // Tape value.

    const tapeLoanB = await prisma.loan.findFirst({
      where: { loanId: `L-${RUN_TAG}-B` },
    });
    const conflictsB = await prisma.exception.findMany({
      where: { exceptionType: "conflicting_source", loanId: tapeLoanB!.id },
    } as never);
    expect(conflictsB.length).toBe(0); // Identical loan has no conflicts.

    // ── AI explain (reviewer) ──
    const excId = conflictsA[0]!.id as string;
    const explainRes = await fetch(`${baseUrl}/api/ai/explain`, {
      body: JSON.stringify({ exceptionId: excId }),
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "POST",
    });
    expect(explainRes.status).toBe(200);
    const explainBody = (await explainRes.json()) as {
      exceptionId: string;
      recommendation: {
        confidence: number;
        fieldsToChange: unknown[];
        model: string;
        promptSummary: string;
        reasoning: string;
        suggestion: string;
        timestamp: string;
      } | null;
    };
    expect(explainBody.exceptionId).toBe(excId);
    expect(explainBody.recommendation).not.toBeNull(); // Mock returns a recommendation.
    expect(explainBody.recommendation!.model).toContain("mock"); // Mock model tagged.
    expect(explainBody.recommendation!.confidence).toBeGreaterThan(0);
    expect(explainBody.recommendation!.fieldsToChange.length).toBeGreaterThan(
      0 // At least one suggested change.
    );
    expect(explainBody.recommendation!.suggestion).toBeDefined();

    // Audit AI_RECOMMENDATION written
    const audit = await prisma.auditLog.findFirst({
      where: { eventType: "AI_RECOMMENDATION", exceptionId: excId },
    } as never);
    expect(audit).not.toBeNull(); // Explain is audited.
    expect(
      (audit as unknown as { metadata: Record<string, unknown> }).metadata.kind
    ).toBe("explain"); // Audit kind is explain.

    // ── AI explain 404 on non-existent ──
    const notFoundExplain = await fetch(`${baseUrl}/api/ai/explain`, {
      body: JSON.stringify({ exceptionId: "c0000000000000000000000000" }), // Unknown id.
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "POST",
    });
    expect(notFoundExplain.status).toBe(404);

    // ── AI explain RBAC ──
    const forbiddenExplain = await fetch(`${baseUrl}/api/ai/explain`, {
      body: JSON.stringify({ exceptionId: excId }),
      headers: { "content-type": "application/json", cookie: consumerCookie },
      method: "POST",
    });
    expect(forbiddenExplain.status).toBe(403); // Consumers cannot explain.

    // ── AI explain auth required ──
    const unauthExplain = await fetch(`${baseUrl}/api/ai/explain`, {
      body: JSON.stringify({ exceptionId: excId }),
      headers: { "content-type": "application/json" }, // No cookie at all.
      method: "POST",
    });
    expect(unauthExplain.status).toBe(401);

    // ── AI explain bad body ──
    const badExplain = await fetch(`${baseUrl}/api/ai/explain`, {
      body: JSON.stringify({}), // Missing exceptionId.
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "POST",
    });
    expect(badExplain.status).toBe(400);

    // ── AI summarize-batch (reviewer) ──
    const summaryRes = await fetch(`${baseUrl}/api/ai/summarize-batch`, {
      body: JSON.stringify({ batchId: tapeBatchId }),
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "POST",
    });
    expect(summaryRes.status).toBe(200);
    const summaryBody = (await summaryRes.json()) as {
      batchId: string;
      model: string;
      summary: string | null;
      timestamp: string;
    };
    expect(summaryBody.batchId).toBe(tapeBatchId);
    expect(summaryBody.summary).not.toBeNull(); // Mock summary generated.
    expect(summaryBody.model).toContain("mock");
    expect(summaryBody.timestamp).toBeDefined();

    // summarize 404
    const summary404 = await fetch(`${baseUrl}/api/ai/summarize-batch`, {
      body: JSON.stringify({ batchId: "c0000000000000000000000000" }), // Unknown batch.
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "POST",
    });
    expect(summary404.status).toBe(404);

    // ── AI classify-severity ──
    const classifyRes = await fetch(`${baseUrl}/api/ai/classify-severity`, {
      body: JSON.stringify({ exceptionId: excId }),
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "POST",
    });
    expect(classifyRes.status).toBe(200);
    const classifyBody = (await classifyRes.json()) as {
      currentSeverity: string;
      reasoning: string | null;
      suggestedSeverity: string | null;
    };
    expect(classifyBody.currentSeverity).toBeDefined(); // Original severity returned.
    expect(classifyBody.suggestedSeverity).not.toBeNull(); // Mock agrees with current.
    expect(classifyBody.reasoning).not.toBeNull();

    // ── AI suggest-rule (reviewer) ──
    const suggestRes = await fetch(`${baseUrl}/api/ai/suggest-rule`, {
      body: JSON.stringify({
        prompt: "Flag any loan where credit grade is A and rate above 12%",
      }),
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "POST",
    });
    expect(suggestRes.status).toBe(200);
    const suggestBody = (await suggestRes.json()) as {
      model: string;
      note: string;
      promptSummary: string;
      rule: {
        id: string;
        name: string;
        exceptionType: string;
        severity: string;
      } | null;
    };
    expect(suggestBody.rule).not.toBeNull();
    expect(suggestBody.rule!.id).toMatch(/^ai_rule_/); // Server-generated id.
    expect(suggestBody.note).toContain("AI-generated"); // Safety note present.

    // suggest-rule as operator (allowed per contract)
    const suggestOp = await fetch(`${baseUrl}/api/ai/suggest-rule`, {
      body: JSON.stringify({ prompt: "Flag stale records older than 90 days" }),
      headers: { "content-type": "application/json", cookie: operatorCookie },
      method: "POST",
    });
    expect(suggestOp.status).toBe(200); // Operators may generate rules.

    // suggest-rule as consumer (forbidden)
    const suggestForbidden = await fetch(`${baseUrl}/api/ai/suggest-rule`, {
      body: JSON.stringify({ prompt: "Flag something" }),
      headers: { "content-type": "application/json", cookie: consumerCookie },
      method: "POST",
    });
    expect(suggestForbidden.status).toBe(403);

    // suggest-rule bad body
    const suggestBad = await fetch(`${baseUrl}/api/ai/suggest-rule`, {
      body: JSON.stringify({ prompt: "" }), // Empty prompt.
      headers: { "content-type": "application/json", cookie: reviewerCookie },
      method: "POST",
    });
    expect(suggestBad.status).toBe(400);

    // ── Rate limit (fresh reviewer to isolate bucket) ──
    const rateLimitEmail = `reviewer_rl_${RUN_TAG}@luma.dev`;
    const signUpRl = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: rateLimitEmail,
        name: "Reviewer RL", // Fresh user so the bucket starts empty.
        password: "password",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect([200, 422].includes(signUpRl.status)).toBe(true);
    await prisma.user.update({
      data: { role: "reviewer" },
      where: { email: rateLimitEmail },
    });
    const rlCookie = await signIn(rateLimitEmail, "password");

    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      // Fire 21 rapid classify requests.
      const r = await fetch(`${baseUrl}/api/ai/explain`, {
        body: JSON.stringify({ exceptionId: excId }),
        headers: { "content-type": "application/json", cookie: rlCookie },
        method: "POST",
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true); // First 20 allowed.
    expect(statuses[20]).toBe(429); // 21st hits the rate limit.
  }, 180_000); // Long budget for the upload pipeline.
});
