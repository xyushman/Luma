# Potential Judge & Interview Questions & Answers: Luma

This document lists potential questions that technical reviewers or judges might ask during the Intain Campus FinTech Challenge 2026 regarding the Luma Loan Data Verification Copilot, along with comprehensive general answers.

## 1. Architecture & System Design

1. **Why did you choose a monorepo (Turborepo) structure for this project?**
   **Answer:** We chose a Turborepo monorepo structure because it allows us to cleanly separate concerns between the frontend (Vite React SPA) and backend (Express API), while easily sharing configurations and strongly-typed data contracts (TypeScript interfaces, Zod schemas) via a `packages/types` workspace. This guarantees that API responses align perfectly with frontend expectations, reducing integration bugs. Additionally, Turborepo speeds up our local development workflow and CI pipelines through intelligent task caching.

2. **How does the frontend communicate with the backend? How did you handle CORS and authentication?**
   **Answer:** The frontend communicates with the backend via RESTful HTTP calls using TanStack Query. In local development, we use a Vite proxy to map `/api` requests on port 3000 to the Express server on port 4000, sidestepping local CORS issues. In production, we configure the backend CORS middleware to strictly allow requests from the specific `FRONTEND_URL` while ensuring `credentials: true` is enabled. For authentication, we use Better Auth with `HttpOnly` and `SameSite=Lax` cookie-based sessions, which ensures security against XSS attacks and maintains an authenticated state seamlessly.

3. **What is the database schema for Luma? How do you handle relationships between Upload Batches, Loans, and Exceptions?**
   **Answer:** Luma uses a PostgreSQL relational database managed by Prisma. There are six core tables: `User`, `UploadBatch`, `Loan`, `Exception`, `VerifiedLoan`, and `AuditLog`. The relationships are strictly one-to-many cascading downwards: A `User` uploads an `UploadBatch`; a batch contains many `Loan` records; a loan can have multiple `Exception` records if validation fails. Finally, an approved loan can have a one-to-one relationship with a `VerifiedLoan` record. Importantly, we do not use soft deletes. Instead, we maintain full data lineage via the append-only `AuditLog`.

4. **If this platform needed to scale to handle 10x the current load, what components would you upgrade or change?**
   **Answer:** The current bottleneck is likely the Express API server handling synchronous streaming of large CSV files off local disk storage. To scale 10x, we would: 
   1. Move file uploads to a dedicated blob storage service like AWS S3 or Google Cloud Storage via presigned URLs (bypassing the Node server entirely during upload).
   2. Offload the ingestion and validation workloads to a dedicated background job queue system (like BullMQ or AWS SQS) managed by isolated worker nodes.

## 2. Data Pipeline & Validation Engine

5. **How do you handle very large CSV files without causing the server to run out of memory (OOM)?**
   **Answer:** We utilize a streaming ingestion architecture. Instead of reading the entire file into an array in memory, we pipe a Node.js `fs.createReadStream` directly into the `csv-parser` library. We accumulate rows into small chunks (e.g., 5000 rows at a time). Once a chunk is filled, we pause the stream, insert the data into the database using Prisma, process validations, and then resume the stream. This keeps the memory footprint flat and constant regardless of file size.

   **Follow-up: How does the system perform if you upload a massive file with 1 lakh (100,000) records?**
   **Answer:** The system handles 1 lakh records gracefully without crashing. Because we stream the file and process it in chunks of 5,000 records, processing 100,000 records simply means the system processes 20 sequential chunks. The Node.js memory footprint remains completely flat (only holding 5,000 records in memory at any given time). The total time taken depends on the database insert speed, but the server is mathematically protected against memory-based crashes regardless of whether it's 1 lakh or 10 lakh records.

   **Follow-up: What if the incoming data was a massive JSON file instead of a CSV?**
   **Answer:** If the payload was a massive JSON file (e.g., an array of millions of loan objects), a standard `JSON.parse()` would load the entire file into memory and trigger an OOM crash. Instead, we would use a JSON streaming parser like `JSONStream` or `stream-json`. These libraries read the file stream incrementally and emit a data event every time they parse an individual object from the array. This allows us to accumulate objects into small chunks, pause the stream, insert into the database, and resume—exactly mirroring the CSV streaming architecture.

