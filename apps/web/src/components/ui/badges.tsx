// Imports: domain enums (batch/validation/exception statuses and severity) from the shared types package.
import type {
  BatchStatus,
  ExceptionStatus,
  ExceptionType,
  Severity,
  ValidationResult,
  ValidationStatus,
} from "@repo/types";
import { cn } from "@/lib/utils"; // merges semantic color classes with any caller-supplied classes.

/* Spec §1 — semantic signal colors live only on badges/pills/dots.
   High severity = desaturated red, medium = amber, low/verified = green. */

// Severity pill palettes: critical/high share the red family, medium is amber, low is green.
const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "border-destructive/25 bg-destructive/8 text-destructive", // critical = most urgent, red.
  high: "border-destructive/25 bg-destructive/8 text-destructive", // high = also red, distinct via label.
  low: "border-success/30 bg-success/8 text-success", // low = relaxed, success green.
  medium: "border-warning/30 bg-warning/10 text-warning", // medium = amber warning tone.
};

// Small status dot color per severity, shown beside the label.
const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-destructive", // red dot for critical.
  high: "bg-destructive", // red dot for high.
  low: "bg-success", // green dot for low.
  medium: "bg-warning", // amber dot for medium.
};

// Human-readable severity names used as the badge text.
const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  low: "Low",
  medium: "Medium",
};

// SeverityBadge: pill that expresses an exception's urgency via color, dot, and label.
export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  const label = SEVERITY_LABELS[severity]; // display text comes from the label map.
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-[11px] tracking-wide",
        SEVERITY_STYLES[severity],
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", SEVERITY_DOT[severity])}
      />
      {label}
    </span>
  );
}

// Maps every machine-readable exception type to its human-friendly label.
const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  balance_error: "Balance error", // outstanding/current balance mismatch.
  conflicting_source: "Conflicting source", // two sources disagree on a field.
  date_error: "Date error", // malformed, out-of-range, or contradictory date.
  duplicate: "Duplicate", // same record found more than once across files.
  invalid_state: "Invalid state", // field value outside its allowed domain.
  missing_field: "Missing field", // required column absent or empty.
  rate_out_of_range: "Rate out of range", // interest rate outside accepted bounds.
  stale_record: "Stale record", // source data older than the current record.
  status_inconsistency: "Status inconsistency", // payment/document statuses contradict.
};

// ExceptionTypeBadge: neutral, non-colorful tag naming the exception type.
export function ExceptionTypeBadge({ type }: { type: ExceptionType }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-muted-foreground text-xs">
      {EXCEPTION_TYPE_LABELS[type]}
    </span>
  );
}

// exceptionTypeLabel: utility for rendering a type's label anywhere, falling back to the raw key.
export function exceptionTypeLabel(type: ExceptionType): string {
  return EXCEPTION_TYPE_LABELS[type] ?? type; // unknown/added keys still render safely.
}

// Reviewer workflow colors: resolution states are green, open review is amber, rejected is red.
const EXCEPTION_STATUS_STYLES: Record<ExceptionStatus, string> = {
  approved: "border-success/30 bg-success/8 text-success", // approved = closed, green.
  corrected: "border-primary/30 bg-primary/8 text-primary", // corrected via edit = primary blue.
  open: "border-warning/30 bg-warning/10 text-warning", // awaiting review = amber.
  rejected: "border-destructive/25 bg-destructive/8 text-destructive", // dismissed = red.
};

// ExceptionStatusBadge: reviewer lifecycle state shown in exception tables and lists.
export function ExceptionStatusBadge({ status }: { status: ExceptionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-[11px] capitalize tracking-wide",
        EXCEPTION_STATUS_STYLES[status]
      )}
    >
      {status}
    </span>
  );
}

// Upload pipeline colors: terminal success green, failure red, active/queued neutral-to-blue.
const BATCH_STATUS_STYLES: Record<BatchStatus, string> = {
  done: "border-success/30 bg-success/8 text-success", // finished OK = green.
  failed: "border-destructive/25 bg-destructive/8 text-destructive", // stopped early = red.
  pending: "border-border bg-muted text-muted-foreground", // not started = muted gray.
  processing: "border-primary/30 bg-primary/8 text-primary", // ingesting now = primary blue.
};

// BatchStatusBadge: state of a file upload/import batch.
export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-[11px] capitalize tracking-wide",
        BATCH_STATUS_STYLES[status]
      )}
    >
      {status}
    </span>
  );
}

// Per-loan validation colors, mirroring the severity palette for consistency.
const VALIDATION_STATUS_STYLES: Record<ValidationStatus, string> = {
  failed: "border-destructive/25 bg-destructive/8 text-destructive", // failed rules = red.
  passed: "border-success/30 bg-success/8 text-success", // all rules clean = green.
  pending: "border-border bg-muted text-muted-foreground", // validation not run = gray.
  review: "border-warning/30 bg-warning/10 text-warning", // flagged for review = amber.
};

// User-facing text for each validation state (failed reads "Exception" in the UI).
const VALIDATION_LABELS: Record<ValidationStatus, string> = {
  failed: "Exception",
  passed: "Valid",
  pending: "Pending",
  review: "In review",
};

// ValidationStatusBadge: shows a loan row's rule-check status with a matching dot.
export function ValidationStatusBadge({
  status,
}: {
  status: ValidationStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-[11px] tracking-wide",
        VALIDATION_STATUS_STYLES[status]
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          status === "failed" && "bg-destructive",
          status === "passed" && "bg-success",
          status === "pending" && "bg-muted-foreground/50",
          status === "review" && "bg-warning"
        )}
      />
      {VALIDATION_LABELS[status]}
    </span>
  );
}

// Final verified-record outcomes: clean pass vs. pass after human review.
const VALIDATION_RESULT_STYLES: Record<ValidationResult, string> = {
  passed: "border-success/30 bg-success/8 text-success", // clean = green.
  passed_with_review: "border-primary/30 bg-primary/8 text-primary", // reviewed = primary blue.
};

// Display text for the finalized outcome badges.
const VALIDATION_RESULT_LABELS: Record<ValidationResult, string> = {
  passed: "Passed",
  passed_with_review: "Reviewed & passed",
};

// ValidationResultBadge: labels a finalized verified loan record as clean or reviewed/passed.
export function ValidationResultBadge({
  result,
}: {
  result: ValidationResult;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-[11px] tracking-wide",
        VALIDATION_RESULT_STYLES[result]
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          result === "passed" ? "bg-success" : "bg-primary"
        )}
      />
      {VALIDATION_RESULT_LABELS[result]}
    </span>
  );
}
