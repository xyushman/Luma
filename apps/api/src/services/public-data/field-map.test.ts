import { describe, expect, it } from "bun:test";
import {
  deriveDelinquency,
  gatePublicRow,
  mapLoanType,
  mapPublicRowToLoanPart,
  mapPurpose,
  PUBLIC_DATA_FORMAT_REGISTRY,
  PUBLIC_DATA_MIN_FIELDS,
  parsePublicDate,
} from "./field-map.js";

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
  arr[25] = overrides[25] ?? "N"; // Unmapped sample column 25.
  arr[26] = overrides[26] ?? "C"; // Unmapped sample column 26.
  arr[27] = overrides[27] ?? "SF"; // Property type.
  arr[28] = overrides[28] ?? "1"; // Unmapped sample column 28.
  arr[29] = overrides[29] ?? "P"; // Loan purpose code.
  arr[30] = overrides[30] ?? "OH"; // State code.
  arr[31] = overrides[31] ?? "17140"; // Unmapped sample column 31.
  arr[32] = overrides[32] ?? "452"; // Unmapped sample column 32.
  arr[34] = overrides[34] ?? "FRM"; // Loan type.
  arr[35] = overrides[35] ?? "N"; // Unmapped sample column 35.
  arr[39] = overrides[39] ?? "00"; // Prepayment penalty.
  arr[41] = overrides[41] ?? "N"; // HARP flag.
  for (const [k, v] of Object.entries(overrides)) {
    arr[Number(k)] = v as string; // Apply any test-specific overrides.
  }
  return arr;
};

describe("parsePublicDate", () => {
  it("parses MMYYYY 082009 -> 2009-08-01", () => {
    const d = parsePublicDate("082009");
    expect(d).toBeInstanceOf(Date); // A valid MMYYYY must become a Date object.
    expect(d?.getUTCFullYear()).toBe(2009); // MM = 08 maps to 2009.
    expect(d?.getUTCMonth()).toBe(7); // Month 08 is zero-based index 7.
    expect(d?.getUTCDate()).toBe(1); // Days default to the first of the month.
  });

  it("parses MMYYYY 122015 -> 2015-12-01", () => {
    const d = parsePublicDate("122015");
    expect(d?.getUTCFullYear()).toBe(2015);
    expect(d?.getUTCMonth()).toBe(11); // December is index 11.
  });

  it("parses YYYYMM 200908 fallback via swapped heuristic", () => {
    const d = parsePublicDate("200908"); // YYYYMM input must still be understood.
    expect(d?.getUTCFullYear()).toBe(2009);
    expect(d?.getUTCMonth()).toBe(7);
  });

  it("parses ISO string", () => {
    const d = parsePublicDate("2022-03-15"); // ISO dates pass through to Date.
    expect(d?.toISOString().startsWith("2022-03-15")).toBe(true);
  });

  it("returns null for empty", () => {
    expect(parsePublicDate("")).toBeNull(); // Empty input means no date.
    expect(parsePublicDate("   ")).toBeNull();
    expect(parsePublicDate(null)).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(parsePublicDate("not-a-date")).toBeNull(); // Unparseable input means no date.
    expect(parsePublicDate("999999")).toBeNull(); // Out-of-range month fails too.
  });
});

describe("deriveDelinquency", () => {
  it("-1 -> current 0", () => {
    expect(deriveDelinquency("-1")).toEqual({
      daysPastDue: 0,
      paymentStatus: "current", // -1 is the "not delinquent" code.
    });
  });

  it("0 -> current 0", () => {
    expect(deriveDelinquency("0")).toEqual({
      daysPastDue: 0,
      paymentStatus: "current", // 0 is the current status code.
    });
  });

  it("1 -> delinquent 30", () => {
    expect(deriveDelinquency("1")).toEqual({
      daysPastDue: 30,
      paymentStatus: "delinquent", // Code 1 means 30 days past due.
    });
  });

  it("3 -> delinquent 90", () => {
    expect(deriveDelinquency("3")).toEqual({
      daysPastDue: 90,
      paymentStatus: "delinquent", // Code 3 means 90 days past due.
    });
  });

  it("empty -> current 0", () => {
    expect(deriveDelinquency("")).toEqual({
      daysPastDue: 0,
      paymentStatus: "current", // Blank input safely defaults to current.
    });
  });

  it("non-numeric keeps raw as status", () => {
    const r = deriveDelinquency("R"); // Unknown codes are surfaced as-is.
    expect(r.paymentStatus).toBe("R");
  });
});

