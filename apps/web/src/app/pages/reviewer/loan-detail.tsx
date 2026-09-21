// Imports: AI/loan types, React hooks, routing, and the reviewer loan-workspace components.
import type { AiRecommendation, LoanExceptionItem } from "@repo/types";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { AiPanel } from "@/components/loan/ai-panel";
import { DiffViewer } from "@/components/loan/diff-viewer";
import { ExceptionList } from "@/components/loan/exception-list";
import { LoanFieldsPanel } from "@/components/loan/loan-fields-panel";
import { ReviewerActions } from "@/components/loan/reviewer-actions";
import { VerificationStatus } from "@/components/loan/verification-status";
import { ValidationStatusBadge } from "@/components/ui/badges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDraftNote } from "@/hooks/use-ai";
import { useLoan } from "@/hooks/use-loans";

// Purpose: full reviewer workspace for one loan — diff/AI panel, exception list, editable fields,
// approve/reject actions, and verification. conflictOpen blocks verification while conflicts are pending.
export default function LoanDetailPage() {
  // Loan id from the route param (e.g. /reviewer/loans/:id).
  const { id } = useParams<{ id: string }>();
  // Normalises the id so the fetch hook always receives a string.
  const loanId = id ?? "";
  // Loads the loan record and its exceptions; isLoading gates the skeleton screen.
  const { data: loan, isLoading } = useLoan(loanId);
  // Draft-note mutation that asks the AI to compose a reviewer note for an exception.
  const draftNote = useDraftNote();
  // Toggles the conflict diff viewer ("Compare conflicting records") open/closed.
  const [conflictOpen, setConflictOpen] = useState(false);
  // Draft note text that will become the audited reviewer note on approve/reject.
  const [note, setNote] = useState("");
  // Tracks the last decision outcome to surface it in the AI panel and actions.
  const [decisionState, setDecisionState] = useState<
    "accepted" | "rejected" | "edited" | null
  >(null);
  // Holds the corrected field value when the reviewer accepts or edits an AI suggestion.
  const [stagedValue, setStagedValue] = useState<string>("");

  // Memoised list of exceptions so recomputes only happen when the loan changes.
  const exceptions = useMemo<LoanExceptionItem[]>(
    () => loan?.exceptions ?? [],
    [loan]
  );
  // Tracks which exception is currently being reviewed in the panel.
  const [activeExceptionId, setActiveExceptionId] = useState<string | null>(
    null
  );

  // Auto-selects the first exception when none is active yet, so a reviewer always lands on something.
  useEffect(() => {
    if (!activeExceptionId && exceptions.length) {
      setActiveExceptionId(exceptions[0]?.id ?? null);
    }
  }, [exceptions, activeExceptionId]);

  // Switching exceptions resets decision state and any staged correction value.
  const handleSelectException = (selectedExceptionId: string | null) => {
    setActiveExceptionId(selectedExceptionId);
    setDecisionState(null);
    setStagedValue("");
  };

  // Resolves the currently selected exception object from the list.
  const activeException = exceptions.find(
    (item) => item.id === activeExceptionId
  );
  // True when every exception has been actioned (nothing left open on this loan).
  const allResolved = exceptions.every((item) => item.status !== "open");
  // Only conflicting_source exceptions count as "conflicts" for the verification gate.
  const conflicts = exceptions.filter(
    (item) => item.exceptionType === "conflicting_source"
  );

  // Asks the AI to draft a note for an exception and populates the note field on success.
  const handleNoteDraft = (exceptionId: string | null) => {
    if (!exceptionId) {
      return;
    }
    draftNote.mutate(exceptionId, {
      onSuccess: (result) => {
        if (result.note) {
          setNote(result.note);
        }
      },
    });
  };

  // Loading / no-data state: render skeletons matching the page layout until the loan arrives.
  if (isLoading || !loan) {
    return (
      // Skeleton layout mirrors the two-column workspace for visual continuity.
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        {/* Skeleton placeholder for the page heading. */}
        <Skeleton className="h-8 w-64" />
        {/* Two-column skeleton grid: fields panel left, exceptions card right. */}
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  return (
    // Main workspace container with consistent spacing.
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      {/* Header row: back link, loan/borrower ids, validation status, and */}
      verification seal.
      <div className="flex flex-wrap items-center gap-3">
        {/* Breadcrumb back-link into the exceptions queue. */}
        <Link
          className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
          to="/reviewer/exceptions"
        >
          {/* Back icon (decorative) for the queue link. */}
          <i aria-hidden="true" className="ri-arrow-left-line" />
          Back to queue
        </Link>
        {/* Vertical divider separating breadcrumb from the title. */}
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        {/* Heading showing the loan id with the borrower id alongside. */}
        <h1 className="font-semibold text-[28px] tracking-tight">
          Loan {loan.loanId ?? "—"}
          <span className="ml-2 font-normal text-base text-muted-foreground/60">
            ({loan.borrowerId ?? "—"})
          </span>
        </h1>
        {/* Badge showing the loan's validation status (passed/failed/completed). */}
        <ValidationStatusBadge status={loan.validationStatus} />
        {/* Seal indicator when a VerifiedLoan record already exists for this */}
        loan.
        <VerificationStatus verifiedRecord={loan.verifiedRecord} />
      </div>
      {/* Two-column workspace: editable canonical fields on the left, review */}
      card on the right.
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_400px]">
        {/* Left panel: whitelisted canonical fields the reviewer is allowed to */}
        edit.
        <LoanFieldsPanel loan={loan} />
        {/* Right column container that keeps the exceptions card at a stable */}
        height.
        <div className="relative min-h-[440px] lg:h-full lg:min-h-0">
          {/* Sticky card wrapper so inner content is fully scrollable on */}
          desktop.
          <div className="flex flex-col lg:absolute lg:inset-0">
            {/* Exceptions review card with header, list, and action controls. */}
            <Card className="flex h-full flex-col rounded-[24px] border border-border bg-card shadow-sm">
              {/* Card header framing the exception review workflow. */}
              <CardHeader className="shrink-0 border-border/50 border-b pb-3">
                {/* Title showing how many exceptions match on this loan. */}
                <CardTitle>Exceptions ({exceptions.length})</CardTitle>
                {/* Description explaining that selection drives the review */}
                actions below.
                <CardDescription className="text-muted-foreground">
                  Select an exception to review and act on it.
                </CardDescription>
              </CardHeader>
              {/* Scrollable card body holding the exception list and active */}
              review tools.
              <CardContent className="flex-1 space-y-4 overflow-y-auto p-4">
                {/* Clickable list of all exceptions; active one drives the */}
                panels below.
                <ExceptionList
                  activeId={activeExceptionId}
                  exceptions={exceptions}
                  onSelect={handleSelectException}
                />
                {/* Only render the review workflow when an exception has been */}
                selected.
                {activeException ? (
                  // Fragment grouping diff viewer, AI panel, and reviewer actions.
                  <>
                    {/* Conflict expander only matters for conflicting_source */}
                    exceptions.
                    {conflicts.length > 0 &&
                    activeException.exceptionType === "conflicting_source" ? (
                      // Wraps the collapsible conflict comparison.
                      <div className="space-y-2">
                        {/* Toggle button that opens/closes the side-by-side */}
                        conflict diff.
                        <button
                          aria-expanded={conflictOpen}
                          className="flex w-full items-center justify-between rounded-lg border border-primary/30 bg-primary/[0.05] px-3.5 py-2.5 text-left transition-colors hover:bg-primary/10"
                          onClick={() => setConflictOpen(!conflictOpen)}
                          type="button"
                        >
                          {/* Label row with an icon and the expander title. */}
                          <span className="flex items-center gap-2">
                            {/* Split-cell icon indicating a multi-source */}
                            comparison.
                            <i
                              aria-hidden="true"
                              className="ri-split-cells-vertical text-[15px] text-primary"
                            />
                            {/* Text label for the conflict comparison toggle. */}
                            <span className="font-medium text-[13px]">
                              Compare conflicting records
                            </span>
                          </span>
                          {/* Chevron that rotates 180 degrees when the diff is */}
                          open.
                          <i
                            aria-hidden="true"
                            className={`ri-arrow-down-s-line text-muted-foreground transition-transform ${conflictOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                        {/* Render the source-vs-target field diff only when */}
                        expanded.
                        {conflictOpen ? (
                          // Field-by-field diff between servicer records plus the AI recommendation.
                          <DiffViewer
                            exception={activeException}
                            recommendation={
                              (activeException.aiRecommendation as AiRecommendation | null) ??
                              null
                            }
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {/* AI panel with "Why it matters / What to fix" explanation */}
                    and provenance.
                    <AiPanel
                      decisionState={decisionState}
                      exception={activeException}
                      onDecision={(type, editedValue, recommendation) => {
                        setDecisionState(type);
                        if (type === "accepted" || type === "edited") {
                          const val =
                            editedValue ??
                            recommendation?.fieldsToChange?.[0]
                              ?.suggestedValue ??
                            "";
                          setStagedValue(val);
                          if (!note && recommendation) {
                            setNote(
                              `Approved with AI correction (${recommendation.model}): ${recommendation.reasoning}`
                            );
                          }
                        }
                      }}
                    />
                    {/* Approve/reject controls with confirm dialogs plus the */}
                    verify-once-all-resolved section.
                    <ReviewerActions
                      allResolved={allResolved}
                      decisionState={decisionState}
                      exceptionId={activeException.id}
                      exceptionStatus={activeException.status}
                      loanId={loan.id}
                      note={note}
                      onNoteChange={setNote}
                      onNoteDrafted={() => handleNoteDraft(activeException.id)}
                      requestingDraft={draftNote.isPending}
                      stagedValue={stagedValue}
                      verifiedRecord={loan.verifiedRecord}
                    />
                  </>
                ) : (
                  // Empty state when the loan has no open exceptions to review.
                  <p className="rounded-lg border border-success/25 bg-success/10 p-3 text-success text-xs">
                    No exceptions on this loan — it can be verified.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      {/* Full append-only audit timeline for this loan below the workspace. */}
      <AuditTimeline loanId={loan.id} />
    </div>
  );
}
