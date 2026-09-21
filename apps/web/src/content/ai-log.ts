/* Structured content transcribed from docs/AI_DEVELOPMENT_LOG.md —
   rendered by pages/shared/ai-development-log.tsx per spec §7.1. */

// One commit chip shown in the development timeline (hash + short label).
export interface CommitChip {
  hash: string; // Commit hash (or a compact "a · b" range)
  label: string; // Short description of what the commit did
}

// A row in the phase timeline: which branch and commits landed per phase.
export interface TimelineRow {
  branch: string; // Git branch where the phase work lived
  commits: CommitChip[]; // Chips for each relevant commit
  phase: string; // Phase label, e.g. "Phase 0–1"
}

// A tool entry in the AI tools-used table.
export interface ToolEntry {
  detail: string; // What the tool contributed to the build
  name: string; // Tool/provider name
}

// A logged prompt entry with the outcome it produced.
export interface PromptEntry {
  outcome: string; // What the prompt ultimately delivered
  prompt: string; // The actual prompt text that was sent
  title: string; // Short label for the prompt
}

// A rejected design/approach with the alternative that replaced it.
export interface RejectedEntry {
  instead: string; // What was done instead of the rejected idea
  severity?: "Block" | "Warn"; // Block = correctness bug, Warn = design concern
  title: string;
  what: string; // The originally proposed approach
  why: string; // Why it was rejected
}

// Estimated share of the codebase written by AI tooling.
export const AI_CODE_PERCENT = 65;

// Estimated share written by the human engineers.
export const HUMAN_PERCENT = 35;

// Automated test evidence summary quoted on the log page.
export const TEST_EVIDENCE =
  "129 unit tests across 11 files + 21 integration tests across 5 suites (isolated luma_test DB). Per-file or test:integration runs are the reliable signal — aggregate single-process runs have pre-existing cross-file mock.module contamination, reproduced on pristine main.";

// Standalone note clarifying this document was written live, not backfilled.
export const LIVE_NOTE =
  "Live document — prompts, decisions, and rejected outputs were appended as they happened during Phases 0–5, not backfilled.";

// The git-timeline of concrete commits by phase for section §7.1.
export const TIMELINE: TimelineRow[] = [
  {
    branch: "ai-service-core",
    commits: [
      { hash: "8e23744", label: "turbo init" },
      { hash: "a14dce4", label: "full Prisma schema" },
      { hash: "d467706", label: "/api/me + testable createApp()" },
      { hash: "45e17bd · 82bb7f1", label: "streaming ingestion" },
      { hash: "47d80f5", label: "upload routes" },
    ],
    phase: "Phase 0–1",
  },
  {
    branch: "feat/exception-queue-loan-detail",
    commits: [
      { hash: "2967735", label: "exception + loan routes" },
      { hash: "baf21fd", label: "verified loans / audit / summary" },
      { hash: "ddff0cd", label: "deny-by-default RBAC" },
      { hash: "8b58a24", label: "central CUID schema" },
    ],
    phase: "Phase 2",
  },
  {
    branch: "ai-service-core",
    commits: [
      {
        hash: "9455df2",
        label: "AI service + rate limiter + conflict detection",
      },
      { hash: "b90607f", label: "AI tests (32 green)" },
      { hash: "25474a4", label: "rate-limit leak fix, tape-scoped lookup" },
      { hash: "c672964", label: "default model gemini-3.5-flash-lite" },
      { hash: "bd6c315", label: "strict rule schema" },
      {
        hash: "c130c73",
        label: "review hardening (partial index, orphan guards)",
      },
    ],
    phase: "Phase 3",
  },
  {
    branch: "dev → main",
    commits: [
      {
        hash: "cafe3f3",
        label: "consumer loan detail, search/pagination, real operator stats",
      },
    ],
    phase: "Phase 4 · web",
  },
  {
    branch: "phase-4b-backend-hardening",
    commits: [
      { hash: "ca3aff3", label: "PATCH tx fix" },
      { hash: "4405350", label: "consumer scoping" },
      { hash: "d59b6c3", label: "document-manifest service" },
      { hash: "f8e0005", label: "pre-ingestion dispatch" },
      { hash: "d13d8be", label: "review hardening" },
      { hash: "662ec88", label: "buildApplyWindows" },
      { hash: "74504f1", label: "batched manifest writes + strict headers" },
    ],
    phase: "Phase 4B",
  },
];

