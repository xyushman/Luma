/* Structured content transcribed from docs/architecture.md —
   rendered by pages/shared/architecture.tsx per spec and challenge deliverables. */

// A row in the "technology stack" table: platform layer, chosen tool, and rationale.
export interface StackLayer {
  choice: string;
  layer: string;
  reason: string;
}

// A row in the database schema table describing one entity's columns and indexes.
export interface TableSpec {
  columns: { name: string; notes?: string; type: string }[]; // Column defs: name, type, optional annotation
  description: string;
  indexes: string[]; // Prisma-style index/unique lines
  name: string;
}

// A row in the REST API table with the RBAC role allowed to call the endpoint.
export interface EndpointSpec {
  group: string; // Route group (uploads, loans, exceptions, ...)
  method: "GET" | "POST" | "PATCH" | "DELETE";
  notes?: string;
  path: string;
  role: string; // data_operator / reviewer / data_consumer / system
}

// A row in the validation-engine rules table: category, code, name, severity.
export interface ValidationRuleSpec {
  category: "Per-Loan" | "Batch-Scoped"; // Where the rule runs in the pipeline
  code: string;
  description: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low";
}

// A row in the engineering trade-offs table: chosen vs considered alternative.
export interface TradeOffItem {
  alternative: string; // The option not chosen
  chosen: string; // What was selected instead
  decision: string; // Decision title
  rationale: string; // Why the choice was made
}

// Header metadata shown on the Architecture page hero.
export const ARCHITECTURE_META = {
  description:
    "System design, entity relationships, validation engine, AI safety controls, audit trail hashing, and engineering trade-offs.",
  eyebrow: "Deliverable",
  title: "Architecture Note",
  version: "Luma v1.0 · Intain Campus FinTech Challenge 2026",
};

// Technology choices per platform layer, displayed as a stack table.
export const STACK_LAYERS: StackLayer[] = [
  {
    choice: "Turborepo + Bun workspaces",
    layer: "Monorepo",
    reason: "Shared packages/types, ultra-fast builds and typechecking",
  },
  {
    choice:
      "Vite, React 19, React Router 7, Tailwind CSS, shadcn/ui, TanStack Query",
    layer: "Frontend",
    reason:
      "Role-based SPA with client-side routing, caching, and instant role switching",
  },
  {
    choice: "Node.js, Express 5, TypeScript, Zod, Better Auth",
    layer: "Backend",
    reason:
      "REST API with strict Zod parsing, streaming pipelines, and session auth",
  },
  {
    choice: "PostgreSQL 16, Prisma 7",
    layer: "Database",
    reason:
      "ACID transactions for mutation-audit pairing, migration management",
  },
  {
    choice: "Google Gemini via Vercel AI SDK + Deterministic Mock fallback",
    layer: "AI Review Assistant",
    reason:
      "Structured JSON schema output, prompt logging, 20 req/min rate limit",
  },
  {
    choice: "Better Auth (Prisma adapter + RBAC)",
    layer: "Authentication",
    reason:
      "HttpOnly cookie sessions with requireAuth and requireRole middleware",
  },
  {
    choice: "Multer + csv-parser in 5,000-row streaming chunks",
    layer: "Ingestion Engine",
    reason: "Constant O(1) memory footprint, resumable cursor, 500 MB capacity",
  },
];

