import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path, { join } from "node:path";
import { batchSummarySchema } from "@repo/types";

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
const RUN_TAG = `upload_it_${Date.now()}`;
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

// Writes CSV content to a temp file and returns the path.
const createCsvFile = (content: string): string => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-it-"));
  const filePath = path.join(tmpDir, "test.csv");
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
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

// Clean up every row created by this run, then close the server.
afterAll(async () => {
  await prisma.loan.deleteMany({
    where: { sourceBatch: { fileName: { contains: RUN_TAG } } },
  });
  await prisma.uploadBatch.deleteMany({
    where: { fileName: { contains: RUN_TAG } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: RUN_TAG } },
  });
  await prisma.$disconnect();
  if (server) {
    server.close();
  }
});

describe("upload flow (integration)", () => {
  it("operator uploads csv -> 202 -> poll until done -> loans and summary", async () => {
    const operatorEmail = `operator_${RUN_TAG}@luma.dev`;
    const uniqueFileName = `loan_tape_${RUN_TAG}.csv`;

    // Ensure operator exists with correct role
    const signUpRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: operatorEmail,
        name: "Operator IT",
        password: "password",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    // 200 if new, 422 if already exists from previous run -> still need role
    expect([200, 422].includes(signUpRes.status)).toBe(true);
    await prisma.user.update({
      data: { role: "data_operator" }, // Promote to operator so they can upload.
      where: { email: operatorEmail },
    });
    const cookie = await signIn(operatorEmail, "password");

    const csvHeader =
      "loan_id,borrower_id,loan_type,origination_date,maturity_date,original_principal,current_balance,interest_rate,term_months,borrower_state,loan_purpose,credit_grade,employment_length,income_band,payment_status,days_past_due,servicer_name,last_payment_date,last_updated_at,document_status,source_system";
    const validRow1 = `L-${RUN_TAG}-1,B-${RUN_TAG}-1,mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`;
    const validRow2 = `L-${RUN_TAG}-2,B-${RUN_TAG}-2,mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`;
    const badRow =
      ",,mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination"; // Missing both ids.
    const csvContent = [csvHeader, validRow1, badRow, validRow2].join("\n");

    const tmpPath = createCsvFile(csvContent);
    const fileName = uniqueFileName;
    // Need to move tmp file to have correct name for uploadBatch fileName check?
    // The upload will use originalname from FormData File, not tmp path.

    const form = new FormData();
    const fileBlob = new File([csvContent], fileName, { type: "text/csv" });
    form.append("file", fileBlob);
    form.append("fileType", "loan_tape");

    const uploadRes = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      headers: { cookie },
      method: "POST",
    });
    expect(uploadRes.status).toBe(202); // Accepted for async processing.
    const uploadBody = (await uploadRes.json()) as {
      batchId: string;
      fileName: string;
      fileType: string;
      status: string;
    };
    expect(uploadBody.batchId).toBeDefined();
    expect(uploadBody.fileName).toBe(fileName);
    expect(uploadBody.fileType).toBe("loan_tape");
    expect(uploadBody.status).toBe("processing"); // Pipeline starts processing.

    const { batchId } = uploadBody;

    // Poll every 500ms until done (web polls every 2s)
    let detail: {
      status: string;
      failedCount: number;
      recordCount: number;
    } | null = null;
    for (let index = 0; index < 20; index += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const detailRes = await fetch(`${baseUrl}/api/uploads/${batchId}`, {
        headers: { cookie },
      });
      expect(detailRes.status).toBe(200);
      const parsedDetail = (await detailRes.json()) as {
        failedCount: number;
        recordCount: number;
        status: string;
      };
      detail = parsedDetail;
      if (detail.status === "done" || detail.status === "failed") {
        break; // Stop polling once the pipeline settles.
      }
    }
    expect(detail).not.toBeNull();
    if (!detail) {
      throw new Error("detail is null after polling");
    }
    expect(detail.status).toBe("done"); // Batch finished successfully.
    expect(detail.recordCount).toBe(3); // All data rows counted.
    expect(detail.failedCount).toBe(1); // Only the bad row failed.

    // Verify loans exist with correct row numbers and batch linkage
    const loans = await prisma.loan.findMany({
      orderBy: { sourceRowNumber: "asc" },
      where: { sourceBatchId: batchId },
    });
    expect(loans.length).toBe(2); // Two valid rows inserted.
    expect(loans[0]?.loanId).toBe(`L-${RUN_TAG}-1`);
    expect(loans[0]?.sourceRowNumber).toBe(2); // Row 2 after the header.
    expect(loans[1]?.loanId).toBe(`L-${RUN_TAG}-2`);
    expect(loans[1]?.sourceRowNumber).toBe(4); // Improper row skipped, so 4.

    // Verify failedRows persisted in metadata
    const batch = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });
    const metadata = batch?.metadata as Record<string, unknown> | null;
    const failedRows = (metadata?.failedRows ?? []) as unknown[];
    expect(failedRows.length).toBe(1); // One failure stored.
    const firstFailed = failedRows[0] as { reason: string; rowNumber: number };
    expect(String(firstFailed.reason).toLowerCase()).toContain("loan_id"); // Reason identifies the gap.
    expect(firstFailed.rowNumber).toBe(3); // The bad row is row 3.

    // Summary returns real counts, zeroed exception groups for now
    const summaryRes = await fetch(
      `${baseUrl}/api/uploads/${batchId}/summary`,
      {
        headers: { cookie },
      }
    );
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as unknown;
    const parsed = batchSummarySchema.safeParse(summary); // Validate the shape.
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.batchId).toBe(batchId);
      expect(parsed.data.totalImported).toBe(2); // Both loans imported.
      expect(parsed.data.failedValidation).toBe(0);
      expect(parsed.data.passedValidation).toBe(2);
    }

    // List endpoint shows the batch
    const listRes = await fetch(`${baseUrl}/api/uploads?page=1&limit=20`, {
      headers: { cookie },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: { id: string }[];
      pagination: { total: number };
    };
    expect(listBody.data.some((b) => b.id === batchId)).toBe(true); // Batch is listed.

    fs.rmSync(path.dirname(tmpPath), { force: true, recursive: true });
  });

  it("non-operator gets 403 on upload", async () => {
    const reviewerEmail = `reviewer_${RUN_TAG}@luma.dev`;
    const signUpRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: reviewerEmail,
        name: "Reviewer IT",
        password: "password",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect([200, 422].includes(signUpRes.status)).toBe(true);
    await prisma.user.update({
      data: { role: "reviewer" }, // Reviewers must not upload.
      where: { email: reviewerEmail },
    });
    const cookie = await signIn(reviewerEmail, "password");

    const form = new FormData();
    form.append(
      "file",
      new File(["a,b\n1,2"], "test.csv", { type: "text/csv" })
    );
    form.append("fileType", "loan_tape");
    const res = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      headers: { cookie },
      method: "POST",
    });
    expect(res.status).toBe(403); // Role gate rejects reviewers.
  });

  it("rejects non-csv with 415 and missing fileType with 400", async () => {
    const operatorEmail = `operator2_${RUN_TAG}@luma.dev`;
    const signUpRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: operatorEmail,
        name: "Operator2",
        password: "password",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect([200, 422].includes(signUpRes.status)).toBe(true);
    await prisma.user.update({
      data: { role: "data_operator" },
      where: { email: operatorEmail },
    });
    const cookie = await signIn(operatorEmail, "password");

    const form415 = new FormData();
    form415.append(
      "file",
      new File(["hello"], "test.txt", { type: "text/plain" }) // Not a CSV.
    );
    form415.append("fileType", "loan_tape");
    const res415 = await fetch(`${baseUrl}/api/uploads`, {
      body: form415,
      headers: { cookie },
      method: "POST",
    });
    expect(res415.status).toBe(415); // Unsupported media type.

    const form400 = new FormData();
    form400.append(
      "file",
      new File(["loan_id,borrower_id\nL-1,B-1"], "test.csv", {
        type: "text/csv",
      })
    );
    form400.append("fileType", "invalid_type"); // Unknown file type.
    const res400 = await fetch(`${baseUrl}/api/uploads`, {
      body: form400,
      headers: { cookie },
      method: "POST",
    });
    expect(res400.status).toBe(400); // Bad request for bad fileType.
  });

  it("fails batch ingestion when CSV does not contain valid loan schema/rows", async () => {
    const operatorEmail = `operator3_${RUN_TAG}@luma.dev`;
    const signUpRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: operatorEmail,
        name: "Operator3",
        password: "password",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect([200, 422].includes(signUpRes.status)).toBe(true);
    await prisma.user.update({
      data: { role: "data_operator" },
      where: { email: operatorEmail },
    });
    const cookie = await signIn(operatorEmail, "password");

    // Tableau-style CSV that has nothing to do with loans.
    const invalidContent =
      "DB1 Controller - Cohart Selection,Measure Names,Measure Values\n2026,% Non-DUS,0.006489243\n2025,% Non-DUS,0.007187661";

    const form = new FormData();
    form.append(
      "file",
      new File([invalidContent], `invalid_${RUN_TAG}.csv`, {
        type: "text/csv",
      })
    );
    form.append("fileType", "loan_tape");

    const uploadRes = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      headers: { cookie },
      method: "POST",
    });
    expect(uploadRes.status).toBe(202); // Accepted, then fails async.
    const { batchId } = (await uploadRes.json()) as { batchId: string };

    let detail: { metadata?: { error?: string }; status: string } | null = null;
    for (let index = 0; index < 20; index += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const detailRes = await fetch(`${baseUrl}/api/uploads/${batchId}`, {
        headers: { cookie },
      });
      const parsedDetail = (await detailRes.json()) as {
        metadata?: { error?: string };
        status: string;
      };
      detail = parsedDetail;
      if (detail.status === "done" || detail.status === "failed") {
        break;
      }
    }

    expect(detail?.status).toBe("failed"); // Bad schema fails the batch.
    expect(detail?.metadata?.error).toContain("CSV header mismatch"); // Error names the cause.
  });
});
