// Shared type for rows that failed import normalization
import type { FailedRow } from "@repo/types";
// QueryClient lets us invalidate/stale caches once a batch finishes processing
import { useQueryClient } from "@tanstack/react-query";
// Side-effect hook: refresh related queries when the batch reaches "done"
import { useEffect } from "react";
// Reads the :batchId URL param for this route
import { useParams } from "react-router-dom";
// Toast feedback after downloading failed rows
import { toast } from "sonner";
// AI-generated summary of the batch's exceptions (HITL scope)
import { AiSummaryPanel } from "@/components/batch/ai-summary-panel";
import { BatchStatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
// Visual stepper showing parse -> import -> validate pipeline progress
import { PipelineTracker } from "@/components/upload/pipeline-stepper";
import {
  ImportSummaryCard,
  ValidationSummaryCard,
} from "@/components/upload/validation-summary";
// Batch + summary data hooks (summary is enabled only after processing finishes)
import { useUploadBatch, useUploadBatchSummary } from "@/hooks/use-uploads";
import { downloadAsCsv } from "@/lib/download";

// FailedRowsTable: table of rows that could not be normalized; empty state when all rows imported cleanly
function FailedRowsTable({ rows }: { rows?: FailedRow[] }) {
  if (!rows?.length) {
    return (
      <CardContent>
        <p className="text-center text-muted-foreground text-sm">
          All rows imported cleanly.
        </p>
      </CardContent>
    );
  }
  return (
    <CardContent className="px-0 pb-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Row</TableHead>
            <TableHead>Raw data</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* One row per failed source row: number, raw CSV values, and the parse reason */}
          {rows.map((row) => (
            <TableRow key={row.rowNumber}>
              <TableCell className="pl-4 tabular-nums">
                {row.rowNumber}
              </TableCell>
              {/* Truncated raw values to keep the table compact */}
              <TableCell className="max-w-md truncate text-muted-foreground text-xs">
                {row.rawData}
              </TableCell>
              {/* Failure reason styled with the destructive tone */}
              <TableCell className="text-destructive text-xs">
                {row.reason}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent>
  );
}

// BatchDetailPage: per-batch drill-down showing pipeline progress, import/validation summaries, and AI notes
export default function BatchDetailPage() {
  // Access to the global query cache for invalidation after batch completion
  const queryClient = useQueryClient();
  // :batchId from the /operator/uploads/:batchId route
  const { batchId } = useParams<{ batchId: string }>();
  const id = batchId ?? "";
  // Fetch the batch record (fileName, status, counts, metadata)
  const { data: batch, isLoading } = useUploadBatch(id);
  // While the batch is still uploading/parsing, the validation summary has no data yet
  const processing = batch?.status === "processing";
  // Summary query is enabled only once processing is complete (returns data after validation runs)
  const { data: summary, isPending: summaryPending } = useUploadBatchSummary(
    id,
    processing
  );

  // When a batch finishes, refresh everything downstream so dashboards/charts show fresh numbers
  useEffect(() => {
    if (batch?.status === "done") {
      // This batch's validation summary just became available
      void queryClient.invalidateQueries({
        queryKey: ["uploads", id, "summary"],
      });
      // Exception queues and KPI summaries may have changed with the completed run
      void queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
      void queryClient.invalidateQueries({ queryKey: ["uploads"] });
    }
  }, [batch?.status, id, queryClient]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Heading row: batch file name plus its live status badge */}
      <div className="flex items-center gap-3">
        <h1 className="font-semibold text-[28px] tracking-tight">
          {batch?.fileName ?? "Batch"}
        </h1>
        {batch ? <BatchStatusBadge status={batch.status} /> : null}
      </div>

      {/* While the batch record is loading, show skeleton placeholders */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {/* Pipeline stepper visualizes parse -> normalize -> validate lifecycle progress */}
      {batch ? (
        <PipelineTracker
          failedCount={batch.failedCount}
          metadata={batch.metadata}
          processedCount={batch.processedCount}
          recordCount={batch.recordCount}
          status={batch.status}
        />
      ) : null}

      {/* Failed batch: red alert card with the exact error (retry is idempotent by design) */}
      {batch?.status === "failed" ? (
        <Card className="rounded-xl border border-destructive/30 bg-destructive/8 shadow-none">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="flex items-center gap-2 font-semibold text-destructive text-sm">
              <i aria-hidden="true" className="ri-error-warning-line text-lg" />
              Ingestion Failed
            </CardTitle>
            <CardDescription className="mt-1 text-[13px] text-destructive/90">
              The CSV stream stopped before completing. Fix the source file and
              re-upload — partially imported rows are kept and a retry is
              idempotent.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {/* Show the stored error string, or ask the user to check logs when unknown */}
            <pre className="custom-scrollbar-hide max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-destructive/25 bg-destructive/5 p-3 font-mono text-[11px] text-destructive/90">
              {String(
                (batch.metadata as Record<string, unknown> | null)?.error ??
                  `Unknown error — check the API logs for batch ${batch.id}`
              )}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {/* Import summary (parsed vs imported counts) only after processing settles */}
      {processing || isLoading ? null : (
        <ImportSummaryCard
          failedCount={batch?.failedCount ?? 0}
          processedCount={batch?.processedCount}
          recordCount={batch?.recordCount ?? 0}
        />
      )}

      {/* Failed rows card with a CSV download action */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Failed rows</CardTitle>
            <CardDescription>
              Rows that could not be normalized (capped at first 1,000).
            </CardDescription>
          </div>
          {/* Download button only appears when there are failed rows to export */}
          {batch?.failedRows?.length ? (
            <Button
              onClick={() => {
                // Serialize the failed rows and save as a CSV on the client
                const rows = batch.failedRows ?? [];
                downloadAsCsv(
                  `failed_rows_${batch.id}.csv`,
                  ["row_number", "raw_data", "reason"],
                  rows.map((row) => [
                    String(row.rowNumber),
                    row.rawData,
                    row.reason,
                  ])
                );
                toast.success(`Downloaded ${rows.length} failed rows`);
              }}
              size="sm"
              variant="outline"
            >
              <i aria-hidden="true" className="ri-download-2-line" />
              Download failed rows
            </Button>
          ) : null}
        </CardHeader>
        <FailedRowsTable rows={batch?.failedRows} />
      </Card>

      {/* While processing, the validation summary card renders in a loading state */}
      {processing ? <ValidationSummaryCard summary={null} /> : null}

      {/* Summary query pending (post-processing): show a placeholder skeleton block */}
      {!processing && summaryPending ? (
        <Skeleton className="h-64 w-full" />
      ) : null}

      {/* Once the validation summary exists, render it with the per-rule breakdown */}
      {processing || summaryPending ? null : (
        <ValidationSummaryCard summary={summary ?? null} />
      )}

      {/* AI review panel appears only for completed batches; advisory, audited, and rate-limited */}
      {batch && batch.status === "done" ? (
        <AiSummaryPanel batchId={batch.id} />
      ) : null}
    </div>
  );
}
