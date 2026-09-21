// cn merges optional class names; the header is shared across dashboard, upload, and reviewer pages.
import { cn } from "@/lib/utils";

// Page header shared by dashboard, upload, and reviewer pages; action holds optional page-level buttons.
export function PageHeader({
  action,
  description,
  eyebrow,
  title,
}: {
  action?: React.ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    // Sides baseline-align so the title block and the action slot share one horizontal line.
    <div className="flex items-end justify-between gap-4">
      {/* Left block stacks the eyebrow, title, and description vertically. */}
      <div className="min-w-0">
        {/* Small-caps eyebrow sits above the title as page context (e.g. "Operations"). */}
        {eyebrow ? (
          <p className="mb-1 font-medium text-[11px] text-primary uppercase tracking-[0.1em]">
            {eyebrow}
          </p>
        ) : null}
        {/* Title is the reference point users scan for; kept large and tight-tracked. */}
        <h2 className="font-semibold text-[24px] leading-tight tracking-tight">
          {title}
        </h2>
        {/* Optional one-line description summarizes what the page below contains. */}
        {description ? (
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {/* Right-aligned action slot holds page controls; shrink-0 prevents it from squeezing the title. */}
      {action ? <div className={cn("shrink-0")}>{action}</div> : null}
    </div>
  );
}
