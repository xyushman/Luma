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

// In-memory Prisma fake so the routes run without a real database.
const fakePrisma = {
  $transaction: mock(
    async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        auditLog: { create: fakePrisma.auditLog.create },
        uploadBatch: { create: fakePrisma.uploadBatch.create },
      } as never) // Run the callback with the fake transaction client.
  ),
  auditLog: { create: mock(() => Promise.resolve({} as never)) },
  exception: {
    count: mock(() => Promise.resolve(0 as never)),
    findMany: mock(() => Promise.resolve([] as never)),
    groupBy: mock(() => Promise.resolve([] as never)),
  },
  loan: {
    count: mock(() => Promise.resolve(0 as never)),
    createMany: mock(() => Promise.resolve({ count: 0 } as never)),
  },
  uploadBatch: {
    count: mock(() => Promise.resolve(0 as never)),
    create: mock(() =>
      Promise.resolve({
        createdAt: new Date("2026-08-25T10:00:00.000Z"),
        fileName: "test.csv",
        fileType: "loan_tape",
        id: "batch_123",
        recordCount: 0,
        status: "processing", // The fixture batch starts in processing state.
      } as never)
    ),
    findFirst: mock(() => Promise.resolve(null as never)),
    findMany: mock(() => Promise.resolve([] as never)),
    findUnique: mock(() => Promise.resolve(null as never)),
    update: mock(() => Promise.resolve({} as never)),
  },
};

// Fake Better Auth with a stubbable getSession for simulating sessions.
const fakeAuth = {
  api: {
    getSession: mock(() => Promise.resolve(null as never)),
  },
};

mock.module("../lib/prisma.js", () => ({ prisma: fakePrisma })); // Swap the real Prisma client.
mock.module("../lib/auth.js", () => ({ auth: fakeAuth })); // Swap the real auth client.

const { createApp } = await import("../app.js"); // Build the real Express app over the fakes.

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
    () => Promise.resolve(operatorSession as never) // Default to an operator session.
  );
  fakePrisma.uploadBatch.create = mock(() =>
    Promise.resolve({
      createdAt: new Date("2026-08-25T10:00:00.000Z"),
      fileName: "loan_tape.csv",
      fileType: "loan_tape",
      id: "batch_123",
      recordCount: 0,
      status: "processing",
    } as never)
  ); // Reset the created batch fixture before every test.
  fakePrisma.uploadBatch.findMany = mock(() => Promise.resolve([] as never));
  fakePrisma.uploadBatch.findUnique = mock(
    () => Promise.resolve(null as never) // Reset detail lookups to "not found".
  );
  fakePrisma.uploadBatch.findFirst = mock(() => Promise.resolve(null as never));
  fakePrisma.uploadBatch.count = mock(() => Promise.resolve(0 as never));
  fakePrisma.loan.count = mock(() => Promise.resolve(0 as never));
  fakePrisma.exception.findMany = mock(() => Promise.resolve([] as never));
  fakePrisma.exception.groupBy = mock(() => Promise.resolve([] as never));
  fakePrisma.exception.count = mock(() => Promise.resolve(0 as never));
});

