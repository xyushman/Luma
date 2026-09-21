// Imports: audit types, React hooks, routing/toasts, audit and verified-loans hooks, CSV helper, and a class util.
import type { AuditEventType, AuditLogEntry } from "@repo/types";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditTrail } from "@/hooks/use-audit";
import { useVerifiedLoans } from "@/hooks/use-verified-loans";
import { downloadAsCsv } from "@/lib/download";
import { cn } from "@/lib/utils";

/* Spec §6.4 — Audit Trail Viewer (Module F). */

// Every audit event type surfaced as an optional filter chip, with a human label for each.
const EVENT_OPTIONS: { label: string; value: AuditEventType }[] = [
  { label: "File uploaded", value: "FILE_UPLOADED" },
  { label: "Record imported", value: "LOAN_IMPORTED" },
  { label: "Ingestion completed", value: "INGESTION_COMPLETED" },
  { label: "Validation executed", value: "VALIDATION_RUN" },
  { label: "Exception created", value: "EXCEPTION_CREATED" },
  { label: "AI recommendation", value: "AI_RECOMMENDATION" },
  { label: "Reviewer note", value: "REVIEWER_COMMENT" },
  { label: "Field edited", value: "FIELD_EDITED" },
  { label: "Approved", value: "LOAN_APPROVED" },
  { label: "Rejected", value: "LOAN_REJECTED" },
  { label: "Verified record created", value: "VERIFIED_RECORD_CREATED" },
  { label: "Record exported", value: "RECORD_EXPORTED" },
];

// Remix icon glyph per event type so each timeline node is visually recognisable.
const EVENT_ICONS: Record<AuditEventType, string> = {
  AI_RECOMMENDATION: "ri-sparkling-2-line",
  EXCEPTION_CREATED: "ri-error-warning-line",
  FIELD_EDITED: "ri-edit-line",
  FILE_UPLOADED: "ri-upload-cloud-2-line",
  INGESTION_COMPLETED: "ri-inbox-archive-line",
  LOAN_APPROVED: "ri-checkbox-circle-line",
  LOAN_IMPORTED: "ri-download-cloud-2-line",
  LOAN_REJECTED: "ri-close-circle-line",
  RECORD_EXPORTED: "ri-share-box-line",
  REVIEWER_COMMENT: "ri-chat-3-line",
  VALIDATION_RUN: "ri-filter-3-line",
  VERIFIED_RECORD_CREATED: "ri-shield-check-line",
};

// Tailwind tone classes per event type, colouring the timeline node dot by meaning.
const EVENT_TONES: Partial<Record<AuditEventType, string>> = {
  AI_RECOMMENDATION: "text-primary bg-primary/10 border-primary/20",
  EXCEPTION_CREATED: "text-destructive bg-destructive/10 border-destructive/20",
  FIELD_EDITED: "text-warning bg-warning/10 border-warning/20",
  LOAN_APPROVED: "text-success bg-success/10 border-success/20",
  LOAN_IMPORTED: "text-primary bg-primary/10 border-primary/20",
  LOAN_REJECTED: "text-destructive bg-destructive/10 border-destructive/20",
  VERIFIED_RECORD_CREATED: "text-success bg-success/10 border-success/20",
};

// Subset of an event's metadata most relevant to field-edit entries.
interface EntryMeta {
  field?: unknown;
  newValue?: unknown;
  oldValue?: unknown;
}

// Turns an audit entry into a compact one-line human description based on its event type.
function describeEntry(entry: AuditLogEntry): string {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  switch (entry.eventType) {
    case "AI_RECOMMENDATION":
      return `AI suggestion generated (${String(meta.model ?? "model")})`;
    case "EXCEPTION_CREATED":
      return `Exception: ${String(meta.exceptionType ?? "unknown")} on ${String(meta.field ?? "field")}`;
    case "LOAN_IMPORTED":
      return `Imported from ${String(meta.fileName ?? "file")}, row ${String(meta.sourceRowNumber ?? "?")}`;
    case "REVIEWER_COMMENT":
      return String(meta.note ?? "Reviewer note added");
    case "VERIFIED_RECORD_CREATED":
      // Sealed events include the (truncated) hash so consumers can match the seal.
      return meta.recordHash
        ? `Sealed with hash ${String(meta.recordHash).slice(0, 16)}…`
        : "Sealed canonical record created";
    default:
      // Fallback: pretty-print the raw event type as lowercase words.
      return entry.eventType.replaceAll("_", " ").toLowerCase();
  }
}