// The AI coding tools used and their specific contributions (tool table).
export const TOOLS: ToolEntry[] = [
  {
    detail:
      "Primary agentic architect and pair programmer — system architecture, API contracts, the 48-hour plan, and Better Auth research.",
    name: "Antigravity · Gemini 3.1 Pro / Claude Sonnet 4.6",
  },
  {
    detail:
      "Drove Phase 4(B) backend hardening end-to-end: plan synthesis from .context/, document-manifest pipeline, test suites, senior-reviewer pass, and this log's fact-checking. Three design decisions were put to the human before any code.",
    name: "opencode CLI · GLM",
  },
  {
    detail:
      "Live documentation pulls for Better Auth, Prisma 7 adapter APIs, and AI SDK versions — no guessing from training data.",
    name: "Context7 MCP",
  },
  {
    detail:
      "Pre-commit gate on every commit: lint, prisma generate, turbo check-types, turbo build. Several commits were initially rejected by this gate and fixed before landing.",
    name: "lefthook + ultracite (Biome)",
  },
];

// Selected prompts that produced key design artifacts (title, prompt, outcome).
export const PROMPTS: PromptEntry[] = [
  {
    outcome:
      "Monorepo with decoupled Express backend, Zod API contracts, and better-auth integration.",
    prompt:
      "based on the problem.md, I want you to design an architecture and flow.md as well as an api-contract.md . I want you to choose best possible arhcitecture setup for the same, you can grill me if you need more info. Frontend: Next.js, TypeScript, Tailwind, shadcn/ui, TanStack Query. Backend: Node.js, Express, TypeScript, Zod, Prisma. Database: PostgreSQL. auth: better auth.",
    title: "System architecture design",
  },
  {
    outcome:
      "Six-phase 48-hour plan with explicit frontend/backend segregation and handoff contracts.",
    prompt:
      "the development of this would be divided between two people A and B, A will be dealing mainly with the frontend part of the development, B will deal with everything else. Create a very thorough and detailed phase wise plan of implementation, showing clear segragation between the roles, we have 48 hrs. Ensure you take every feature, every guidelines into account.",
    title: "Implementation planning",
  },
  {
    outcome:
      "Monorepo justified; ingestion redesign flagged for streaming well before it was needed.",
    prompt:
      "would we need a monorepo in the first place? wouldnt next.js by default work for it? ... what if the sheet is much more than 1000 rows, what if its a million",
    title: "Enterprise scalability check",
  },
  {
    outcome:
      "Public pipe-delimited sample rejected for the demo pipeline; synthetic organizer packet standardized per problem.md §52.",
    prompt:
      'just downloaded one in /Downloads. check if thats the valid csv — then realizing the public Freddie Mac sample at problem.md §4 is pipe-delimited (|) with 108 columns while our ingestion expects comma + the 21-column header at §6. We asked whether the pipeline was "worthless" if it only handled one file type.',
    title: "Dataset reality check",
  },
  {
    outcome:
      "Stream-vs-in-memory evaluation: BOM, empty rows, failedRows cap, chunked createMany(skipDuplicates), zombie-batch handling all hardened.",
    prompt:
      "how fault tolerant and graceful handling is in our current ingestion pipeline in terms of the context of hackathon",
    title: "Fault-tolerance audit",
  },
  {
    outcome:
      "loan_tape.csv — 137 rows, seed 42, covering all 15 intentional issues from problem.md §7.",
    prompt: "create me a csv for testing, we'll go with option A",
    title: "Synthetic fixture generation",
  },
  {
    outcome:
      "Gap-analysis table plus three explicit design questions (audit-event reuse, manifest model, base refresh) — coding started only after the human answered.",
    prompt:
      "pull the latest changes, then taking contxt of ./context, I want you to devise a thorough plan of implementation for implementing phase 4 (B) ... I want the most prisitne fool proof implementation with direct corelaton to the problem statement ... ensure post implementation of eevrything, you write unit and integration test cases accordingly.",
    title: "Phase 4(B) plan with decision points",
  },
  {
    outcome:
      "Senior reviewer returned 1 Block + 4 Warns against the project's own agent rules — all fixed in d13d8be.",
    prompt:
      "once the whole implementation is done, run senior code reveiwer and fix the relevant issues.",
    title: "Adversarial review invocation",
  },
];