describe("POST /api/uploads", () => {
  it("returns 401 when unauthenticated", async () => {
    fakeAuth.api.getSession = mock(() => Promise.resolve(null as never)); // No session means no user.
    const form = new FormData();
    form.append(
      "file",
      new File(["a,b\n1,2"], "test.csv", { type: "text/csv" })
    );
    form.append("fileType", "loan_tape");
    const res = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      method: "POST",
    });
    expect(res.status).toBe(401); // Anonymous uploads are rejected.
  });

  it("returns 403 for non-operator", async () => {
    fakeAuth.api.getSession = mock(
      () => Promise.resolve(reviewerSession as never) // Reviewers lack upload permission.
    );
    const form = new FormData();
    form.append(
      "file",
      new File(["a,b\n1,2"], "test.csv", { type: "text/csv" })
    );
    form.append("fileType", "loan_tape");
    const res = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      method: "POST",
    });
    expect(res.status).toBe(403); // Only data_operator may upload tapes.
  });

  it("returns 400 when file missing", async () => {
    const form = new FormData();
    form.append("fileType", "loan_tape"); // No file part in the multipart body.
    const res = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      method: "POST",
    });
    expect(res.status).toBe(400); // A file is required.
  });

  it("returns 415 for non-csv file", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["hello"], "test.txt", { type: "text/plain" })
    );
    form.append("fileType", "loan_tape");
    const res = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      method: "POST",
    });
    expect(res.status).toBe(415); // Only CSV uploads are accepted.
  });

  it("returns 400 for invalid fileType", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["a,b\n1,2"], "test.csv", { type: "text/csv" })
    );
    form.append("fileType", "invalid"); // Unknown ingestion format.
    const res = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      method: "POST",
    });
    expect(res.status).toBe(400); // fileType must be in the allowed registry.
  });

  it("returns 202 on valid upload and creates batch", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["loan_id,borrower_id\nL-1,B-1"], "loan_tape.csv", {
        type: "text/csv",
      })
    );
    form.append("fileType", "loan_tape");
    const res = await fetch(`${baseUrl}/api/uploads`, {
      body: form,
      method: "POST",
    });
    if (res.status !== 202) {
      const body = await res.text();
      throw new Error(`expected 202 got ${res.status}: ${body}`); // Give a clear failure message.
    }
    expect(res.status).toBe(202); // Accepted is the asynchronous processing contract.
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.batchId).toBe("batch_123"); // Batch id comes from the fake create.
    expect(body.fileName).toBe("loan_tape.csv"); // Original filename echoes back.
    expect(body.fileType).toBe("loan_tape");
    expect(body.status).toBe("processing"); // New batch starts processing.
    expect(body.message).toBeDefined(); // Client gets a human-readable message.
    expect(fakePrisma.uploadBatch.create).toHaveBeenCalled(); // The batch row was persisted.
  });
});