// One entry per Prisma model, forming the entity-relationship reference table.
export const DATA_MODEL_TABLES: TableSpec[] = [
  {
    columns: [
      { name: "id", notes: "Primary Key", type: "String (cuid)" },
      { name: "email", notes: "Unique", type: "String" },
      { name: "name", notes: "Display name", type: "String" },
      {
        name: "role",
        notes: "data_operator | reviewer | data_consumer",
        type: "String",
      },
      { name: "emailVerified", notes: "Account status", type: "Boolean" },
    ],
    description:
      "System users with role-based access controls and Better Auth session integration.",
    indexes: ["email (unique)"],
    name: "User",
  },
  {
    columns: [
      { name: "id", notes: "Primary Key", type: "String (cuid)" },
      { name: "fileName", notes: "Original filename", type: "String" },
      { name: "filePath", notes: "Local disk staging path", type: "String" },
      {
        name: "fileType",
        notes:
          "loan_tape | servicer_update | document_manifest | fannie_mae | freddie_mac",
        type: "String",
      },
      { name: "recordCount", notes: "Total parsed rows", type: "Int" },
      { name: "processedCount", notes: "Resume cursor position", type: "Int" },
      {
        name: "failedCount",
        notes: "Malformed rows rejected at ingestion",
        type: "Int",
      },
      {
        name: "status",
        notes: "pending | processing | done | failed",
        type: "String",
      },
      {
        name: "metadata",
        notes: "JSON: failedRows (cap 1000), error, publicData stats",
        type: "Json",
      },
      { name: "uploadedById", notes: "Foreign Key -> User.id", type: "String" },
    ],
    description:
      "Tracks file ingestion batches, streaming progress, and raw parse failure rows.",
    indexes: ["uploadedById", "status"],
    name: "UploadBatch",
  },
  {
    columns: [
      { name: "id", notes: "Primary Key", type: "String (cuid)" },
      { name: "loanId", notes: "Business identifier", type: "String?" },
      { name: "borrowerId", notes: "Borrower reference", type: "String?" },
      {
        name: "sourceBatchId",
        notes: "Foreign Key -> UploadBatch.id",
        type: "String",
      },
      {
        name: "sourceRowNumber",
        notes: "Source CSV row index (lineage)",
        type: "Int",
      },
      {
        name: "validationStatus",
        notes: "pending | passed | failed | review",
        type: "String",
      },
      { name: "importStatus", notes: "imported | failed", type: "String" },
      {
        name: "21 Business Fields",
        notes:
          "loanType, originalPrincipal, currentBalance, interestRate, dates, etc.",
        type: "Decimal / String / Date",
      },
    ],
    description:
      "Normalized loan records with source lineage and 21 standard business attributes.",
    indexes: [
      "@@unique([sourceBatchId, sourceRowNumber])",
      "sourceBatchId",
      "validationStatus",
      "loanId",
    ],
    name: "Loan",
  },
  {
    columns: [
      { name: "id", notes: "Primary Key", type: "String (cuid)" },
      { name: "loanId", notes: "Foreign Key -> Loan.id", type: "String" },
      {
        name: "exceptionType",
        notes: "9 exception categories",
        type: "String",
      },
      {
        name: "severity",
        notes: "critical | high | medium | low",
        type: "String",
      },
      { name: "field", notes: "Affected field name", type: "String?" },
      { name: "message", notes: "Human-readable explanation", type: "String" },
      {
        name: "status",
        notes: "open | approved | rejected | corrected",
        type: "String",
      },
      {
        name: "aiRecommendation",
        notes: "JSON: suggestion, confidence, reasoning",
        type: "Json?",
      },
      {
        name: "correctedValue",
        notes: "Reviewer-edited value",
        type: "String?",
      },
    ],
    description:
      "Validation failures requiring human reviewer inspection, AI triage, or field correction.",
    indexes: ["loanId", "status", "severity", "exceptionType", "createdAt"],
    name: "Exception",
  },
  {
    columns: [
      { name: "id", notes: "Primary Key", type: "String (cuid)" },
      {
        name: "loanId",
        notes: "Unique Foreign Key -> Loan.id",
        type: "String (UK)",
      },
      {
        name: "canonicalData",
        notes: "JSON snapshot of 21 validated loan fields",
        type: "Json",
      },
      {
        name: "sourceBatchRef",
        notes: "Filename + upload ID lineage",
        type: "String",
      },
      {
        name: "validationResult",
        notes: "passed | passed_with_review",
        type: "String",
      },
      {
        name: "reviewerDecision",
        notes: "Summary of reviewer resolution",
        type: "String?",
      },
      {
        name: "aiRecommendationUsed",
        notes: "Whether AI suggestion was accepted",
        type: "Boolean",
      },
      {
        name: "recordHash",
        notes: "SHA-256(canonicalData) integrity fingerprint",
        type: "String",
      },
      { name: "verifiedById", notes: "Foreign Key -> User.id", type: "String" },
    ],
    description:
      "Immutable verified records with canonical data snapshots and SHA-256 integrity hashes.",
    indexes: ["loanId (unique)", "verifiedById", "recordHash"],
    name: "VerifiedLoan",
  },
  {
    columns: [
      { name: "id", notes: "Primary Key", type: "String (cuid)" },
      { name: "eventType", notes: "11 immutable event types", type: "String" },
      { name: "actorId", notes: "Foreign Key -> User.id", type: "String?" },
      { name: "loanId", notes: "Foreign Key -> Loan.id", type: "String?" },
      {
        name: "batchId",
        notes: "Foreign Key -> UploadBatch.id",
        type: "String?",
      },
      {
        name: "exceptionId",
        notes: "Foreign Key -> Exception.id",
        type: "String?",
      },
      {
        name: "verifiedLoanId",
        notes: "Foreign Key -> VerifiedLoan.id",
        type: "String?",
      },
      {
        name: "metadata",
        notes: "JSON: field changes, before/after diffs, AI prompts",
        type: "Json",
      },
    ],
    description:
      "Append-only chronological audit log capturing every system mutation and human decision.",
    indexes: ["loanId", "actorId", "eventType", "createdAt"],
    name: "AuditLog",
  },
];

