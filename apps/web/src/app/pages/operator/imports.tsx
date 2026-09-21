// Shared types for upload batches, their validation summaries, and failed rows
import type { BatchSummary, FailedRow, UploadBatch } from "@repo/types";
// Pagination and drawer-selection state for the history table
import { useState } from "react";
// Router hook for the "Upload New File" CTA navigation
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/dashboard/page-header";
import { BatchStatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
// Sheet (side drawer) renders the per-batch detail view
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
// Upload list hook + per-batch validation summary hook (polled while processing)
import { useUploadBatchSummary, useUploads } from "@/hooks/use-uploads";

/* Spec §4.3 — Import History with per-batch detail drawer (Module A). */

// Map internal file-type enums to friendly display labels
const FILE_TYPE_LABELS: Record<string, string> = {
  document_manifest: "Document manifest",
  loan_tape: "Loan tape",
  servicer_update: "Servicer update",
};

// formatDate: compact timestamp rendering for the history table and drawer
function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

// SummaryGrid: stat tiles (parsed/imported/failed) plus metadata rows for a single batch
function SummaryGrid({ batch }: { batch: UploadBatch }) {
  // Three headline numbers derived from the batch record counts
  const stats = [
    { label: "Rows parsed", value: batch.recordCount },
    {
      label: "Rows imported",
      value: batch.processedCount ?? batch.recordCount - batch.failedCount,
    },
    { label: "Rows failed", value: batch.failedCount },
  ];
  // Batch metadata holds extra pipeline context (duplicates skipped, stage, etc.)
  const meta = (batch.metadata ?? {}) as Record<string, unknown>;
  const duplicates = Number(meta.skippedDuplicates ?? 0);

  return (
    <div className="space-y-4">
      {/* Three-column stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <div
            className="rounded-lg border border-border bg-muted/40 p-3"
            key={stat.label}
          >
            <p className="font-medium text-[10.5px] text-muted-foreground uppercase tracking-wider">
              {stat.label}
            </p>
            <p className="mt-1 font-semibold text-[20px] tabular-nums tracking-tight">
              {stat.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
      {/* Key-value metadata list for the batch */}
      <dl className="space-y-1.5 text-[12.5px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Source file</dt>
          <dd className="truncate font-mono text-[11.5px]">{batch.fileName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">File type</dt>
          <dd>{FILE_TYPE_LABELS[batch.fileType] ?? batch.fileType}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Duplicates skipped</dt>
          {/* Dedupe count from processing metadata, formatted with thousands separators */}
          <dd className="tabular-nums">{duplicates.toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Uploaded</dt>
          <dd className="font-mono text-[11.5px]">
            {formatDate(batch.createdAt)}
          </dd>
        </div>
        {/* Pipeline stage only shows once the batch has progressed past ingestion */}
        {meta.pipelineStage ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Pipeline stage</dt>
            <dd className="capitalize">{String(meta.pipelineStage)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

// FailedRowsTable: compact table of a batch's failed source rows (capped at 50 rows)
function FailedRowsTable({ rows }: { rows: FailedRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="w-16">Row</TableHead>
            <TableHead>Raw values</TableHead>
            <TableHead className="w-44">Failure reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* First 50 failures render; raw values truncated to keep the drawer tidy */}
          {rows.slice(0, 50).map((row) => (
            <TableRow key={row.rowNumber}>
              <TableCell className="font-mono text-[12px] tabular-nums">
                {row.rowNumber}
              </TableCell>
              <TableCell className="max-w-[260px] truncate font-mono text-[11px] text-muted-foreground">
                {row.rawData}
              </TableCell>
              <TableCell className="text-[12px] text-destructive">
                {row.reason}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* When more than 50 failures exist, note the cap so users know it is truncated */}
      {rows.length > 50 ? (
        <p className="border-border border-t px-3 py-2 text-[11.5px] text-muted-foreground">
          Showing first 50 of {rows.length} failed rows.
        </p>
      ) : null}
    </div>
  );
}

// ImportDetailDrawer: slide-over panel showing stats, validation breakdown, and failed rows for one batch
function ImportDetailDrawer({
  batch,
  onClose,
}: {
  batch: UploadBatch | null;
  onClose: () => void;
}) {
  // Fetch the batch's validation summary; polling enabled only while the batch is processing
  const { data: summary, isLoading: summaryLoading } = useUploadBatchSummary(
    batch?.id ?? "",
    batch?.status === "processing"
  );

  return (
    // Sheet open state is driven directly by whether a batch is selected; close resets selection
    <Sheet
      onOpenChange={(open) => (open ? undefined : onClose())}
      open={Boolean(batch)}
    >
      {/* Fixed-width drawer with its own scroll for long content */}
      <SheetContent className="w-[440px] gap-0 overflow-y-auto sm:max-w-[440px]">
        {batch ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="truncate font-mono text-[15px]">
                {batch.fileName}
              </SheetTitle>
              {/* Status badge + upload timestamp under the title */}
              <SheetDescription className="flex items-center gap-2">
                <BatchStatusBadge status={batch.status} />
                <span>{formatDate(batch.createdAt)}</span>
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 p-5">
              {/* Headline parse/import/failed stats */}
              <SummaryGrid batch={batch} />

              {/* Validation breakdown once the summary has loaded */}
              {summary ? <ValidationBreakdown summary={summary} /> : null}
              {/* Skeleton while the summary is still being fetched */}
              {summaryLoading && !summary ? (
                <div className="space-y-2">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-3/4" />
                </div>
              ) : null}

              {/* Failed rows sub-section handles empty/failed/clean states */}
              <section className="space-y-2">
                <h4 className="font-semibold text-[13px] tracking-tight">
                  Failed rows
                </h4>
                <FailedRowsSection batch={batch} />
              </section>

              {/* Lineage note tying every imported row back to this file through the pipeline */}
              <p className="border-border border-t pt-3 text-[11px] text-muted-foreground">
                Lineage: every row imported from this file carries its batch and
                row reference through validation, review, and export.
              </p>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// FailedRowsSection: picks the right render for a batch's failed rows (table, note, or clean state)
function FailedRowsSection({ batch }: { batch: UploadBatch }) {
  if (batch.failedRows && batch.failedRows.length > 0) {
    // Detailed row data is embedded in the batch payload: show the full table
    return <FailedRowsTable rows={batch.failedRows} />;
  }
  if (batch.failedCount > 0) {
    // Failures exist but row details were not attached: point to the processing log
    return (
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12.5px] text-muted-foreground">
        {batch.failedCount} rows failed import. Detailed row data is available
        in the batch processing log.
      </p>
    );
  }
  // Zero failures: green confirmation that the import was clean
  return (
    <p className="rounded-lg border border-success/25 bg-success/8 px-3 py-2.5 text-[12.5px] text-success">
      No failed rows — clean import.
    </p>
  );
}

// ValidationBreakdown: passed / failed / total counts for a finished batch's validation run
function ValidationBreakdown({ summary }: { summary: BatchSummary }) {
  // Rows are defined declaratively so tone + label + value stay together
  const rows = [
    {
      label: "Passed validation",
      tone: "text-success",
      value: summary.passedValidation,
    },
    {
      label: "Failed validation",
      tone: "text-destructive",
      value: summary.failedValidation,
    },
    { label: "Total imported", tone: "", value: summary.totalImported },
  ];
  return (
    <section className="space-y-2">
      <h4 className="font-semibold text-[13px] tracking-tight">
        Validation breakdown
      </h4>
      <div className="overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <div
            className="flex items-center justify-between border-border border-b px-3 py-2 text-[12.5px] last:border-b-0"
            key={row.label}
          >
            {/* Label colored by outcome (success/error/neutral) */}
            <span className={row.tone || "text-muted-foreground"}>
              {row.label}
            </span>
            <span className="font-medium tabular-nums">
              {row.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ImportHistoryPage: full paginated upload history table with a detail drawer per batch (Module A §4.3)
export default function ImportHistoryPage() {
  // Used by the "Upload New File" CTA
  const navigate = useNavigate();
  // Current page state for the paginated table
  const [page, setPage] = useState(1);
  // The batch whose detail drawer is currently open (null = closed)
  const [selected, setSelected] = useState<UploadBatch | null>(null);
  // Fetch the uploads for the active page
  const { data, isLoading } = useUploads(page);

  const batches = data?.data ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;

  // renderTable: skeleton, empty, or the paginated rows table
  function renderTable() {
    if (isLoading) {
      // Placeholder bars matching the table row height
      return (
        <div className="space-y-2 p-4">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton className="h-10 w-full" key={row} />
          ))}
        </div>
      );
    }
    if (batches.length === 0) {
      // First-run nudge when there are no imports yet
      return (
        <p className="px-5 py-14 text-center text-[13px] text-muted-foreground">
          No imports yet — upload your first loan tape.
        </p>
      );
    }
    return (
      <>
        {/* History table: file, type, counts, status, upload time */}
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>File</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uploaded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Clicking any row opens its detail drawer */}
            {batches.map((batch) => (
              <TableRow
                className="cursor-pointer"
                key={batch.id}
                onClick={() => setSelected(batch)}
              >
                <TableCell className="max-w-[220px] truncate font-medium text-[13px]">
                  <span className="flex items-center gap-2">
                    <i
                      aria-hidden="true"
                      className="ri-file-3-line text-muted-foreground/60"
                    />
                    {batch.fileName}
                  </span>
                </TableCell>
                <TableCell className="text-[12.5px] text-muted-foreground">
                  {FILE_TYPE_LABELS[batch.fileType] ?? batch.fileType}
                </TableCell>
                {/* Right-aligned row count in monospace */}
                <TableCell className="text-right font-mono text-[12.5px] tabular-nums">
                  {batch.recordCount.toLocaleString()}
                </TableCell>
                {/* Failed count emphasized in destructive red when > 0, muted otherwise */}
                <TableCell className="text-right">
                  {batch.failedCount > 0 ? (
                    <span className="font-medium text-destructive tabular-nums">
                      {batch.failedCount}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50 tabular-nums">
                      0
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <BatchStatusBadge status={batch.status} />
                </TableCell>
                <TableCell className="text-[12.5px] text-muted-foreground">
                  {formatDate(batch.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* Pagination controls appear only when there is more than one page */}
        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-border border-t px-5 py-3">
            <p className="text-[12px] text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              {/* Previous is disabled on the first page */}
              <Button
                className="rounded-full px-3 text-xs"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                size="sm"
                variant="outline"
              >
                Previous
              </Button>
              {/* Next is disabled on the last page */}
              <Button
                className="rounded-full px-3 text-xs"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                size="sm"
                variant="outline"
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-8">
      <PageHeader
        action={
          // Primary CTA back into the upload flow
          <Button
            className="rounded-full"
            onClick={() => navigate("/operator/upload")}
          >
            <i aria-hidden="true" className="ri-upload-cloud-2-line" />
            Upload New File
          </Button>
        }
        description="Every ingest with its parse results, failures, and lineage."
        eyebrow="Data Operator"
        title="Import History"
      />

      {/* Table area renders current page (or skeleton/empty) */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        {renderTable()}
      </section>

      {/* Drawer bound to the selected batch; closing resets the selection */}
      <ImportDetailDrawer batch={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
