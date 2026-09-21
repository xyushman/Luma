// Shared API types: full loan detail, list rows, list query params, and validation status enum
import type {
  LoanDetail,
  LoanListItem,
  LoanListQuery,
  ValidationStatus,
} from "@repo/types";
import { useEffect, useState } from "react";
// Router hooks: useParams picks up /loans/:id, useNavigate resets the URL when the drawer closes
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/dashboard/page-header";
import { ValidationStatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
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
import { useLoanList } from "@/hooks/use-loans";
// Base API URL used by the drawer's on-demand loan detail fetch
import { API_BASE } from "@/lib/api";

/* Spec §4.4 — Loan Records browser. Read-only inspection for operators:
   filters (status, source file), search by loan/borrower ID, row click opens
   the read-only detail drawer with raw vs normalized fields. */

// Status filter chips: empty string means "all statuses"
const STATUS_FILTERS: { label: string; value: ValidationStatus | "" }[] = [
  { label: "All statuses", value: "" },
  { label: "Valid", value: "passed" },
  { label: "Exception", value: "failed" },
  { label: "In review", value: "review" },
  { label: "Pending", value: "pending" },
];

// Maps API field keys to human-readable labels for the detail drawer
const FIELD_LABELS: Record<string, string> = {
  borrowerId: "Borrower ID",
  borrowerState: "State",
  creditGrade: "Credit grade",
  currentBalance: "Current balance",
  daysPastDue: "Days past due",
  documentStatus: "Document status",
  employmentLength: "Employment",
  incomeBand: "Income band",
  interestRate: "Interest rate",
  lastPaymentDate: "Last payment",
  lastUpdatedAt: "Last updated",
  loanId: "Loan ID",
  loanPurpose: "Purpose",
  loanType: "Type",
  maturityDate: "Maturity",
  originalPrincipal: "Original principal",
  originationDate: "Origination",
  paymentStatus: "Payment status",
  servicerName: "Servicer",
  sourceSystem: "Source system",
  termMonths: "Term (months)",
};

// The order in which normalized fields are displayed in the detail drawer
const DISPLAY_ORDER: (keyof LoanDetail)[] = [
  "loanId",
  "borrowerId",
  "loanType",
  "originationDate",
  "maturityDate",
  "originalPrincipal",
  "currentBalance",
  "interestRate",
  "termMonths",
  "paymentStatus",
  "daysPastDue",
  "borrowerState",
  "loanPurpose",
  "creditGrade",
  "employmentLength",
  "incomeBand",
  "servicerName",
  "lastPaymentDate",
  "lastUpdatedAt",
  "documentStatus",
  "sourceSystem",
];

// formatFieldValue: renders drawer field values; empty -> dash, dates localize, currency fields get USD format
function formatFieldValue(key: string, value: unknown): string {
  // Empty-ish values render as an em dash so the drawer never looks blank
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  // Date-like fields are localized to a short readable date
  if (
    [
      "originationDate",
      "maturityDate",
      "lastPaymentDate",
      "lastUpdatedAt",
    ].includes(key)
  ) {
    return new Date(String(value)).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  // Monetary fields become USD-formatted numbers with up to 2 decimals
  if (["currentBalance", "originalPrincipal"].includes(key)) {
    const amount = Number(value);
    // Guard against invalid numeric payloads before formatting
    if (!Number.isNaN(amount)) {
      return amount.toLocaleString(undefined, {
        currency: "USD",
        maximumFractionDigits: 2,
        style: "currency",
      });
    }
  }
  // Default: stringify the raw value as-is
  return String(value);
}

// LoanDetailDrawer: side panel that lazily fetches and shows one loan's full detail (read-only for operators)
function LoanDetailDrawer({
  loanId,
  onClose,
}: {
  loanId: string | null;
  onClose: () => void;
}) {
  // Fetched detail payload and its loading flag
  const [detail, setDetail] = useState<LoanDetail | null>(null);
  const [loading, setLoading] = useState(false);

  // Lazy fetch on open
  // Track which loan ID we already fetched so we only call the API once per opened loan
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  // Start the fetch only when an un-fetched loanId appears and no request is inflight
  if (loanId && loanId !== fetchedFor && !loading) {
    setLoading(true);
    // Direct fetch (with credentials) since the drawer is not a cached React Query resource
    fetch(`${API_BASE}/api/loans/${loanId}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: LoanDetail) => {
        setDetail(data);
        setFetchedFor(loanId);
      })
      .catch(() => {
        // On any error, show the "could not load" empty state rather than stale data
        setDetail(null);
        setFetchedFor(loanId);
      })
      .finally(() => {
        setLoading(false);
      });
  }

  return (
    // Drawer open state is driven entirely by whether a loan is selected
    <Sheet
      onOpenChange={(open) => (open ? undefined : onClose())}
      open={Boolean(loanId)}
    >
      <SheetContent className="w-[480px] gap-0 overflow-y-auto sm:max-w-[480px]">
        <SheetHeader className="border-b">
          <SheetTitle className="font-mono text-[15px]">
            {detail?.loanId ?? loanId}
          </SheetTitle>
          <SheetDescription>
            Read-only — edits and reviews happen in the Reviewer workspace
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 p-5">
          {/* Body content branches on loading / loaded-with-detail / failure states */}
          <DrawerBody
            detail={detail}
            fetchedFor={fetchedFor}
            loading={loading}
            loanId={loanId}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// DrawerBody: decides what the drawer shows based on fetch state and current loan
function DrawerBody({
  detail,
  fetchedFor,
  loading,
  loanId,
}: {
  detail: LoanDetail | null;
  fetchedFor: string | null;
  loading: boolean;
  loanId: string | null;
}) {
  const navigate = useNavigate();

  // Force a refetch happened for this exact loan: show skeletons while loading
  if (loading && !detail && fetchedFor === loanId) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <Skeleton className="h-9 w-full" key={row} />
        ))}
      </div>
    );
  }
  if (detail) {
    return (
      <>
        {/* Open exceptions section, only rendered when the loan has any */}
        {detail.exceptions.length > 0 ? (
          <section className="space-y-2">
            <h4 className="font-semibold text-[13px] tracking-tight">
              Open exceptions ({detail.exceptions.length})
            </h4>
            <ul className="space-y-1.5">
              {/* Show up to 4 exceptions; type is snake_case, de-snaked for display */}
              {detail.exceptions.slice(0, 4).map((exception) => (
                <li
                  className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12.5px]"
                  key={exception.id}
                >
                  <span className="font-medium capitalize">
                    {exception.exceptionType.replaceAll("_", " ")}
                  </span>
                  {/* Exception detail message follows the type */}
                  <span className="text-muted-foreground">
                    {" "}
                    · {exception.message}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* The normalized record rendered as a definition list in DISPLAY_ORDER */}
        <section className="space-y-1">
          <h4 className="mb-2 font-semibold text-[13px] tracking-tight">
            Normalized record
          </h4>
          <dl className="divide-y divide-border/60">
            {DISPLAY_ORDER.map((key) => (
              <div
                className="flex items-center justify-between gap-3 py-1.5"
                key={key}
              >
                <dt className="shrink-0 text-muted-foreground text-xs">
                  {FIELD_LABELS[key] ?? key}
                </dt>
                {/* Value is right-aligned and truncated; formatted per field type */}
                <dd className="truncate text-right font-mono text-[12px]">
                  {formatFieldValue(key, detail[key])}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Source lineage: which file/row the record came from and its import status */}
        <section className="rounded-lg border border-border bg-muted/40 p-3">
          <h4 className="mb-1.5 font-semibold text-[12px] tracking-tight">
            Source lineage
          </h4>
          <dl className="space-y-1 text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Source file</dt>
              <dd className="truncate font-mono text-[11px]">
                {detail.sourceBatch.fileName}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Source row</dt>
              <dd className="font-mono text-[11px] tabular-nums">
                #{detail.sourceRowNumber}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Import status</dt>
              <dd className="capitalize">{detail.importStatus}</dd>
            </div>
          </dl>
        </section>

        {/* Verified badge when this loan already passed review and got a SHA-256 seal */}
        {detail.verifiedRecord ? (
          <section className="rounded-lg border border-success/25 bg-success/8 p-3">
            <p className="font-medium text-[12px] text-success">
              Verified{" "}
              {new Date(detail.verifiedRecord.verifiedAt).toLocaleDateString()}
            </p>
            {/* Show the hash prefix; full value stays on the sealed record */}
            <p className="mt-1 truncate font-mono text-[11px] text-success/80">
              {detail.verifiedRecord.recordHash.slice(0, 28)}…
            </p>
          </section>
        ) : null}

        {/* Jump back to the source batch's detail page */}
        <Button
          className="w-full"
          onClick={() => navigate(`/operator/uploads/${detail.sourceBatch.id}`)}
          size="sm"
          variant="outline"
        >
          View source import
        </Button>
      </>
    );
  }
  // No detail loaded and not fetching: show the failure/empty state
  return (
    <p className="py-8 text-center text-[13px] text-muted-foreground">
      Could not load loan detail.
    </p>
  );
}

// LoanRecordsPage: searchable, filterable loan table scoped to the operator's batches (Module A §4.4)
export default function LoanRecordsPage() {
  // Optional /loans/:id deep link: when present, auto-opens that loan's drawer
  const { id } = useParams<{ id?: string }>();
  // Used to clear the :id from the URL when the drawer closes
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  // committed search term sent to the API
  const [search, setSearch] = useState("");
  // live input value while the user is still typing
  const [searchInput, setSearchInput] = useState("");
  // active validation status filter ("" = all)
  const [status, setStatus] = useState<ValidationStatus | "">("");
  // the loan whose drawer is open, seeded from the route param when present
  const [drawerId, setDrawerId] = useState<string | null>(id ?? null);

  // Keep the drawer in sync if the :id route param changes (e.g. navigation from another page)
  useEffect(() => {
    if (id) {
      setDrawerId(id);
    }
  }, [id]);

  // Build the query object; empty filter keys are omitted so the API keeps its defaults
  const query: LoanListQuery = {
    limit: 20,
    page,
    ...(search ? { search } : {}),
    ...(status ? { validationStatus: status } : {}),
  };
  const { data, isLoading } = useLoanList(query);

  // applySearch: commit the typed value and reset to page 1 so results start fresh
  const applySearch = () => {
    setPage(1);
    setSearch(searchInput);
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-8">
      <PageHeader
        description="All normalized records — inspect fields, validation status, and lineage."
        eyebrow="Data Operator"
        title="Loan Records"
      />

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Toolbar: status filter chips on the left, search box + button on the right */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-3.5">
          <div className="flex items-center gap-1.5">
            {STATUS_FILTERS.map((filter) => (
              <button
                className={
                  // Active chip is highlighted with primary colors; inactive uses neutral border colors
                  status === filter.value
                    ? "rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-[11.5px] text-primary"
                    : "rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent/50"
                }
                key={filter.value || "all"}
                onClick={() => {
                  // Filter change resets pagination so the user always lands on page 1
                  setPage(1);
                  setStatus(filter.value);
                }}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
          {/* Search by loan or borrower ID */}
          <div className="flex items-center gap-2">
            <input
              className="h-8 w-56 rounded-lg border border-input bg-background px-3 text-[13px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                // Enter in the field triggers the same search as clicking the button
                if (event.key === "Enter") {
                  applySearch();
                }
              }}
              placeholder="Loan or borrower ID…"
              type="search"
              value={searchInput}
            />
            <Button onClick={applySearch} size="sm" variant="outline">
              Search
            </Button>
          </div>
        </header>

        {isLoading ? (
          // Skeleton bars while the loan list loads
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton className="h-10 w-full" key={row} />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Loan ID</TableHead>
                <TableHead>Borrower</TableHead>
                <TableHead>Source file</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Each row click opens the read-only detail drawer for that loan */}
              {data?.data.map((loan: LoanListItem) => (
                <TableRow
                  className="cursor-pointer"
                  key={loan.id}
                  onClick={() => setDrawerId(loan.id)}
                >
                  <TableCell className="font-medium font-mono text-[12.5px]">
                    {loan.loanId ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-[12px] text-muted-foreground">
                    {loan.borrowerId ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-[12px] text-muted-foreground">
                    {loan.sourceBatch.fileName}
                  </TableCell>
                  {/* Current balance formatted as a plain number */}
                  <TableCell className="text-right font-mono text-[12px] tabular-nums">
                    {loan.currentBalance
                      ? Number(loan.currentBalance).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular-nums">
                    {loan.interestRate ? `${loan.interestRate}%` : "—"}
                  </TableCell>
                  <TableCell>
                    <ValidationStatusBadge status={loan.validationStatus} />
                  </TableCell>
                </TableRow>
              ))}
              {/* Empty state row when the list comes back with no results */}
              {data?.data.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="py-10 text-center text-[13px] text-muted-foreground"
                    colSpan={6}
                  >
                    {search
                      ? `No loans matching "${search}"`
                      : "No loan records yet — upload a file to begin."}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
        {/* Pagination footer appears once more than one page of results exists */}
        {data && data.pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between border-border border-t px-5 py-3">
            <p className="text-[12px] text-muted-foreground">
              Page {data.pagination.page} of {data.pagination.totalPages} ·{" "}
              {data.pagination.total.toLocaleString()} loans
            </p>
            <div className="flex gap-1.5">
              <Button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                size="sm"
                variant="outline"
              >
                Previous
              </Button>
              <Button
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

      {/* Drawer at the bottom; closing it also clears a deep-linked :id from the URL */}
      <LoanDetailDrawer
        loanId={drawerId}
        onClose={() => {
          setDrawerId(null);
          if (id) {
            navigate("/operator/loans", { replace: true });
          }
        }}
      />
    </div>
  );
}
