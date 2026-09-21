// Imports: shared domain types, router navigation, and reviewer dashboard components/hooks.
import type { Severity } from "@repo/types";
import { useNavigate } from "react-router-dom";
import { AiBatchSummary } from "@/components/dashboard/ai-batch-summary";
import { ExceptionQueuePreview } from "@/components/dashboard/exception-queue-preview";
import { KpiCard, KpiStrip } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { RecentDecisions } from "@/components/dashboard/recent-decisions";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { SeverityBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { useDashboardSeries } from "@/hooks/use-dashboard-series";
import { useDashboardSummary, useExceptions } from "@/hooks/use-exceptions";
import { useUploads } from "@/hooks/use-uploads";
import { cn } from "@/lib/utils";

/* Spec §5.1 — Reviewer Dashboard (Module G + Module D batch summary). */

// Fixes the display order of severities (critical first) for the queue-by-severity list.
const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  low: 3,
  medium: 2,
};

// Maps each severity to a Tailwind bar color so urgency is visually distinguishable in the preview.
const SEVERITY_BAR_COLOR: Record<Severity, string> = {
  critical: "bg-destructive",
  high: "bg-destructive/85",
  low: "bg-success",
  medium: "bg-warning",
};

// Local chart card: renders the 14-day exception trend for reviewer triage.
function ExceptionTrendChart() {
  // Pulls the aggregate dashboard summary used to derive per-day exception counts.
  const { data: summary } = useDashboardSummary();
  // Pulls recent ingestion batches so the trend aligns with actual upload runs.
  const { data: uploads } = useUploads();
  // Derives the time series (exceptions per day) from batches plus the summary.
  const { exceptionSeries } = useDashboardSeries({
    batches: uploads?.data,
    summary,
  });

  return (
    // Fixed-height card section so the trend chart fills the dashboard grid cell.
    <section className="flex h-full min-h-[340px] flex-col rounded-xl bg-transparent py-5 pr-4">
      {/* Header row with the chart title and an inline legend. */}
      <header className="mb-3 flex shrink-0 items-start justify-between">
        <div>
          {/* Chart title describing the trend widget. */}
          <h3 className="font-semibold text-xl tracking-tight">
            Exception trend
          </h3>
          {/* Subtitle clarifying the chart covers the last 14 days. */}
          <p className="text-[12px] text-muted-foreground">
            Exception activity across the last 14 days
          </p>
        </div>
        {/* Legend chip pairing the primary chart colour with the "Exceptions" */}
        label.
        <span className="flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground">
          {/* Purely decorative colour dot, marked aria-hidden for accessibility. */}
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-[var(--chart-1)]"
          />
          Exceptions
        </span>
      </header>
      {/* Flex-1 container giving the chart the remaining vertical space. */}
      <div className="min-h-0 flex-1">
        {/* Recharts line chart plotting per-day exception counts from the */}
        derived series.
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

// Local card: lists open-exception counts per severity; each row deep-links to the pre-filtered queue.
function IssuesBySeverity() {
  // Reads the dashboard summary that exposes exceptionsBySeverity counts.
  const { data: summary } = useDashboardSummary();
  // Router navigation for deep-linking into the exceptions page filtered by severity.
  const navigate = useNavigate();
  // Converts the severity-to-count object into an array of [severity, count] tuples for mapping.
  const rows = Object.entries(summary?.exceptionsBySeverity ?? {}) as [
    Severity,
    number,
  ][];
  // Uses the largest bucket as the bar denominator (floor of 1 guards against divide-by-zero).
  const max = Math.max(1, ...rows.map(([, count]) => count));
  // Sorts rows by the fixed SEVERITY_ORDER so critical always renders first.
  const sorted = rows.sort(
    (a, b) => SEVERITY_ORDER[a[0]] - SEVERITY_ORDER[b[0]]
  );
  // Totals all bucket counts to decide whether the queue is empty.
  const total = rows.reduce((sum, [, count]) => sum + count, 0);

  return (
    // Outer card section with fixed height for consistent dashboard layout.
    <section className="flex h-full min-h-[340px] flex-col rounded-2xl border border-border bg-card p-5">
      {/* Card header with a title and a hint to prioritise critical/high items. */}
      <header className="mb-3 shrink-0">
        {/* Title of the severity breakdown card. */}
        <h3 className="font-semibold text-xl tracking-tight">
          Queue by severity
        </h3>
        {/* Subtitle steering reviewers to the most urgent buckets first. */}
        <p className="text-[12px] text-muted-foreground">
          Work critical and high priority items first
        </p>
      </header>
      {/* Empty state: show a subtle message when there are no open exceptions. */}
      {total === 0 ? (
        // Centred empty-state content inside the card body.
        <div className="flex flex-1 items-center justify-center py-6">
          {/* Empty-queue messaging for the reviewer. */}
          <p className="text-[13px] text-muted-foreground">
            No exceptions in queue.
          </p>
        </div>
      ) : (
        // Scrollable list body so many severity buckets never overflow the card.
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {/* Renders one bar row per severity bucket. */}
          <ul className="space-y-3.5 pt-1">
            {sorted.map(([severity, count]) => (
              // Each row keyed by severity for stable reconciliation.
              <li key={severity}>
                {/* The whole row is a button that opens the queue pre-filtered */}
                by this severity.
                <button
                  className="group flex w-full items-center gap-3 text-left transition-opacity hover:opacity-80"
                  onClick={() =>
                    navigate(`/reviewer/exceptions?severity=${severity}`)
                  }
                  type="button"
                >
                  {/* Fixed-width label column showing the severity badge. */}
                  <div className="w-24 shrink-0">
                    <SeverityBadge severity={severity} />
                  </div>
                  {/* Track for the proportional severity bar. */}
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    {/* Bar width depicts how dominant this severity is relative */}
                    to the largest bucket.
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        SEVERITY_BAR_COLOR[severity]
                      )}
                      style={{ width: `${(count / max) * 100}%` }}
                    />
                  </span>
                  {/* Right-aligned exception count using tabular figures for */}
                  stable digits.
                  <span className="w-8 text-right font-medium text-[12.5px] tabular-nums">
                    {count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// Local card: previews the current top open exceptions (critical only) via a compact list.
function ExceptionQueueSection() {
  // Router navigation to jump to the full exceptions queue page.
  const navigate = useNavigate();
  // Pre-fetches the critical, open exceptions — the highest-priority slice of the reviewer queue.
  const { data: critical, isLoading } = useExceptions({
    batchId: "",
    page: 1,
    search: "",
    severity: "critical",
    status: "open",
    type: "",
  });

  return (
    // Outer card container with rounded border styling.
    <section className="rounded-2xl border border-border bg-card">
      {/* Card header row: title/subtitle on the left, "View queue" action on the */}
      right.
      <header className="flex items-center justify-between border-border border-b px-5 py-4">
        <div>
          {/* Title of the queue preview card. */}
          <h3 className="font-semibold text-[14px] tracking-tight">
            Exception queue
          </h3>
          {/* Subtitle describing that the most severe open items are shown. */}
          <p className="text-[12px] text-muted-foreground">
            Top open items ordered by severity
          </p>
        </div>
        {/* Ghost button that routes to the full exceptions workspace. */}
        <Button
          onClick={() => navigate("/reviewer/exceptions")}
          size="sm"
          variant="ghost"
        >
          View queue {/* Trailing chevron glyph, decorative and hidden from */}
          screen readers.
          <i aria-hidden="true" className="ri-arrow-right-s-line" />
        </Button>
      </header>
      {/* Renders the compact exception list, showing skeletons while critical */}
      items load.
      <ExceptionQueuePreview items={critical?.data} loading={isLoading} />
    </section>
  );
}

// Local card: shows audited reviewer actions (decisions and updates) from recent activity.
function RecentDecisionsSection() {
  // Router navigation to open the full audit trail page.
  const navigate = useNavigate();
  // Reads recentActivity from the dashboard summary feed.
  const { data: summary } = useDashboardSummary();

  return (
    // Outer card container with rounded border styling.
    <section className="rounded-2xl border border-border bg-card">
      {/* Card header row: title/subtitle on the left, "Audit trail" action on */}
      the right.
      <header className="flex items-center justify-between border-border border-b px-5 py-4">
        <div>
          {/* Title of the recent-decisions feed. */}
          <h3 className="font-semibold text-[14px] tracking-tight">
            Recent decisions
          </h3>
          {/* Subtitle noting these events are the audited reviewer actions and */}
          updates.
          <p className="text-[12px] text-muted-foreground">
            Audited reviewer actions and updates
          </p>
        </div>
        {/* Ghost button routing to the consumer audit trail viewer. */}
        <Button
          onClick={() => navigate("/consumer/audit")}
          size="sm"
          variant="ghost"
        >
          Audit trail {/* Trailing chevron glyph, decorative and hidden from */}
          screen readers.
          <i aria-hidden="true" className="ri-arrow-right-s-line" />
        </Button>
      </header>
      {/* Renders the latest audit activity events into the feed list. */}
      <RecentDecisions events={summary?.recentActivity} />
    </section>
  );
}

// Purpose: main reviewer dashboard combining summary KPIs, trend charts, and queue/decision feeds.
export default function ReviewerDashboard() {
  // Router navigation used by the header action buttons.
  const navigate = useNavigate();
  // Loads the aggregate summary: overview counts, quality score, and recent audited activity.
  const { data: summary, isLoading } = useDashboardSummary();
  // Loads every open exception across all severities to show the live pending-queue total.
  const { data: allOpen } = useExceptions({
    batchId: "",
    page: 1,
    search: "",
    severity: "",
    status: "open",
    type: "",
  });
  // Loads the ingestion batch list to spotlight the most recent AI batch summary.
  const { data: uploads } = useUploads();

  // Overview object from the summary, used to populate the four KPI cards.
  const overview = summary?.overview;
  // Open-exception count defaults to zero so the KPI never renders an empty dash.
  const openExceptions = overview?.openExceptions ?? 0;
  // High-severity workload = critical + high buckets, the items that should be triaged first.
  const highSeverity =
    (summary?.exceptionsBySeverity?.critical ?? 0) +
    (summary?.exceptionsBySeverity?.high ?? 0);
  // The most recent upload batch drives the AI batch summary banner.
  const latestBatch = uploads?.data?.[0];
  // Counts reviewer decisions from audit events that landed within the last 24 hours (86,400,000 ms).
  const reviewedToday = (summary?.recentActivity ?? []).filter((event) => {
    // Only loan-level outcomes count as "reviewed" for this KPI.
    const isDecision = [
      "LOAN_APPROVED",
      "LOAN_REJECTED",
      "FIELD_EDITED",
    ].includes(event.eventType);
    return (
      // Keep an event only if it is a decision and falls inside the rolling 24-hour window.
      isDecision &&
      Date.now() - new Date(event.timestamp).getTime() < 86_400_000
    );
  }).length;

  return (
    // Page shell: a centred 1200px column with consistent vertical spacing.
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      {/* Standard page header with an "Open Exception Queue" call-to-action */}
      button.
      <PageHeader
        action={
          // Pill button that jumps straight to the exceptions queue page.
          <Button
            className="rounded-full"
            onClick={() => navigate("/reviewer/exceptions")}
          >
            {/* Warning icon (decorative) paired with the call-to-action label. */}
            <i aria-hidden="true" className="ri-error-warning-line" />
            Open Exception Queue
          </Button>
        }
        description="Triage the exception queue and keep verified data flowing."
        title="Dashboard"
      />
      {/* Horizontal strip of four summary KPI cards. */}
      <KpiStrip>
        {/* KPI 1: total open exceptions; trend shows "down" while the queue is */}
        being worked.
        <KpiCard
          icon="ri-error-warning-line"
          inverse={true}
          label="Open exceptions"
          loading={isLoading}
          trend={openExceptions > 0 ? "down" : "up"}
          trendLabel="exceptions"
          trendValue={openExceptions > 0 ? `${openExceptions}` : "0"}
          value={overview ? openExceptions.toLocaleString() : "—"}
        />
        {/* KPI 2: critical + high exceptions that need immediate review */}
        attention.
        <KpiCard
          delta={highSeverity > 0 ? "Review immediately" : "None pending"}
          deltaTone={highSeverity > 0 ? "negative" : "positive"}
          icon="ri-alarm-warning-line"
          inverse={true}
          label="High-severity"
          loading={isLoading}
          trend={highSeverity > 0 ? "down" : "up"}
          trendLabel="critical"
          trendValue={highSeverity > 0 ? `${highSeverity}` : "0"}
          value={highSeverity.toLocaleString()}
        />
        {/* KPI 3: every open exception across severities — the reviewer's */}
        pending queue size.
        <KpiCard
          icon="ri-user-search-line"
          label="Pending my review"
          loading={isLoading}
          trend="neutral"
          trendLabel="queue"
          trendValue={
            allOpen
              ? `${allOpen.pagination?.total ?? allOpen.data.length}`
              : "0"
          }
          value={
            allOpen
              ? (
                  allOpen.pagination?.total ?? allOpen.data.length
                ).toLocaleString()
              : "—"
          }
        />
        {/* KPI 4: reviewer decisions made in the last 24 hours, sourced from */}
        audited events.
        <KpiCard
          delta={reviewedToday > 0 ? "Last 24 hours" : "No decisions yet"}
          deltaTone={reviewedToday > 0 ? "positive" : "neutral"}
          icon="ri-checkbox-multiple-line"
          label="Reviewed today"
          loading={isLoading}
          trend="up"
          trendLabel="decisions"
          trendValue={reviewedToday > 0 ? `${reviewedToday}` : "0"}
          value={reviewedToday.toLocaleString()}
        />
      </KpiStrip>
      {/* Conditional AI batch summary banner, only shown once an upload batch */}
      exists.
      {latestBatch ? (
        // Summarises the AI's batch-level findings for the most recent ingestion run.
        <AiBatchSummary
          batchId={latestBatch.id}
          fileName={latestBatch.fileName}
        />
      ) : null}
      {/* Two-column layout: trend chart spans ~3/5 width, severity breakdown */}
      ~2/5.
      <div className="grid items-stretch gap-4 lg:grid-cols-5">
        {/* Left cell holds the full-height exception trend chart. */}
        <div className="flex flex-col lg:col-span-3">
          <ExceptionTrendChart />
        </div>
        {/* Right cell holds the queue-by-severity list. */}
        <div className="flex flex-col lg:col-span-2">
          <IssuesBySeverity />
        </div>
      </div>
      {/* Bottom row pairs the queue preview with the recent-decision feed. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Card previewing critical open exceptions with a link to the full */}
        queue.
        <ExceptionQueueSection />
        {/* Card showing the audited recent reviewer activity. */}
        <RecentDecisionsSection />
      </div>
    </div>
  );
}
