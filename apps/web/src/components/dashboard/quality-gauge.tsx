// Recharts radial primitives draw the donut; shadcn ChartContainer applies theme tokens.
import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";

/* Spec §3 — QualityScoreGauge: radial donut for the data-quality score. */

// Single radial series maps the score to the chart-1 accent token.
const gaugeConfig = {
  score: {
    color: "var(--chart-1)",
    label: "Quality",
  },
} satisfies ChartConfig;

// Shows decimals only where they matter, rounding to a plain integer at 10 and above.
function formatScoreText(val: number): string {
  if (val === 0) {
    return "0";
  }
  if (val < 1) {
    return val.toFixed(2);
  }
  if (val < 10) {
    return val.toFixed(1);
  }
  return String(Math.round(val));
}

// Dashboard donut: the verified data-quality score rendered as a radial gauge.
export function QualityScoreGauge({
  className,
  score,
  size = 168,
}: {
  className?: string;
  score: number;
  size?: number;
}) {
  // Clamp the score to 0–100 so an out-of-range feed value can't distort the donut.
  const clamped = Math.max(0, Math.min(100, score));
  // Recharts needs an array; fill pulls the color from the "score" chart token.
  const data = [{ fill: "var(--color-score)", name: "score", value: clamped }];

  return (
    // Outer box is square; the chart plus its centered overlay share this container.
    <div
      className={className}
      style={{ height: size, position: "relative", width: size }}
    >
      {/* ChartContainer applies the theme; the ring SVG is sized to the square prop box. */}
      <ChartContainer
        config={gaugeConfig}
        style={{ height: size, width: size }}
      >
        {/* Radial bar with a 270-degree sweep draws the percentage as a quarter-open ring. */}
        <RadialBarChart
          barSize={10}
          data={data}
          endAngle={90}
          innerRadius="82%"
          startAngle={-270}
        >
          {/* Pinned 0–100 axis with hidden ticks makes the bar behave like a percentage. */}
          <PolarAngleAxis
            angleAxisId={0}
            domain={[0, 100]}
            tick={false}
            type="number"
          />
          {/* Pill-capped bar draws the score; background fill carves out the muted track. */}
          <RadialBar
            angleAxisId={0}
            background={{ fill: "var(--muted)" }}
            cornerRadius={999}
            dataKey="value"
          />
        </RadialBarChart>
      </ChartContainer>
      {/* Centered overlay: formatted score plus the "Verified" caption naming the metric. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {/* Big numeric score with a small percent suffix dominates the gauge center. */}
        <p className="font-semibold text-[30px] tabular-nums leading-none tracking-tight">
          {formatScoreText(clamped)}
          <span className="text-lg text-muted-foreground">%</span>
        </p>
        {/* Small-caps caption names the metric the score represents. */}
        <p className="mt-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          Verified
        </p>
      </div>
    </div>
  );
}