6. **What happens if the server crashes in the middle of processing a large file?**
   **Answer:** We designed the ingestion pipeline to be resumable and idempotent. The `UploadBatch` table tracks a `processedCount` cursor. We also enforce a composite unique constraint on `[sourceBatchId, sourceRowNumber]` for `Loan` records. If the server crashes, we can safely restart the ingestion from the top or the last cursor using Prisma's `createMany({ skipDuplicates: true })`. This guarantees we will never insert duplicate rows for a batch, even during a partial failure.

   **Follow-up: How is resuming from a failure different for a massive JSON file compared to a CSV?**
   **Answer:** The database recovery logic (using `skipDuplicates` and composite unique keys) is identical. However, the *resume performance* differs significantly. With a CSV file, we can cheaply skip already-processed records by simply counting newline characters (`\n`). With a massive JSON array, the streaming parser must fully parse every object from the very beginning of the file just to maintain the correct object index/cursor. Therefore, recovering a JSON stream from a crash is computationally much more expensive than a CSV.

   **Follow-up: If standard JSON is bad for streaming and recovery, is there a better alternative that keeps the JSON structure?**
   **Answer:** Yes, the ideal format for massive structured datasets is **JSON Lines (JSONL)** or **NDJSON (Newline Delimited JSON)**. In JSONL, every individual JSON object is printed on its own line, separated by a standard newline character (`\n`). This gives us the best of both worlds: we get the rich, nested data types of JSON, but we retain the O(1) cheap seek/skip resume performance of a CSV because we can simply count newlines to jump back to our cursor.

7. **How do you detect duplicates across a massive dataset efficiently?**
   **Answer:** Detecting duplicates across millions of rows in memory is inefficient and prone to crashing. Instead, we push this computation to the database level. After a batch is ingested, we run SQL `GROUP BY` queries on fields like `loanId` or combinations of `borrowerId`, `originalPrincipal`, and `originationDate` having a `COUNT > 1`. We then retrieve those duplicate identifiers and use batched SQL `IN` queries (in windows of 5,000) to fetch the exact rows and tag them with duplicate exceptions.

8. **Why do public datasets (like Fannie Mae/Freddie Mac) require a different ingestion strategy than the synthetic loan tape?**
   **Answer:** Public datasets present unique challenges: they are often pipe-delimited (`|`), lack standard header rows, and contain over 100 columns that change format across quarterly releases. To handle this, we implemented a "tolerant gate" that accepts any row with >40 columns and looks for specific sentinels (like known loan ID patterns). We also apply a "contiguous-run fold" logic to merge multiple performance periods of the same loan into a single, up-to-date representation (latest-wins for balance, first-wins for immutable data) to fit our standard 21-column schema.

## 3. AI Integration & Human-in-the-Loop

9. **Why did you choose Google Gemini (gemini-3.5-flash-lite) via the Vercel AI SDK?**
   **Answer:** We selected Gemini 3.5 Flash Lite because it offers an exceptional balance between low latency, cost-effectiveness, and capability—which is critical when we might need to explain thousands of exceptions per batch. We integrated it via the Vercel AI SDK primarily for its excellent `generateObject` function, which allows us to enforce strict output structures using Zod schemas. This ensures our AI responses are predictable, typed JSON objects that our application can reliably render without brittle regex parsing.

10. **How do you guarantee that the AI doesn't hallucinate or silently corrupt the financial data?**
    **Answer:** We strictly enforce a "Human-in-the-Loop" architecture. The AI in Luma acts strictly as a Copilot; it never has direct access to mutate the database. It generates suggestions and reasoning for an exception. A human Reviewer must read the suggestion and explicitly choose to `Accept`, `Edit`, or `Reject` it. Furthermore, every AI interaction is permanently logged in the immutable `AuditLog` (with model metadata and confidence scores) so any AI-assisted decision is fully traceable.

11. **What happens if the AI provider goes down or the API key is missing?**
    **Answer:** Luma is built for resilience. We implemented a fallback mechanism controlled by the `MOCK_AI=true` environment variable. If the AI is unreachable or unconfigured, the system automatically bypasses the network call and returns deterministic mock data. The UI elegantly degrades, informing the Reviewer that AI is temporarily unavailable and that manual review is required, ensuring that the core verification platform remains 100% operational.

12. **How do you prompt the AI to classify exception severity or suggest validation rules?**
    **Answer:** We use highly structured, context-rich prompts. For instance, when classifying severity, we inject the specific `exceptionType`, the data `field` in question, and the `message`, while providing the model with a strict system prompt defining what constitutes a `critical` vs `low` severity. We then force the AI to return data conforming to a specific Zod schema (e.g., requiring a `suggestedSeverity` enum and a `reasoning` string), which prevents the AI from returning unstructured conversational text.

## 4. Audit Trail, Security & Traceability

