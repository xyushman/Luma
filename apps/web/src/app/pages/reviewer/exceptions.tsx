// Imports: shared exception types, React state/hooks, routing, and queue UI components.
import type {
  ExceptionListItem,
  ExceptionStatus,
  ExceptionType,
  Severity,
} from "@repo/types";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AiResolutionPanel } from "@/components/exceptions/ai-resolution-panel";
import { ExceptionQueueTable } from "@/components/exceptions/exception-table";
import { FilterBar } from "@/components/exceptions/filter-bar";
import { useExceptions } from "@/hooks/use-exceptions";
import {
  EMPTY_EXCEPTION_FILTERS,
  type ExceptionListFilters,
} from "@/hooks/use-exceptions-filters";

// Purpose: master-detail queue page — filterable exception table plus an AI resolution panel for the selected record.
export default function ExceptionQueuePage() {
  // Reads URL query params so the queue can be deep-linked (e.g. dashboard "?severity=critical").
  const [searchParams] = useSearchParams();
  // Initial severity comes from the URL, defaulting to no filter.
  const initialSeverity = (searchParams.get("severity") ?? "") as Severity | "";
  // Initial status defaults to "open" so reviewers land on actionable exceptions.
  const initialStatus = (searchParams.get("status") ?? "open") as
    | ExceptionStatus
    | "";
  // Initial exception-type filter from the URL.
  const initialType = (searchParams.get("type") ?? "") as ExceptionType | "";
  // Initial batch filter from the URL.
  const initialBatchId = searchParams.get("batchId") ?? "";
  // Initial search text from the URL.
  const initialSearch = searchParams.get("search") ?? "";

  // Local filter state seeded from defaults + URL; drives the server query (with 300ms debounce in the UI).
  const [filters, setFilters] = useState<ExceptionListFilters>(() => ({
    ...EMPTY_EXCEPTION_FILTERS,
    batchId: initialBatchId,
    search: initialSearch,
    severity: initialSeverity,
    status: initialStatus,
    type: initialType,
  }));
  // Tracks which row is selected so the right-hand AI panel can show that exception.
  const [selected, setSelected] = useState<ExceptionListItem | null>(null);
  // Fetches the filtered exception list; isFetching fires on background refetches too.
  const { data, isLoading, isFetching } = useExceptions(filters);

  // Patch helper used by FilterBar: merges partial filters and resets to page 1 for the new criteria.
  const patch = (partial: Partial<ExceptionListFilters>) =>
    setFilters((prev) => ({ ...prev, page: 1, ...partial }));

  // If the selected exception leaves the current page/set, clear the selection to avoid a stale detail panel.
  useEffect(() => {
    if (selected && !data?.data.some((item) => item.id === selected.id)) {
      setSelected(null);
    }
  }, [data, selected]);

  return (
    <div className="flex min-h-screen">
      {/* Full-height flex layout: scrollable table column on the left, fixed detail panel on the right. */}
      {/* Left column that scrolls independently while the resolution panel stays anchored. */}
      <div className="custom-scrollbar-hide flex-1 overflow-y-auto bg-background p-10">
        {/* Header row with page title/subtitle and an inline loading spinner. */}
        <div className="flex items-end justify-between">
          <div>
            {/* Page title for the reviewer exception workspace. */}
            <h1 className="mb-2 font-semibold text-[28px] tracking-tight">
              Exception Queue
            </h1>
            {/* Subtitle explaining the purpose: review validation failures and apply AI corrections. */}
            <p className="text-[14px] text-muted-foreground">
              Review validation failures and apply AI-suggested corrections.
            </p>
          </div>
          {/* Small spinner shown while the table is refetching in the background. */}
          {isFetching ? (
            <i
              aria-hidden="true"
              className="ri-loader-4-line animate-spin text-muted-foreground"
            />
          ) : null}
        </div>
        {/* Card containing the FilterBar on top and the paginated exception table below. */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
          {/* FilterBar container: status tabs, severity/type selects, and debounced search. */}
          <div className="border-border border-b bg-muted/40 p-4">
            <FilterBar filters={filters} onChange={patch} />
          </div>
          {/* Server-paginated table; page changes and row selection bubble up here. */}
          <ExceptionQueueTable
            data={data?.data}
            isLoading={isLoading}
            onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
            onSelect={setSelected}
            pagination={data?.pagination}
            selectedId={selected?.id ?? null}
          />
        </div>
      </div>
      {/* Right-hand master-detail panel: AI explanation / fix suggestions for the selected exception. */}
      <AiResolutionPanel exception={selected} />
    </div>
  );
}