describe("mapPurpose", () => {
  it("maps P/R/C/U", () => {
    expect(mapPurpose("P")).toBe("purchase"); // P is purchase.
    expect(mapPurpose("R")).toBe("refinance"); // R is refinance.
    expect(mapPurpose("C")).toBe("cash-out refinance"); // C is cash-out refinance.
    expect(mapPurpose("U")).toBeNull(); // U is unknown.
    expect(mapPurpose("p")).toBe("purchase"); // Lowercase is normalized too.
  });

  it("returns raw for unknown", () => {
    expect(mapPurpose("X")).toBe("X"); // Unknown codes pass through untouched.
  });

  it("null -> null", () => {
    expect(mapPurpose(null)).toBeNull(); // Missing purpose is null.
    expect(mapPurpose("")).toBeNull();
  });
});

describe("mapLoanType", () => {
  it("SF -> single_family", () => {
    expect(mapLoanType("SF")).toBe("single_family"); // SF is single family.
    expect(mapLoanType("CO")).toBe("condo"); // CO is condo.
  });

  it("unknown kept raw", () => {
    expect(mapLoanType("XYZ")).toBe("XYZ"); // Unknown types pass through.
  });
});

describe("gatePublicRow", () => {
  it("rejects < MIN_FIELDS", () => {
    const short = Array.from({ length: 10 }, () => ""); // Too few fields to map.
    short[1] = "L1";
    short[2] = "082009";
    const r = gatePublicRow(short, "freddie_mac");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("expected"); // Error names the minimum field count.
  });

  it("rejects missing loan_id", () => {
    const arr = buildPipeFields({ 1: "" }); // Blank loan id column.
    const r = gatePublicRow(arr, "fannie_mae");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("loan_id"); // Missing loan_id is a hard gate failure.
  });

  it("rejects invalid period", () => {
    const arr = buildPipeFields({ 2: "notadate" }); // Bad reporting period.
    const r = gatePublicRow(arr, "freddie_mac");
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("reporting period"); // Unparseable period fails the gate.
  });

  it("passes valid row and counts unmapped", () => {
    const arr = buildPipeFields();
    const before = gatePublicRow(arr, "freddie_mac");
    expect(before.valid).toBe(true);
    expect(before.unmappedNonEmpty).toBeGreaterThanOrEqual(0); // Baseline non-empty unmapped count.
    arr[50] = "unexpected"; // Add a value in an unmapped column.
    const after = gatePublicRow(arr, "freddie_mac");
    expect(after.valid).toBe(true);
    expect(after.unmappedNonEmpty).toBe((before.unmappedNonEmpty ?? 0) + 1); // Count increments by one.
  });

  it("passes with no extra injection and reports a number", () => {
    const arr = buildPipeFields();
    const r = gatePublicRow(arr, "fannie_mae");
    expect(r.valid).toBe(true); // A full clean row always passes.
    expect(typeof r.unmappedNonEmpty).toBe("number"); // unmapped count is always present.
  });
});

