import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
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
const RUN_TAG = `manifest_it_${Date.now()}`;
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

// Registers a fresh user, promotes them to the requested role, and returns their cookie.
const createUser = async (prefix: string, role: string): Promise<string> => {
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
  expect([200, 422].includes(signUpRes.status)).toBe(true);
  await prisma.user.update({ data: { role }, where: { email } });
  return signIn(email, "password");
};

// Uploads a CSV as the given user and returns the resulting batch id.
const uploadCsv = async (
  cookie: string,
  fileType: string,
  content: string,
  fileName: string
): Promise<string> => {
  const form = new FormData();
  form.append("file", new File([content], fileName, { type: "text/csv" }));
  form.append("fileType", fileType);
  const uploadRes = await fetch(`${baseUrl}/api/uploads`, {
    body: form,
    headers: { cookie },
    method: "POST",
  });
  expect(uploadRes.status).toBe(202); // Accepted for async processing.
  const { batchId } = (await uploadRes.json()) as { batchId: string };
  return batchId;
};

// Polls a batch until it reaches a terminal state (done or failed).
const pollBatch = async (
  cookie: string,
  batchId: string
): Promise<{ status: string; recordCount: number; failedCount: number }> => {
  let detail = { failedCount: 0, recordCount: 0, status: "processing" };
  for (let index = 0; index < 40; index += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const detailRes = await fetch(`${baseUrl}/api/uploads/${batchId}`, {
      headers: { cookie },
    });
    if (detailRes.status === 200) {
      detail = (await detailRes.json()) as typeof detail;
      if (detail.status === "done" || detail.status === "failed") {
        break;
      }
    }
  }
  return detail;
};

// Standard loan_tape header used in every synthetic upload below.
const TAPE_HEADER =
  "loan_id,borrower_id,loan_type,origination_date,maturity_date,original_principal,current_balance,interest_rate,term_months,borrower_state,loan_purpose,credit_grade,employment_length,income_band,payment_status,days_past_due,servicer_name,last_payment_date,last_updated_at,document_status,source_system";

// Builds a valid synthetic tape row with the given document status.
const tapeRow = (n: number, docStatus: string): string =>
  `L-${RUN_TAG}-${n},B-${RUN_TAG}-${n},mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,${docStatus},origination`;

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

// Delete every row this run created, then close the server.
afterAll(async () => {
  const batchIds = (
    await prisma.uploadBatch.findMany({
      select: { id: true },
      where: { fileName: { contains: RUN_TAG } },
    })
  ).map((b) => b.id); // Collect manifest batch ids for cascaded cleanup.
  const loanIds = (
    await prisma.loan.findMany({
      select: { id: true },
      where: { sourceBatchId: { in: batchIds } },
    })
  ).map((l) => l.id); // Loans that came from those batches.
  const userIds = (
    await prisma.user.findMany({
      select: { id: true },
      where: { email: { contains: RUN_TAG } },
    })
  ).map((u) => u.id); // Users created by this run.

  // Manually-updated tape loans (not tied to manifest batch ids)
  const allTapeLoanIds = (
    await prisma.loan.findMany({
      select: { id: true },
      where: { loanId: { contains: RUN_TAG } },
    })
  ).map((l) => l.id); // Every loan id matching the run tag.

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { loanId: { in: [...new Set([...loanIds, ...allTapeLoanIds])] } },
        { batchId: { in: batchIds } },
        { actorId: { in: userIds } },
      ],
    },
  });
  await prisma.exception.deleteMany({
    where: { loanId: { in: [...new Set([...loanIds, ...allTapeLoanIds])] } },
  });
  await prisma.loan.deleteMany({
    where: { loanId: { contains: RUN_TAG } },
  });
  await prisma.uploadBatch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
  if (server) {
    server.close();
  }
});

