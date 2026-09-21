// Imports: React hooks, toasts, page/button UI, verified-loans fallback, the API base URL, and a class util.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { useVerifiedLoans } from "@/hooks/use-verified-loans";
import { API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";

/* Spec §6.5 — API Explorer (Module H). */

// Whether an endpoint needs a path-parameter id or runs with no parameters.
type ParamKind = "id" | "none";

// Describes one explorable REST endpoint in the sandbox.
interface Endpoint {
  description: string;
  method: "GET";
  paramKind: ParamKind;
  paramLabel?: string;
  path: string;
}

// The real endpoints exposed in the sandbox; calls are executed live against the API.
const ENDPOINTS: Endpoint[] = [
  {
    description: "Paginated verified loans with quality score",
    method: "GET",
    paramKind: "none",
    path: "/api/verified-loans",
  },
  {
    description: "Full canonical record, lineage, and record hash",
    method: "GET",
    paramKind: "id",
    paramLabel: "Verified loan ID",
    path: "/api/verified-loans/:id",
  },
  {
    description: "All normalized loan records",
    method: "GET",
    paramKind: "none",
    path: "/api/loans",
  },
  {
    description: "Single loan record by internal ID",
    method: "GET",
    paramKind: "id",
    paramLabel: "Loan ID",
    path: "/api/loans/:id",
  },
  {
    description: "Append-only audit trail for a loan",
    method: "GET",
    paramKind: "id",
    paramLabel: "Loan ID",
    path: "/api/audit/:id",
  },
  {
    description: "Aggregate counts, quality score, and recent activity",
    method: "GET",
    paramKind: "none",
    path: "/api/summary",
  },
  {
    description: "Download verified records as CSV",
    method: "GET",
    paramKind: "none",
    path: "/api/verified-loans/export",
  },
];

// Pre-compiled regexes used to colour tokens in the pretty-printed JSON response.
const HL_STRING_KEY = /"("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?/g;
const HL_BOOL = /\b(true|false)\b/g;
const HL_NULL = /\bnull\b/g;
const HL_NUMBER = /(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

// Escapes HTML metacharacters before highlighting so JSON content can't inject markup.
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Highlights a JSON string by wrapping tokens in colour span classes; safe because input is escaped first.
function syntaxHighlight(json: string): string {
  return (
    escapeHtml(json)
      // Keys (and their colon) render in primary colour; bare strings in foreground.
      .replace(HL_STRING_KEY, (_match, raw: string, colon?: string) =>
        colon
          ? `<span class="text-primary">"${raw}"</span>${colon}`
          : `<span class="text-foreground">"${raw}"</span>`
      )
      // Booleans render in warning colour.
      .replace(HL_BOOL, '<span class="text-warning">$1</span>')
      // Null values render dimmed.
      .replace(HL_NULL, '<span class="text-muted-foreground/60">null</span>')
      // Numbers render in success colour.
      .replace(HL_NUMBER, '<span class="text-success">$1</span>')
  );
}

// Purpose: read-only panel that pretty-prints the API response payload with syntax colours and a copy action.
function JsonViewer({
  body,
  isError,
  onCopy,
}: {
  body: unknown;
  isError: boolean;
  onCopy: () => void;
}) {
  // Formats the payload: strings render verbatim, objects get 2-space pretty printing.
  const formatted = useMemo(() => {
    if (typeof body === "string") {
      return body;
    }
    return JSON.stringify(body, null, 2);
  }, [body]);

  return (
    // Wrapper card whose border colour signals success vs error responses.
    <div
      className={cn(
        "overflow-hidden rounded-xl border shadow-xs",
        isError ? "border-destructive/30 bg-card" : "border-border bg-card"
      )}
    >
      {/* Panel header with a label and the Copy JSON button. */}
      <header className="flex items-center justify-between border-border border-b bg-muted/30 px-3.5 py-2">
        {/* Header label with a code icon. */}
        <span className="flex items-center gap-1.5 font-medium text-[12px] text-foreground">
          {/* Code icon marking the response payload. */}
          <i
            aria-hidden="true"
            className="ri-code-s-slash-line text-muted-foreground"
          />
          Response Payload
        </span>
        {/* Button copying the pretty-printed JSON to the clipboard. */}
        <button
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onCopy}
          type="button"
        >
          {/* Copy icon for the action. */}
          <i aria-hidden="true" className="ri-file-copy-line text-xs" />
          Copy JSON
        </button>
      </header>
      {/* Scrollable body holding the highlighted JSON, capped at 60k chars. */}
      <div className="custom-scrollbar-hide max-h-[380px] overflow-auto p-3.5">
        {/* Pre-formatted block; the highlighted HTML is safe because it was */}
        HTML-escaped first.
        <pre
          className="font-mono text-[11.5px] leading-relaxed"
          dangerouslySetInnerHTML={{
            __html: syntaxHighlight(
              formatted.length > 60_000 ? formatted.slice(0, 60_000) : formatted
            ),
          }}
        />
      </div>
    </div>
  );
}

// Purpose: interactive API playground — pick an endpoint, send a real request, and inspect the JSON response.
export default function ApiExplorerPage() {
  // Currently selected endpoint path, defaulting to the first entry.
  const [activePath, setActivePath] = useState<string>(
    ENDPOINTS[0]?.path ?? ""
  );
  // User-typed path-parameter value (for :id endpoints).
  const [paramValue, setParamValue] = useState("");
  // Captured response metadata (body, latency, status, error flag) for the last request.
  const [response, setResponse] = useState<{
    body: unknown;
    durationMs: number;
    isError: boolean;
    status: number;
  } | null>(null);
  // Guards the Send button while a request is in flight.
  const [sending, setSending] = useState(false);

  // Resolves the full Endpoint object matching the active path.
  const endpoint: Endpoint = ENDPOINTS.find(
    (item) => item.path === activePath
  ) as Endpoint;
  // Fetches a sample verified record so :id endpoints can be prefilled.
  const { data: verified } = useVerifiedLoans(1, "");
  // Fallback id: the first verified record's id, used when no param was typed.
  const sampleId = verified?.data?.[0]?.id ?? "";

  // Executes the endpoint live against the API and captures response + timing.
  const send = async () => {
    setSending(true);
    const startTime = performance.now();
    // Substitutes :id with the typed value (or the sample id) and calls the real HTTP endpoint.
    const url = `${API_BASE}${endpoint.path.replace(":id", paramValue.trim() || sampleId)}`;
    try {
      const res = await fetch(url, { credentials: "include" });
      const durationMs = Math.round(performance.now() - startTime);
      let body: unknown;
      const contentType = res.headers.get("content-type") ?? "";
      // JSON responses parse fully; other bodies are read as truncated text.
      if (contentType.includes("application/json")) {
        body = await res.json();
      } else {
        const text = await res.text();
        body = text.slice(0, 4000);
      }
      setResponse({
        body,
        durationMs,
        isError: !res.ok,
        status: res.status,
      });
    } catch {
      // Network failure produces a friendly error payload instead of crashing.
      setResponse({
        body: { error: "Request failed — is the API server running?" },
        durationMs: 0,
        isError: true,
        status: 0,
      });
    } finally {
      setSending(false);
    }
  };

  // Preview URL with :id substituted (kept literal when no id is available yet).
  const resolvedUrl = endpoint.path.replace(
    ":id",
    paramValue.trim() || (sampleId ? sampleId : ":id")
  );
  // Equivalent cURL command generated for copy/paste into a terminal.
  const curl = `curl -s -H "Cookie: <session>" \\\n  http://localhost:4000${resolvedUrl}`;

  return (
    // Page shell: a centred 1200px column with compact spacing.
    <div className="mx-auto max-w-[1200px] space-y-4 p-6">
      {/* Standard page header describing the sandbox. */}
      <PageHeader
        description="Live interactive test sandbox for the Verified Records REST API."
        eyebrow="Data Consumer"
        title="API Explorer"
      />
      {/* Two-column layout: endpoint selector sidebar on the left, sandbox on */}
      the right.
      <div className="grid gap-4 lg:grid-cols-[290px_1fr]">
        {/* Sidebar listing every explorable endpoint. */}
        <aside className="space-y-1.5 rounded-xl border border-border bg-card p-2.5 shadow-xs">
          {/* Sidebar heading with the endpoint count. */}
          <p className="px-2 pt-1 pb-1.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
            Endpoints ({ENDPOINTS.length})
          </p>
          {/* Maps each endpoint to a selectable button. */}
          {ENDPOINTS.map((item) => (
            // Endpoint row; highlights when it is the active selection.
            <button
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                activePath === item.path
                  ? "border-primary/30 bg-primary/10"
                  : "border-transparent hover:bg-accent/50"
              )}
              key={item.path}
              onClick={() => {
                // Switching endpoints selects it and clears the previous response.
                setActivePath(item.path);
                setResponse(null);
              }}
              type="button"
            >
              {/* Row header: method badge plus the endpoint path. */}
              <div className="flex w-full items-center gap-1.5">
                {/* Green GET method badge. */}
                <span className="rounded bg-success/15 px-1 py-0.2 font-mono font-semibold text-[9.5px] text-success">
                  {item.method}
                </span>
                {/* Mono path, emphasised when this endpoint is active. */}
                <span
                  className={cn(
                    "truncate font-mono text-[11.5px]",
                    activePath === item.path
                      ? "font-semibold text-primary"
                      : "text-foreground"
                  )}
                >
                  {item.path}
                </span>
              </div>
              {/* One-line description of what the endpoint returns. */}
              <span className="truncate text-[10.5px] text-muted-foreground">
                {item.description}
              </span>
            </button>
          ))}
        </aside>
        {/* Sandbox content column: request controls, response box, and cURL */}
        snippet.
        <section className="space-y-3.5">
          {/* Request builder card with method/path header, params, and the Send */}
          button.
          <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
            {/* Controls header: method + resolved URL, plus status/latency */}
            badges when a response exists.
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-border border-b pb-2.5">
              {/* Left group: method badge and the resolved URL. */}
              <div className="flex items-center gap-2 font-mono">
                {/* Green GET method badge. */}
                <span className="rounded bg-success/15 px-2 py-0.5 font-bold text-[11px] text-success">
                  {endpoint.method}
                </span>
                {/* Resolved endpoint URL (id placeholder substituted). */}
                <span className="font-semibold text-[13px] text-foreground">
                  {resolvedUrl}
                </span>
              </div>
              {/* Response meta badges: status result plus request duration. */}
              {response ? (
                // Meta group for the last response.
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  {/* Status pill coloured by success/error. */}
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.2 font-medium",
                      response.isError
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : "border-success/30 bg-success/10 text-success"
                    )}
                  >
                    {response.status || "ERR"}{" "}
                    {response.isError ? "Error" : "OK"}
                  </span>
                  {/* Round-trip latency measured from the fetch. */}
                  <span className="text-muted-foreground">
                    {response.durationMs}ms
                  </span>
                </div>
              ) : null}
            </div>
            {/* Param input row, only rendered for endpoints that need an :id. */}
            {endpoint.paramKind === "id" ? (
              // Wraps the label, input, and "Use sample ID" button.
              <div className="mb-3 flex flex-wrap items-end gap-2">
                {/* Labeled input binding the path-parameter value. */}
                <label className="min-w-64 flex-1 space-y-1">
                  {/* Small uppercase label for the parameter. */}
                  <span className="block font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                    {endpoint.paramLabel}
                  </span>
                  {/* Mono text input for the id, with the sample id as */}
                  placeholder.
                  <input
                    className="h-8 w-full rounded-lg border border-input bg-background px-3 font-mono text-[12px] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                    onChange={(event) => setParamValue(event.target.value)}
                    placeholder={sampleId || "cuid…"}
                    type="text"
                    value={paramValue}
                  />
                </label>
                {/* Convenience button filling in the first verified record's id. */}
                {sampleId ? (
                  <Button
                    className="h-8 text-xs"
                    onClick={() => setParamValue(sampleId)}
                    size="sm"
                    variant="ghost"
                  >
                    Use sample ID
                  </Button>
                ) : null}
              </div>
            ) : null}
            {/* Send button triggering the live request; disabled while one is in */}
            flight.
            <Button
              className="h-8.5 text-xs"
              disabled={sending}
              onClick={() => void send()}
            >
              {/* Swaps between a spinner and the play icon based on request */}
              state.
              {sending ? (
                // Pending state fragment with a spinning loader.
                <>
                  <i
                    aria-hidden="true"
                    className="ri-loader-4-line animate-spin"
                  />
                  Sending…
                </>
              ) : (
                // Idle state fragment with a play icon and the primary label.
                <>
                  <i aria-hidden="true" className="ri-play-line" />
                  Send Request
                </>
              )}
            </Button>
          </div>
          {/* Response box showing the payload once a request has completed. */}
          {response ? (
            // Syntax-coloured JSON viewer with a copy action.
            <JsonViewer
              body={response.body}
              isError={response.isError}
              onCopy={() => {
                void navigator.clipboard.writeText(
                  JSON.stringify(response.body, null, 2)
                );
                toast.success("Response JSON copied");
              }}
            />
          ) : (
            // Placeholder state before the first request is sent.
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border border-dashed bg-muted/20 py-10 text-center">
              {/* Code icon for the empty sandbox. */}
              <i
                aria-hidden="true"
                className="ri-code-s-slash-line text-2xl text-muted-foreground/40"
              />
              {/* Heading for the no-request state. */}
              <p className="font-medium text-[12.5px] text-foreground">
                No Request Sent
              </p>
              {/* Hint telling the consumer to press Send Request. */}
              <p className="text-[11.5px] text-muted-foreground">
                Click "Send Request" to execute live against the API.
              </p>
            </div>
          )}
          {/* Terminal-style card exposing the copyable cURL equivalent. */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            {/* Header row with a terminal icon and a Copy button. */}
            <header className="flex items-center justify-between border-border border-b bg-muted/30 px-3.5 py-2">
              {/* Header label with the terminal icon. */}
              <span className="flex items-center gap-1.5 font-medium text-[12px] text-foreground">
                {/* Terminal icon marking the snippet card. */}
                <i
                  aria-hidden="true"
                  className="ri-terminal-line text-muted-foreground"
                />
                cURL Command
              </span>
              {/* Button copying the cURL command to the clipboard. */}
              <button
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => {
                  void navigator.clipboard.writeText(curl);
                  toast.success("cURL command copied");
                }}
                type="button"
              >
                {/* Copy icon for the action. */}
                <i aria-hidden="true" className="ri-file-copy-line text-xs" />
                Copy
              </button>
            </header>
            {/* Scrollable pre block rendering the cURL command. */}
            <pre className="custom-scrollbar-hide overflow-x-auto p-3.5 font-mono text-[11.5px] text-foreground/80 leading-relaxed">
              {curl}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