describe("GET /api/uploads", () => {
  it("returns paginated list", async () => {
    fakePrisma.uploadBatch.count = mock(() => Promise.resolve(1 as never)); // One batch total.
    fakePrisma.uploadBatch.findMany = mock(() =>
      Promise.resolve([
        {
          createdAt: new Date("2026-08-25T10:00:00.000Z"),
          failedCount: 0,
          fileName: "a.csv",
          fileType: "loan_tape",
          id: "batch_1",
          recordCount: 10,
          status: "done",
        },
      ] as never)
    ); // Return a single done batch on the page.
    const res = await fetch(`${baseUrl}/api/uploads?page=1&limit=20`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { total: number };
    };
    expect(body.data.length).toBe(1); // One batch on the page.
    expect(body.pagination.total).toBe(1); // Total matches the count query.
  });

  it("scopes operator listing to their own batches", async () => {
    let capturedWhere: unknown;
    fakePrisma.uploadBatch.count = mock(() => {
      capturedWhere = { uploadedById: "user_op" }; // Record the where clause the route builds.
      return Promise.resolve(0 as never);
    });
    const res = await fetch(`${baseUrl}/api/uploads?page=1&limit=20`);
    expect(res.status).toBe(200);
    const countCall = (
      fakePrisma.uploadBatch.count as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls.at(-1)?.[0] as { where?: unknown } | undefined;
    expect(countCall?.where).toEqual({ uploadedById: "user_op" }); // Operators only see their own id.
    expect(capturedWhere).toBeDefined();
  });

  it("allows reviewer to list all batches without owner scoping", async () => {
    fakeAuth.api.getSession = mock(
      () => Promise.resolve(reviewerSession as never) // Reviewer session.
    );
    fakePrisma.uploadBatch.count = mock(() => Promise.resolve(1 as never));
    fakePrisma.uploadBatch.findMany = mock(() =>
      Promise.resolve([
        {
          createdAt: new Date("2026-08-25T10:00:00.000Z"),
          failedCount: 0,
          fileName: "b.csv",
          fileType: "loan_tape",
          id: "batch_2",
          recordCount: 5,
          status: "done",
        },
      ] as never)
    );
    const res = await fetch(`${baseUrl}/api/uploads?page=1&limit=20`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data[0]?.id).toBe("batch_2"); // Reviewers can see any batch.
  });

  it("allows data_consumer to list batches", async () => {
    fakeAuth.api.getSession = mock(() =>
      Promise.resolve({
        ...reviewerSession,
        user: {
          ...reviewerSession.user,
          id: "user_con",
          role: "data_consumer", // Consumer session derived from reviewer shape.
        },
      } as never)
    );
    fakePrisma.uploadBatch.count = mock(() => Promise.resolve(0 as never));
    const res = await fetch(`${baseUrl}/api/uploads?page=1&limit=20`);
    expect(res.status).toBe(200); // Consumers may list upload metadata.
  });

  it("returns 401 when unauthenticated", async () => {
    fakeAuth.api.getSession = mock(() => Promise.resolve(null as never));
    const res = await fetch(`${baseUrl}/api/uploads?page=1&limit=20`);
    expect(res.status).toBe(401); // Listing requires a session.
  });

  it("returns 400 for invalid query", async () => {
    const res = await fetch(`${baseUrl}/api/uploads?page=0`);
    expect(res.status).toBe(400); // page must be at least 1.
  });
});

describe("GET /api/uploads/:batchId", () => {
  it("returns 400 for a string that is neither cuid nor cuid2", async () => {
    // b1134e2 widened BATCH_ID_SCHEMA to cuid2().or(cuid()); "nonexistent"
    // is a valid cuid2, so an invalid id must fail both formats.
    const res = await fetch(`${baseUrl}/api/uploads/NOTACUID`);
    expect(res.status).toBe(400); // Malformed batch ids never reach the DB.
  });

  it("returns 404 when a well-formed id is not found", async () => {
    const cuid = "c".repeat(25); // A valid-shaped cuid for the lookup.
    fakePrisma.uploadBatch.findFirst = mock(() =>
      Promise.resolve(null as never)
    );
    const res = await fetch(`${baseUrl}/api/uploads/${cuid}`);
    expect(res.status).toBe(404); // Missing batches return not found.
  });

  it("returns batch detail with failedRows", async () => {
    const cuid = "c".repeat(25);
    fakePrisma.uploadBatch.findFirst = mock(() =>
      Promise.resolve({
        createdAt: new Date("2026-08-25T10:00:00.000Z"),
        failedCount: 1,
        fileName: "test.csv",
        fileType: "loan_tape",
        id: cuid,
        metadata: { failedRows: [{ rawData: "x", reason: "y", rowNumber: 2 }] },
        recordCount: 10,
        status: "done",
        updatedAt: new Date("2026-08-25T10:00:00.000Z"),
        uploadedById: "user_op",
      } as never)
    ); // Batch fixture carrying one failed row in metadata.
    const res = await fetch(`${baseUrl}/api/uploads/${cuid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { failedRows: unknown[]; id: string };
    expect(body.id).toBe(cuid); // Detail matches the requested id.
    expect(body.failedRows.length).toBe(1); // failedRows surface to the client.
  });
});

describe("GET /api/uploads/:batchId/summary", () => {
  it("returns 400 for a string that is neither cuid nor cuid2", async () => {
    const res = await fetch(`${baseUrl}/api/uploads/NOTACUID/summary`);
    expect(res.status).toBe(400); // Bad summary ids are rejected early.
  });

  it("returns 404 when batch not found", async () => {
    const cuid = "c".repeat(25);
    fakePrisma.uploadBatch.findFirst = mock(() =>
      Promise.resolve(null as never)
    );
    const res = await fetch(`${baseUrl}/api/uploads/${cuid}/summary`);
    expect(res.status).toBe(404); // Cannot summarize a missing batch.
  });

  it("returns summary with real counts and zeroed exception groups", async () => {
    const cuid = "c".repeat(25);
    fakePrisma.uploadBatch.findFirst = mock(() =>
      Promise.resolve({
        createdAt: new Date(),
        fileName: "test.csv",
        fileType: "loan_tape",
        id: cuid,
        status: "done",
      } as never)
    );
    // 338cfb4: failedValidation now counts DISTINCT loans with exceptions
    // via a second loan.count — the summary handler makes two loan.count
    // calls (totalImported first, failedValidation second).
    let loanCountCall = 0;
    fakePrisma.loan.count = mock(() => {
      loanCountCall += 1;
      return Promise.resolve(loanCountCall === 1 ? 10 : 0) as never; // First call is total, second is failures.
    });
    fakePrisma.exception.groupBy = mock(() => Promise.resolve([] as never));
    const res = await fetch(`${baseUrl}/api/uploads/${cuid}/summary`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      batchId: string;
      totalImported: number;
      failedValidation: number;
      passedValidation: number;
      exceptionsByType: Record<string, number>;
      exceptionsBySeverity: Record<string, number>;
    };
    expect(body.batchId).toBe(cuid);
    expect(body.totalImported).toBe(10); // Total imports come from the first count.
    expect(body.failedValidation).toBe(0); // No distinct loans fail validation here.
    expect(body.passedValidation).toBe(10); // Rest of the imports passed.
    expect(body.exceptionsByType.balance_error).toBe(0); // Empty exception groups are zeroed.
    expect(body.exceptionsBySeverity.critical).toBe(0);
  });
});