describe("document manifest pipeline (integration)", () => {
  let operatorCookie = "";
  let tapeBatchId = "";
  let loanOneId = "";
  let loanTwoId = "";

  beforeAll(async () => {
    operatorCookie = await createUser("operator_it", "data_operator");

    // Seed a clean loan_tape with two loans (document_status=complete).
    tapeBatchId = await uploadCsv(
      operatorCookie,
      "loan_tape",
      [TAPE_HEADER, tapeRow(1, "complete"), tapeRow(2, "complete")].join("\n"),
      `tape_${RUN_TAG}.csv`
    );
    const tapePoll = await pollBatch(operatorCookie, tapeBatchId);
    expect(tapePoll.status).toBe("done"); // Tape finished ingesting.

    const loans = await prisma.loan.findMany({
      orderBy: { sourceRowNumber: "asc" },
      where: { sourceBatchId: tapeBatchId },
    });
    expect(loans.length).toBe(2); // Two tape loans to anchor the manifests.
    loanOneId = loans[0]?.id ?? "";
    loanTwoId = loans[1]?.id ?? "";
    expect(loanOneId).not.toBe("");
    expect(loanTwoId).not.toBe("");
  });

  it("applies availability to matched loans, exceptions for missing, no Loan pollution", async () => {
    const manifestContent = [
      "loan_id,document_type,available",
      // Loan 1: fully available
      `L-${RUN_TAG}-1,deed_of_trust,true`,
      `L-${RUN_TAG}-1,title_insurance,yes`,
      // Loan 2: one missing document -> missing + missing_field exception
      `L-${RUN_TAG}-2,deed_of_trust,false`,
      // Unknown business id -> ignored as unmatched
      `L-${RUN_TAG}-999,deed_of_trust,true`,
    ].join("\n");

    const manifestBatchId = await uploadCsv(
      operatorCookie,
      "document_manifest",
      manifestContent,
      `manifest_${RUN_TAG}.csv`
    );
    const pollResult = await pollBatch(operatorCookie, manifestBatchId);
    expect(pollResult.status).toBe("done"); // Manifest pipeline finished.
    expect(pollResult.recordCount).toBe(4); // All four manifest rows processed.
    expect(pollResult.failedCount).toBe(0); // No normalization failures.

    // Regression guard: manifests must NOT create Loan rows.
    const manifestLoans = await prisma.loan.count({
      where: { sourceBatchId: manifestBatchId },
    });
    expect(manifestLoans).toBe(0); // Manifests only annotate existing loans.

    const loanOne = await prisma.loan.findUnique({
      where: { id: loanOneId },
    });
    expect(loanOne?.documentStatus).toBe("complete"); // Availability keeps it complete.

    const loanTwo = await prisma.loan.findUnique({
      where: { id: loanTwoId },
    });
    expect(loanTwo?.documentStatus).toBe("missing"); // One false doc flips to missing.

    // One missing_field exception on loan 2 only
    const exceptions = await prisma.exception.findMany({
      where: {
        exceptionType: "missing_field",
        metadata: {
          equals: manifestBatchId,
          path: ["manifestBatchId"], // Exception tagged to this manifest batch.
        } as never,
      },
    });
    expect(exceptions.length).toBe(1); // Exactly one exception row.
    expect(exceptions[0]?.loanId).toBe(loanTwoId);
    expect(exceptions[0]?.status).toBe("open"); // Fresh and unreviewed.
    const excMeta = exceptions[0]?.metadata as Record<string, unknown>;
    expect(excMeta.missingDocumentTypes).toEqual(["deed_of_trust"]); // Records what is missing.

    // FIELD_EDITED only for the loan whose status actually flipped (loan 2);
    // loan 1 was already complete in the tape — a no-op writes nothing.
    const fieldEdits = await prisma.auditLog.findMany({
      where: {
        eventType: "FIELD_EDITED",
        loanId: { in: [loanOneId, loanTwoId] },
        metadata: {
          equals: manifestBatchId,
          path: ["manifestBatchId"], // Audit tied to the manifest batch.
        } as never,
      },
    });
    expect(fieldEdits.length).toBe(1); // Only loan 2 emitted an audit entry.
    const editMeta = fieldEdits[0]?.metadata as Record<string, unknown>;
    expect(editMeta.newValue).toBe("missing"); // Status transition recorded.
    expect(editMeta.oldValue).toBe("complete"); // Previous status preserved.
    expect(editMeta.source).toBe("system:document_manifest"); // System-origin audit.

    const exceptionCreated = await prisma.auditLog.count({
      where: { eventType: "EXCEPTION_CREATED", exceptionId: exceptions[0]?.id },
    });
    expect(exceptionCreated).toBe(1); // Creation itself is audited once.
  });

  it("replaying the same manifest twice does not duplicate exceptions (orphan guard)", async () => {
    const manifestContent = [
      "loan_id,document_type,available",
      `L-${RUN_TAG}-2,deed_of_trust,false`,
    ].join("\n");

    const firstBatchId = await uploadCsv(
      operatorCookie,
      "document_manifest",
      manifestContent,
      `replay_a_${RUN_TAG}.csv`
    );
    expect((await pollBatch(operatorCookie, firstBatchId)).status).toBe("done");
    const afterFirst = await prisma.exception.count({
      where: {
        exceptionType: "missing_field",
        metadata: { equals: firstBatchId, path: ["manifestBatchId"] } as never,
      },
    });
    expect(afterFirst).toBe(1); // First run ensures its own exception.

    // Re-run same data under a NEW batch id — the tape loan is already
    // missing, but the missing_field exception must STILL be ensured for
    // the new manifest batch (decoupled from the status flip).
    const secondBatchId = await uploadCsv(
      operatorCookie,
      "document_manifest",
      manifestContent,
      `replay_b_${RUN_TAG}.csv`
    );
    expect((await pollBatch(operatorCookie, secondBatchId)).status).toBe(
      "done"
    );
    const afterSecond = await prisma.exception.count({
      where: {
        exceptionType: "missing_field",
        metadata: { equals: secondBatchId, path: ["manifestBatchId"] } as never,
      },
    });
    expect(afterSecond).toBe(1); // New batch gets its own exception row.

    // The done-guard: re-invoking the service on a completed batch must
    // skip entirely (no orphan cleanup, no duplicate INGESTION_COMPLETED).
    const { processDocumentManifest } = await import(
      "./services/document-manifest.service.js"
    );
    const filePath = `/tmp/opencode/orphan_${Date.now()}.csv`;
    await Bun.write(filePath, manifestContent); // Materialize a file to feed the service.

    const completedBefore = await prisma.auditLog.count({
      where: { batchId: firstBatchId, eventType: "INGESTION_COMPLETED" },
    });
    await processDocumentManifest(filePath, firstBatchId); // Force re-run.
    const completedAfter = await prisma.auditLog.count({
      where: { batchId: firstBatchId, eventType: "INGESTION_COMPLETED" },
    });
    expect(completedAfter).toBe(completedBefore); // No duplicate completion audit.
    const stillOne = await prisma.exception.count({
      where: {
        exceptionType: "missing_field",
        metadata: { equals: firstBatchId, path: ["manifestBatchId"] } as never,
      },
    });
    expect(stillOne).toBe(1); // Existing exception untouched by the guarded re-run.

    await fs.promises.unlink(filePath).catch(() => {}); // Best-effort tmp cleanup.
  });

  it("bad headers or all-invalid rows fail the batch without zombie processing", async () => {
    // Bad headers
    const badHeaderBatchId = await uploadCsv(
      operatorCookie,
      "document_manifest",
      ["foo,bar", "1,2"].join("\n"),
      `badhead_${RUN_TAG}.csv`
    );
    const badHeaderPoll = await pollBatch(operatorCookie, badHeaderBatchId);
    expect(badHeaderPoll.status).toBe("failed"); // Structural failure stops the batch.
    const badHeadBatch = await prisma.uploadBatch.findUnique({
      where: { id: badHeaderBatchId },
    });
    const badHeadMeta = badHeadBatch?.metadata as Record<string, unknown>;
    expect(String(badHeadMeta.error)).toContain("header mismatch"); // Failure reason surfaced.

    // All rows invalid (missing loan_id / invalid boolean)
    const invalidRowsBatchId = await uploadCsv(
      operatorCookie,
      "document_manifest",
      ["loan_id,document_type,available", ",deed,maybe", "L-x,title,3"].join(
        "\n"
      ),
      `invalid_${RUN_TAG}.csv`
    );
    const invalidPoll = await pollBatch(operatorCookie, invalidRowsBatchId);
    // Rows fail normalization but the file is structurally valid:
    // batch completes with failedRows recorded, no loans touched.
    expect(invalidPoll.status).toBe("done"); // Per-row failures do not fail the batch.
    expect(invalidPoll.recordCount).toBe(2); // Both rows counted.
    expect(invalidPoll.failedCount).toBe(2); // Both rows failed normalization.
    const invalidBatch = await prisma.uploadBatch.findUnique({
      where: { id: invalidRowsBatchId },
    });
    const invalidMeta = invalidBatch?.metadata as Record<string, unknown>;
    const failedRows = invalidMeta.failedRows as Array<{ reason: string }>;
    expect(failedRows.length).toBe(2); // Two recorded failures.
    expect(failedRows.some((r) => r.reason.includes("loan_id"))).toBe(true); // Blank loan id flagged.
    expect(failedRows.some((r) => r.reason.includes("available"))).toBe(true); // Bad boolean flagged.
  });

  it("skips processing when the same manifest batch is marked done (idempotent)", async () => {
    const manifestContent = [
      "loan_id,document_type,available",
      `L-${RUN_TAG}-1,title,true`,
    ].join("\n");

    const batchId = await uploadCsv(
      operatorCookie,
      "document_manifest",
      manifestContent,
      `idem_${RUN_TAG}.csv`
    );
    expect((await pollBatch(operatorCookie, batchId)).status).toBe("done");

    const editsBefore = await prisma.auditLog.count({
      where: {
        eventType: "FIELD_EDITED",
        loanId: loanOneId,
        metadata: { equals: batchId, path: ["manifestBatchId"] } as never,
      },
    });
    expect(editsBefore).toBe(0); // documentStatus already complete → no-op

    // Done-guard skips re-run entirely (no double INGESTION_COMPLETED)
    const completedBefore = await prisma.auditLog.count({
      where: { batchId, eventType: "INGESTION_COMPLETED" },
    });
    const { processDocumentManifest } = await import(
      "./services/document-manifest.service.js"
    );
    const filePath = `/tmp/opencode/idem_${Date.now()}.csv`;
    await Bun.write(filePath, manifestContent); // Materialize a file to feed the service.
    await processDocumentManifest(filePath, batchId); // Force re-run.
    const completedAfter = await prisma.auditLog.count({
      where: { batchId, eventType: "INGESTION_COMPLETED" },
    });
    expect(completedAfter).toBe(completedBefore); // No duplicate completion audit.
    await fs.promises.unlink(filePath).catch(() => {}); // Best-effort tmp cleanup.
  });

  it("re-invoking a soft-failed batch cleans orphans and recreates exactly one exception", async () => {
    const manifestContent = [
      "loan_id,document_type,available",
      `L-${RUN_TAG}-1,deed,false`,
    ].join("\n");

    const batchId = await uploadCsv(
      operatorCookie,
      "document_manifest",
      manifestContent,
      `orphan_${RUN_TAG}.csv`
    );
    expect((await pollBatch(operatorCookie, batchId)).status).toBe("done");

    // Simulate a mid-run crash: stage left "applying" with an orphan
    // open/unreviewed exception from the aborted attempt.
    const batch = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });
    const meta = (batch?.metadata as Record<string, unknown>) ?? {};
    await prisma.uploadBatch.update({
      data: {
        metadata: { ...meta, manifestStage: "applying" }, // Rewind to applying stage.
        status: "processing", // Flip back to non-terminal so re-entry is allowed.
      },
      where: { id: batchId },
    });

    const { processDocumentManifest } = await import(
      "./services/document-manifest.service.js"
    );
    const filePath = `/tmp/opencode/crash_${Date.now()}.csv`;
    await Bun.write(filePath, manifestContent); // Materialize a file to feed the service.
    await processDocumentManifest(filePath, batchId); // Resume the interrupted batch.
    await fs.promises.unlink(filePath).catch(() => {}); // Best-effort tmp cleanup.

    const finalBatch = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });
    expect(finalBatch?.status).toBe("done"); // Recovery pushes the batch to done.

    // Orphan deleted, re-ensured exactly once — no duplicates.
    const exceptions = await prisma.exception.findMany({
      where: {
        exceptionType: "missing_field",
        metadata: { equals: batchId, path: ["manifestBatchId"] } as never,
      },
    });
    expect(exceptions.length).toBe(1); // Cleaned up to a single row.
    expect(exceptions[0]?.status).toBe("open"); // Recreated and pending review.
  });
});
