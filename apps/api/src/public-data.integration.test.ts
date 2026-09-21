import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path, { join } from "node:path";

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
const RUN_TAG = `public_data_it_${Date.now()}`;
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

// Joins pipe fields into an unheaded public-feed row.
const pipeRow = (fields: string[]): string => fields.join("|");

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
  await prisma.exception.deleteMany({
    where: { loan: { sourceBatch: { fileName: { contains: RUN_TAG } } } },
  });
  await prisma.verifiedLoan.deleteMany({
    where: { loan: { sourceBatch: { fileName: { contains: RUN_TAG } } } },
  });
  await prisma.auditLog.deleteMany({
    where: { batch: { fileName: { contains: RUN_TAG } } },
  });
  await prisma.auditLog.deleteMany({
    where: { loan: { sourceBatch: { fileName: { contains: RUN_TAG } } } },
  });
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

describe("public-data ingestion (integration) — fannie_mae / freddie_mac", () => {
  it("operator uploads freddie_mac pipe file -> folded loans, validation, summary", async () => {
    const operatorEmail = `operator_${RUN_TAG}@luma.dev`;
    const uniqueFileName = `freddie_mac_${RUN_TAG}.csv`;

    const signUpRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: operatorEmail,
        name: "Operator Public IT",
        password: "password",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect([200, 422].includes(signUpRes.status)).toBe(true);
    await prisma.user.update({
      data: { role: "data_operator" }, // Promote to operator so they can upload.
      where: { email: operatorEmail },
    });
    const cookie = await signIn(operatorEmail, "password");

    // Build pipe content: 2 loans, first with 3 monthly rows (fold), second with 1 row, plus 1 bad row (empty loan_id)
    const loanAFold1 = buildPipeFields({
      1: `L-${RUN_TAG}-A`,
      2: "082009",
      11: "0.00",
      15: "0",
    });
    const loanAFold2 = buildPipeFields({
      1: `L-${RUN_TAG}-A`,
      2: "092009",
      11: "54300.00",
      15: "1",
    });
    const loanAFold3 = buildPipeFields({
      1: `L-${RUN_TAG}-A`,
      2: "102009",
      11: "54200.00",
      15: "2",
    });
    const loanB = buildPipeFields({
      1: `L-${RUN_TAG}-B`,
      2: "082009",
      11: "165000.00",
      15: "0",
      30: "CA",
    });
    const bad = buildPipeFields({ 1: "" }); // Missing loan id — gate reject.

    const pipeContent = [
      pipeRow(loanAFold1),
      pipeRow(loanAFold2),
      pipeRow(loanAFold3),
      pipeRow(loanB),
      pipeRow(bad),
    ].join("\n");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-it-"));
    const tmpPath = path.join(tmpDir, "freddie_mac.csv");
    fs.writeFileSync(tmpPath, pipeContent, "utf8");

    const form = new FormData();
    const fileBlob = new File([pipeContent], uniqueFileName, {
      type: "text/csv",
    });
    form.append("file", fileBlob);
    form.append("fileType", "freddie_mac");

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
    expect(uploadBody.fileName).toBe(uniqueFileName);
    expect(uploadBody.fileType).toBe("freddie_mac");
    const { batchId } = uploadBody;

    let detail: {
      failedCount: number;
      metadata?: Record<string, unknown>;
      recordCount: number;
      status: string;
    } | null = null;
    for (let index = 0; index < 20; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500)); // Poll the pipeline.
      const detailRes = await fetch(`${baseUrl}/api/uploads/${batchId}`, {
        headers: { cookie },
      });
      expect(detailRes.status).toBe(200);
      detail = (await detailRes.json()) as {
        failedCount: number;
        metadata?: Record<string, unknown>;
        recordCount: number;
        status: string;
      };
      if (detail.status === "done" || detail.status === "failed") {
        break;
      }
    }
    expect(detail).not.toBeNull();
    if (!detail) {
      throw new Error("detail null");
    }
    expect(detail.status).toBe("done"); // Pipeline finished.
    // 4 raw rows folded to 2 loans + 1 failed row => recordCount = 3
    expect(detail.recordCount).toBe(3); // Two folded loans + one failed row.
    expect(detail.failedCount).toBe(1); // Only the bad row failed.
    expect(detail.metadata?.publicDataSourceRows).toBe(5); // Raw pipe rows counted.
    expect(detail.metadata?.publicDataFoldedLoans).toBe(2); // Distinct loans after folding.

    const loans = await prisma.loan.findMany({
      orderBy: { sourceRowNumber: "asc" },
      where: { sourceBatchId: batchId },
    });
    expect(loans.length).toBe(2); // Two loans persisted.
    const loanA = loans.find((l) => l.loanId === `L-${RUN_TAG}-A`);
    const loanBRec = loans.find((l) => l.loanId === `L-${RUN_TAG}-B`);
    expect(loanA).toBeDefined();
    expect(loanBRec).toBeDefined();
    // Fold: latest balance 54200, lastUpdatedAt from 102009, DPD 60, delinquent
    expect(Number(loanA?.currentBalance)).toBe(54_200); // Latest month's UPB wins.
    expect(loanA?.paymentStatus).toBe("delinquent"); // Latest delinquency wins.
    expect(loanA?.daysPastDue).toBe(60); // Two months delinquent.
    expect(loanA?.sourceSystem).toBe("freddie_mac"); // Feed tag preserved.
    expect(loanA?.documentStatus).toBe("unknown"); // Public data never sets docs.
    expect(loanBRec?.borrowerState).toBe("CA"); // State lands for loan B.

    // Summary should reflect validation (stale_record etc. for 2009 dates will be present, but check counts)
    const summaryRes = await fetch(
      `${baseUrl}/api/uploads/${batchId}/summary`,
      {
        headers: { cookie },
      }
    );
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as {
      failedValidation: number;
      passedValidation: number;
      totalImported: number;
    };
    expect(summary.totalImported).toBe(2); // Both folded loans counted.
    expect(summary.failedValidation + summary.passedValidation).toBe(2); // All loans accounted for.

    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it("operator uploads fannie_mae pipe file -> same lineage, sourceSystem = fannie_mae", async () => {
    const operatorEmail = `operator2_${RUN_TAG}@luma.dev`;
    const uniqueFileName = `fannie_mae_${RUN_TAG}.csv`;
    const signUpRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: operatorEmail,
        name: "Operator Public 2",
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

    const row = buildPipeFields({
      1: `L-${RUN_TAG}-FANNIE`,
      2: "082009",
      30: "NY", // Fannie-specific state.
    });
    const pipeContent = pipeRow(row);
    const form = new FormData();
    form.append(
      "file",
      new File([pipeContent], uniqueFileName, { type: "text/csv" })
    );
    form.append("fileType", "fannie_mae");
    const uploadRes = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      headers: { cookie },
      method: "POST",
    });
    expect(uploadRes.status).toBe(202);
    const { batchId } = (await uploadRes.json()) as { batchId: string };
    let detail: { status: string } | null = null;
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const res = await fetch(`${baseUrl}/api/uploads/${batchId}`, {
        headers: { cookie },
      });
      detail = (await res.json()) as { status: string };
      if (detail.status === "done" || detail.status === "failed") {
        break;
      }
    }
    expect(detail?.status).toBe("done"); // Fannie ingest finished.
    const loans = await prisma.loan.findMany({
      where: { sourceBatchId: batchId },
    });
    expect(loans.length).toBe(1);
    expect(loans[0]?.sourceSystem).toBe("fannie_mae"); // Proper feed tag.
    expect(loans[0]?.loanId).toBe(`L-${RUN_TAG}-FANNIE`);
  });

  it("synthetic loan_tape still succeeds (non-regression)", async () => {
    const operatorEmail = `operator3_${RUN_TAG}@luma.dev`;
    const signUpRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: operatorEmail,
        name: "Operator 3",
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
    const csvHeader =
      "loan_id,borrower_id,loan_type,origination_date,maturity_date,original_principal,current_balance,interest_rate,term_months,borrower_state,loan_purpose,credit_grade,employment_length,income_band,payment_status,days_past_due,servicer_name,last_payment_date,last_updated_at,document_status,source_system";
    const validRow = `L-${RUN_TAG}-SYN,B-${RUN_TAG}-SYN,mortgage,2022-03-15,2052-03-15,350000.00,342000.00,6.75,360,CA,purchase,A,5-10 years,100k-150k,current,0,First National,2026-08-01,2026-08-20,complete,origination`;
    const form = new FormData();
    form.append(
      "file",
      new File([`${csvHeader}\n${validRow}`], `loan_tape_${RUN_TAG}_syn.csv`, {
        type: "text/csv",
      })
    );
    form.append("fileType", "loan_tape");
    const res = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      headers: { cookie },
      method: "POST",
    });
    expect(res.status).toBe(202);
    const { batchId } = (await res.json()) as { batchId: string };
    let detail: { status: string } | null = null;
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const pollRes = await fetch(`${baseUrl}/api/uploads/${batchId}`, {
        headers: { cookie },
      });
      detail = (await pollRes.json()) as { status: string };
      if (detail.status === "done" || detail.status === "failed") {
        break;
      }
    }
    expect(detail?.status).toBe("done"); // Synthetic tape still works.
  });
});