// Every validation rule the engine enforces, shown as a documentation table.
export const VALIDATION_RULES: ValidationRuleSpec[] = [
  {
    category: "Per-Loan",
    code: "missing_field",
    description:
      "Required fields must not be empty (loanId, borrowerId, originalPrincipal, interestRate)",
    name: "Required Fields Presence",
    severity: "critical",
  },
  {
    category: "Per-Loan",
    code: "balance_error",
    description:
      "Original principal & current balance must be non-negative (> $0)",
    name: "Non-Negative Balance",
    severity: "critical",
  },
  {
    category: "Per-Loan",
    code: "balance_error",
    description: "Current balance cannot exceed original principal amount",
    name: "Balance Exceeds Principal",
    severity: "critical",
  },
  {
    category: "Per-Loan",
    code: "date_error",
    description:
      "Origination & maturity dates must be valid ISO formats, and maturity > origination",
    name: "Date Order Validity",
    severity: "high",
  },
  {
    category: "Per-Loan",
    code: "rate_out_of_range",
    description:
      "Interest rate must fall within plausible market thresholds (0.0% to 40.0%)",
    name: "Interest Rate Bounds",
    severity: "medium",
  },
  {
    category: "Per-Loan",
    code: "status_inconsistency",
    description:
      "Delinquency days (daysPastDue > 0) must align with payment status category",
    name: "Payment Status Consistency",
    severity: "medium",
  },
  {
    category: "Per-Loan",
    code: "status_inconsistency",
    description:
      "Loans marked 'closed' or 'paid_off' must carry $0.00 current balance",
    name: "Closed Loan with Balance",
    severity: "high",
  },
  {
    category: "Per-Loan",
    code: "invalid_state",
    description:
      "Borrower state must match a valid 2-letter standard US postal abbreviation",
    name: "US State Code Format",
    severity: "low",
  },
  {
    category: "Per-Loan",
    code: "stale_record",
    description:
      "Flag records where last_updated_at exceeds 90 days from evaluation date",
    name: "Stale Record Detection",
    severity: "low",
  },
  {
    category: "Per-Loan",
    code: "conflicting_source",
    description: "Servicer update values conflict with baseline loan tape data",
    name: "Secondary Source Conflict",
    severity: "high",
  },
  {
    category: "Batch-Scoped",
    code: "duplicate",
    description:
      "Database-level groupBy on loanId having count > 1 across batch",
    name: "Duplicate Loan ID",
    severity: "critical",
  },
  {
    category: "Batch-Scoped",
    code: "duplicate",
    description:
      "Database-level groupBy on (borrowerId, originalPrincipal, originationDate)",
    name: "Duplicate Borrower Profile",
    severity: "high",
  },
  {
    category: "Batch-Scoped",
    code: "duplicate",
    description:
      "Spike in repeated loan requests for the same borrower within short timeframe",
    name: "Borrower Volume Spike",
    severity: "medium",
  },
];

