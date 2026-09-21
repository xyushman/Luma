// Shared API types for upload batches, exceptions, and loan list rows
import type { ExceptionType, LoanListItem, UploadBatch } from "@repo/types";
// Router hook for navigating to import/loan detail routes
import { useNavigate } from "react-router-dom";
// KPI card/row components for the summary strip
import { KpiCard, KpiStrip } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { TrendChart } from "@/components/dashboard/trend-chart";
// Badges for batch status plus human-readable exception labels
import { BatchStatusBadge, exceptionTypeLabel } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
// Data hooks: dashboard series for the chart, summary for KPIs, loan list, and uploads list
import { useDashboardSeries } from "@/hooks/use-dashboard-series";
import { useDashboardSummary } from "@/hooks/use-exceptions";
import { useLoanList } from "@/hooks/use-loans";
import { useUploads } from "@/hooks/use-uploads";

/* Spec §4.1 — Operator Dashboard (Module G). */

// Map internal file-type enums to friendly display labels
const FILE_TYPE_LABELS: Record<string, string> = {
  document_manifest: "Document manifest",
  loan_tape: "Loan tape",
  servicer_update: "Servicer update",
};

// formatWhen: renders a timestamp compactly (e.g. "Sep 21, 14:32") for batch tables
function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

// RecentUploads: card listing the last 5 ingested batches; rows deep-link to the batch detail page
function RecentUploads() {
  // Used to navigate to the full import history or a batch's detail page
  const navigate = useNavigate();
  // Fetch paginated uploads; only the first 5 are shown here
  const { data, isLoading } = useUploads();
  const batches = (data?.data ?? []).slice(0, 5);

  // renderBody: picks skeleton, empty, or populated content based on fetch state
  function renderBody() {
    if (isLoading) {
      // Show placeholder bars while the uploads request is pending
      return (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((row) => (
            <Skeleton className="h-9 w-full" key={row} />
          ))}
        </div>
      );
    }
    if (batches.length === 0) {
      // Fresh workspace: a friendly nudge to perform the first upload
      return (
        <div className="flex h-full min-h-[280px] items-center justify-center p-5">
          <p className="text-center text-[13px] text-muted-foreground">
            No uploads yet — send your first loan tape.
          </p>
        </div>
      );
    }
    // Otherwise render the clickable batch rows
    return <UploadRows batches={batches} />;
  }

  return (
    <section className="flex h-[380px] min-h-[360px] flex-col rounded-2xl border border-border bg-card">
      <header className="flex shrink-0 items-center justify-between border-border border-b px-5 py-4">
        <div>
          <h3 className="font-semibold text-[14px] tracking-tight">
            Recent uploads
          </h3>
          <p className="text-[12px] text-muted-foreground">
            Last 5 ingested files
          </p>
        </div>
        <Button
          onClick={() => navigate("/operator/imports")}
          size="sm"
          variant="ghost"
        >
          Import history
          <i aria-hidden="true" className="ri-arrow-right-s-line" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{renderBody()}</div>
    </section>
  );
}

