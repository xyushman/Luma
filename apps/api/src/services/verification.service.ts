// Imports the canonical-hash helpers (date/decimal string normalization) and the Prisma client.
import {
  computeRecordHash,
  normalizeDateString,
  normalizeDecimalString,
} from "../lib/hash.js";
import { prisma } from "../lib/prisma.js";

// Domain error carrying an HTTP status and code so routes map it to API responses directly.
export class VerificationError extends Error {
  statusCode: number;
  code: string;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    options?: { cause?: unknown }
  ) {
    // Forward the message (and optional cause) to the base Error.
    super(message, options);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Assembles the canonical 20-field snapshot used as input for the verification hash.
const buildCanonicalData = (loan: {
  borrowerId: string | null;
  borrowerState: string | null;
  creditGrade: string | null;
  currentBalance: unknown;
  daysPastDue: number | null;
  documentStatus: string | null;
  employmentLength: string | null;
  incomeBand: string | null;
  interestRate: unknown;
  lastPaymentDate: Date | null;
  loanId: string | null;
  loanPurpose: string | null;
  loanType: string | null;
  maturityDate: Date | null;
  originationDate: Date | null;
  originalPrincipal: unknown;
  paymentStatus: string | null;
  servicerName: string | null;
  sourceSystem: string | null;
  termMonths: number | null;
}): Record<string, unknown> => ({
  borrowerId: loan.borrowerId,
  borrowerState: loan.borrowerState,
  creditGrade: loan.creditGrade,
  // Decimal normalization makes 1000 and 1000.0 hash identically.
  currentBalance: normalizeDecimalString(loan.currentBalance),
  daysPastDue: loan.daysPastDue,
  documentStatus: loan.documentStatus,
  employmentLength: loan.employmentLength,
  incomeBand: loan.incomeBand,
  interestRate: normalizeDecimalString(loan.interestRate),
  // Dates normalize to ISO to erase timezone/format differences before hashing.
  lastPaymentDate: normalizeDateString(loan.lastPaymentDate),
  loanId: loan.loanId,
  loanPurpose: loan.loanPurpose,
  loanType: loan.loanType,
  maturityDate: normalizeDateString(loan.maturityDate),
  originalPrincipal: normalizeDecimalString(loan.originalPrincipal),
  originationDate: normalizeDateString(loan.originationDate),
  paymentStatus: loan.paymentStatus,
  servicerName: loan.servicerName,
  sourceSystem: loan.sourceSystem,
  termMonths: loan.termMonths,
});

// Verifies a loan by hashing its canonical data, gating on preconditions, then creating a VerifiedLoan.
export const verifyLoan = async (
  loanId: string,
  userId: string
): Promise<{
  id: string;
  loanId: string;
  recordHash: string;
  validationResult: string;
  verifiedAt: string;
  verifiedById: string;
}> => {
  // Fetch the loan with its exceptions, batch metadata, and any existing verified record.
  const loan = await prisma.loan.findUnique({
    include: {
      exceptions: true,
      sourceBatch: { select: { fileName: true, id: true } },
      verifiedRecord: true,
    },
    where: { id: loanId },
  });

  // Cannot verify a loan we do not have; 404 with a stable code for routes.
  if (!loan) {
    throw new VerificationError("Loan not found", 404, "NOT_FOUND");
  }

  // One verified record per loan; a second attempt is a conflict.
  if (loan.verifiedRecord) {
    throw new VerificationError(
      "Verified record already exists for this loan",
      409,
      "CONFLICT"
    );
  }

  // Open exceptions mean the data is still disputed, so verification is blocked.
  const openExceptions = loan.exceptions.filter((e) => e.status === "open");
  if (openExceptions.length > 0) {
    throw new VerificationError(
      `${openExceptions.length} exception(s) still open — resolve all exceptions before verification`,
      409,
      "CONFLICT"
    );
  }

  // Normalize the loan fields into a stable, comparable snapshot.
  const canonicalData = buildCanonicalData(loan as never);
  // SHA-256 of the canonical JSON becomes the tamper-evident record fingerprint.
  const recordHash = computeRecordHash(canonicalData);
  // Loans that had exceptions were reviewed, hence "passed_with_review".
  const validationResult =
    loan.exceptions.length === 0 ? "passed" : "passed_with_review";
  // Only reviewed loans carry an approvals-flow decision on the record.
  const reviewerDecision =
    loan.exceptions.length === 0 ? null : "approved_with_edits";
  // Records the fact that an AI recommendation shaped the outcome, for audit.
  const aiRecommendationUsed = loan.exceptions.some(
    (e) => e.aiRecommendation !== null && e.aiRecommendation !== undefined
  );
  // Human-readable provenance: which uploaded file this loan originally came from.
  const sourceBatchRef = `${loan.sourceBatch.fileName} (${loan.sourceBatch.id})`;

  let result: Awaited<ReturnType<typeof prisma.verifiedLoan.create>>;
  try {
    // Record creation and audit logging commit together so provenance is never half-written.
    result = await prisma.$transaction(async (tx) => {
      const verified = await tx.verifiedLoan.create({
        data: {
          aiRecommendationUsed,
          canonicalData: canonicalData as never,
          loanId: loan.id,
          recordHash,
          reviewerDecision,
          sourceBatchRef,
          validationResult,
          verifiedById: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          eventType: "VERIFIED_RECORD_CREATED",
          loanId: loan.id,
          metadata: {
            recordHash,
            validationResult,
            verifiedLoanId: verified.id,
          },
          verifiedLoanId: verified.id,
        },
      });

      return verified;
    });
  } catch (error) {
    // P2002 is Prisma's unique-constraint violation; map it to a 409 CONFLICT.
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      // biome-ignore lint/style/useErrorCause: cause is forwarded via VerificationError options
      throw new VerificationError(
        "Verified record already exists for this loan",
        409,
        "CONFLICT",
        { cause: error }
      );
    }
    throw error as Error;
  }

  // Return the persisted record as a plain serializable shape for the API response.
  return {
    id: result.id,
    loanId: result.loanId,
    recordHash: result.recordHash,
    validationResult: result.validationResult,
    verifiedAt: result.verifiedAt.toISOString(),
    verifiedById: result.verifiedById,
  };
};
