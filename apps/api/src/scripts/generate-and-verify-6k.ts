// Deterministic PRNG (Park-Miller) so the 6k tape reproduces identically every run.
class PRNG {
  private s: number;
  constructor(seed = 123_456_789) {
    this.s = seed % 2_147_483_647; // 2^31-1 keeps the state inside the PRNG range.
    if (this.s <= 0) {
      this.s += 2_147_483_646; // Bump non-positive seeds into the valid range.
    }
  }
  next(): number {
    this.s = (this.s * 16_807) % 2_147_483_647; // Standard Park-Miller multiplier.
    return (this.s - 1) / 2_147_483_646; // Normalize state to a float in (0, 1).
  }
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min; // Map a unit float to an integer in [min, max].
  }
  pick<T>(arr: readonly T[]): T {
    const item = arr[this.nextInt(0, arr.length - 1)]; // Choose a random element by index.
    if (item === undefined) {
      throw new Error("Cannot pick from empty array"); // Guard against empty inputs.
    }
    return item;
  }
  randomFloat(min: number, max: number, decimals = 2): number {
    const val = this.next() * (max - min) + min; // Generate a float between min and max.
    return Number(val.toFixed(decimals)); // Round to the requested decimal places.
  }
}

const prng = new PRNG(42); // One shared seeded generator for the whole script.

// Option pools for random field values; matching the validation rules' expectations.
const US_STATES = [
  "CA",
  "TX",
  "NY",
  "FL",
  "IL",
  "PA",
  "OH",
  "MI",
  "WA",
  "AZ",
  "GA",
  "NC",
  "VA",
  "CO",
  "NJ",
  "MA",
  "TN",
  "IN",
  "MO",
  "MD",
  "WI",
  "MN",
  "SC",
  "AL",
  "LA",
  "KY",
  "OR",
  "OK",
  "CT",
  "UT",
] as const;

// Loan types skewed toward mortgage; all are valid for the ingestion schema.
const LOAN_TYPES = [
  "mortgage",
  "mortgage",
  "mortgage",
  "mortgage",
  "auto",
  "personal",
  "student",
  "commercial",
] as const;

// Allowed loan purpose codes the validator understands.
const LOAN_PURPOSES = [
  "purchase",
  "refinance",
  "debt_consolidation",
  "home_improvement",
  "cash_out_refinance",
] as const;

// Credit grade buckets from A (best) through E.
const CREDIT_GRADES = ["A", "B", "C", "D", "E"] as const;

// Employment length buckets accepted as raw strings by normalization.
const EMPLOYMENT_LENGTHS = [
  "< 1 year",
  "1-3 years",
  "3-5 years",
  "5-10 years",
  "10+ years",
] as const;

// Income band buckets accepted as raw strings by normalization.
const INCOME_BANDS = [
  "<30k",
  "30k-50k",
  "50k-75k",
  "75k-100k",
  "100k-150k",
  "150k+",
] as const;

// Realistic servicer names used for servicer_name values.
const SERVICERS = [
  "First National",
  "Rocket Servicing",
  "Pennymac",
  "Chase Home Lending",
  "Freedom Mortgage",
  "Wells Fargo Servicing",
  "Mr. Cooper",
  "LoanCare",
] as const;

// Source systems the tape can claim as its origin.
const SOURCE_SYSTEMS = [
  "origination",
  "servicing_core",
  "legacy_crm",
  "portal_upload",
] as const;

// Convert a Date to a plain YYYY-MM-DD string for the CSV.
const formatDate = (date: Date): string => {
  const [datePart] = date.toISOString().split("T"); // Take the date part before the T.
  return datePart ?? ""; // Fall back to empty string if split returned nothing.
};

// Pick payment fields so that ~92% of loans are current, some late/delinquent, few closed.
const determinePaymentFields = (currentBalance: number) => {
  const roll = prng.nextInt(1, 100); // Roll a number from 1 to 100 for the status bucket.
  if (roll <= 92) {
    return {
      daysPastDue: 0,
      finalBalance: currentBalance,
      paymentStatus: "current", // Most loans are current with no days past due.
    };
  }
  if (roll <= 97) {
    return {
      daysPastDue: prng.pick([30, 60, 90, 120]), // Delinquent loans carry 30-120 days past due.
      finalBalance: currentBalance,
      paymentStatus: "delinquent",
    };
  }
  if (roll <= 99) {
    return {
      daysPastDue: prng.pick([15, 25]), // Late loans carry a short days-past-due window.
      finalBalance: currentBalance,
      paymentStatus: "late",
    };
  }
  return { daysPastDue: 0, finalBalance: 0.0, paymentStatus: "closed" }; // Closed loans are paid to zero.
};

