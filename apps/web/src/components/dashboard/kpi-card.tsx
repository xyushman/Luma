// ReactNode lets the KPI value be any renderable; cn merges conditional Tailwind classes.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Spec §3 — KPICard: big number + small-caps label + optional delta chip. */

// Chip arrow direction; "neutral" renders no arrow.
type TrendDirection = "down" | "neutral" | "up";

// value renders the headline figure; delta/trend props drive the optional chip.
export interface KpiCardProps {
  delta?: string | null;
  deltaTone?: "negative" | "neutral" | "positive";
  icon: string;
  inverse?: boolean;
  label: string;
  loading?: boolean;
  trend?: TrendDirection | null;
  trendLabel?: string | null;
  trendTone?: "negative" | "neutral" | "positive";
  trendValue?: string | number | null;
  value: ReactNode;
}

// Static delta-chip colors keyed by tone; exponent props reuse these exact mappings.
const DELTA_TONES = {
  negative: "text-destructive",
  neutral: "text-muted-foreground",
  positive: "text-success",
} as const;

// Direction takes precedence when given; otherwise it's inferred from the delta's tone.
function resolveTrend(
  trend?: TrendDirection | null,
  deltaTone?: "negative" | "neutral" | "positive"
): TrendDirection | null {
  if (trend) {
    return trend;
  }
  if (deltaTone === "positive") {
    return "up";
  }
  if (deltaTone === "negative") {
    return "down";
  }
  return null;
}

// Chip color: explicit tone wins; otherwise "up" reads positive unless the card is inverted.
function resolveTrendTone(
  trend: TrendDirection,
  trendTone?: "negative" | "neutral" | "positive",
  inverse?: boolean
): "negative" | "neutral" | "positive" {
  if (trendTone) {
    return trendTone;
  }
  if (trend === "neutral") {
    return "neutral";
  }
  if (inverse) {
    return trend === "down" ? "positive" : "negative";
  }
  return trend === "up" ? "positive" : "negative";
}

// A sign prefix on the chip value is dropped because the arrow icon already shows direction.
const SIGN_REGEX = /^[+-]/;

function cleanTrendValue(
  val: string | number | null | undefined
): string | null {
  if (val === null || val === undefined) {
    return null;
  }
  return String(val).replace(SIGN_REGEX, "");
}

// Renders the direction arrow glyph for a chip, or nothing when the trend is neutral.
function TrendIcon({ trend }: { trend: TrendDirection }) {
  if (trend === "up") {
    return <i aria-hidden="true" className="ri-arrow-up-line text-[12px]" />;
  }
  if (trend === "down") {
    return <i aria-hidden="true" className="ri-arrow-down-line text-[12px]" />;
  }
  return null;
}

// Small pill that displays the trend arrow, formatted value, and tone-coded color.
function TrendBadge({
  trend,
  tone,
  displayValue,
}: {
  trend: TrendDirection;
  tone: "negative" | "neutral" | "positive";
  displayValue?: string | number | null;
}) {
  const toneClasses = {
    negative: "text-destructive",
    neutral: "text-muted-foreground",
    positive: "text-success",
  };

  // Clean display copy has the leading sign stripped and empties collapsed.
  const formattedValue = cleanTrendValue(displayValue);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium text-[12px] tabular-nums leading-none",
        toneClasses[tone]
      )}
    >
      <TrendIcon trend={trend} />
      {formattedValue ? <span>{formattedValue}</span> : null}
    </span>
  );
}

// KPI cell: icon, label, headline value, and an optional trend/delta chip.
export function KpiCard({
  delta,
  deltaTone = "neutral",
  icon,
  inverse = false,
  label,
  loading = false,
  trend,
  trendLabel,
  trendTone,
  trendValue,
  value,
}: KpiCardProps) {
  // Resolve chip direction from the explicit trend, or infer it from the delta tone.
  const effectiveTrend = resolveTrend(trend, deltaTone);
  // Resolve the chip color; falls to neutral when no trend is shown at all.
  const effectiveTone = effectiveTrend
    ? resolveTrendTone(effectiveTrend, trendTone, inverse)
    : "neutral";
  // Prefer the explicit trend value, else reuse the delta as the display figure.
  const displayTrendValue = trendValue ?? (trend ? delta : null);

  return (
    // Card body is a horizontal flex: leading icon tile, then the value block.
    <div className="flex items-center gap-3.5">
      {/* Circular icon tile mirrors the page theme and stays fixed-width. */}
      <div
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-foreground/80 shadow-xs"
      >
        <i className={cn(icon, "text-[20px]")} />
      </div>

      {/* Text column: label on top, then either skeleton or the live figures. */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-foreground text-sm">
          {label}
        </p>

        {/* While loading, a pulsing skeleton keeps the row height stable. */}
        {loading ? (
          <div className="mt-1.5 h-7 w-20 animate-pulse rounded-md bg-muted" />
        ) : (
          // Secondary row lays out the big number next to any trend/delta chips.
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            {/* Headline figure is the largest text on the card. */}
            <p className="font-semibold text-[24px] tabular-nums leading-none tracking-tight">
              {value}
            </p>

            {/* Directional chip (arrow + value) appears only when a trend resolves. */}
            {effectiveTrend ? (
              <TrendBadge
                displayValue={displayTrendValue}
                tone={effectiveTone}
                trend={effectiveTrend}
              />
            ) : null}

            {/* Plain delta pill colors the delta itself when no trend chip is shown. */}
            {!effectiveTrend && delta ? (
              <span
                className={cn(
                  "font-medium text-[11.5px]",
                  DELTA_TONES[deltaTone]
                )}
              >
                {delta}
              </span>
            ) : null}

            {/* Free-text trendLabel tacks on extra context like a comparison period. */}
            {trendLabel ? (
              <span className="text-[11px] text-muted-foreground">
                {trendLabel}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// Grid strip that lays out multiple KPI cards with responsive dividers.
export function KpiStrip({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 border-border border-y",
        "[&>*]:border-border/60 [&>*]:py-5 [&>*]:pr-5",
        "max-sm:[&>*+*]:border-t",
        "sm:grid-cols-2",
        "sm:[&>*:nth-child(even)]:border-l",
        "sm:[&>*:nth-child(even)]:pl-5",
        "sm:[&>*:nth-child(n+3)]:border-t",
        "xl:grid-cols-4",
        "xl:[&>*:nth-child(n+2)]:border-l",
        "xl:[&>*:nth-child(n+2)]:pl-5",
        "xl:[&>*:nth-child(n+3)]:border-t-0"
      )}
    >
      {children}
    </div>
  );
}