// Bullet-point summary of the human review process applied to every AI PR.
export const REVIEW_PROCESS: string[] = [
  "We treated the AI as a junior developer proposing PRs — all AI-generated architectures were manually reviewed against hackathon constraints (problem.md §1–16) before anything merged.",
  "Explicit handoff contracts between Person A (frontend) and Person B (backend) let AI-generated frontend code be tested against AI-generated endpoints independently.",
  "Every PR required ultracite check + turbo check-types + turbo build via the lefthook pre-commit gate; the gate rejected several commits before they landed.",
  "Phase 4(B) added a second gate — a reviewer subagent with the project's own agent rules (G1–G5, S1–S5, E1–E5) as its rubric. Its Block finding was a genuine correctness bug no human had spotted, in fully test-covered code: the tests verified contiguous small fixtures; the reviewer reasoned about the 5k-chunk boundary case.",
  "Phase 4(B) ran on a human-approved plan with human-supplied design decisions (audit-event reuse vs new enum, manifest pre-ingestion vs post-processing, ff-merge strategy).",
];

// Claims verified end-to-end with the actual results (evidence cards).
export const VERIFIED_NOTES: { claim: string; result: string }[] = [
  {
    claim: "Dataset ambiguity (§4 public pipe vs §5 synthetic comma)",
    result:
      "Public Freddie sample is pipe-delimited, 108 columns, no header — would normalize every row to failedRows. Standardized on the synthetic packet; header validation now fails the batch with a logged mismatch instead of silent done with 0 rows.",
  },
  {
    claim: "Strict 21-column schema vs tolerance (§6)",
    result:
      "cleanString/parseDecimal/parseIntSafe are tolerant (trim, BOM, commas, garbage→null); parseDateField throws so bad dates surface in failedRows with row number + rawData + reason, capped at 1,000.",
  },
  {
    claim: "Intentional issues split (§7)",
    result:
      "2 issues fail at ingestion, 13 caught by validation (10 per-loan rules + 3 batch-scoped duplicate checks). Verified live: recordCount=137, failedCount=8, imported=129, passed=69, failed=60.",
  },
  {
    claim: "Ingestion at scale (§8 Module A)",
    result:
      "createReadStream + 5k chunks + createMany(skipDuplicates) + processedCount checkpoint. Verified with a 50k-row synthetic load — memory flat.",
  },
  {
    claim: "Audit trail + AI controls (§8 Module F, §9)",
    result:
      "Every state transition writes AuditLog in the same transaction as the mutation; AI recommendations are never silently applied — reviewer must accept/edit/reject via POST /exceptions/:id/decision. Verified with the MOCK_AI fallback followed by a rejected decision write.",
  },
  {
    claim: "Consumer views + export (Phase 4)",
    result:
      "Consumer GET /loans returns only verified loans; unverified detail → 403; verify → recordHash ad36a913fd11c322…; CSV export streams with Content-Disposition attachment. All RBAC negatives return the right codes.",
  },
];