// Generate one fully valid loan row for the synthetic tape.
const generateCleanLoan = (index: number): Record<string, string> => {
  const loanId = `L-${(100_000 + index).toString()}`; // Monotonic loan id per row index.
  const borrowerId = `B-${(500_000 + index).toString()}`; // Monotonic borrower id per row index.
  const loanType = prng.pick(LOAN_TYPES); // Pick a random loan type.
  const termMonths =
    loanType === "mortgage"
      ? prng.pick([180, 240, 360]) // Mortgages get long terms.
      : prng.pick([36, 60, 84, 120]); // Other loans get short terms.

  const origYear = prng.nextInt(2018, 2024); // Origination year between 2018 and 2024.
  const origMonth = prng.nextInt(1, 12); // Random month 1-12.
  const origDay = prng.nextInt(1, 28); // Day capped at 28 to stay valid for all months.
  const origDate = new Date(Date.UTC(origYear, origMonth - 1, origDay)); // Build origination date in UTC.
  const matDate = new Date(
    Date.UTC(origYear, origMonth - 1 + termMonths, origDay) // Maturity is origination plus term months.
  );

  const originalPrincipal = prng.randomFloat(50_000, 650_000, 2); // Principal between 50k and 650k.
  const currentBalance = prng.randomFloat(
    originalPrincipal * 0.15, // Balance is 15-95% of the original principal.
    originalPrincipal * 0.95,
    2
  );
  const interestRate = prng.randomFloat(3.25, 8.75, 2); // Rate between 3.25% and 8.75%.

  const { paymentStatus, daysPastDue, finalBalance } =
    determinePaymentFields(currentBalance); // Derive consistent payment fields.

  const lastPayMonth = prng.nextInt(6, 8); // Last payment month between June and August.
  const lastPayDay = prng.nextInt(1, 28); // Last payment day.
  const lastPaymentDate = `2026-0${lastPayMonth}-${lastPayDay < 10 ? `0${lastPayDay}` : lastPayDay}`; // Format a fixed 2026 payment date.

  const lastUpdDay = prng.nextInt(1, 25); // Last update day within August 2026.
  const lastUpdatedAt = `2026-08-${lastUpdDay < 10 ? `0${lastUpdDay}` : lastUpdDay}`; // Format a fixed August 2026 update date.

  return {
    borrower_id: borrowerId,
    borrower_state: prng.pick(US_STATES), // Random US state.
    credit_grade: prng.pick(CREDIT_GRADES), // Random credit grade.
    current_balance: finalBalance.toFixed(2), // Final balance for this loan.
    days_past_due: daysPastDue.toString(), // Days past due as string.
    document_status: prng.pick([
      "complete",
      "complete",
      "complete",
      "verified", // Mostly complete with some verified docs.
    ]),
    employment_length: prng.pick(EMPLOYMENT_LENGTHS), // Random employment bucket.
    income_band: prng.pick(INCOME_BANDS), // Random income bucket.
    interest_rate: interestRate.toFixed(2), // Interest rate as a string.
    last_payment_date: lastPaymentDate, // Fixed format payment date.
    last_updated_at: lastUpdatedAt, // Fixed format update date.
    loan_id: loanId,
    loan_purpose: prng.pick(LOAN_PURPOSES), // Random loan purpose.
    loan_type: loanType,
    maturity_date: formatDate(matDate), // Maturity as YYYY-MM-DD.
    original_principal: originalPrincipal.toFixed(2), // Principal as a string.
    origination_date: formatDate(origDate), // Origination as YYYY-MM-DD.
    payment_status: paymentStatus,
    servicer_name: prng.pick(SERVICERS), // Random servicer.
    source_system: prng.pick(SOURCE_SYSTEMS), // Random source system.
    term_months: termMonths.toString(), // Term as a string.
  };
};

// Set a single field on one row, guarding against bad indices.
const mutateRow = (
  rows: Record<string, string>[],
  idx: number,
  field: string,
  val: string
) => {
  const row = rows[idx]; // Look up the target row.
  if (row) {
    row[field] = val; // Overwrite the field only if the row exists.
  }
};

// Inject rows that fail CSV normalization: blank ids, bad origin dates, bad maturity dates.
const applyNormalizationAnomalies = (rows: Record<string, string>[]) => {
  for (let i = 0; i < 10; i += 1) {
    const idx = 10 + i * 10; // Every 10th row starting at row 10.
    mutateRow(rows, idx, "loan_id", ""); // Blank the loan_id to force a normalization failure.
    mutateRow(rows, idx, "borrower_id", ""); // Blank the borrower_id too.
  }
  for (let i = 0; i < 10; i += 1) {
    const idx = 110 + i * 10; // Next spread of rows.
    mutateRow(rows, idx, "origination_date", "not-a-date"); // Bad origination date fails parsing.
  }
  for (let i = 0; i < 10; i += 1) {
    const idx = 210 + i * 10; // Last spread of normalization rows.
    mutateRow(rows, idx, "maturity_date", "2030-99-99"); // Invalid maturity date fails parsing.
  }
};

