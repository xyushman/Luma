// Imports: ReactNode for polymorphic content, cn for conditional trend classes.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// StatCardProps: describes the KPI tiles used on dashboard screens (label, big value, trend, hint, icon).
interface StatCardProps {
  hint?: string; // optional footnote shown under the value.
  icon?: string; // CSS class for an icon font glyph.
  label: string; // short metric name, e.g. "Pending exceptions".
  trend?: ReactNode; // optional trend indicator (arrow + percentage) node.
  trendClassName?: string; // overrides the default success/positive trend color.
  value: ReactNode; // the headline KPI number, possibly formatted markup.
}

// StatCard: dashboard KPI tile pairing an icon, label, headline value, trend, and hint.
export function StatCard({
  icon,
  label,
  value,
  hint,
  trend,
  trendClassName = "text-success",
}: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        {icon ? (
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground text-base"
          >
            <i className={icon} />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="truncate font-medium text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
            {label}
          </p>
          <p className="font-semibold text-[20px] tabular-nums tracking-tight">
            {value}
          </p>
          {trend ? (
            <p className={cn("truncate font-medium text-xs", trendClassName)}>
              {trend}
            </p>
          ) : null}
          {hint ? (
            <p className="truncate text-muted-foreground/70 text-xs">{hint}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