// Purpose: a single expandable node in the audit timeline, with details for events that carry metadata.
function TimelineEntry({ entry }: { entry: AuditLogEntry }) {
  // Toggles the metadata detail panel for this entry.
  const [expanded, setExpanded] = useState(false);
  // Casts metadata to the field-edit shape so old/new values are easy to read.
  const meta = (entry.metadata ?? {}) as EntryMeta;
  // An entry is expandable when it carries any metadata beyond common fields.
  const hasDetail =
    meta.field !== undefined ||
    meta.newValue !== undefined ||
    Object.keys(meta).length > 0;
  // Field edits get a sweet old → new rendering instead of raw JSON.
  const isEdit = entry.eventType === "FIELD_EDITED";

  return (
    // List item with a connector line down the left for the vertical timeline.
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* Timeline node dot, coloured by event tone and showing the event icon. */}
      <span
        aria-hidden="true"
        className={cn(
          "z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card shadow-xs",
          EVENT_TONES[entry.eventType] ??
            "border-border text-muted-foreground/70"
        )}
      >
        {/* Icon glyph for this event type. */}
        <i className={`${EVENT_ICONS[entry.eventType]} text-[11px]`} />
      </span>
      {/* Content area to the right of the node dot. */}
      <div className="min-w-0 flex-1 pt-0.5">
        {/* Header button toggles the detail payload when the entry has one. */}
        <button
          className="flex w-full flex-wrap items-baseline gap-x-2 text-left"
          disabled={!hasDetail}
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {/* Event-type label with underscores rendered as spaces. */}
          <span className="font-medium text-[12.5px] text-foreground">
            {entry.eventType.replaceAll("_", " ")}
          </span>
          {/* Meta line: actor name badge plus formatted timestamp. */}
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {/* Small badge showing who performed the action (or "System"). */}
            <span className="rounded bg-muted px-1.5 py-0.2 font-medium text-[10px]">
              {entry.actor?.name ?? "System"}
            </span>
            ·{" "}
            {new Date(entry.createdAt).toLocaleString(undefined, {
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              month: "short",
            })}
          </span>
          {/* Chevron appears only on expandable entries and rotates when open. */}
          {hasDetail ? (
            <i
              aria-hidden="true"
              className={cn(
                "text-[12px] text-muted-foreground/60 transition-transform",
                expanded && "rotate-90"
              )}
            />
          ) : null}
        </button>
        {/* The human-readable one-line description under the header. */}
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
          {describeEntry(entry)}
        </p>
        {/* Expandable detail panel rendering metadata when the entry is opened. */}
        {expanded && hasDetail ? (
          <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2.5">
            {/* Field edits render as field name, struck-through old value, */}
            arrow, and new value.
            {isEdit ? (
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
                {/* Field name being edited. */}
                <span className="font-medium text-foreground">
                  {String(meta.field ?? "field")}:
                </span>
                {/* Old value shown struck through in destructive colour. */}
                <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive line-through">
                  {String(meta.oldValue ?? "—")}
                </span>
                {/* Arrow separating the old and new values. */}
                <i
                  aria-hidden="true"
                  className="ri-arrow-right-line text-[11px] text-muted-foreground"
                />
                {/* New value highlighted in success colour. */}
                <span className="rounded bg-success/10 px-1.5 py-0.5 font-medium text-success">
                  {String(meta.newValue ?? "—")}
                </span>
              </div>
            ) : (
              // All other event types dump the raw metadata as pretty-printed JSON.
              <pre className="custom-scrollbar-hide max-h-48 overflow-auto font-mono text-[11px] text-foreground/80 leading-relaxed">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

// Purpose: searchable picker that selects which verified loan's audit trail to view.
function LoanPicker({
  onPick,
  value,
}: {
  onPick: (loanId: string) => void;
  value: string;
}) {
  // Live text being typed into the search box.
  const [query, setQuery] = useState("");
  // Searches verified loans server-side; results power the dropdown hit list.
  const { data } = useVerifiedLoans(1, query);
  // Only the top six matches are shown to keep the dropdown compact.
  const hits = (data?.data ?? []).slice(0, 6);

  return (
    // Vertical stack wrapping the search box and the results dropdown.
    <div className="space-y-1.5">
      {/* Relative wrapper so the search icon can float inside the input. */}
      <div className="relative">
        {/* Search icon absolutely positioned at the input's left edge. */}
        <i
          aria-hidden="true"
          className="ri-search-line absolute top-1/2 left-2.5 -translate-y-1/2 text-[12px] text-muted-foreground/70"
        />
        {/* Text input bound to the live query. */}
        <input
          className="h-8 w-full rounded-lg border border-input bg-background pr-7 pl-7 text-[12px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search verified loan ID…"
          type="search"
          value={query}
        />
        {/* Clear button appears once the consumer has typed something. */}
        {query ? (
          // Button resets the query to hide the dropdown.
          <button
            aria-label="Clear query"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            onClick={() => setQuery("")}
            type="button"
          >
            <i aria-hidden="true" className="ri-close-line text-xs" />
          </button>
        ) : null}
      </div>
      {/* Dropdown with matches, only rendered while there is a non-empty query. */}
      {query.trim().length > 0 ? (
        // Bordered dropdown list container.
        <ul className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
          {/* Empty-match message shown when nothing comes back from the API. */}
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-[11.5px] text-muted-foreground">
              No matching verified loans.
            </li>
          ) : (
            // Maps each hit to a clickable row.
            hits.map((record) => (
              <li key={record.id}>
                {/* Row button; highlights when it matches the currently selected */}
                loan.
                <button
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-accent",
                    value === record.loanId && "bg-accent font-medium"
                  )}
                  onClick={() => {
                    // Picks the loan and clears the query to collapse the dropdown.
                    onPick(record.loanId);
                    setQuery("");
                  }}
                  type="button"
                >
                  {/* Mono loan id shown in the row. */}
                  <span className="font-mono">
                    {record.loan.loanId ?? record.id}
                  </span>
                  {/* Short hash fragment as a preview of the record's seal. */}
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {record.recordHash.slice(0, 8)}…
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

// Purpose: flexible empty-state block used by the timeline (no loan, no events, filtered empty).
function TimelineEmptyState({
  icon,
  subtitle,
  title,
}: {
  icon: string;
  subtitle: string;
  title: string;
}) {
  return (
    // Centred stacked layout for icon, title, and subtitle.
    <div className="flex flex-col items-center gap-1.5 py-14 text-center">
      {/* Large muted icon reflecting the empty state. */}
      <i
        aria-hidden="true"
        className={`${icon} text-2xl text-muted-foreground/40`}
      />
      {/* Short title of the empty state. */}
      <p className="font-medium text-[13px] text-foreground">{title}</p>
      {/* Supporting sentence explaining the empty state. */}
      <p className="max-w-xs text-[11.5px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

// Purpose: scrollable, filterable timeline list with paging, delve-into-dossier, and CSV export.
function TimelineList({
  entries,
  eventFilter,
  loanId,
  onLoadMore,
  onOpenRecord,
  page,
  total,
  totalPages,
}: {
  entries: AuditLogEntry[];
  eventFilter: string;
  loanId: string;
  onLoadMore: () => void;
  onOpenRecord: () => void;
  page: number;
  total: number;
  totalPages: number;
}) {
  return (
    // Fragment grouping timeline header, entries, and the load-more footer.
    <>
      {/* Header bar with event count, filter badge, and action buttons. */}
      <header className="mb-3.5 flex items-center justify-between border-border border-b pb-2.5">
        {/* Left group: title, entry count, and a "Filtered" badge when active. */}
        <div className="flex items-center gap-2">
          {/* Heading label for the event list. */}
          <span className="font-medium text-[12.5px] text-foreground">
            Audit Events
          </span>
          {/* Count pill reading "shown of total". */}
          <span className="rounded-full bg-muted px-2 py-0.2 font-mono text-[10.5px] text-muted-foreground tabular-nums">
            {entries.length} of {total}
          </span>
          {/* Badge signalling the list is being filtered by event type. */}
          {eventFilter ? (
            <Badge className="text-[10px]" variant="outline">
              Filtered
            </Badge>
          ) : null}
        </div>
        {/* Right group: open dossier and export CSV actions. */}
        <div className="flex items-center gap-1.5">
          {/* Ghost button navigating to the selected loan's dossier page. */}
          <Button
            className="h-7.5 text-xs"
            onClick={onOpenRecord}
            size="sm"
            variant="ghost"
          >
            Open Dossier{" "}
            {/* Trailing chevron glyph, decorative and hidden from */}
            screen readers.
            <i aria-hidden="true" className="ri-arrow-right-s-line text-sm" />
          </Button>
          {/* Outline button exporting visible events to a CSV file client-side. */}
          <Button
            className="h-7.5 text-xs"
            onClick={() => {
              downloadAsCsv(
                `audit_trail_${loanId}.csv`,
                ["event_type", "actor", "timestamp", "detail"],
                entries.map((entry) => [
                  entry.eventType,
                  entry.actor?.name ?? "System",
                  entry.createdAt,
                  describeEntry(entry),
                ])
              );
              toast.success(`Downloaded ${entries.length} audit events`);
            }}
            size="sm"
            variant="outline"
          >
            {/* Download icon paired with the CSV export label. */}
            <i aria-hidden="true" className="ri-download-2-line text-xs" />
            Export CSV
          </Button>
        </div>
      </header>
      {/* Relative ordered list forming the vertical timeline. */}
      <ol className="relative space-y-0 pl-1">
        {entries.map((entry, index) => (
          // Fragment-wrapped entry so the connector line can sit beside the item.
          <div key={entry.id}>
            {/* Connector line extending downward for every entry except the */}
            last.
            {index < entries.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-6 bottom-0 left-[15px] w-px bg-border/80"
              />
            ) : null}
            {/* Renders a single expandable timeline node. */}
            <TimelineEntry entry={entry} />
          </div>
        ))}
      </ol>
      {/* "Load older events" footer appears while more pages remain. */}
      {totalPages > page ? (
        // Centred footer row above the primary border.
        <div className="border-border border-t pt-3 text-center">
          {/* Button requesting the next page of (older) events. */}
          <Button
            className="h-7 text-xs"
            onClick={onLoadMore}
            size="sm"
            variant="outline"
          >
            Load older events
          </Button>
        </div>
      ) : null}
    </>
  );
}

// Purpose: full audit-trail viewer — pick a loan, filter by event type, and inspect its append-only history.
export default function AuditTrailPage() {
  // Router navigation to open a verified-loan dossier.
  const navigate = useNavigate();
  // Currently selected loan id; empty means "no loan selected".
  const [loanId, setLoanId] = useState("");
  // Active event-type filter; empty string means "show all".
  const [eventFilter, setEventFilter] = useState<AuditEventType | "">("");
  // Pagination cursor for the audit trail; "none" sentinel avoids an undefined-loan request.
  const [page, setPage] = useState(1);
  // Fetches the loan's audit trail (or a harmless "none" query while no loan is selected).
  const { data, isLoading } = useAuditTrail(loanId || "none", page);
  // Fetches verified loans to power the picker and the recently-verified sidebar.
  const { data: verified } = useVerifiedLoans(1, "");

  // Memoised, newest-first, optionally event-filtered entry list for the timeline.
  const entries = useMemo(() => {
    const raw = data?.data ?? [];
    const filtered =
      eventFilter === ""
        ? raw
        : raw.filter((entry) => entry.eventType === eventFilter);
    return [...filtered].reverse();
  }, [data, eventFilter]);

  // Resolves the selected loan's verified record (matched by loanId or record id).
  const currentVerifiedRecord = verified?.data.find(
    (v) => v.loanId === loanId || v.id === loanId
  );
  // "Open Dossier" targets the verified record id when we know it, else the raw loan id.
  const targetVerifiedId = currentVerifiedRecord?.id ?? loanId;

  // Renders the timeline body based on selection/loading/filter state.
  const renderTimelineBody = () => {
    if (loanId === "") {
      return (
        // Prompt shown before any loan has been chosen from the picker.
        <TimelineEmptyState
          icon="ri-history-line"
          subtitle="Pick a verified loan from the sidebar to inspect its append-only event history."
          title="No Loan Selected"
        />
      );
    }
    if (isLoading) {
      return (
        // Skeleton rows shown while the trail request is in flight.
        <div className="space-y-2.5 p-2">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton className="h-10 w-full" key={row} />
          ))}
        </div>
      );
    }
    if (entries.length === 0) {
      return (
        // Empty state distinguishing "filtered to nothing" from "no events at all".
        <TimelineEmptyState
          icon="ri-inbox-line"
          subtitle={
            eventFilter
              ? "No events match the selected event filter."
              : "No audit events recorded for this loan."
          }
          title="No Events Found"
        />
      );
    }
    return (
      // Real timeline: header, paged entries, and load-more pagination.
      <TimelineList
        entries={entries}
        eventFilter={eventFilter}
        loanId={loanId}
        onLoadMore={() => setPage(page + 1)}
        onOpenRecord={() => navigate(`/consumer/loans/${targetVerifiedId}`)}
        page={page}
        total={data?.pagination.total ?? 0}
        totalPages={data?.pagination.totalPages ?? 1}
      />
    );
  };

  return (
    // Page shell: a centred 1200px column with compact spacing.
    <div className="mx-auto max-w-[1200px] space-y-4 p-6">
      {/* Standard page header with a shortcut to the verified-records page. */}
      <PageHeader
        action={
          // Button routing to the verified-records inventory.
          <Button
            className="h-8.5 text-xs"
            onClick={() => navigate("/consumer/verified")}
            variant="outline"
          >
            {/* Shield-check icon paired with the records shortcut. */}
            <i aria-hidden="true" className="ri-shield-check-line" />
            Verified Records
          </Button>
        }
        description="Every lifecycle event — ingest, validations, AI suggestions, reviewer decisions, and exports."
        eyebrow="Data Consumer"
        title="Audit Trail"
      />
      {/* Two-column layout: sidebar controls on the left, timeline on the right. */}
      <div className="grid gap-4 lg:grid-cols-[290px_1fr]">
        {/* Sidebar with loan picker, event filter, and recently verified picks. */}
        <aside className="space-y-3.5">
          {/* Card: searchable "Select Loan" picker plus a clear-selection link. */}
          <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
            {/* Heading for the loan picker. */}
            <h3 className="mb-2 font-semibold text-[12px] text-muted-foreground uppercase tracking-wider">
              Select Loan
            </h3>
            {/* Loan picker search box feeding the selected loan id. */}
            <LoanPicker onPick={setLoanId} value={loanId} />
            {/* Clear link rendered whenever a loan is selected. */}
            {loanId ? (
              // Button resetting the selection back to none.
              <button
                className="mt-1.5 font-medium text-[11.5px] text-primary hover:underline"
                onClick={() => setLoanId("")}
                type="button"
              >
                Clear selection
              </button>
            ) : null}
          </section>
          {/* Card: chip group filtering the timeline by event type. */}
          <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
            {/* Heading for the event filter. */}
            <h3 className="mb-2 font-semibold text-[12px] text-muted-foreground uppercase tracking-wider">
              Filter by Event
            </h3>
            {/* Wrap-flex chip group of the filter options. */}
            <div className="flex flex-wrap gap-1">
              {/* "All" chip resetting the filter to show every event type. */}
              <button
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                  eventFilter === ""
                    ? "border-primary/30 bg-primary/10 font-medium text-primary"
                    : "border-border text-muted-foreground hover:bg-accent/60"
                )}
                onClick={() => setEventFilter("")}
                type="button"
              >
                All
              </button>
              {/* One chip per event type, toggling the filter when clicked. */}
              {EVENT_OPTIONS.map((option) => (
                <button
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                    eventFilter === option.value
                      ? "border-primary/30 bg-primary/10 font-medium text-primary"
                      : "border-border text-muted-foreground hover:bg-accent/60"
                  )}
                  key={option.value}
                  onClick={() => setEventFilter(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
          {/* Card: the five most recently verified loans as one-click pickers. */}
          {verified && verified.data.length > 0 ? (
            <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
              {/* Heading for the recently verified list. */}
              <h3 className="mb-2 font-semibold text-[12px] text-muted-foreground uppercase tracking-wider">
                Recently Verified
              </h3>
              {/* Stack of quick-pick rows. */}
              <ul className="space-y-1">
                {verified.data.slice(0, 5).map((record) => (
                  <li key={record.id}>
                    {/* Row selects the loan and highlights when selected. */}
                    <button
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/50",
                        (loanId === record.loanId || loanId === record.id) &&
                          "border border-primary/30 bg-primary/10 font-medium"
                      )}
                      onClick={() => setLoanId(record.loanId)}
                      type="button"
                    >
                      {/* Mono loan id for the row. */}
                      <span className="font-mono text-[12px]">
                        {record.loan.loanId ?? record.id}
                      </span>
                      {/* Validation badge coloured by pass/fail. */}
                      <Badge
                        className="text-[10px]"
                        variant={
                          record.validationResult === "passed"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {record.validationResult.replaceAll("_", " ")}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
        {/* Right column holding the rendered timeline body. */}
        <section className="rounded-xl border border-border bg-card p-4.5 shadow-xs">
          {renderTimelineBody()}
        </section>
      </div>
    </div>
  );
}