// Inject rows that normalize but fail validation rules on the per-loan pass.
const applyValidationAnomalies = (rows: Record<string, string>[]) => {
  for (let i = 0; i < 20; i += 1) {
    mutateRow(rows, 310 + i * 10, "loan_id", ""); // Blank loan_id triggers missing_field.
  }
  for (let i = 0; i < 25; i += 1) {
    mutateRow(rows, 510 + i * 10, "document_status", ""); // Blank document status triggers missing_field.
  }
  for (let i = 0; i < 25; i += 1) {
    const idx = 760 + i * 10;
    mutateRow(rows, idx, "origination_date", "2023-05-15"); // Set a valid origination date.
    mutateRow(rows, idx, "maturity_date", "2020-01-01"); // Set maturity before origination to trip date_error.
  }
  for (let i = 0; i < 20; i += 1) {
    const idx = 1010 + i * 10;
    mutateRow(
      rows,
      idx,
      "original_principal",
      `-${prng.randomFloat(20_000, 100_000).toFixed(2)}` // Negative principal trips balance_error.
    );
  }
  for (let i = 0; i < 25; i += 1) {
    const idx = 1210 + i * 10;
    const orig = 250_000.0;
    mutateRow(rows, idx, "original_principal", orig.toFixed(2)); // Set a 250k principal.
    mutateRow(rows, idx, "current_balance", (orig + 50_000.0).toFixed(2)); // Balance above principal trips balance_error.
  }
  for (let i = 0; i < 15; i += 1) {
    mutateRow(
      rows,
      1460 + i * 10,
      "interest_rate",
      `-${prng.randomFloat(1.0, 5.0).toFixed(2)}` // Negative rate trips rate_out_of_range.
    );
  }
  for (let i = 0; i < 15; i += 1) {
    mutateRow(
      rows,
      1610 + i * 10,
      "interest_rate",
      prng.randomFloat(45.0, 68.0).toFixed(2) // Rate above the 40 max trips rate_out_of_range.
    );
  }
  for (let i = 0; i < 25; i += 1) {
    const idx = 1760 + i * 10;
    mutateRow(rows, idx, "payment_status", "current"); // Keep status current.
    mutateRow(
      rows,
      idx,
      "days_past_due",
      prng.pick([30, 45, 60, 90]).toString() // Positive DPD with current status trips status_inconsistency.
    );
  }
  for (let i = 0; i < 25; i += 1) {
    const idx = 2010 + i * 10;
    mutateRow(rows, idx, "payment_status", prng.pick(["delinquent", "late"])); // Set a non-current status.
    mutateRow(rows, idx, "days_past_due", "0"); // Zero DPD with non-current status trips status_inconsistency.
  }
  for (let i = 0; i < 25; i += 1) {
    const idx = 2260 + i * 10;
    mutateRow(rows, idx, "payment_status", "closed"); // Set status to closed.
    mutateRow(
      rows,
      idx,
      "current_balance",
      prng.randomFloat(10_000, 75_000).toFixed(2) // Closed with a non-zero balance trips status_inconsistency.
    );
  }
  for (let i = 0; i < 25; i += 1) {
    mutateRow(
      rows,
      2510 + i * 10,
      "borrower_state",
      prng.pick(["XX", "ZZ", "99", "AA", "QQ"]) // Invalid states trip invalid_state.
    );
  }
  for (let i = 0; i < 25; i += 1) {
    const idx = 2760 + i * 10;
    const oldYear = prng.pick([2024, 2025]); // Pick a year older than 2026.
    const oldMonth = prng.nextInt(1, 12); // Random old month.
    const oldDay = prng.nextInt(1, 28); // Random old day.
    mutateRow(
      rows,
      idx,
      "last_updated_at",
      `${oldYear}-${oldMonth < 10 ? `0${oldMonth}` : oldMonth}-${oldDay < 10 ? `0${oldDay}` : oldDay}` // Old update date trips stale_record.
    );
  }
};