13. **If a regulator asked to see the history of a verified loan, how does Luma provide that?**
    **Answer:** Luma maintains a dedicated, append-only `AuditLog` table. Every single business event that mutates state (e.g., file uploaded, loan imported, validation run, exception generated, AI recommendation made, reviewer comment added, field edited, loan approved) triggers an audit entry. Crucially, this audit entry is committed to the database inside the exact same Prisma transaction as the state change. The UI provides a chronological, paginated view of this exact history for any given loan.

14. **How do you prevent malicious users from altering the audit log?**
    **Answer:** The `AuditLog` is strictly append-only at the API level. There are absolutely no `PUT`, `PATCH`, or `DELETE` endpoints exposed for audit records. The application logic only ever calls `prisma.auditLog.create`. Therefore, unless a bad actor gains direct root access to the PostgreSQL instance, the application itself guarantees the log cannot be tampered with.

15. **What is the purpose of the `recordHash` on a Verified Loan? How is it generated?**
    **Answer:** The `recordHash` provides cryptographic proof of data integrity. When a loan is finally verified, we take a snapshot of its 21 business fields (the `canonicalData`). We stringify this JSON object and pass it through a SHA-256 hashing algorithm. This hash is stored permanently. If a downstream consumer or regulator ever wants to prove that the data hasn't been tampered with since the verification timestamp, they can re-hash the data and compare it to our signature.

16. **How does Luma enforce Role-Based Access Control (RBAC)?**
    **Answer:** We enforce RBAC directly at the Express middleware layer using Better Auth. Users are assigned one of three roles: `data_operator`, `reviewer`, or `data_consumer`. We built a `requireRole(...roles)` middleware that intercepts incoming requests, verifies the session cookie, and checks the user's role against the allowed list for that specific endpoint. If a `data_consumer` tries to send a `POST` request to approve an exception (a reviewer action), the middleware immediately rejects it with a `403 Forbidden` error before the controller logic even executes.

## 5. Product & Trade-offs

17. **What was the hardest technical challenge you faced while building Luma?**
    **Answer:** *(You have a few great options to choose from here based on your architecture. Pick the one you feel most comfortable explaining:)*
    *   **Challenge Option 1: Ingesting Drifting Public Datasets:** "Handling real-world Fannie Mae/Freddie Mac data was extremely difficult because their schemas are pipe-delimited (`|`), lack headers, have over 100 columns, and the layout drifts across quarterly releases. We solved this by building a 'tolerant gate' that dynamically accepts rows with >40 columns using sentinels (like known ID patterns), and applying a 'contiguous-run fold' to merge multiple performance periods into a single, up-to-date representation."
    *   **Challenge Option 2: Transactional Integrity at Scale:** "Ensuring the Audit Log was perfectly in sync with data mutations during massive batch validations was tough. We had to carefully construct Prisma transactions that could update thousands of loan statuses while simultaneously bulk-inserting corresponding exception records and audit logs—all without deadlocking the PostgreSQL database or causing memory spikes."
    *   **Challenge Option 3: Memory-Safe Duplicate Detection:** "Detecting duplicates across millions of records would instantly crash a Node server if done using in-memory arrays. We had to rethink the algorithm and push the computation to the database level, utilizing SQL `GROUP BY` queries and batched `IN` queries (in 5,000 row windows) to identify and tag duplicates highly efficiently."

18. **Why did you choose to compute batch summaries dynamically on read rather than storing denormalized counts?**
    **Answer:** We chose to compute stats (like `total failed`, `exceptions by severity`) dynamically using SQL `GROUP BY` operations rather than maintaining counter columns in the `UploadBatch` table. While counter columns (denormalization) are faster for reads, they are notoriously difficult to keep accurate (cache invalidation/stale state) when multiple reviewers are concurrently resolving exceptions. Dynamic aggregation guarantees that the dashboard always displays mathematically perfect, real-time data.

19. **How did you use AI or agentic coding tools during development?**
    **Answer:** We relied heavily on agentic AI workflows. As documented in our AI Development Log, we used tools to rapidly scaffold the initial Turborepo and Prisma schema, generate robust regex patterns for data validation, and write comprehensive unit tests. We also used LLMs to generate our realistic synthetic `loan_tape.csv` data. However, human engineering judgment was vital—we frequently had to reject AI-generated code that suggested loading entire files into memory (which causes OOMs) and instead guided the AI to implement our robust streaming ingestion architecture.

20. **What features are explicitly "Out of Scope" for this copilot?**
    **Answer:** Luma is fundamentally a data ingestion and verification layer. It is explicitly not a securitization engine, a borrowing-base calculator, an underwriting decision platform, or a credit scoring model. We focus solely on turning messy, raw datasets into clean, cryptographically hashed, and auditable records that those downstream financial systems can confidently consume.