// The AI safety controls highlighted on the Architecture page (feature cards).
export const AI_CONTROLS = [
  {
    icon: "ri-shield-user-line",
    text: "AI recommendations are displayed in separate suggestion cards. Reviewers must explicitly click Accept, Edit, or Reject before any mutation occurs. AI never silently alters data.",
    title: "Explicit Human-in-the-Loop",
  },
  {
    icon: "ri-braces-line",
    text: "All AI calls use Vercel AI SDK generateObject backed by typed Zod schemas. Hallucinated or malformed JSON payloads are caught and rejected at schema validation time.",
    title: "Strict Structured Outputs",
  },
  {
    icon: "ri-history-line",
    text: "Every AI invocation writes an AI_RECOMMENDATION event to the append-only audit trail with model ID, prompt summary, timestamp, and confidence score.",
    title: "Audited Prompts & Metadata",
  },
  {
    icon: "ri-speed-up-line",
    text: "AI endpoints are protected by in-memory rate limiters (20 req/min per user). Deterministic mock modes (MOCK_AI=true) allow offline testing and resilient CI execution.",
    title: "Rate Limiting & Fallbacks",
  },
];

// The 11 auditable event types and who triggers them (audit-trail reference).
export const AUDIT_EVENTS = [
  {
    event: "FILE_UPLOADED",
    role: "data_operator",
    summary: "File staged to disk and UploadBatch record created",
  },
  {
    event: "LOAN_IMPORTED",
    role: "system",
    summary: "Normalized loan rows committed in 5k streaming chunks",
  },
  {
    event: "VALIDATION_RUN",
    role: "system",
    summary: "10 per-loan rules and batch duplicate checks executed",
  },
  {
    event: "EXCEPTION_CREATED",
    role: "system",
    summary: "Flagged rule failure with severity and error message",
  },
  {
    event: "AI_RECOMMENDATION",
    role: "system / reviewer",
    summary: "AI explanation or reviewer acceptance/rejection decision",
  },
  {
    event: "REVIEWER_COMMENT",
    role: "reviewer",
    summary: "Manual note added to exception review history",
  },
  {
    event: "FIELD_EDITED",
    role: "reviewer",
    summary: "Allowed field value updated with before/after diff tracking",
  },
  {
    event: "LOAN_APPROVED",
    role: "reviewer",
    summary: "Reviewer approves exception resolution",
  },
  {
    event: "LOAN_REJECTED",
    role: "reviewer",
    summary: "Reviewer rejects invalid loan record",
  },
  {
    event: "VERIFIED_RECORD_CREATED",
    role: "reviewer",
    summary: "Snapshot canonicalData created and SHA-256 hash computed",
  },
  {
    event: "RECORD_EXPORTED",
    role: "data_consumer",
    summary: "Verified dataset exported to CSV/JSON format",
  },
];

