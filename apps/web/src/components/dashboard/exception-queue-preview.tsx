// Types and UI helpers come from the shared package and shared component libraries.
import type {
  ExceptionListItem,
  Severity,
  Severity as SeverityType,
} from "@repo/types";
import { useNavigate } from "react-router-dom"; // Programmatic row click-through to the review workspace.
import { exceptionTypeLabel, SeverityBadge } from "@/components/ui/badges";
import { Skeleton } from "@/components/ui/skeleton";

/* Spec §5.1 — Exception Queue preview (top 5 by severity) with severity
   ordering, mono loan IDs, row click-through to the review workspace. */

// Numeric rank for sorting so critical exceptions surface before lower severities.
const SEVERITY_ORDER: Record<SeverityType, number> = {
  critical: 0,
  high: 1,
  low: 3,
  medium: 2,
};

// Dashboard widget previewing the top exceptions by severity, tapped into the review queue.
export function ExceptionQueuePreview({
  items,
  loading,
  titleHref,
}: {
  items?: ExceptionListItem[];
  loading?: boolean;
  titleHref?: string;
}) {
  const navigate = useNavigate();
  // Shallow-copy rows then rank by severity so the queue always leads with critical items.
  const sorted = [...(items ?? [])].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity as SeverityType] -
      SEVERITY_ORDER[b.severity as SeverityType]
  );

  if (loading) {
    return (
      // Skeleton placeholders keep the row height stable while the queue loads.
      <div className="space-y-2.5 p-1">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton className="h-11 w-full" key={row} />
        ))}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      // Empty state celebrates a clear queue and offers a link to the full review list.
      <div className="flex flex-col items-center gap-2 py-10">
        <i
          aria-hidden="true"
          className="ri-checkbox-circle-line text-2xl text-success"
        />
        <p className="text-[13px] text-muted-foreground">
          Queue is clear — no open exceptions.
        </p>
        {titleHref ? (
          <button
            className="text-[12.5px] text-primary underline-offset-4 hover:underline"
            onClick={() => navigate(titleHref)}
            type="button"
          >
            {/* Link-style button jumps to the full queue when a title href is supplied. */}
            Open full queue
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {/* Top five rows by sorted severity, newest-worst first, each clickable into the reviewer page. */}
      {sorted.slice(0, 5).map((item) => (
        <li key={item.id}>
          {/* Full-row button; clicking drops the reviewer straight onto that loan. */}
          <button
            className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/50"
            onClick={() => navigate(`/reviewer/loans/${item.loan.id}`)}
            type="button"
          >
            {/* Loan ID shows in mono for scannability, falling back to the internal id. */}
            <span className="w-[100px] shrink-0 truncate font-mono text-[12px]">
              {item.loan.loanId ?? item.loan.id}
            </span>
            {/* Humanized exception name plus the affected field and short reason. */}
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
              <span className="font-medium text-foreground">
                {exceptionTypeLabel(item.exceptionType)}
              </span>
              {item.field ? ` · ${item.field}` : ""} — {item.message}
            </span>
            {/* Severity badge colors the row by criticality for quick triage. */}
            <SeverityBadge severity={item.severity as Severity} />
            {/* Chevron nudges forward on hover to hint at the click-through destination. */}
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
