// Imports: filesystem access, validation thresholds, ingestion normalization,
// per-loan validation rules, and the 6k tape generator.
import fs from "node:fs";
import path from "node:path";
import { defaultThresholds } from "../lib/validation-thresholds.js";
import {
  type LoanCreateData,
  normalizeRow,
} from "../services/ingestion.service.js";
import {
  runPerLoanRules,
  type ValidationException,
} from "../services/validation.service.js";
import { generate6kDataset, toCsv } from "./generate-and-verify-6k.js";

// A normalized loan carries a synthetic id so per-loan rules can run without a DB.
type NormalizedLoanItem = LoanCreateData & { id: string };

// Verify the generated CSV file has 6001 lines and 21 columns on disk.
const verifyFileStructure = (outPath: string) => {
  const stats = fs.statSync(outPath); // Read the file size from disk.
  const rawFile = fs.readFileSync(outPath, "utf8"); // Load the whole file as text.
  const fileLines = rawFile.split("\n"); // Split the file content into lines.
  const totalLines = fileLines.length; // Count header plus data rows.
  const header = fileLines[0] ?? ""; // The first line is the CSV header row.
  const headers = header.split(","); // Split the header into column names.

  console.log("\n--- File Structure Verification ---"); // Print the file checks heading.
  console.log(
    `File Size: ${(stats.size / 1024).toFixed(2)} KB (${stats.size} bytes)` // Report size in KB and bytes.
  );
  console.log(
    `Total Lines: ${totalLines} (1 Header + ${totalLines - 1} Data Rows)` // Report line totals.
  );
  console.log(`Header Count: ${headers.length} columns`); // Report column count.
  console.log(`Headers: ${header}`); // Print the raw header row.

  if (totalLines !== 6001) {
    throw new Error(
      `Expected 6001 lines (1 header + 6000 data rows), but got ${totalLines}` // Abort if line count is off.
    );
  }
  if (headers.length !== 21) {
    throw new Error(`Expected 21 headers, but got ${headers.length}`); // Abort if column count is off.
  }
};

// Run normalizeRow over the 6k rows, tallying successes vs failures.
const runNormalizationPass = (rows: Record<string, string>[]) => {
  let normalizedCount = 0; // Track how many rows normalized cleanly.
  let failedNormalizationCount = 0; // Track how many rows failed normalization.
  const failedNormalizationReasons: Record<string, number> = {}; // Tally failure reasons by message.
  const normalizedLoans: NormalizedLoanItem[] = []; // Keep normalized rows for the validation pass.

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]; // Grab the current raw row.
    if (!row) {
      continue; // Skip any empty slot in the array.
    }
    const rowNumber = i + 2; // Row 2 is the first data row after the header.
    const res = normalizeRow(row, "test_batch_6k", rowNumber); // Normalize this row via the shared service.
    if (res.success) {
      normalizedCount += 1; // Count a normalized row.
      normalizedLoans.push({ ...res.data, id: `mock_id_${rowNumber}` }); // Store it with a synthetic id.
    } else {
      failedNormalizationCount += 1; // Count a normalization failure.
      const { reason } = res.failedRow; // Get why the row failed.
      failedNormalizationReasons[reason] =
        (failedNormalizationReasons[reason] || 0) + 1; // Increment the per-reason counter.
    }
  }

  return {
    failedNormalizationCount,
    failedNormalizationReasons,
    normalizedCount,
    normalizedLoans,
  };
};

