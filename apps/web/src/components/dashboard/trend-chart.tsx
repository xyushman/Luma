// Recharts renders the SVG chart; the shadcn chart primitives supply the themable container and tooltip.
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { ChartConfig } from "@/components/ui/chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

/* Spec §3 — TrendChart: single-series area chart on the chart-1 token. */

// Color/label tokens are shared with ChartContainer so the tooltip and grid inherit the theme.
const trendConfig = {
  value: {
    color: "var(--chart-1)",
    label: "Records",
  },
} satisfies ChartConfig;

// Round Y-axis tick step and scale floor keep gridlines on clean, comparable values.
const TICK_STEP = 250;
const MIN_UPPER_BOUND = 1000;

// Rounds the Y domain up to clean 250-tick steps and returns the tick marks for the YAxis.
function computeYAxisConfig(data: object[], dataKey: string) {
  // Running maximum, seeded at zero and updated while walking the rows below.
  let max = 0;
  // Scan every row for the highest numeric value of the plotted data key.
  for (const item of data) {
    const val = (item as Record<string, unknown>)[dataKey];
    if (typeof val === "number" && val > max) {
      max = val;
    }
  }

  // Clamp the axis top to a step multiple, with a floor so short series keep a readable scale.
  const upper = Math.max(
    MIN_UPPER_BOUND,
    Math.ceil(max / TICK_STEP) * TICK_STEP
  );
  const ticks: number[] = [];
  // Fill ticks from 0 to upper at the fixed step so gridlines land on round values.
  for (let tick = 0; tick <= upper; tick += TICK_STEP) {
    ticks.push(tick);
  }

  // Return the clean upper bound as a domain plus the round tick marks for the Y axis.
  return { domain: [0, upper] as [number, number], ticks };
}

// Props: the time-series rows to plot plus optional value/label keys, outer height, and a class.
export interface TrendChartProps {
  className?: string;
  data: object[];
  dataKey?: string;
  height?: number;
  labelKey?: string;
}

// Renders a single-series area chart; dataKey/labelKey let any time-series rows be plotted.
export function TrendChart({
  className,
  data,
  dataKey = "value",
  height = 250,
  labelKey = "label",
}: TrendChartProps) {
  // Axis ticks recompute only when the plotted rows or the data key change.
  const yConfig = useMemo(
    () => computeYAxisConfig(data, dataKey),
    [data, dataKey]
  );

  return (
    // ChartContainer applies the shared color tokens; the inline style fixes the SVG's outer height.
    <ChartContainer
      className={className}
      config={trendConfig}
      style={{ height }}
    >
      {/* AreaChart maps the rows; the accessibility layer adds ARIA so the chart is screen-reader friendly. */}
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{ bottom: 0, left: 4, right: 12, top: 8 }}
      >
        {/* Gradient fill fades the accent down to transparent so the area stays subtle. */}
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            {/* Fill is most visible at the top and fades out entirely by the baseline. */}
            <stop
              offset="0%"
              stopColor="var(--color-value)"
              stopOpacity={0.22}
            />
            <stop
              offset="100%"
              stopColor="var(--color-value)"
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
        {/* Dashed horizontal gridlines only; vertical lines would fight the time labels. */}
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        {/* X labels come from labelKey; minTickGap thins them out when space is tight. */}
        <XAxis
          axisLine={false}
          dataKey={labelKey}
          minTickGap={28}
          tickLine={false}
          tickMargin={8}
        />
        {/* Y axis uses the precomputed domain/ticks; values render grouped with commas. */}
        <YAxis
          allowDecimals={false}
          axisLine={false}
          domain={yConfig.domain}
          tickFormatter={(val: number) => val.toLocaleString()}
          tickLine={false}
          tickMargin={8}
          ticks={yConfig.ticks}
          width={42}
        />
        {/* Tooltip shows the hovered value; hideLabel drops the redundant series name. */}
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        {/* Area draws the filled series; monotone eases the curve for time data. */}
        <Area
          dataKey={dataKey}
          fill="url(#trend-fill)"
          stroke="var(--color-value)"
          strokeWidth={1.75}
          type="monotone"
        />
      </AreaChart>
    </ChartContainer>
  );
}
