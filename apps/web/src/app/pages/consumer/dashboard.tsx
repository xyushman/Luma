// Imports: verified-loan types, routing/navigation, and consumer dashboard components/hooks.
import type { VerifiedLoanListItem } from "@repo/types";
import { useNavigate } from "react-router-dom";
import { KpiCard, KpiStrip } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { QualityScoreGauge } from "@/components/dashboard/quality-gauge";
import { RecentDecisions } from "@/components/dashboard/recent-decisions";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { ValidationResultBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardSeries } from "@/hooks/use-dashboard-series";
import { useDashboardSummary } from "@/hooks/use-exceptions";
import { useUploads } from "@/hooks/use-uploads";
import { useVerifiedLoans } from "@/hooks/use-verified-loans";

/* Spec §6.1 — Data Consumer Dashboard (Module G). */

// Formats an ISO timestamp into a compact, locale-aware "day month HH:MM" string for lists.
function formatWhen(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

// Purpose: tappable shortcut card that routes the consumer to a key section (records, audit, export).
function QuickLink({
  href,
  icon,
  label,
  sub,
}: {
  href: string;
  icon: string;
  label: string;
  sub: string;
}) {
  // Router navigation used to jump to the linked section.
  const navigate = useNavigate();
  return (
    // Whole card is a button; hover states emphasise it as an interactive link.
    <button
      className="group flex flex-1 items-center gap-3.5 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:bg-accent/30"
      onClick={() => navigate(href)}
      type="button"
    >
      {/* Icon tile: rounded square holding the section's Remix icon. */}
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-xs"
      >
        {/* Rendered icon glyph passed in via the icon prop. */}
        <i className={`${icon} text-base`} />
      </span>
      {/* Text block: bold label plus a muted one-line subtitle. */}
      <span className="min-w-0 flex-1">
        {/* Link label, e.g. "Verified Records". */}
        <span className="block font-medium text-[13px]">{label}</span>
        {/* Truncated description of where the link leads. */}
        <span className="block truncate text-[11.5px] text-muted-foreground">
          {sub}
        </span>
      </span>
      {/* Trailing chevron that nudges right on hover, signalling navigation. */}
      <i
        aria-hidden="true"
        className="ri-arrow-right-s-line text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
}

// Purpose: history chart card showing ingestion and verification activity over the last 14 days.
function VerificationVolumeChart() {
  // Reads the aggregate dashboard summary used to build the volume series.
  const { data: summary } = useDashboardSummary();
  // Pulls recent upload batches so the series aligns with actual ingestion runs.
  const { data: uploads } = useUploads();
  // Derives the time series (ingested records per day) from batches plus the summary.
  const { volumeSeries } = useDashboardSeries({
    batches: uploads?.data,
    summary,
  });

  return (
    // Fixed-height card section so the chart fills the dashboard grid cell.
    <section className="flex h-full min-h-[340px] flex-col rounded-xl bg-transparent py-5 pr-4">
      {/* Header row with the chart title and an inline legend. */}
      <header className="mb-3 flex shrink-0 items-start justify-between">
        <div>
          {/* Chart title describing the widget. */}
          <h3 className="font-semibold text-xl tracking-tight">
            Verification volume
          </h3>
          {/* Subtitle clarifying the chart covers the last 14 days. */}
          <p className="text-[12px] text-muted-foreground">
            Ingestion and verification activity across the last 14 days
          </p>
        </div>
        {/* Legend chip pairing the primary chart colour with the "Records" */}
        label.
        <span className="flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground">
          {/* Purely decorative colour dot, marked aria-hidden for accessibility. */}
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-[var(--chart-1)]"
          />
          Records
        </span>
      </header>
      {/* Flex-1 container giving the chart the remaining vertical space. */}
      <div className="min-h-0 flex-1">
        {/* Recharts chart plotting the per-day ingested count from the derived */}
        series.
        <TrendChart
          className="aspect-auto h-[260px] w-full"
          data={volumeSeries}
          dataKey="ingested"
          height={260}
        />
      </div>
    </section>
  );
}

// Purpose: card presenting the overall data quality as a gauge plus fixed lineage stats.
function QualityHealthCard({
  qualityScore,
  totalVerified,
}: {
  qualityScore: number;
  totalVerified: number;
}) {
  return (
    // Fixed-height card so the gauge section lines up with the chart cell beside it.
    <section className="flex h-full min-h-[340px] flex-col rounded-2xl border border-border bg-card p-5">
      {/* Card header with title and a subtitle covering the metrics below. */}
      <header className="mb-3 shrink-0">
        {/* Title of the quality & lineage card. */}
        <h3 className="font-semibold text-xl tracking-tight">
          Quality & lineage
        </h3>
        {/* Subtitle explaining the card covers verification rate and integrity. */}
        <p className="text-[12px] text-muted-foreground">
          Verification rate and cryptographic integrity
        </p>
      </header>
      {/* Centred area holding the circular quality-score gauge. */}
      <div className="flex flex-1 flex-col items-center justify-center py-2">
        {/* Semicircular gauge rendering the score as a 150px visual. */}
        <QualityScoreGauge score={qualityScore} size={150} />
      </div>
      {/* Two stat tiles split across the bottom, divided by a top border. */}
      <div className="grid grid-cols-2 gap-2 border-border/80 border-t pt-3.5 text-center">
        {/* Left tile: number of records that passed validation. */}
        <div className="rounded-lg bg-muted/40 p-2">
          {/* Label for the passed-validation metric. */}
          <p className="text-[11px] text-muted-foreground">Passed validation</p>
          {/* Count of verified records with a thousands separator. */}
          <p className="font-semibold text-[14px] text-foreground tabular-nums">
            {totalVerified.toLocaleString()}
          </p>
        </div>
        {/* Right tile: fixed 100% because every verified record carries a */}
        SHA-256 seal.
        <div className="rounded-lg bg-muted/40 p-2">
          {/* Label for the integrity metric. */}
          <p className="text-[11px] text-muted-foreground">SHA-256 sealed</p>
          {/* Static 100% figure rendered green to convey full integrity. */}
          <p className="font-semibold text-[14px] text-success tabular-nums">
            100%
          </p>
        </div>
      </div>
    </section>
  );
}

// Purpose: card listing the five most recent verified records, each linking to its loan dossier.
function RecentVerifiedRecords({
  items,
  loading,
}: {
  items?: VerifiedLoanListItem[];
  loading?: boolean;
}) {
  // Router navigation to open an individual verified record.
  const navigate = useNavigate();
  // Only the newest five records are shown in this preview.
  const records = (items ?? []).slice(0, 5);

  // Renders one of: skeletons, empty message, or the record rows.
  function renderBody() {
    if (loading) {
      return (
        // Skeleton rows shown while the verified-loans request is in flight.
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((row) => (
            <Skeleton className="h-9 w-full" key={row} />
          ))}
        </div>
      );
    }
    if (records.length === 0) {
      return (
        // Centred empty message when no records are verified yet.
        <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
          No verified records yet.
        </p>
      );
    }
    return (
      // Divider-styled list of the newest verified records.
      <ul className="divide-y divide-border">
        {records.map((item) => (
          <li key={item.id}>
            {/* Each row is a button that opens the record's dossier. */}
            <button
              className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/50"
              onClick={() => navigate(`/consumer/loans/${item.id}`)}
              type="button"
            >
              {/* Green shield icon signalling a tamper-sealed record. */}
              <i
                aria-hidden="true"
                className="ri-shield-check-line text-base text-success"
              />
              {/* Mono loan id, truncated to fit the fixed-width column. */}
              <span className="w-[110px] shrink-0 truncate font-mono text-[12px]">
                {item.loan.loanId ?? item.loanId}
              </span>
              {/* Flexible cell showing borrower id and verification date. */}
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                {item.loan.borrowerId
                  ? `Borrower ${item.loan.borrowerId} · `
                  : ""}
                {formatWhen(item.verifiedAt)}
              </span>
              {/* Badge showing whether validation passed or failed. */}
              <ValidationResultBadge result={item.validationResult} />
              {/* Trailing chevron hinting the row navigates to the dossier. */}
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

  return (
    // Outer card container with a header and the body rendered by renderBody().
    <section className="rounded-2xl border border-border bg-card">
      {/* Card header row: title/subtitle on the left, "Verified records" action */}
      on the right.
      <header className="flex items-center justify-between border-border border-b px-5 py-4">
        <div>
          {/* Title of the recent-records preview. */}
          <h3 className="font-semibold text-[14px] tracking-tight">
            Recent verified records
          </h3>
          {/* Subtitle emphasising the SHA-256 hashes sealing each record. */}
          <p className="text-[12px] text-muted-foreground">
            Latest loans sealed with cryptographic hashes
          </p>
        </div>
        {/* Ghost button routing to the full verified-records list. */}
        <Button
          onClick={() => navigate("/consumer/verified")}
          size="sm"
          variant="ghost"
        >
          Verified records{" "}
          {/* Trailing chevron glyph, decorative and hidden from */}
          screen readers.
          <i aria-hidden="true" className="ri-arrow-right-s-line" />
        </Button>
      </header>
      {renderBody()}
    </section>
  );
}

// Purpose: card streaming the five latest audit events so consumers can watch lineage activity.
function RecentAuditActivity() {
  // Router navigation to open the richer audit trail page.
  const navigate = useNavigate();
  // Reads recentActivity and loading state from the dashboard summary.
  const { data: summary, isLoading } = useDashboardSummary();
  // Only the newest five events are shown in this preview.
  const events = (summary?.recentActivity ?? []).slice(0, 5);

  // Renders one of: skeletons, empty message, or the RecentDecisions feed.
  function renderBody() {
    if (isLoading) {
      return (
        // Skeleton rows shown while the summary request is in flight.
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((row) => (
            <Skeleton className="h-9 w-full" key={row} />
          ))}
        </div>
      );
    }
    if (events.length === 0) {
      return (
        // Centred empty message when the audit feed has nothing yet.
        <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
          No recent activity recorded yet.
        </p>
      );
    }
    // Reuses the decision feed but with all event types visible (exports, imports, etc.).
    return <RecentDecisions decisionsOnly={false} events={events} />;
  }

  return (
    // Outer card container with a header and the body rendered by renderBody().
    <section className="rounded-2xl border border-border bg-card">
      {/* Card header row: title/subtitle on the left, "Audit trail" action on */}
      the right.
      <header className="flex items-center justify-between border-border border-b px-5 py-4">
        <div>
          {/* Title of the audit-activity preview. */}
          <h3 className="font-semibold text-[14px] tracking-tight">
            Audit & lineage activity
          </h3>
          {/* Subtitle covering verification and downstream actions. */}
          <p className="text-[12px] text-muted-foreground">
            Latest verification and downstream actions
          </p>
        </div>
        {/* Ghost button routing to the full audit trail page. */}
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
      {renderBody()}
    </section>
  );
}

// Formats the quality score with adaptive precision so it never shows noisy decimals.
function formatQualityScore(score: number): string {
  if (score === 0) {
    return "0%";
  }
  if (score < 1) {
    return `${score.toFixed(2)}%`;
  }
  if (score < 10) {
    return `${score.toFixed(1)}%`;
  }
  return `${Math.round(score)}%`;
}

// Maps the raw quality score to a human-friendly confidence label for the KPI delta.
function getQualityDelta(score: number): string {
  if (score >= 95) {
    return "High confidence";
  }
  if (score >= 80) {
    return "Good quality";
  }
  return "Review pending";
}

// Purpose: main data-consumer dashboard — KPIs, quality gauge, charts, recent records, and quick links.
export default function ConsumerDashboard() {
  // Router navigation used by the header action button.
  const navigate = useNavigate();
  // Loads page 1 of verified loans; the pagination total feeds the record KPI.
  const { data: verified, isLoading } = useVerifiedLoans(1, "");
  // Loads the aggregate summary for quality score and recent activity.
  const { data: summary } = useDashboardSummary();

  // Total verified-record count, defaulting to zero.
  const totalVerified = verified?.pagination.total ?? 0;
  // Quality score falls back from the verified-loans response to the summary overview.
  const qualityScore =
    verified?.qualityScore ?? summary?.overview.qualityScore ?? 0;
  // Counts exported events from recent activity for the export KPI.
  const exported = (summary?.recentActivity ?? []).filter(
    (event) => event.eventType === "RECORD_EXPORTED"
  ).length;
  // Finds the most recent export event to show its date on the last-export KPI.
  const lastExport = (summary?.recentActivity ?? []).find(
    (event) => event.eventType === "RECORD_EXPORTED"
  );

  return (
    // Page shell: a centred 1200px column with consistent vertical spacing.
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      {/* Standard page header with an "Export Records" call-to-action button. */}
      <PageHeader
        action={
          // Pill button that routes to the one-click export page.
          <Button
            className="rounded-full"
            onClick={() => navigate("/consumer/export")}
          >
            {/* Download icon (decorative) paired with the action label. */}
            <i aria-hidden="true" className="ri-download-2-line" />
            Export Records
          </Button>
        }
        description="Trusted loan data with full lineage and tamper-evident hashes."
        title="Dashboard"
      />
      {/* Horizontal strip of four summary KPI cards. */}
      <KpiStrip>
        {/* KPI 1: total verified records known to the consumer (paginated */}
        total).
        <KpiCard
          icon="ri-shield-check-line"
          label="Total verified records"
          loading={isLoading}
          trend="up"
          trendLabel="records"
          trendValue="18.5%"
          value={verified ? totalVerified.toLocaleString() : "—"}
        />
        {/* KPI 2: data quality score with wording and tone derived from the */}
        score band.
        <KpiCard
          delta={getQualityDelta(qualityScore)}
          deltaTone={qualityScore >= 90 ? "positive" : "neutral"}
          icon="ri-sparkling-line"
          label="Data quality score"
          loading={isLoading}
          trend={qualityScore >= 90 ? "up" : "neutral"}
          trendLabel="score"
          trendValue={formatQualityScore(qualityScore)}
          value={formatQualityScore(qualityScore)}
        />
        {/* KPI 3: how many export events have been audit-logged so far. */}
        <KpiCard
          icon="ri-download-cloud-2-line"
          label="Records exported"
          loading={isLoading}
          trend="up"
          trendLabel="exports"
          trendValue="24%"
          value={exported ? `${exported}+` : "0"}
        />
        {/* KPI 4: date of the most recent export, derived from the newest export */}
        event.
        <KpiCard
          delta={
            lastExport
              ? `Sealed on ${new Date(lastExport.timestamp).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}`
              : "No exports yet"
          }
          deltaTone="neutral"
          icon="ri-calendar-event-line"
          label="Last export date"
          loading={isLoading}
          value={
            lastExport
              ? new Date(lastExport.timestamp).toLocaleDateString(undefined, {
                  day: "2-digit",
                  month: "short",
                })
              : "—"
          }
        />
      </KpiStrip>
      {/* Two-column layout: volume chart spans ~3/5 width, quality gauge ~2/5. */}
      <div className="grid items-stretch gap-4 lg:grid-cols-5">
        {/* Left cell holds the full-height verification-volume chart. */}
        <div className="flex flex-col lg:col-span-3">
          <VerificationVolumeChart />
        </div>
        {/* Right cell holds the quality-gauge card. */}
        <div className="flex flex-col lg:col-span-2">
          <QualityHealthCard
            qualityScore={qualityScore}
            totalVerified={totalVerified}
          />
        </div>
      </div>
      {/* Middle row pairs the recent-records preview with the audit-activity */}
      feed.
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Card listing the newest verified records with links to their */}
        dossiers.
        <RecentVerifiedRecords items={verified?.data} loading={isLoading} />
        {/* Card listing the latest audited lifecycle events. */}
        <RecentAuditActivity />
      </div>
      {/* Bottom band of quick links into Verified Records, Audit Trail, and */}
      Export & API.
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        {/* Shortcut card to the verified-records inventory page. */}
        <QuickLink
          href="/consumer/verified"
          icon="ri-shield-check-line"
          label="Verified Records"
          sub="Browse every verified loan record and tamper-evident SHA-256 seal"
        />
        {/* Shortcut card to the chronological audit trail. */}
        <QuickLink
          href="/consumer/audit"
          icon="ri-history-line"
          label="Audit Trail"
          sub="Full chronological event history and loan mutation timeline"
        />
        {/* Shortcut card to exports and the interactive API explorer. */}
        <QuickLink
          href="/consumer/export"
          icon="ri-share-box-line"
          label="Export & API"
          sub="Download datasets as CSV/JSON or explore REST endpoints"
        />
      </div>
    </div>
  );
}