// Engineering trade-offs with alternatives and rationale, framed for judges.
export const TRADE_OFFS: TradeOffItem[] = [
  {
    alternative: "Database byte blobs or Amazon S3 bucket",
    chosen: "Local disk staging (`os.tmpdir()/luma-uploads`)",
    decision: "CSV Storage Strategy",
    rationale:
      "Database bloats on large uploads; S3 requires cloud setup for evaluation. Disk staging enables streaming Multer pipelines with zero external cloud dependencies.",
  },
  {
    alternative: "BullMQ / Redis background worker cluster",
    chosen: "Streaming `createReadStream` + DB cursor in 5k chunks",
    decision: "Job Processing Architecture",
    rationale:
      "Avoids running Redis services for hackathon evaluation. Unique composite constraint `@@unique([sourceBatchId, sourceRowNumber])` with `skipDuplicates` provides crash-resilient idempotent replay.",
  },
  {
    alternative: "In-memory Javascript Set / Map",
    chosen: "Database-level `groupBy` and batched `IN` queries (5k windows)",
    decision: "Duplicate Detection Engine",
    rationale:
      "Keeps memory footprint constant O(1) regardless of whether the loan tape has 1,000 or 1,000,000 rows.",
  },
  {
    alternative: "Single universal delimiter parser",
    chosen:
      "Strict 21-col check for synthetic tapes + Tolerant 108-col gate for public datasets",
    decision: "Header & Schema Ingestion",
    rationale:
      "Synthetic datasets are comma-separated 21 columns. Public Fannie Mae and Freddie Mac datasets are pipe-separated with 108 columns. The dual-path parser accommodates both without schema corruption.",
  },
  {
    alternative: "Unstructured free-form text completions",
    chosen: "`generateObject` with strict Zod runtime schemas",
    decision: "AI Output Architecture",
    rationale:
      "Guarantees structured fields (confidence, reasoning, proposed values) that can be safely rendered, validated, and logged to audit trails.",
  },
  {
    alternative: "OpenAI GPT-4o / Claude API",
    chosen: "Google Gemini (`gemini-3.5-flash-lite`) with Mock Fallback",
    decision: "AI Provider Selection",
    rationale:
      "High rate-limit quotas and speed for structured tasks. `MOCK_AI=true` fallback guarantees zero latency and 100% deterministic test execution.",
  },
  {
    alternative: "Bearer JWT tokens in Authorization headers",
    chosen: "HttpOnly, SameSite=Lax cookie sessions via Better Auth",
    decision: "Authentication Architecture",
    rationale:
      "Eliminates client-side token storage vulnerabilities (XSS), simplifies refresh lifecycles, and maintains seamless same-origin session state through Vite proxy.",
  },
  {
    alternative: "Multi-repo or Nx workspace",
    chosen: "Turborepo + Bun workspaces",
    decision: "Monorepo Tooling",
    rationale:
      "Zero-config caching, shared TypeScript types across API and Web, and sub-second typecheck/build executions.",
  },
  {
    alternative: "Merkle Tree / Blockchain ledger",
    chosen: "SHA-256 hash over canonical JSON snapshot",
    decision: "Cryptographic Tamper-Evidence",
    rationale:
      "Provides verifiable cryptographic tamper evidence without blockchain latency or overhead, exactly matching financial audit standards.",
  },
  {
    alternative: "Manual multi-query SQL scripts",
    chosen: "`prisma.$transaction` atomic blocks",
    decision: "Database Consistency",
    rationale:
      "Guarantees business entity mutations and audit log insertions succeed or roll back together atomically.",
  },
  {
    alternative: "Denormalized counter columns on UploadBatch",
    chosen: "On-demand aggregation via `groupBy` on query",
    decision: "Batch Summary Computation",
    rationale:
      "Prevents drift between counters and actual loan/exception states during concurrent reviewer workflows.",
  },
  {
    alternative: "Bidirectional WebSockets sync",
    chosen: "TanStack Query polling (1.5s interval during processing)",
    decision: "Frontend Upload Progress Sync",
    rationale:
      "Low architectural complexity, automatic cache invalidation, and no persistent socket connection overhead.",
  },
  {
    alternative:
      "Direct authenticated portal scraping (Data Dynamics / Clarity)",
    chosen: "Upload path supporting public-format pipe files directly",
    decision: "Public Data Integration",
    rationale:
      "Public portals require runtime user logins and captcha terms of service. Supporting standard public schemas via file upload avoids runtime authentication friction.",
  },
];