// UploadRows: clickable list rows for a set of batches, each navigating to its batch detail
function UploadRows({ batches }: { batches: UploadBatch[] }) {
  const navigate = useNavigate();

  // Safety: nothing to render if the caller passes no batches
  if (batches.length === 0) {
    return null;
  }

  return (
    <ul className="divide-y divide-border">
      {batches.map((batch) => (
        <li key={batch.id}>
          {/* Whole row is a button; clicking opens /operator/uploads/:batchId */}
          <button
            className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/50"
            onClick={() => navigate(`/operator/uploads/${batch.id}`)}
            type="button"
          >
            <i
              aria-hidden="true"
              className="ri-file-3-line text-base text-muted-foreground"
            />
            <span className="min-w-0 flex-1">
              {/* Truncated filename plus file type, row count, and upload time */}
              <span className="block truncate font-medium text-[13px]">
                {batch.fileName}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                {FILE_TYPE_LABELS[batch.fileType] ?? batch.fileType} ·{" "}
                {batch.recordCount.toLocaleString()} rows ·{" "}
                {formatWhen(batch.createdAt)}
              </span>
            </span>
            {/* Color-coded status pill (processing/done/failed) */}
            <BatchStatusBadge status={batch.status as never} />
            {/* Arrow nudges right on hover to hint this row is clickable */}
            <i
              aria-hidden="true"
              className="ri-arrow-right-s-line text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

// CorrectionsNeeded: operator-view of failed imports + validation-failed loans (ingestion, not the reviewer queue)
function CorrectionsNeeded() {
  const navigate = useNavigate();
  // Spec §4.1 / problem.md Module A & G: operator corrections = failed-import rows (ingestion),
  // not reviewer exception queue (Module C). Both endpoints are operator-allowed:
  // GET /api/uploads (failedCount) and GET /api/loans?validationStatus=failed (read-only).
  const {
    data: uploadsData,
    error: uploadsError,
    isLoading: uploadsLoading,
  } = useUploads();
  // Fetch the most recent validation-failed loans for the "inspection" list below
  const {
    data: loansData,
    error: loansError,
    isLoading: loansLoading,
  } = useLoanList({ limit: 6, page: 1, validationStatus: "failed" });

  // Combine loading flags and error state from both queries
  const isLoading = uploadsLoading || loansLoading;
  const hasError = Boolean(uploadsError || loansError);
  // Batches that actually have failed rows, capped at 4 for brevity
  const failedBatches = (uploadsData?.data ?? [])
    .filter((b) => b.failedCount > 0)
    .slice(0, 4);
  const failedLoans = (loansData?.data ?? []).slice(0, 6);
  // Both lists empty means nothing actionable to show
  const isEmpty = failedBatches.length === 0 && failedLoans.length === 0;

  // renderBody: skeleton / error / empty / populated content for the card
  function renderBody() {
    if (isLoading) {
      // Skeleton bars during the parallel requests
      return (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((row) => (
            <Skeleton className="h-9 w-full" key={row} />
          ))}
        </div>
      );
    }
    if (hasError) {
      // Prefer whichever query failed; fall back to a generic message
      const msg =
        (uploadsError as Error | undefined)?.message ??
        (loansError as Error | undefined)?.message ??
        "Failed to load corrections";
      return (
        <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-5 py-6 text-center">
          <p className="text-[13px] text-destructive">{msg}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Check import history or retry.
          </p>
        </div>
      );
    }
    if (isEmpty) {
      // Nothing to fix: healthy pipeline state message
      return (
        <div className="flex h-full min-h-[280px] items-center justify-center p-5">
          <p className="text-center text-[13px] text-muted-foreground">
            All clear — no failed imports or validation issues. Upload a new
            file to see corrections here.
          </p>
        </div>
      );
    }
    return (
      // Two stacked sub-lists: failed batch imports then validation-failed loans
      <div className="divide-y divide-border">
        {failedBatches.length > 0 && (
          <div>
            <p className="px-5 pt-3 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              Failed imports · {failedBatches.length} file
              {failedBatches.length > 1 ? "s" : ""} need re-upload
            </p>
            <ul className="divide-y divide-border">
              {failedBatches.map((batch) => (
                <FailedImportRow batch={batch} key={batch.id} />
              ))}
            </ul>
          </div>
        )}
        {failedLoans.length > 0 && (
          <div>
            <p className="px-5 pt-3 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              Validation failures ·{" "}
              {loansData?.pagination.total ?? failedLoans.length} loans need
              inspection
            </p>
            <ul className="divide-y divide-border">
              {failedLoans.map((loan) => (
                <FailedLoanRow key={loan.id} loan={loan} />
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="flex h-[380px] min-h-[360px] flex-col rounded-2xl border border-border bg-card">
      <header className="flex shrink-0 items-center justify-between border-border border-b px-5 py-4">
        <div>
          <h3 className="font-semibold text-[14px] tracking-tight">
            Corrections needed
          </h3>
          <p className="text-[12px] text-muted-foreground">
            Failed imports awaiting re-upload · validation failures for
            inspection
          </p>
        </div>
        {/* Quick links into the two relevant lists */}
        <div className="flex items-center gap-1">
          <Button
            onClick={() => navigate("/operator/imports")}
            size="sm"
            variant="ghost"
          >
            Imports
            <i aria-hidden="true" className="ri-history-line" />
          </Button>
          <Button
            onClick={() => navigate("/operator/loans")}
            size="sm"
            variant="ghost"
          >
            Loans
            <i aria-hidden="true" className="ri-arrow-right-s-line" />
          </Button>
        </div>
      </header>
      {/* Scrollable sub-list body */}
      <div className="min-h-0 flex-1 overflow-y-auto">{renderBody()}</div>
    </section>
  );
}

// FailedImportRow: a single batch that failed ingestion, opening its batch detail on click
function FailedImportRow({ batch }: { batch: UploadBatch }) {
  const navigate = useNavigate();
  return (
    <li>
      <button
        className="group flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-accent/50"
        onClick={() => navigate(`/operator/uploads/${batch.id}`)}
        type="button"
      >
        {/* Amber warning icon signals the import problem */}
        <i
          aria-hidden="true"
          className="ri-file-warning-line shrink-0 text-[15px] text-amber-600"
        />
        <span className="min-w-0 flex-1">
          {/* File name with failed-row count and timestamp below */}
          <span className="block truncate font-medium text-[13px]">
            {batch.fileName}
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            {FILE_TYPE_LABELS[batch.fileType] ?? batch.fileType} ·{" "}
            {batch.failedCount.toLocaleString()} rows failed ·{" "}
            {formatWhen(batch.createdAt)}
          </span>
        </span>
        <BatchStatusBadge status={batch.status as never} />
        {/* Hover-shifting arrow indicates the row navigates somewhere */}
        <i
          aria-hidden="true"
          className="ri-arrow-right-s-line shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </li>
  );
}

// FailedLoanRow: a validation-failed loan row; clicking jumps to the loan list pre-searched for that loan
function FailedLoanRow({ loan }: { loan: LoanListItem }) {
  const navigate = useNavigate();
  return (
    <li>
      <button
        className="group flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-accent/50"
        onClick={() =>
          // Pre-fill the loans page search with this loan ID so the row is easy to find
          navigate(
            `/operator/loans?search=${encodeURIComponent(loan.loanId ?? loan.id)}`
          )
        }
        type="button"
      >
        {/* Loan identifier, truncated to a fixed width */}
        <span className="w-[110px] shrink-0 truncate font-mono text-[12px]">
          {loan.loanId ?? loan.id}
        </span>
        {/* Status, exception count, and the source file that produced this loan */}
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
          {loan.validationStatus === "failed"
            ? "Validation failed"
            : loan.validationStatus}{" "}
          · {loan.exceptionCount} issue{loan.exceptionCount === 1 ? "" : "s"} ·{" "}
          {loan.sourceBatch.fileName}
        </span>
        {/* Magnifier icon hints "inspect this loan" */}
        <i
          aria-hidden="true"
          className="ri-search-eye-line shrink-0 text-muted-foreground/60"
        />
      </button>
    </li>
  );
}

// ValidationSummaryChart: 14-day exception trend rendered from the dashboard series hook
function ValidationSummaryChart() {
  // Aggregate exception counts by type for the KPI/summary computations
  const { data: summary } = useDashboardSummary();
  // Upload batches feed the series builder
  const { data: uploads } = useUploads();
  // Derive a time series (exceptions per day) once we have batches + summary
  const { exceptionSeries } = useDashboardSeries({
    batches: uploads?.data,
    summary,
  });

  return (
    <section className="flex h-full min-h-[340px] flex-col rounded-xl bg-transparent py-5 pr-4">
      <header className="mb-3 flex shrink-0 items-start justify-between">
        <div>
          <h3 className="font-semibold text-xl tracking-tight">
            Validation summary
          </h3>
          <p className="text-[12px] text-muted-foreground">
            Exception activity across the last 14 days
          </p>
        </div>
        {/* Legend chip for the chart color */}
        <span className="flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-[var(--chart-1)]"
          />
          Exceptions
        </span>
      </header>
      <div className="min-h-0 flex-1">
        {/* Recharts line/area chart bound to the exception series */}
        <TrendChart
          className="aspect-auto h-[260px] w-full"
          data={exceptionSeries}
          dataKey="exceptions"
          height={260}
        />
      </div>
    </section>
  );
}

// IssuesByType: sorted horizontal bars showing where validation exceptions concentrate
function IssuesByType() {
  const { data: summary } = useDashboardSummary();
  // Flatten the exceptionsByType record into an array of [type, count] tuples
  const byType = Object.entries(summary?.exceptionsByType ?? {}) as [
    ExceptionType,
    number,
  ][];
  // Largest count drives the relative bar widths (min 1 avoids divide-by-zero)
  const max = Math.max(1, ...byType.map(([, count]) => count));
  // Keep only nonzero types, sorted most-frequent first for readability
  const top = byType
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <section className="flex h-full min-h-[340px] flex-col rounded-2xl border border-border bg-card p-5">
      <header className="mb-3 shrink-0">
        <h3 className="font-semibold text-xl tracking-tight">Issues by type</h3>
        <p className="text-[12px] text-muted-foreground">
          Where validation effort is going
        </p>
      </header>
      {top.length === 0 ? (
        // No exceptions recorded yet: show an empty-state message
        <div className="flex flex-1 items-center justify-center py-6">
          <p className="text-[13px] text-muted-foreground">
            No issues recorded yet.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <ul className="space-y-2.5">
            {top.map(([type, count]) => (
              <li className="flex items-center gap-3" key={type}>
                {/* Human-readable exception type name (tooltip rescues truncation) */}
                <span
                  className="w-36 shrink-0 truncate text-[12.5px] text-muted-foreground"
                  title={exceptionTypeLabel(type)}
                >
                  {exceptionTypeLabel(type)}
                </span>
                {/* Track behind the filled proportion bar */}
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  {/* Filled segment width is proportional to count/max; env-safe var for the chart color */}
                  <span
                    className="block h-full rounded-full bg-[var(--chart-1)]"
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </span>
                {/* Raw count at the end of each bar */}
                <span className="w-8 text-right font-medium text-[12.5px] tabular-nums">
                  {count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// OperatorDashboard: the Module G landing page aggregating KPIs, charts, uploads, and corrections
export default function OperatorDashboard() {
  const navigate = useNavigate();
  // Summary powers the KPI strip (totals, open exceptions, batches)
  const { data: summary, isLoading } = useDashboardSummary();
  // Uploads feed the "rows failed import" KPI's rollup
  const { data: uploads } = useUploads();
  const overview = summary?.overview;
  // Operator-visible number of open exceptions (global review queue health)
  const openExceptions = overview?.openExceptions ?? 0;
  // Sum of failed rows across all batches, or null when there are no uploads yet
  const rowsFailed =
    (uploads?.data ?? []).reduce((acc, batch) => acc + batch.failedCount, 0) ||
    null;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <PageHeader
        action={
          // Primary CTA into the Module A upload flow
          <Button
            className="rounded-full"
            onClick={() => navigate("/operator/upload")}
          >
            <i aria-hidden="true" className="ri-upload-cloud-2-line" />
            Upload New File
          </Button>
        }
        description="Ingest loan tapes and track validation health."
        title="Dashboard"
      />

      {/* KPI strip: ingestion totals, upload counts, failures, and corrections health */}
      <KpiStrip>
        <KpiCard
          icon="ri-inbox-archive-line"
          label="Records ingested"
          loading={isLoading}
          trend="up"
          trendLabel="records"
          trendValue="12.4%"
          value={overview ? overview.totalLoansImported.toLocaleString() : "—"}
        />
        <KpiCard
          icon="ri-folder-upload-line"
          label="Files uploaded"
          loading={isLoading}
          trend="up"
          trendLabel="files"
          trendValue="2"
          value={overview ? overview.totalBatches.toLocaleString() : "—"}
        />
        <KpiCard
          icon="ri-file-damage-line"
          inverse={true}
          label="Rows failed import"
          loading={isLoading}
          trend={rowsFailed && rowsFailed > 0 ? "down" : "neutral"}
          trendLabel="rows"
          trendValue={rowsFailed && rowsFailed > 0 ? "3" : "0"}
          value={rowsFailed === null ? "—" : rowsFailed.toLocaleString()}
        />
        {/* Corrections needed KPI stays as global openExceptions (reviewer queue health) per Module G:
            operator widget below shows operator-actionable failed imports + failed loans (Module A).
            Keeping KPI as openExceptions preserves cross-role visibility via GET /api/summary (operator-allowed). */}
        <KpiCard
          delta={openExceptions > 0 ? "Needs correction" : "All clear"}
          deltaTone={openExceptions > 0 ? "negative" : "positive"}
          icon="ri-error-warning-line"
          inverse={true}
          label="Corrections needed"
          loading={isLoading}
          trend={openExceptions > 0 ? "down" : "up"}
          trendLabel="exceptions"
          trendValue={openExceptions > 0 ? "4" : "0"}
          value={overview ? openExceptions.toLocaleString() : "—"}
        />
      </KpiStrip>

      {/* Charts row: trend chart (3 cols) beside issues-by-type bars (2 cols) */}
      <div className="grid items-stretch gap-4 lg:grid-cols-5">
        <div className="flex flex-col lg:col-span-3">
          <ValidationSummaryChart />
        </div>
        <div className="flex flex-col lg:col-span-2">
          <IssuesByType />
        </div>
      </div>

      {/* Lists row: recent uploads next to corrections needed */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <RecentUploads />
        <CorrectionsNeeded />
      </div>
    </div>
  );
}
