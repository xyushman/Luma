// TanStack Query drives the summarize-batch call; React state handles the refresh; shared UI pulls helpers.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { aiApi } from "@/lib/api";
import { cn } from "@/lib/utils";

/* Spec §5.1 — AI Batch Summary widget (Module D). Renders AI output in the
   AISuggestionCard shape: recommendation body, model/timestamp metadata
   footer, and a refresh action. */

// Response shape from the summarize-batch endpoint: model, generated text, and pin time.
interface SummaryData {
  model: string;
  summary: string | null;
  timestamp: string;
}

// Presents the AI summary text plus a provenance footer (file, model, generation time).
function SummaryBody({
  data,
  fileName,
}: {
  data: SummaryData;
  fileName?: string;
}) {
  return (
    <>
      {/* The generated narrative falls back to a placeholder when the model produced none. */}
      <p className="text-[13.5px] text-foreground/90 leading-relaxed">
        {data.summary ?? "No summary generated for this batch yet."}
      </p>
      {/* Self-serve provenance footer: file chip, mono model name, and pinned time. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-primary/15 border-t pt-2.5 text-[11px] text-muted-foreground">
        {fileName ? (
          <>
            {/* File chip names the batch that produced this insight. */}
            <span className="font-medium text-foreground/80">
              <i
                aria-hidden="true"
                className="ri-file-3-line mr-1 text-[12px]"
              />
              {fileName}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        {/* Mono model name identifies which AI generated the insight. */}
        <span className="font-mono">{data.model}</span>
        <span aria-hidden="true">·</span>
        {/* Pinned generation timestamp shows how fresh this insight is. */}
        <span>
          {new Date(data.timestamp).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </>
  );
}

// Dashboard widget that calls summarize-batch and re-runs it on demand via refresh.
export function AiBatchSummary({
  batchId,
  fileName,
}: {
  batchId: string;
  fileName?: string;
}) {
  // Bumping nonce creates a new query key so Refresh always hits the API again.
  const [nonce, setNonce] = useState(0);
  // Query caches 60 seconds; refetch is retriggered by changing nonce in the key.
  const { data, error, isFetching, refetch } = useQuery({
    queryFn: () => aiApi.summarizeBatch(batchId),
    queryKey: ["ai-batch-summary", batchId, nonce],
    staleTime: 60_000,
  });

  // Picks error text, the summary, or skeleton lines while the call settles.
  function renderBody() {
    if (error) {
      // On failure, show a lightweight message and let the user retry via refresh.
      return (
        <p className="text-[13px] text-muted-foreground">
          AI summary unavailable right now. Click refresh to try again.
        </p>
      );
    }
    if (data) {
      // On success, delegate rendering to the SummaryBody presenter.
      return <SummaryBody data={data} fileName={fileName} />;
    }
    // Skeleton lines mimic text height while the summary streams in.
    return (
      <div className="space-y-2">
        <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    // Card container uses the primary token so AI insights stay visually distinct.
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.03] p-5 shadow-xs"
      )}
    >
      {/* Header row: sparkle icon, title/subtitle block, and the refresh action. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
            <i aria-hidden="true" className="ri-sparkling-2-line text-[14px]" />
          </span>
          <div>
            {/* Title plus an optional file chip sit on the same line. */}
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-[14px] tracking-tight">
                AI batch summary
              </h3>
              {fileName ? (
                <span className="rounded-md border border-border bg-muted/60 px-2 py-0.5 font-medium text-[11.5px] text-foreground">
                  {fileName}
                </span>
              ) : null}
            </div>
            {/* Subtitle explains what this box summarizes. */}
            <p className="text-[11.5px] text-muted-foreground">
              {fileName
                ? `Automated anomaly & validation insight for ${fileName}`
                : "Automated anomaly & validation insight"}
            </p>
          </div>
        </div>
        {/* Refresh re-runs summarize-batch; the icon spins while fetching. */}
        <button
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          disabled={isFetching}
          onClick={() => {
            setNonce((n) => n + 1);
            void refetch();
          }}
          type="button"
        >
          <i
            aria-hidden="true"
            className={cn(
              "ri-refresh-line text-sm",
              isFetching && "animate-spin"
            )}
          />
        </button>
      </div>

      {/* Body switches between skeleton, error text, and the full summary. */}
      {renderBody()}
    </div>
  );
}
