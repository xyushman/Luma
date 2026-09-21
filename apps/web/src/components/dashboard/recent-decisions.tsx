// Activity feed pulls audit event types from the shared package; cn merges Tailwind classes.
import type { AuditEventType } from "@repo/types";
import { cn } from "@/lib/utils";

/* Spec §5.1 — Recent Decisions activity feed with event-type iconography. */

// One activity row; eventType mirrors the audit enum and loanId tags record-level events.
interface ActivityItem {
  actor: string | null;
  eventType: string;
  loanId?: string | null;
  timestamp: string;
}

// Maps every audit event type to a Remix icon class and Tailwind color tone.
const EVENT_META: Record<AuditEventType, { icon: string; tone: string }> = {
  AI_RECOMMENDATION: { icon: "ri-sparkling-2-line", tone: "text-primary" },
  EXCEPTION_CREATED: {
    icon: "ri-error-warning-line",
    tone: "text-destructive",
  },
  FIELD_EDITED: { icon: "ri-edit-line", tone: "text-muted-foreground" },
  FILE_UPLOADED: {
    icon: "ri-upload-cloud-2-line",
    tone: "text-muted-foreground",
  },
  INGESTION_COMPLETED: {
    icon: "ri-inbox-archive-line",
    tone: "text-muted-foreground",
  },
  LOAN_APPROVED: { icon: "ri-checkbox-circle-line", tone: "text-success" },
  LOAN_IMPORTED: {
    icon: "ri-download-cloud-2-line",
    tone: "text-muted-foreground",
  },
  LOAN_REJECTED: { icon: "ri-close-circle-line", tone: "text-destructive" },
  RECORD_EXPORTED: { icon: "ri-share-box-line", tone: "text-muted-foreground" },
  REVIEWER_COMMENT: { icon: "ri-chat-3-line", tone: "text-muted-foreground" },
  VALIDATION_RUN: { icon: "ri-filter-3-line", tone: "text-muted-foreground" },
  VERIFIED_RECORD_CREATED: {
    icon: "ri-shield-check-line",
    tone: "text-success",
  },
};

// Subset shown by default so the feed reads as "decisions made today" rather than raw audit noise.
const DECISION_EVENTS = new Set<AuditEventType>([
  "LOAN_APPROVED",
  "LOAN_REJECTED",
  "REVIEWER_COMMENT",
  "FIELD_EDITED",
  "VERIFIED_RECORD_CREATED",
]);

// Precompiled regex for capitalizing the first letter of a humanized event name.
const FIRST_WORD_REGEX = /^\w/;

// "LOAN_APPROVED" -> "Loan approved": lowercases, spaces out underscores, then title-cases word one.
function humanizeEventType(eventType: string): string {
  const words = eventType.replaceAll("_", " ").toLowerCase();
  return words.replace(FIRST_WORD_REGEX, (c) => c.toUpperCase());
}

// Dashboard widget listing the latest reviewer decisions pulled from the audit stream.
export function RecentDecisions({
  events,
  decisionsOnly = true,
}: {
  decisionsOnly?: boolean;
  events?: ActivityItem[];
}) {
  // decisionsOnly narrows the feed to decision-type events; otherwise every audit event shows.
  const filtered = (events ?? []).filter((event) =>
    decisionsOnly
      ? DECISION_EVENTS.has(event.eventType as AuditEventType)
      : true
  );

  if (filtered.length === 0) {
    return (
      // Empty feed shows a clock glyph and a hint instead of a blank panel.
      <div className="flex flex-col items-center gap-2 py-10">
        <i
          aria-hidden="true"
          className="ri-time-line text-2xl text-muted-foreground/50"
        />
        <p className="text-[13px] text-muted-foreground">
          No decisions yet today.
        </p>
      </div>
    );
  }

  return (
    // The five most recent matching events render as one feed row each.
    <ul className="divide-y divide-border">
      {filtered.slice(0, 5).map((event) => {
        // Resolve the icon/tone for this event type, defaulting to a neutral record glyph.
        const meta =
          EVENT_META[event.eventType as AuditEventType] ??
          ({
            icon: "ri-record-circle-line",
            tone: "text-muted-foreground",
          } as const);
        return (
          <li key={`${event.eventType}-${event.timestamp}`}>
            {/* Row body: tinted event icon on the left, summary text on the right. */}
            <div className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/50">
              {/* Circle chip tinted with the event tone frames the Remix icon. */}
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/40",
                  meta.tone
                )}
              >
                <i className={cn(meta.icon, "text-[13px]")} />
              </span>
              <div className="min-w-0 flex-1">
                {/* Humanized event label; a mono loan ID tag appends when the event is loan-scoped. */}
                <p className="truncate font-medium text-[13px] leading-snug">
                  {humanizeEventType(event.eventType)}
                  {event.loanId ? (
                    <span className="ml-1.5 font-mono text-[11.5px] text-muted-foreground">
                      {event.loanId}
                    </span>
                  ) : null}
                </p>
                {/* Subline names the actor (or System) and the wall-clock time of the audit event. */}
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {event.actor ?? "System"} ·{" "}
                  {new Date(event.timestamp).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
