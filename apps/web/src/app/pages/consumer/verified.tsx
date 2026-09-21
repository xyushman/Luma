// Imports: React state, routing/navigation, toasts, and the inventory table UI pieces.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVerifiedLoans } from "@/hooks/use-verified-loans";

/* Spec §6.2 — Verified Records list (Module E). */

// Shortens a full SHA-256 hash to "first8…last6" so rows stay compact while staying unique-ish.
function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

// Formats an ISO timestamp into a compact "day month HH:MM" string for the table.
function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

// Purpose: paginated, searchable inventory of verified (sealed) loan records for the data consumer.
export default function VerifiedRecordsPage() {
  // Router navigation to open a record's dossier or jump to export/audit pages.
  const navigate = useNavigate();
  // Current page number for the verified-loans fetch.
  const [page, setPage] = useState(1);
  // Committed search term that is actually sent to the API.
  const [search, setSearch] = useState("");
  // Uncommitted search-box text; only applied via applySearch (Enter or Filter click).
  const [searchInput, setSearchInput] = useState("");
  // Fetches the requested page of verified loans; search query drives server-side filtering.
  const { data, isLoading } = useVerifiedLoans(page, search);

  // Commits the typed search: resets to page 1 and trims the query sent to the API.
  const applySearch = () => {
    setPage(1);
    setSearch(searchInput.trim());
  };

  // Counts records on the current page that were assisted by an AI recommendation.
  const aiAssistedCount =
    data?.data.filter((d) => d.aiRecommendationUsed).length ?? 0;

  return (
    // Page shell: a centred 1200px column with compact spacing.
    <div className="mx-auto max-w-[1200px] space-y-4 p-6">
      {/* Standard page header with quick actions for export and audit pages. */}
      <PageHeader
        action={
          // Header actions group holding the two shortcut buttons.
          <div className="flex items-center gap-2">
            {/* Outline button routing to the one-click CSV/JSON export page. */}
            <Button
              className="h-8.5 text-xs"
              onClick={() => navigate("/consumer/export")}
              variant="outline"
            >
              {/* Download icon for the export shortcut. */}
              <i aria-hidden="true" className="ri-download-2-line" />
              Export Records
            </Button>
            {/* Ghost button routing to the audit trail page. */}
            <Button
              className="h-8.5 text-xs"
              onClick={() => navigate("/consumer/audit")}
              variant="ghost"
            >
              {/* History icon for the audit shortcut. */}
              <i aria-hidden="true" className="ri-history-line" />
              Audit Trail
            </Button>
          </div>
        }
        description="Every sealed loan carries a deterministic SHA-256 hash of its canonical 22 fields."
        eyebrow="Data Consumer"
        title="Verified Records"
      />
      {/* Mini stats ribbon summarising the verified inventory in three tiles. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Tile 1: total number of sealed records from the API pagination total. */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
          <div>
            {/* Label for the total-sealed metric. */}
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Total Sealed
            </p>
            {/* The pagination total (or a dash while loading). */}
            <p className="font-semibold text-foreground text-lg tabular-nums">
              {data ? data.pagination.total.toLocaleString() : "—"}
            </p>
          </div>
          {/* Shield icon tile representing the tamper-evident seal. */}
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <i aria-hidden="true" className="ri-shield-check-line text-base" />
          </span>
        </div>
        {/* Tile 2: fixed 100% integrity claim for all verified records. */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
          <div>
            {/* Label for the integrity-status metric. */}
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Integrity Status
            </p>
            {/* Static 100% figure rendered green to convey full SHA-256 */}
            coverage.
            <p className="font-semibold text-lg text-success tabular-nums">
              100% SHA-256
            </p>
          </div>
          {/* Lock icon tile signalling cryptographic integrity. */}
          <span className="flex size-8 items-center justify-center rounded-lg bg-success/10 text-success">
            <i aria-hidden="true" className="ri-lock-2-line text-base" />
          </span>
        </div>
        {/* Tile 3: how many records on this page were AI-assisted during review. */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
          <div>
            {/* Label for the AI-assisted metric. */}
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
              AI Assisted
            </p>
            {/* Count of AI-assisted records (or a dash while loading). */}
            <p className="font-semibold text-lg text-primary tabular-nums">
              {data ? `${aiAssistedCount} records` : "—"}
            </p>
          </div>
          {/* Sparkle icon tile representing AI involvement. */}
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <i aria-hidden="true" className="ri-sparkling-2-line text-base" />
          </span>
        </div>
      </div>
      {/* Card containing the inventory table plus its header/footer chrome. */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {/* Table header row: inventory count on the left, search controls on the */}
        right.
        <header className="flex flex-wrap items-center justify-between gap-3 border-border border-b bg-muted/20 px-4 py-2.5">
          {/* Left side: "Inventory" label with a total-count pill. */}
          <div className="flex items-center gap-2">
            {/* Heading label for the table. */}
            <span className="font-medium text-[13px] text-foreground">
              Inventory
            </span>
            {/* Mono pill showing the total record count. */}
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
              {data ? data.pagination.total : 0}
            </span>
          </div>
          {/* Right side: search input plus a filter button. */}
          <div className="flex items-center gap-2">
            {/* Relative wrapper so the search icon can float inside the input. */}
            <div className="relative">
              {/* Search icon absolutely positioned inside the input's left edge. */}
              <i
                aria-hidden="true"
                className="ri-search-line absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-muted-foreground/70"
              />
              {/* Text input holding the uncommitted search text. */}
              <input
                className="h-8 w-48 rounded-lg border border-input bg-background pr-7 pl-8 text-[12px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 sm:w-60"
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  // Applies the search when the user presses Enter.
                  if (event.key === "Enter") {
                    applySearch();
                  }
                }}
                placeholder="Search loan or borrower ID…"
                type="search"
                value={searchInput}
              />
              {/* Clear button appears once the user has typed anything. */}
              {searchInput ? (
                // Button resets both the box and the committed search.
                <button
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setPage(1);
                  }}
                  type="button"
                >
                  {/* Close icon for clearing the search. */}
                  <i aria-hidden="true" className="ri-close-line text-xs" />
                </button>
              ) : null}
            </div>
            {/* Filter button committing the typed search term. */}
            <Button
              className="h-8 text-xs"
              onClick={applySearch}
              size="sm"
              variant="outline"
            >
              Filter
            </Button>
          </div>
        </header>
        {/* Renders skeletons while the first fetch is in flight; otherwise the */}
        table.
        {isLoading ? (
          // Skeleton rows placeholders during loading.
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton className="h-9 w-full" key={row} />
            ))}
          </div>
        ) : (
          // The structured verified-records table.
          <Table>
            {/* Header row defining the seven columns. */}
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                {/* Column header: Loan ID. */}
                <TableHead className="py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                  Loan ID
                </TableHead>
                {/* Column header: Borrower. */}
                <TableHead className="py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                  Borrower
                </TableHead>
                {/* Column header: Verified Date. */}
                <TableHead className="py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                  Verified Date
                </TableHead>
                {/* Column header: AI Review. */}
                <TableHead className="py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                  AI Review
                </TableHead>
                {/* Column header: Validation. */}
                <TableHead className="py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                  Validation
                </TableHead>
                {/* Column header: Record Hash. */}
                <TableHead className="py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                  Record Hash (SHA-256)
                </TableHead>
                {/* Narrow spacer column for the trailing chevron. */}
                <TableHead className="w-10 py-2.5" />
              </TableRow>
            </TableHeader>
            {/* Body with one row per verified record. */}
            <TableBody>
              {data?.data.map((record) => (
                // Row is clickable and navigates to the record's dossier.
                <TableRow
                  className="cursor-pointer transition-colors hover:bg-accent/40"
                  key={record.id}
                  onClick={() => navigate(`/consumer/loans/${record.id}`)}
                >
                  {/* Cell: mono loan id (falls back to the record id). */}
                  <TableCell className="py-2.5 font-medium">
                    <span className="font-mono font-semibold text-[13px] text-foreground">
                      {record.loan.loanId ?? record.id}
                    </span>
                  </TableCell>
                  {/* Cell: borrower id in mono type (or a dash). */}
                  <TableCell className="py-2.5 font-mono text-[12px] text-muted-foreground">
                    {record.loan.borrowerId ?? "—"}
                  </TableCell>
                  {/* Cell: formatted verification date. */}
                  <TableCell className="py-2.5 text-[12px] text-muted-foreground">
                    {formatDate(record.verifiedAt)}
                  </TableCell>
                  {/* Cell: AI-assisted pill or a muted "Manual" note. */}
                  <TableCell className="py-2.5">
                    {/* Pill shown when the review used an AI recommendation. */}
                    {record.aiRecommendationUsed ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-medium text-[11px] text-primary">
                        {/* Sparkle icon inside the AI-assisted pill. */}
                        <i
                          aria-hidden="true"
                          className="ri-sparkling-2-line text-[11px]"
                        />
                        AI Assisted
                      </span>
                    ) : (
                      // Muted marker for records reviewed without AI.
                      <span className="text-[11px] text-muted-foreground/60">
                        Manual
                      </span>
                    )}
                  </TableCell>
                  {/* Cell: validation-result badge colouring by pass/fail. */}
                  <TableCell className="py-2.5">
                    <Badge
                      className="text-[11px]"
                      variant={
                        record.validationResult === "passed"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {record.validationResult.replaceAll("_", " ")}
                    </Badge>
                  </TableCell>
                  {/* Cell: shortened record hash plus a copy button. */}
                  <TableCell className="py-2.5 text-[12px]">
                    {/* Hash chip grouping the shortened hash and copy control. */}
                    <span className="group/hash inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/40 px-2 py-0.5">
                      {/* Shortened SHA-256 hash in monospace. */}
                      <span className="font-mono text-[11.5px] text-muted-foreground">
                        {shortHash(record.recordHash)}
                      </span>
                      {/* Copy button writing the full hash to the clipboard. */}
                      <button
                        aria-label={`Copy record hash for ${record.loan.loanId ?? record.id}`}
                        className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
                        onClick={(event) => {
                          // Stops propagation so the row click doesn't navigate.
                          event.stopPropagation();
                          void navigator.clipboard.writeText(record.recordHash);
                          toast.success("SHA-256 record hash copied");
                        }}
                        type="button"
                      >
                        {/* Copy icon inside the button. */}
                        <i
                          aria-hidden="true"
                          className="ri-file-copy-line text-[12px]"
                        />
                      </button>
                    </span>
                  </TableCell>
                  {/* Trailing chevron cell hinting this row navigates to the */}
                  dossier.
                  <TableCell className="py-2.5 text-right">
                    <i
                      aria-hidden="true"
                      className="ri-arrow-right-s-line text-[15px] text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
                    />
                  </TableCell>
                </TableRow>
              ))}
              {/* Full-width empty row shown when the search/page returns no */}
              records.
              {data?.data.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="py-12 text-center text-[13px] text-muted-foreground"
                    colSpan={7}
                  >
                    {/* Centred empty-state content. */}
                    <div className="flex flex-col items-center gap-1.5">
                      {/* Inbox icon signalling an empty inventory. */}
                      <i
                        aria-hidden="true"
                        className="ri-inbox-line text-2xl text-muted-foreground/40"
                      />
                      {/* Main empty message varies by whether a search is */}
                      active.
                      <p className="font-medium text-foreground">
                        {search
                          ? `No verified loans matching "${search}"`
                          : "No verified loans yet."}
                      </p>
                      {/* Helpful hint depending on the empty-state cause. */}
                      <p className="text-[11.5px] text-muted-foreground">
                        {search
                          ? "Try a different loan ID or clear search."
                          : "Reviewers will seal loans once validation checks pass."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
        {/* Pagination footer shown only when the result set spans multiple */}
        pages.
        {data && data.pagination.totalPages > 1 ? (
          // Footer bar with page indicator and prev/next controls.
          <div className="flex items-center justify-between border-border border-t bg-muted/10 px-4 py-2.5">
            {/* Text reading "Page X of Y" with tabular figures. */}
            <p className="text-[12px] text-muted-foreground tabular-nums">
              Page {data.pagination.page} of {data.pagination.totalPages}
            </p>
            {/* Prev/next button group. */}
            <div className="flex gap-1.5">
              {/* Previous-page button disabled on the first page. */}
              <Button
                className="h-7 px-2.5 text-xs"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                size="sm"
                variant="outline"
              >
                Previous
              </Button>
              {/* Next-page button disabled on the final page. */}
              <Button
                className="h-7 px-2.5 text-xs"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage(page + 1)}
                size="sm"
                variant="outline"
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
