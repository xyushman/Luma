// Imports: AI recommendation type, routing, and the consumer dossier/UI building blocks.
import type { AiRecommendation } from "@repo/types";
import { Link, useParams } from "react-router-dom";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { VerificationStatus } from "@/components/loan/verification-status";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useVerifiedLoanDetail } from "@/hooks/use-verified-loans";

// Friendly display labels for the canonical fields shown in the dossier's data card.
const FIELD_LABELS: Record<string, string> = {
  borrowerId: "Borrower ID",
  borrowerState: "Borrower State",
  creditGrade: "Credit Grade",
  currentBalance: "Current Balance",
  daysPastDue: "Days Past Due",
  documentStatus: "Document Status",
  employmentLength: "Employment Length",
  incomeBand: "Income Band",
  interestRate: "Interest Rate",
  lastPaymentDate: "Last Payment Date",
  loanId: "Loan ID",
  loanPurpose: "Loan Purpose",
  loanType: "Loan Type",
  maturityDate: "Maturity Date",
  originalPrincipal: "Original Principal",
  originationDate: "Origination Date",
  paymentStatus: "Payment Status",
  servicerName: "Servicer Name",
  sourceSystem: "Source System",
  termMonths: "Term (Months)",
};

// Formats canonical field values for display: currency for balances, percent for rate, dash for empty.
function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (key === "currentBalance" || key === "originalPrincipal") {
    // Money fields render with two decimals and US locale thousands separators.
    const num = Number(value);
    return Number.isFinite(num)
      ? `$${num.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
      : String(value);
  }
  if (key === "interestRate") {
    return `${value}%`;
  }
  return String(value);
}

// Purpose: card showing the original AI recommendation that preceded the reviewer's decision.
function AiRecommendationUsedCard({
  aiDecision,
  recommendation,
}: {
  aiDecision?: "accepted" | "edited" | "rejected" | null;
  recommendation: AiRecommendation;
}) {
  return (
    // Card with a primary-tinted border to highlight the AI provenance section.
    <Card className="rounded-xl border-primary/20">
      {/* Card header with a sparkle icon and title. */}
      <CardHeader>
        {/* Title row: sparkle icon plus "AI Recommendation Used" heading. */}
        <CardTitle className="flex items-center gap-2">
          {/* Sparkle icon marking this as an AI-produced artifact. */}
          <i aria-hidden="true" className="ri-sparkling-2-line text-primary" />
          AI Recommendation Used
        </CardTitle>
        {/* Subtitle clarifying the suggestion is recorded separately from its outcome. */}
        <CardDescription className="text-muted-foreground">
          Original suggestion — outcome recorded separately
        </CardDescription>
      </CardHeader>
      {/* Body: natural-language suggestion, field diffs, and model provenance. */}
      <CardContent className="space-y-3">
        {/* Shows the AI's human-readable explanation when one exists. */}
        {recommendation.suggestion ? (
          <p className="text-[13px] text-foreground/90 leading-relaxed">
            {recommendation.suggestion}
          </p>
        ) : null}
        {/* Renders up to four suggested field changes as old-to-new pairs. */}
        {recommendation.fieldsToChange.length > 0 ? (
          <ul className="space-y-1.5">
            {recommendation.fieldsToChange.slice(0, 4).map((change) => (
              <li
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px]"
                key={`${change.field}-${change.suggestedValue}`}
              >
                {/* Row per suggested field change, keyed by field + target value. */}
                {/* Mono-styled field name being corrected. */}
                <span className="font-mono text-muted-foreground">
                  {change.field}
                </span>
                {/* Struck-through current value when one is known. */}
                {change.currentValue ? (
                  <span className="text-destructive line-through">
                    {change.currentValue}
                  </span>
                ) : null}
                {/* Small arrow separating old value from suggested value. */}
                <i
                  aria-hidden="true"
                  className="ri-arrow-right-line text-[10px] text-muted-foreground"
                />
                {/* Suggested replacement value highlighted in success colour. */}
                <span className="font-medium text-success">
                  {change.suggestedValue}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {/* Footer row: model name, confidence, and the outcome badge (if known). */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-border border-t pt-3 text-[11px] text-muted-foreground">
          {/* Model that produced the recommendation (AI provenance). */}
          <span className="font-mono">{recommendation.model}</span>
          {/* Confidence percentage of the suggestion. */}
          <span>confidence {Math.round(recommendation.confidence * 100)}%</span>
          {/* Outcome badge (accepted/edited/rejected) when a reviewer decision exists. */}
          {aiDecision ? (
            <Badge
              variant={aiDecision === "rejected" ? "destructive" : "secondary"}
            >
              {aiDecision}
            </Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// Purpose: read-only verified-loan dossier — canonical data, record integrity, and reviewer decisions.
export default function ConsumerLoanDetailPage() {
  // Loan id from the route param (e.g. /consumer/loans/:id).
  const { id } = useParams<{ id: string }>();
  // Normalises the id so the fetch hook always receives a string.
  const loanId = id ?? "";
  // Loads the verified loan record; isLoading gates the skeleton screen.
  const { data: loan, isLoading } = useVerifiedLoanDetail(loanId);

  // Loading state: show skeletons matching the dossier layout until data arrives.
  if (isLoading) {
    return (
      // Skeleton layout mirroring the dossier's stacked cards.
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // Missing-record state: show a short not-found message.
  if (!loan) {
    return (
      // Simple centred not-found container.
      <div className="mx-auto max-w-5xl p-6">
        <p className="text-muted-foreground text-sm">Loan not found.</p>
      </div>
    );
  }

  // Only canonical fields with an actual value are rendered (null/undefined are omitted).
  const canonicalEntries = Object.entries(loan.canonicalData).filter(
    ([, value]) => value !== null && value !== undefined
  );

  return (
    // Page shell: a centred 5xl column with consistent vertical spacing.
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      {/* Header row: back link, loan id, and the verification status seal. */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Breadcrumb back-link into the consumer dashboard. */}
        <Link
          className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
          to="/consumer/dashboard"
        >
          {/* Back icon (decorative) for the dashboard link. */}
          <i aria-hidden="true" className="ri-arrow-left-line" />
          Back to records
        </Link>
        {/* Vertical divider separating breadcrumb from the title. */}
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        {/* Heading showing the verified loan id. */}
        <h1 className="font-semibold text-[28px] tracking-tight">
          {loan.loanId ?? "—"}
        </h1>
        {/* Seal pill showing record hash and verified date when the hash exists. */}
        <VerificationStatus
          verifiedRecord={
            loan.recordHash
              ? { recordHash: loan.recordHash, verifiedAt: loan.verifiedAt }
              : null
          }
        />
      </div>
      {/* Card listing every canonical (verified) field of the loan record. */}
      <Card className="rounded-xl border-border">
        {/* Card header with title and description of the source. */}
        <CardHeader>
          {/* Title of the canonical-data section. */}
          <CardTitle>Canonical Data</CardTitle>
          {/* Subtitle noting these values come from the verified source loan */}
          tape.
          <CardDescription className="text-muted-foreground">
            Verified field values from the source loan tape.
          </CardDescription>
        </CardHeader>
        {/* Two-column grid of label/value pairs. */}
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Maps each canonical entry to a label/value row. */}
            {canonicalEntries.map(([key, value]) => (
              // Bottom-border row; keyed by field name for stable rendering.
              <div
                className="flex items-baseline justify-between gap-2 border-border border-b pb-2"
                key={key}
              >
                {/* Muted field label (falls back to the raw key). */}
                <span className="text-muted-foreground text-xs">
                  {FIELD_LABELS[key] ?? key}
                </span>
                {/* Formatted field value, right-aligned for easy scanning. */}
                <span className="text-right font-medium text-[13px]">
                  {formatValue(key, value)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {/* Card presenting the record's cryptographic integrity metadata. */}
      <Card className="rounded-xl border-border">
        {/* Card header with just the section title. */}
        <CardHeader>
          <CardTitle>Record Integrity</CardTitle>
        </CardHeader>
        {/* Vertical stack of key/value integrity rows. */}
        <CardContent className="space-y-3">
          {/* Row: the SHA-256 record hash covering the canonical fingerprint. */}
          <div className="flex items-center justify-between">
            {/* Label for the record hash. */}
            <span className="text-muted-foreground text-xs">
              Record hash (SHA-256)
            </span>
            {/* Mono-styled hash, truncated so long hashes stay tidy. */}
            <span className="max-w-md truncate font-mono text-[12px] text-primary">
              {loan.recordHash}
            </span>
          </div>
          {/* Row: source batch reference that produced this record. */}
          <div className="flex items-center justify-between">
            {/* Label for the source batch. */}
            <span className="text-muted-foreground text-xs">Source batch</span>
            <span className="text-[13px]">{loan.sourceBatchRef}</span>
          </div>
          {/* Row: final validation result shown with spaces instead of */}
          underscores.
          <div className="flex items-center justify-between">
            {/* Label for the validation result. */}
            <span className="text-muted-foreground text-xs">
              Validation result
            </span>
            <span className="text-[13px] capitalize">
              {loan.validationResult.replaceAll("_", " ")}
            </span>
          </div>
          {/* Row: the timestamp when the record was verified/sealed. */}
          <div className="flex items-center justify-between">
            {/* Label for the verification timestamp. */}
            <span className="text-muted-foreground text-xs">Verified at</span>
            <span className="text-[13px]">
              {new Date(loan.verifiedAt).toLocaleString()}
            </span>
          </div>
          {/* Row: notes whether AI assistance was used during review. */}
          {loan.aiRecommendationUsed ? (
            <div className="flex items-center justify-between">
              {/* Label for the AI-assistance flag. */}
              <span className="text-muted-foreground text-xs">
                AI assistance
              </span>
              {/* Sparkle icon plus "Used" to signal AI involvement. */}
              <span className="flex items-center gap-1 text-[13px] text-primary">
                <i aria-hidden="true" className="ri-sparkling-2-line text-sm" />
                Used
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {/* Reviewer decision card rendered only when a decision or reviewer name */}
      exists.
      {loan.reviewerDecision || loan.verifiedByName ? (
        <Card className="rounded-xl border-border">
          {/* Card header with title and a note about human sign-off. */}
          <CardHeader>
            {/* Title of the reviewer-decision section. */}
            <CardTitle>Reviewer Decision</CardTitle>
            {/* Subtitle noting sign-off happened before verification. */}
            <CardDescription className="text-muted-foreground">
              Human sign-off recorded before verification
            </CardDescription>
          </CardHeader>
          {/* Vertical stack of decision details. */}
          <CardContent className="space-y-3">
            {/* Row: reviewer name who sealed the record. */}
            <div className="flex items-center justify-between">
              {/* Label for the reviewer name. */}
              <span className="text-muted-foreground text-xs">Reviewer</span>
              <span className="text-[13px]">
                {loan.verifiedByName ?? "Unknown"}
              </span>
            </div>
            {/* Row: the action taken (approved/rejected) when recorded. */}
            {loan.reviewerDecision ? (
              <div className="flex items-center justify-between">
                {/* Label for the decision action. */}
                <span className="text-muted-foreground text-xs">Action</span>
                {/* Capitalised action value with underscores as spaces. */}
                <span className="text-[13px] capitalize">
                  {loan.reviewerDecision.replaceAll("_", " ")}
                </span>
              </div>
            ) : null}
            {/* Note block shown when the reviewer left a written note. */}
            {loan.reviewerNote ? (
              <div>
                {/* Label for the reviewer note. */}
                <span className="text-muted-foreground text-xs">Note</span>
                {/* Boxed note text for readability. */}
                <p className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-foreground/90 leading-relaxed">
                  {loan.reviewerNote}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {/* Shows the original AI recommendation card when one was used during the */}
      review.
      {loan.aiRecommendationUsed && loan.aiRecommendation ? (
        <AiRecommendationUsedCard
          aiDecision={loan.aiDecision}
          recommendation={loan.aiRecommendation}
        />
      ) : null}
      {/* Footer banner with a link to the full audit trail for this record. */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-3.5">
        {/* Caption listing the event kinds covered by the audit trail. */}
        <p className="text-[13px] text-muted-foreground">
          Every event on this record — ingests, validations, decisions, exports.
        </p>
        {/* Link navigating to the full audit timeline for this loan. */}
        <Link
          className="flex items-center gap-1 font-medium text-[13px] text-primary underline-offset-4 hover:underline"
          to={`/consumer/audit/${loanId}`}
        >
          View Full Audit Trail{" "}
          {/* Trailing chevron glyph, decorative and hidden */}
          from screen readers.
          <i aria-hidden="true" className="ri-arrow-right-s-line" />
        </Link>
      </div>
      {/* Embedded append-only audit timeline for this loan. */}
      <AuditTimeline loanId={loanId} />
    </div>
  );
}