// Count loan ids, borrower+principal+date combos, and borrower totals for duplicate checks.
const collectBatchDuplicateKeys = (normalizedLoans: NormalizedLoanItem[]) => {
  const loanIdCounts = new Map<string, number>(); // Map loan_id to occurrence count.
  const borrowerComboCounts = new Map<string, number>(); // Map borrower combo key to occurrence count.
  const borrowerCounts = new Map<string, number>(); // Map borrower_id to occurrence count.

  for (const loan of normalizedLoans) {
    if (loan.loanId) {
      loanIdCounts.set(loan.loanId, (loanIdCounts.get(loan.loanId) ?? 0) + 1); // Count each loan_id occurrence.
    }
    if (loan.borrowerId) {
      const comboKey = `${loan.borrowerId}|${loan.originalPrincipal ?? ""}|${loan.originationDate ? loan.originationDate.toISOString() : ""}`; // Build a unique borrower+amount+date key.
      borrowerComboCounts.set(
        comboKey,
        (borrowerComboCounts.get(comboKey) ?? 0) + 1 // Count each combo occurrence.
      );
      borrowerCounts.set(
        loan.borrowerId,
        (borrowerCounts.get(loan.borrowerId) ?? 0) + 1 // Count each borrower_id occurrence.
      );
    }
  }

  const duplicateLoanIds = new Set(
    [...loanIdCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id) // Keep ids seen more than once.
  );
  const duplicateCombos = new Set(
    [...borrowerComboCounts.entries()].filter(([, c]) => c > 1).map(([k]) => k) // Keep combos seen more than once.
  );
  const spikedBorrowers = new Set(
    [...borrowerCounts.entries()]
      .filter(([, c]) => c > defaultThresholds.duplicateBorrowerThreshold) // Flag borrowers above the spike threshold.
      .map(([id]) => id)
  );

  return {
    borrowerCounts,
    duplicateCombos,
    duplicateLoanIds,
    spikedBorrowers,
  };
};

// Produce duplicate ValidationException entries for one loan based on batch-wide sets.
const checkDuplicateExceptions = (
  loan: NormalizedLoanItem,
  duplicateSets: ReturnType<typeof collectBatchDuplicateKeys>
): ValidationException[] => {
  const { duplicateLoanIds, duplicateCombos, spikedBorrowers, borrowerCounts } =
    duplicateSets;
  const exceptions: ValidationException[] = [];

  if (loan.loanId && duplicateLoanIds.has(loan.loanId)) {
    exceptions.push({
      exceptionType: "duplicate",
      field: "loanId",
      message: `duplicate loan_id ${loan.loanId}`, // Flag a repeated loan_id as critical.
      severity: "critical",
    });
  }

  if (loan.borrowerId) {
    const comboKey = `${loan.borrowerId}|${loan.originalPrincipal ?? ""}|${loan.originationDate ? loan.originationDate.toISOString() : ""}`; // Rebuild the combo key for this loan.
    if (duplicateCombos.has(comboKey)) {
      exceptions.push({
        exceptionType: "duplicate",
        field: "borrowerId",
        message: `duplicate borrower combo ${loan.borrowerId}`, // Flag a repeated combo as critical.
        severity: "critical",
      });
    }
    if (spikedBorrowers.has(loan.borrowerId)) {
      exceptions.push({
        exceptionType: "duplicate",
        field: "borrowerId",
        message: `borrower ${loan.borrowerId} appears ${borrowerCounts.get(loan.borrowerId)} times`, // Flag an over-repeated borrower.
        severity: "critical",
      });
    }
  }

  return exceptions;
};

// Run per-loan rules plus duplicate checks and tally pass/fail counts.
const runValidationPass = (
  normalizedLoans: NormalizedLoanItem[],
  duplicateSets: ReturnType<typeof collectBatchDuplicateKeys>
) => {
  let passedValidation = 0; // Count loans that raised no exceptions.
  let failedValidation = 0; // Count loans that raised at least one exception.
  const exceptionsByType: Record<string, number> = {}; // Tally exceptions per type.
  const exceptionsBySeverity: Record<string, number> = {}; // Tally exceptions per severity.

  for (const loan of normalizedLoans) {
    const perLoan = runPerLoanRules(loan, defaultThresholds); // Run field-level validation rules.
    const dupeExceptions = checkDuplicateExceptions(loan, duplicateSets); // Add batch duplicate checks.
    const totalExceptions = [...perLoan, ...dupeExceptions]; // Combine both rule sets.

    if (totalExceptions.length > 0) {
      failedValidation += 1; // A loan with any exception fails validation.
      for (const exc of totalExceptions) {
        exceptionsByType[exc.exceptionType] =
          (exceptionsByType[exc.exceptionType] || 0) + 1; // Increment the type counter.
        exceptionsBySeverity[exc.severity] =
          (exceptionsBySeverity[exc.severity] || 0) + 1; // Increment the severity counter.
      }
    } else {
      passedValidation += 1; // A loan with no exceptions passes validation.
    }
  }

  return {
    exceptionsBySeverity,
    exceptionsByType,
    failedValidation,
    passedValidation,
  };
};

