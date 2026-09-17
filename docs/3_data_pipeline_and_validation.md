# Data Pipeline & Validation Engine

## 1. Data Ingestion
Handling large datasets requires a robust ingestion pipeline. Luma uses:
- **Multer** for multipart file uploads, storing files temporarily on disk.
- **Streaming (csv-parser)** to process records in chunks of 5000. This constant-memory approach prevents Out-Of-Memory (OOM) errors even for very large files.
- **Resumability**: `UploadBatch.processedCount` tracks progress, allowing the system to resume gracefully.

## 2. Validation Engine
Once ingested, records pass through a multi-tier validation engine:

### Per-Loan Rules
Evaluates individual rows for issues like:
- Missing required fields.
- Date logic errors (e.g., maturity before origination).
- Balance errors (e.g., negative principal, current balance > original).
- Interest rates out of bounds.
- Stale records (>90 days old).

### Batch-Scoped Rules
Evaluates the loan against the entire batch or database:
- **Duplicate Detection**: Identifies duplicate `loanId` or `borrowerId` + amount combos. Luma uses database-level `groupBy` and batched `IN` queries (5k windows) rather than memory-heavy arrays.
- **Repeated Borrower Spikes**: Detects suspiciously high concentrations of a single borrower.

## 3. Exception Handling
Valid rows are inserted into the database. Rows failing the validation engine generate `Exception` records. These are queued for the Reviewer, annotated with severity levels (`critical`, `high`, `medium`, `low`).
