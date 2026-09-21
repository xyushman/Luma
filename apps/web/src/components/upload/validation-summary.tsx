// Shared shadcn cards, badges, and stats render validation output; types model the summary.
import type { ExceptionType, Severity } from "@repo/types";
import { SeverityBadge } from "@/components/ui/badges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";

// Operator-facing totals: rows staged, rows imported, and malformed rows isolated.
export function ImportSummaryCard({
  recordCount,
  processedCount,
  failedCount,
  processing,
}: {
  recordCount: number;
  processedCount?: number;
  failedCount: number;
  processing?: boolean;
}) {
  return (
    // Three stat tiles summarize the ingest phase of the pipeline.
    <div className="grid gap-3 sm:grid-cols-3">
      {/* Every row read from the file, including those that will fail parsing. */}
      <StatCard
        hint={processing ? "processing..." : undefined}
        icon="ri-stack-line"
        label="Total rows"
        value={recordCount.toLocaleString()}
      />
      {/* Rows that made it through normalization; hint tracks streaming completion. */}
      <StatCard
        hint={
          processedCount !== undefined && processedCount < recordCount
            ? `${Math.round((processedCount / Math.max(recordCount, 1)) * 100)}% complete`
            : undefined
        }
        icon="ri-check-double-line"
        label="Imported"
        value={(processedCount ?? recordCount - failedCount).toLocaleString()}
      />
      {/* Rows isolated by schema/parse that will never reach validation. */}
      <StatCard
        icon="ri-close-circle-line"
        label="Failed rows"
        value={failedCount.toLocaleString()}
      />
    </div>
  );
}

// Validation widget: counts passed/failed plus breakdowns by type and severity.
export function ValidationSummaryCard({
  summary,
}: {
  summary: {
    exceptionsBySeverity: Record<Severity, number>;
    exceptionsByType: Record<ExceptionType, number>;
    failedValidation: number;
    passedValidation: number;
    totalImported: number;
  } | null;
}) {
  // Nothing renders until the batch finishes validation and returns a summary.
  if (!summary) {
    return null;
  }

  // Exception counts by rule type, sorted highest first for the list bars.
  const typeEntries = Object.entries(summary.exceptionsByType).sort(
    (a, b) => b[1] - a[1]
  );
  // Peak count is the divisor so the longest bar reaches 100% width.
  const maxType = typeEntries[0]?.[1] ?? 0;

  return (
    // Top strip holds pass/fail stat cards; two breakdown cards sit below it.
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="grid gap-3 lg:col-span-3 lg:grid-cols-3">
        {/* Rows that cleared all ten rules and the duplicate engine. */}
        <StatCard
          icon="ri-checkbox-circle-line"
          label="Passed validation"
          value={summary.passedValidation.toLocaleString()}
        />
        {/* Rows flagged by at least one automated validation rule. */}
        <StatCard
          icon="ri-error-warning-line"
          label="Failed validation"
          value={summary.failedValidation.toLocaleString()}
        />
        {/* Imported rows entering validation plus the derived clean-rate hint. */}
        <StatCard
          hint={`${Math.round((summary.passedValidation / Math.max(summary.totalImported, 1)) * 100)}% clean rate`}
          icon="ri-database-2-line"
          label="Total imported"
          value={summary.totalImported.toLocaleString()}
        />
      </div>

      {/* Histogram card groups failures by exception type with proportional bars. */}
      <Card className="lg:col-span-2">
        {/* Header names the grouping and what each bar represents. */}
        <CardHeader>
          <CardTitle>Exceptions by type</CardTitle>
          <CardDescription>Validation failures grouped by rule</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* One row per rule type: label, count, and a bar scaled to the max. */}
          {typeEntries.map(([type, count]) => (
            <div className="space-y-1" key={type}>
              {/* Rule label versus its count lays out as one readable line. */}
              <div className="flex justify-between text-sm">
                <span className="capitalize">{type.replaceAll("_", " ")}</span>
                <span className="text-muted-foreground tabular-nums">
                  {count}
                </span>
              </div>
              {/* Bar width normalizes against the largest type so sizes compare. */}
              <Progress value={maxType > 0 ? (count / maxType) * 100 : 0} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Severity card ranks counts so critical items get attention first. */}
      <Card>
        {/* Header prompts reviewers to triage critical items first. */}
        <CardHeader>
          <CardTitle>By severity</CardTitle>
          <CardDescription>Critical items need attention first</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Each severity row pairs the colored badge with its plain count. */}
          {(
            Object.entries(summary.exceptionsBySeverity) as [Severity, number][]
          ).map(([severity, count]) => (
            <div className="flex items-center justify-between" key={severity}>
              <SeverityBadge severity={severity} />
              <span className="font-medium text-sm tabular-nums">
                {count.toLocaleString()}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