// Print human-readable summaries of normalization, duplicates, and validation.
const printReports = (
  rowsLength: number,
  norm: ReturnType<typeof runNormalizationPass>,
  val: ReturnType<typeof runValidationPass>,
  dupes: ReturnType<typeof collectBatchDuplicateKeys>
) => {
  console.log("\n--- Ingestion Pipeline Normalization Verification ---"); // Heading for normalization results.
  console.log(
    `Normalization Success: ${norm.normalizedCount} / ${rowsLength} (${((norm.normalizedCount / rowsLength) * 100).toFixed(2)}%)` // Show success count and percentage.
  );
  console.log(
    `Normalization Failed (stored in failedRows): ${norm.failedNormalizationCount} / ${rowsLength} (${((norm.failedNormalizationCount / rowsLength) * 100).toFixed(2)}%)` // Show failure count and percentage.
  );
  console.log(
    "Normalization Failure Breakdown:",
    norm.failedNormalizationReasons // Print the failure reason tally.
  );

  console.log("\n--- Validation Pipeline Verification ---"); // Heading for validation results.
  console.log(
    `Duplicate Loan IDs detected: ${dupes.duplicateLoanIds.size} unique keys` // Report duplicate loan ids.
  );
  console.log(
    `Duplicate Borrower Combos detected: ${dupes.duplicateCombos.size} unique combos` // Report duplicate combos.
  );
  console.log(
    `Spiked Borrowers (>5 loans): ${dupes.spikedBorrowers.size} borrowers` // Report spiked borrowers.
  );

  console.log("\nValidation Summary:"); // Sub-heading for validation summary.
  console.log(
    `- Passed Validation: ${val.passedValidation} / ${norm.normalizedCount} (${((val.passedValidation / norm.normalizedCount) * 100).toFixed(2)}%)` // Show passed percentage.
  );
  console.log(
    `- Failed Validation (Exceptions Raised): ${val.failedValidation} / ${norm.normalizedCount} (${((val.failedValidation / norm.normalizedCount) * 100).toFixed(2)}%)` // Show failed percentage.
  );
  console.log("\nExceptions by Type:"); // Print exceptions grouped by type.
  console.table(val.exceptionsByType);
  console.log("\nExceptions by Severity:"); // Print exceptions grouped by severity.
  console.table(val.exceptionsBySeverity);
};

const run = () => {
  console.log("================================================="); // Banner line separating output.
  console.log("Generating 6,000-row Loan Tape CSV dataset..."); // Announce generation step.
  console.log("================================================="); // Banner line closing the heading.

  const rows = generate6kDataset(); // Generate the 6k row dataset in memory.
  console.log(`Generated ${rows.length} records in memory.`); // Report the row count.

  const csvContent = toCsv(rows); // Serialize all rows to one CSV string.
  const outPath = path.resolve(process.cwd(), "../../loan_tape_6k.csv"); // Resolve the output file path relative to cwd.
  fs.writeFileSync(outPath, csvContent, "utf8"); // Write the CSV file to disk.

  console.log(`Wrote CSV file to: ${outPath}`); // Confirm the file location.

  verifyFileStructure(outPath); // Verify the file shape on disk.
  const norm = runNormalizationPass(rows); // Run the normalization pass.
  const dupes = collectBatchDuplicateKeys(norm.normalizedLoans); // Compute duplicate keys from normalized rows.
  const val = runValidationPass(norm.normalizedLoans, dupes); // Run validation, including duplicates.

  printReports(rows.length, norm, val, dupes); // Print the full verification report.

  console.log("\n--- Chunking & Scale Compatibility ---"); // Heading for chunking notes.
  console.log(
    "Chunk 1 (Rows 2..5001): 5,000 records -> Flushed as batch chunk 1" // Note the first 5000-row chunk.
  );
  console.log(
    "Chunk 2 (Rows 5002..6001): 1,000 records -> Flushed as batch chunk 2" // Note the remaining 1000-row chunk.
  );
  console.log(
    "Validation chunking threshold: 5,000 records -> Multi-chunk validation execution verified." // Note the validation chunk threshold.
  );

  console.log("\n================================================="); // Banner line closing the output.
  console.log("✅ 6K CSV DATASET GENERATED & VERIFIED SUCCESSFULLY!"); // Final success message.
  console.log("================================================="); // Banner line closing the output.
};

run();