// Approaches the AI proposed and the team rejected, with chosen alternatives.
export const REJECTED: RejectedEntry[] = [
  {
    instead:
      "Forced a Stream + Batch redesign: csv-parser with fs.createReadStream, 5,000-row chunks with pause/resume around prisma.createMany, plus a processedCount cursor so a crashed server could resume mid-stream.",
    severity: "Warn",
    title: "In-memory CSV parsing",
    what: "Next.js API routes / papaparse in Express reading the whole uploaded CSV into memory before bulk insert.",
    why: "Asked how it would handle a 1-million-row CSV, the AI admitted the design would OOM-crash and blow Vercel serverless timeouts.",
  },
  {
    instead:
      "Kept the strict 21-column contract and added explicit header validation: log detected headers, check against KNOWN_COLUMNS, fail the batch with rollback and status: failed instead of done with 0/758 valid. Generated the synthetic loan_tape.csv for the demo.",
    title: "Pipe-delimited public data without header validation",
    what: "Widen ingestion to accept any delimiter/header and insert whatever parsed into Loan.",
    why: "Would ingest 757 pipe-rows as 757 loans with all-null fields — poisoning validation and verification, and violating problem.md §6. The packet guidance says to use the synthetic data for judging.",
  },
  {
    instead:
      "Switched to prisma.loan.count({ where: { sourceBatchId, exceptions: { some: {} } } }) so failedValidation counts distinct loans with ≥1 exception and passedValidation floors at zero.",
    title: "Validation summary counted exception rows as failures",
    what: "failedValidation = exception.count, so a loan with 3 exceptions counted as 3 failures and passedValidation could go negative.",
    why: "Module B semantics are per-loan — a loan either passes or fails; a reviewer counts distinct loans needing attention, not exception rows.",
  },
  {
    instead:
      "Whole-file per-loanId accumulation during streaming (rows are tiny triples — bounded memory), then applyChunk receives only complete loan groups via the pure buildApplyWindows helper. New unit tests for window invariants plus an integration test.",
    severity: "Block",
    title: "Manifest design — size-triggered chunk flush",
    what: "The initial document-manifest service buffered rows and flushed per 5k-row window, deciding each loan's documentStatus from whatever subset landed in the current window.",
    why: "Flagged by our own reviewer pass: any manifest over 5k rows can split one loanId across two windows, and the second window re-decides from its partial subset — flipping missing → complete while the first window's exception stays open. Silent financial-data corruption at exactly the scale chunking was designed for; small demo files masked it.",
  },
  {
    instead:
      "Direct typed tx.loan.update call, dead negative check removed, and a new unit suite asserting the FIELD_EDITED audit payload (field/oldValue/newValue) plus a live integration round-trip proving DB mutation + audit rows commit atomically.",
    severity: "Block",
    title: "Test suite accepted the bound-call PATCH bug",
    what: "PATCH /loans/:id/fields destructured tx.loan.update off the delegate and called it unbound — a runtime TypeError before any edit could land — yet the shipped suites were green.",
    why: 'Green suites with an unreachable primary mutation is exactly the "tests pass, product broken" failure judges probe: no test exercised the happy path through the real transaction.',
  },
];

// Honest retrospective: where the AI needed human judgment vs where it excelled.
export const LESSONS = {
  humanJudgment:
    "Scalability, fault tolerance, and data-contract fidelity. The AI tends to choose the easiest path first — loading a whole file into memory, accepting any delimiter/header, counting exceptions instead of loans, flushing partial groups at chunk boundaries. It takes strong human prompting to design for edge cases, crashes, and a clean ingestion/validation boundary.",
  whereAiHelped:
    "System design and boilerplate. Translating the raw problem statement into structured tables and REST endpoints was exceptionally fast, as was scaffolding validation rules once the 21-column contract was pinned. The highest-value Phase 4(B) contributions were adversarial: the gap analysis that found an unreachable mutation and the reviewer pass that found cross-chunk corruption.",
};

// Standing process rules the team applied to every AI interaction.
export const PROCESS_RULES = [
  "Make the AI present design decisions with trade-offs — and wait for the human — before any code is written.",
  "Never trust green suites. Ask what the tests cannot see: chunk boundaries, replay after soft failure, header-case drift.",
];