describe("mapPublicRowToLoanPart", () => {
  const batchId = "batch_pub_001";
  it("happy path -> loan fields mapped correctly", () => {
    const arr = buildPipeFields();
    const res = mapPublicRowToLoanPart(arr, batchId, 2, "freddie_mac");
    expect(res.success).toBe(true);
    if (!res.success) {
      throw new Error("expected success");
    }
    const d = res.data;
    expect(d.loanId).toBe("100023020488"); // Loan id comes from column 1.
    expect(d.borrowerId).toBeNull(); // Public data has no borrower ids.
    expect(d.sourceBatchId).toBe(batchId); // Batch linkage is preserved.
    expect(d.sourceRowNumber).toBe(2);
    expect(d.sourceSystem).toBe("freddie_mac"); // Source is tagged per feed.
    expect(d.documentStatus).toBe("unknown"); // Public data has no doc status.
    expect(d.borrowerState).toBe("OH"); // State maps from column 30.
    expect(d.loanPurpose).toBe("purchase"); // Purpose "P" maps to purchase.
    expect(d.loanType).toBe("single_family"); // SF maps to single_family.
    expect(d.termMonths).toBe(240); // Term maps from column 12.
    expect(d.creditGrade).toBe("714"); // Credit score stays as a string.
    expect(d.servicerName).toBe("Other"); // Servicer maps from column 5.
    expect(d.originalPrincipal).toBe(55_000); // Original UPB maps to principal.
    expect(d.currentBalance).toBe(55_000); // Current UPB maps to balance.
    expect(d.interestRate).toBe(5.375); // Rate stays numeric.
    expect(d.originationDate?.getUTCFullYear()).toBe(2009); // First payment year becomes origination.
    expect(d.maturityDate?.getUTCFullYear()).toBe(2029); // Maturity date parses to 2029.
    expect(d.lastUpdatedAt?.getUTCMonth()).toBe(7); // Reporting month maps to update month.
    expect(d.paymentStatus).toBe("current"); // Delinquency 0 maps to current.
    expect(d.daysPastDue).toBe(0);
  });

  it("curr UPB non-zero uses that value", () => {
    const arr = buildPipeFields({ 11: "54350.98" }); // Non-zero current UPB.
    const res = mapPublicRowToLoanPart(arr, batchId, 2, "fannie_mae");
    expect(res.success).toBe(true);
    if (!res.success) {
      throw new Error("expected success");
    }
    expect(res.data.currentBalance).toBe(54_350.98); // Balance reflects the given UPB.
  });

  it("delinquency 3 -> delinquent 90", () => {
    const arr = buildPipeFields({ 15: "3" }); // Delinquency code 3.
    const res = mapPublicRowToLoanPart(arr, batchId, 2, "freddie_mac");
    expect(res.success).toBe(true);
    if (!res.success) {
      throw new Error("expected success");
    }
    expect(res.data.paymentStatus).toBe("delinquent"); // Code 3 means delinquent.
    expect(res.data.daysPastDue).toBe(90); // Code 3 maps to 90 days.
  });

  it("missing loan_id -> failedRow with reason", () => {
    const arr = buildPipeFields({ 1: "" }); // Blank loan id.
    const res = mapPublicRowToLoanPart(arr, batchId, 5, "fannie_mae");
    expect(res.success).toBe(false);
    if (res.success) {
      throw new Error("expected failure");
    }
    expect(res.failedRow.rowNumber).toBe(5); // Failure keeps the row number.
    expect(res.failedRow.reason.toLowerCase()).toContain("loan_id"); // Reason names the field.
  });

  it("invalid origination date -> failedRow", () => {
    const arr = buildPipeFields({ 13: "not-a-date" }); // Bad first payment date.
    const res = mapPublicRowToLoanPart(arr, batchId, 2, "freddie_mac");
    expect(res.success).toBe(false);
    if (res.success) {
      throw new Error("expected failure");
    }
    expect(res.failedRow.reason.toLowerCase()).toContain("origination_date"); // Reason names the field.
  });

  it("invalid maturity date -> failedRow", () => {
    const arr = buildPipeFields({ 18: "bad" }); // Bad maturity date.
    const res = mapPublicRowToLoanPart(arr, batchId, 2, "fannie_mae");
    expect(res.success).toBe(false);
    if (res.success) {
      throw new Error("expected failure");
    }
    expect(res.failedRow.reason.toLowerCase()).toContain("maturity_date"); // Reason names the field.
  });

  it("too few fields -> gate failedRow", () => {
    const short = ["", "L1", "082009"]; // Far below minimum field count.
    const res = mapPublicRowToLoanPart(short, batchId, 2, "freddie_mac");
    expect(res.success).toBe(false);
    if (res.success) {
      throw new Error("expected failure");
    }
    expect(res.failedRow.reason).toContain("expected"); // Gate names the minimum requirement.
  });
});

describe("PUBLIC_DATA_FORMAT_REGISTRY", () => {
  it("contains both formats with minFields >= MIN_FIELDS", () => {
    expect(PUBLIC_DATA_FORMAT_REGISTRY.fannie_mae.minFields).toBe(
      PUBLIC_DATA_MIN_FIELDS // Fannie must respect the shared minimum.
    );
    expect(PUBLIC_DATA_FORMAT_REGISTRY.freddie_mac.minFields).toBe(
      PUBLIC_DATA_MIN_FIELDS // Freddie must respect the shared minimum.
    );
  });

  it("layout versions are strings", () => {
    expect(typeof PUBLIC_DATA_FORMAT_REGISTRY.fannie_mae.layoutVersion).toBe(
      "string" // Fannie records which layout version it targets.
    );
    expect(typeof PUBLIC_DATA_FORMAT_REGISTRY.freddie_mac.layoutVersion).toBe(
      "string" // Freddie records which layout version it targets.
    );
  });
});
