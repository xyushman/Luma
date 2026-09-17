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

const EVENT_TONES: Partial<Record<AuditEventType, string>> = {
  AI_RECOMMENDATION: "text-primary bg-primary/10 border-primary/20",
  EXCEPTION_CREATED: "text-destructive bg-destructive/10 border-destructive/20",
  FIELD_EDITED: "text-warning bg-warning/10 border-warning/20",
  LOAN_APPROVED: "text-success bg-success/10 border-success/20",
  LOAN_IMPORTED: "text-primary bg-primary/10 border-primary/20",
  LOAN_REJECTED: "text-destructive bg-destructive/10 border-destructive/20",
  VERIFIED_RECORD_CREATED: "text-success bg-success/10 border-success/20",
};

interface EntryMeta {
  field?: unknown;
  newValue?: unknown;
  oldValue?: unknown;
}

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
      return meta.recordHash
        ? `Sealed with hash ${String(meta.recordHash).slice(0, 16)}…`
        : "Sealed canonical record created";
    default:
      return entry.eventType.replaceAll("_", " ").toLowerCase();
  }
}

function TimelineEntry({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const meta = (entry.metadata ?? {}) as EntryMeta;
  const hasDetail =
    meta.field !== undefined ||
    meta.newValue !== undefined ||
    Object.keys(meta).length > 0;
  const isEdit = entry.eventType === "FIELD_EDITED";

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span
        aria-hidden="true"
        className={cn(
          "z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card shadow-xs",
          EVENT_TONES[entry.eventType] ??
            "border-border text-muted-foreground/70"
        )}
      >
        <i className={`${EVENT_ICONS[entry.eventType]} text-[11px]`} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <button
          className="flex w-full flex-wrap items-baseline gap-x-2 text-left"
          disabled={!hasDetail}
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          <span className="font-medium text-[12.5px] text-foreground">
            {entry.eventType.replaceAll("_", " ")}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
          {describeEntry(entry)}
        </p>
        {expanded && hasDetail ? (
          <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2.5">
            {isEdit ? (
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
                <span className="font-medium text-foreground">
                  {String(meta.field ?? "field")}:
                </span>
                <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive line-through">
                  {String(meta.oldValue ?? "—")}
                </span>
                <i
                  aria-hidden="true"
                  className="ri-arrow-right-line text-[11px] text-muted-foreground"
                />
                <span className="rounded bg-success/10 px-1.5 py-0.5 font-medium text-success">
                  {String(meta.newValue ?? "—")}
                </span>
              </div>
            ) : (
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

function LoanPicker({
  onPick,
  value,
}: {
  onPick: (loanId: string) => void;
  value: string;
}) {
  const [query, setQuery] = useState("");
  const { data } = useVerifiedLoans(1, query);
  const hits = (data?.data ?? []).slice(0, 6);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <i
          aria-hidden="true"
          className="ri-search-line absolute top-1/2 left-2.5 -translate-y-1/2 text-[12px] text-muted-foreground/70"
        />
        <input
          className="h-8 w-full rounded-lg border border-input bg-background pr-7 pl-7 text-[12px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search verified loan ID…"
          type="search"
          value={query}
        />
        {query ? (
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
      {query.trim().length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-[11.5px] text-muted-foreground">
              No matching verified loans.
            </li>
          ) : (
            hits.map((record) => (
              <li key={record.id}>
                <button
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-accent",
                    value === record.loanId && "bg-accent font-medium"
                  )}
                  onClick={() => {
                    onPick(record.loanId);
                    setQuery("");
                  }}
                  type="button"
                >
                  <span className="font-mono">
                    {record.loan.loanId ?? record.id}
                  </span>
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
    <div className="flex flex-col items-center gap-1.5 py-14 text-center">
      <i
        aria-hidden="true"
        className={`${icon} text-2xl text-muted-foreground/40`}
      />
      <p className="font-medium text-[13px] text-foreground">{title}</p>
      <p className="max-w-xs text-[11.5px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

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
    <>
      <header className="mb-3.5 flex items-center justify-between border-border border-b pb-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[12.5px] text-foreground">
            Audit Events
          </span>
          <span className="rounded-full bg-muted px-2 py-0.2 font-mono text-[10.5px] text-muted-foreground tabular-nums">
            {entries.length} of {total}
          </span>
          {eventFilter ? (
            <Badge className="text-[10px]" variant="outline">
              Filtered
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            className="h-7.5 text-xs"
            onClick={onOpenRecord}
            size="sm"
            variant="ghost"
          >
            Open Dossier
            <i aria-hidden="true" className="ri-arrow-right-s-line text-sm" />
          </Button>
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
            <i aria-hidden="true" className="ri-download-2-line text-xs" />
            Export CSV
          </Button>
        </div>
      </header>
      <ol className="relative space-y-0 pl-1">
        {entries.map((entry, index) => (
          <div key={entry.id}>
            {index < entries.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-6 bottom-0 left-[15px] w-px bg-border/80"
              />
            ) : null}
            <TimelineEntry entry={entry} />
          </div>
        ))}
      </ol>
      {totalPages > page ? (
        <div className="border-border border-t pt-3 text-center">
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

export default function AuditTrailPage() {
  const navigate = useNavigate();
  const [loanId, setLoanId] = useState("");
  const [eventFilter, setEventFilter] = useState<AuditEventType | "">("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAuditTrail(loanId || "none", page);
  const { data: verified } = useVerifiedLoans(1, "");

  const entries = useMemo(() => {
    const raw = data?.data ?? [];
    const filtered =
      eventFilter === ""
        ? raw
        : raw.filter((entry) => entry.eventType === eventFilter);
    return [...filtered].reverse();
  }, [data, eventFilter]);

  const currentVerifiedRecord = verified?.data.find(
    (v) => v.loanId === loanId || v.id === loanId
  );
  const targetVerifiedId = currentVerifiedRecord?.id ?? loanId;

  const renderTimelineBody = () => {
    if (loanId === "") {
      return (
        <TimelineEmptyState
          icon="ri-history-line"
          subtitle="Pick a verified loan from the sidebar to inspect its append-only event history."
          title="No Loan Selected"
        />
      );
    }
    if (isLoading) {
      return (
        <div className="space-y-2.5 p-2">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton className="h-10 w-full" key={row} />
          ))}
        </div>
      );
    }
    if (entries.length === 0) {
      return (
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
    <div className="mx-auto max-w-[1200px] space-y-4 p-6">
      <PageHeader
        action={
          <Button
            className="h-8.5 text-xs"
            onClick={() => navigate("/consumer/verified")}
            variant="outline"
          >
            <i aria-hidden="true" className="ri-shield-check-line" />
            Verified Records
          </Button>
        }
        description="Every lifecycle event — ingest, validations, AI suggestions, reviewer decisions, and exports."
        eyebrow="Data Consumer"
        title="Audit Trail"
      />

      <div className="grid gap-4 lg:grid-cols-[290px_1fr]">
        <aside className="space-y-3.5">
          <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
            <h3 className="mb-2 font-semibold text-[12px] text-muted-foreground uppercase tracking-wider">
              Select Loan
            </h3>
            <LoanPicker onPick={setLoanId} value={loanId} />
            {loanId ? (
              <button
                className="mt-1.5 font-medium text-[11.5px] text-primary hover:underline"
                onClick={() => setLoanId("")}
                type="button"
              >
                Clear selection
              </button>
            ) : null}
          </section>

          <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
            <h3 className="mb-2 font-semibold text-[12px] text-muted-foreground uppercase tracking-wider">
              Filter by Event
            </h3>
            <div className="flex flex-wrap gap-1">
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

          {verified && verified.data.length > 0 ? (
            <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
              <h3 className="mb-2 font-semibold text-[12px] text-muted-foreground uppercase tracking-wider">
                Recently Verified
              </h3>
              <ul className="space-y-1">
                {verified.data.slice(0, 5).map((record) => (
                  <li key={record.id}>
                    <button
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/50",
                        (loanId === record.loanId || loanId === record.id) &&
                          "border border-primary/30 bg-primary/10 font-medium"
                      )}
                      onClick={() => setLoanId(record.loanId)}
                      type="button"
                    >
                      <span className="font-mono text-[12px]">
                        {record.loan.loanId ?? record.id}
                      </span>
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

        <section className="rounded-xl border border-border bg-card p-4.5 shadow-xs">
          {renderTimelineBody()}
        </section>
      </div>
    </div>
  );
}