// Inject duplicate loan ids, duplicate combos, and spiked borrowers across the rows.
const applyDuplicateAnomalies = (rows: Record<string, string>[]) => {
  for (let i = 0; i < 20; i += 1) {
    const baseIdx = 3010 + i * 10; // First occurrence position.
    const dupeIdx = 5010 + i * 10; // Second occurrence position.
    const dupId = `L-DUP-${1000 + i}`; // Shared duplicate loan id.
    mutateRow(rows, baseIdx, "loan_id", dupId); // Set the loan id in its first row.
    mutateRow(rows, dupeIdx, "loan_id", dupId); // Reuse the same loan id in its second row.
  }

  for (let i = 0; i < 15; i += 1) {
    const baseIdx = 3210 + i * 10; // First occurrence position.
    const dupeIdx = 5210 + i * 10; // Second occurrence position.
    const comboBorrower = `B-COMBO-${2000 + i}`; // Shared duplicate borrower id.
    const comboPrincipal = "385000.00"; // Shared principal for the combo key.
    const comboDate = "2021-09-15"; // Shared origination date for the combo key.
    mutateRow(rows, baseIdx, "borrower_id", comboBorrower); // Set borrower on first row.
    mutateRow(rows, baseIdx, "original_principal", comboPrincipal); // Match principal on first row.
    mutateRow(rows, baseIdx, "origination_date", comboDate); // Match date on first row.
    mutateRow(rows, dupeIdx, "borrower_id", comboBorrower); // Set borrower on second row.
    mutateRow(rows, dupeIdx, "original_principal", comboPrincipal); // Match principal on second row.
    mutateRow(rows, dupeIdx, "origination_date", comboDate); // Match date on second row.
  }

  const spiked1 = "B-SPIKED-HIGH-01"; // First high-frequency borrower id.
  const spiked2 = "B-SPIKED-HIGH-02"; // Second high-frequency borrower id.
  const spiked1Indices = [3400, 3500, 3600, 3700, 3800, 3900, 5410, 5510]; // Where spiked1 appears.
  const spiked2Indices = [4000, 4100, 4200, 4300, 4400, 4500, 5610, 5710]; // Where spiked2 appears.

  for (let i = 0; i < 8; i += 1) {
    const idx1 = spiked1Indices[i]; // Get the current spiked1 index.
    if (idx1 !== undefined) {
      mutateRow(rows, idx1, "borrower_id", spiked1); // Reassign the borrower id.
      mutateRow(
        rows,
        idx1,
        "origination_date",
        `202${i % 4}-0${(i % 8) + 1}-10` // Vary origination dates so only borrower count spikes.
      );
      mutateRow(
        rows,
        idx1,
        "original_principal",
        (200_000 + i * 15_000).toFixed(2) // Vary principals so only borrower count spikes.
      );
    }

    const idx2 = spiked2Indices[i]; // Get the current spiked2 index.
    if (idx2 !== undefined) {
      mutateRow(rows, idx2, "borrower_id", spiked2); // Reassign the borrower id.
      mutateRow(
        rows,
        idx2,
        "origination_date",
        `202${(i + 1) % 4}-0${(i % 8) + 1}-12` // Vary dates like the first spike group.
      );
      mutateRow(
        rows,
        idx2,
        "original_principal",
        (300_000 + i * 12_000).toFixed(2) // Vary principals like the first spike group.
      );
    }
  }
};

// Build the full 6k dataset: clean rows plus normalization, validation, and duplicate anomalies.
export const generate6kDataset = (): Record<string, string>[] => {
  const TOTAL_ROWS = 6000; // Exactly 6000 data rows.
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < TOTAL_ROWS; i += 1) {
    rows.push(generateCleanLoan(i)); // Generate each clean loan in index order.
  }

  applyNormalizationAnomalies(rows); // Stamp in rows that fail normalization.
  applyValidationAnomalies(rows); // Stamp in rows that fail validation.
  applyDuplicateAnomalies(rows); // Stamp in duplicate and spike patterns.

  return rows;
};

const HEADERS = [
  "loan_id",
  "borrower_id",
  "loan_type",
  "origination_date",
  "maturity_date",
  "original_principal",
  "current_balance",
  "interest_rate",
  "term_months",
  "borrower_state",
  "loan_purpose",
  "credit_grade",
  "employment_length",
  "income_band",
  "payment_status",
  "days_past_due",
  "servicer_name",
  "last_payment_date",
  "last_updated_at",
  "document_status",
  "source_system",
] as const;

export const toCsv = (rows: Record<string, string>[]): string => {
  const headerLine = HEADERS.join(","); // Join the fixed header names into one CSV line.
  const dataLines = rows.map(
    (row) => HEADERS.map((h) => row[h] ?? "").join(",") // Output each row's values in header order.
  );
  return [headerLine, ...dataLines].join("\n"); // Combine header and rows into one file string.
};
