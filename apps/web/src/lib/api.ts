// Typed request/response shapes shared with the backend, imported from the
// @luma/types workspace package so client calls stay in sync with the API.
import type {
  AiClassifySeverityResponse,
  AiDraftNoteResponse,
  AiExplainResponse,
  AiSuggestRuleResponse,
  AiSummarizeBatchResponse,
  AuditListQuery,
  AuditTrailResponse,
  BatchSummary,
  CreateUploadResponse,
  ExceptionApproveBody,
  ExceptionCommentBody,
  ExceptionDecisionBody,
  ExceptionDecisionResponse,
  ExceptionDetail,
  ExceptionListItem,
  FileType,
  GetBatchResponse,
  HealthResponse,
  LoanDetail,
  LoanFieldsPatchBody,
  LoanFieldsPatchResponse,
  LoanListItem,
  LoanListQuery,
  LoanVerifyResponse,
  PaginationQuery,
  SummaryResponse,
  UploadBatch,
  VerifiedLoanDetail,
  VerifiedLoanListQuery,
  VerifiedLoanListResponse,
} from "@repo/types";
import axios from "axios";

export const API_BASE = import.meta.env.VITE_API_URL ?? ""; // Base origin; empty string means same host as the frontend

// Single configured axios instance reused by every endpoint group below.
export const api = axios.create({
  baseURL: `${API_BASE}/api`, // All REST routes live under /api
  headers: { "Content-Type": "application/json" }, // JSON body default; multipart uploads override per request
  withCredentials: true, // Attach the auth cookie so Better Auth sessions work cross-origin
});

// Shape of the structured error JSON the API returns on 4xx/5xx responses.
export interface ApiErrorPayload {
  code?: string; // Machine-readable error code from the backend
  error?: string; // Human-readable message shown to the user
  fields?: Record<string, string>; // Per-field messages for validation-style errors
}

// Converts raw axios/network failures into a friendly Error with status info
// so callers can toast a readable message and branch on the error code.
function toApiError(error: unknown): Error & ApiErrorPayload {
  if (axios.isAxiosError(error)) {
    // Type guard: this is a real HTTP/network failure
    const data = error.response?.data as ApiErrorPayload | undefined; // Best-effort read of the API's error body
    const err = new Error(
      data?.error ?? error.message ?? "Request failed" // Prefer backend message, fall back to axios/network text
    ) as Error & ApiErrorPayload;
    err.code = data?.code; // Attach the machine-readable code for programmatic handling
    err.fields = data?.fields; // Attach per-field details for validation errors
    return err;
  }
  return error instanceof Error ? error : new Error(String(error)); // Non-axios: pass through or wrap unknowns
}

// Every response flows through this interceptor, so all callers get normalized Errors.
api.interceptors.response.use(
  (response) => response, // Success: pass the response through untouched
  (error) => Promise.reject(toApiError(error)) // Failure: replace with the friendly, code-carrying Error
);

// Standard envelope for every paginated list endpoint (items + page metadata).
export interface Paginated<T> {
  data: T[]; // Items for the current page
  pagination: {
    limit: number; // Items requested per page
    page: number; // Current page number (1-based)
    total: number; // Total rows across all pages
    totalPages: number; // Derived page count used by UI pagination controls
  };
}

// Health endpoint group, used to gate the app behind an "API online" check.
export const healthApi = {
  check: async (): Promise<HealthResponse> => {
    // GET /api/health returns service/DB status
    const { data } = await api.get<HealthResponse>("/health");
    return data;
  },
};

// Upload pipeline endpoints: start a batch, poll its status, list and summarize.
export const uploadsApi = {
  // Starts an ingestion batch by streaming the File as multipart form data.
  create: async (
    file: File,
    fileType: FileType,
    onProgress?: (percent: number) => void
  ): Promise<CreateUploadResponse> => {
    const form = new FormData(); // Multipart body carries the file plus its type flag
    form.append("file", file);
    form.append("fileType", fileType);
    const { data } = await api.post<CreateUploadResponse>("/uploads", form, {
      headers: { "Content-Type": "multipart/form-data" }, // Override JSON default; axios adds the boundary itself
      onUploadProgress: (event) => {
        // Axios progress hook used to drive the progress bar
        if (!(onProgress && event.total)) {
          // Guard: need a listener and a known total size
          return;
        }
        onProgress(Math.round((event.loaded / event.total) * 100)); // Report 0-100 percent to the caller
      },
    });
    return data;
  },
  // Polls one batch record (status, counters, resume cursor) during processing.
  detail: async (batchId: string): Promise<GetBatchResponse> => {
    const { data } = await api.get<GetBatchResponse>(`/uploads/${batchId}`);
    return data;
  },
  // Lists upload batches with paging and an optional status filter.
  list: async (query: PaginationQuery & { status?: string }) => {
    const { data } = await api.get<Paginated<UploadBatch>>("/uploads", {
      params: query, // limit/page/status become the query string
    });
    return data;
  },
  // Reads the per-type aggregation summary for a batch (e.g. failure counts).
  summary: async (batchId: string): Promise<BatchSummary> => {
    const { data } = await api.get<BatchSummary>(`/uploads/${batchId}/summary`);
    return data;
  },
};

// Loan record endpoints used by loan rails and reviewer/consumer detail views.
export const loansApi = {
  // Single loan detail including exceptions and verification status.
  detail: async (id: string): Promise<LoanDetail> => {
    const { data } = await api.get<LoanDetail>(`/loans/${id}`);
    return data;
  },
  // Paginated loan list; the full LoanListQuery becomes the query string.
  list: async (query: LoanListQuery) => {
    const { data } = await api.get<Paginated<LoanListItem>>("/loans", {
      params: query,
    });
    return data;
  },
  // PATCH of allowed loan fields; returns the list of fields that were updated.
  patchFields: async (
    id: string,
    body: LoanFieldsPatchBody
  ): Promise<LoanFieldsPatchResponse> => {
    const { data } = await api.patch<LoanFieldsPatchResponse>(
      `/loans/${id}/fields`,
      body
    );
    return data;
  },
  // Seals a loan into an immutable VerifiedLoan with a SHA-256 integrity hash.
  verify: async (id: string): Promise<LoanVerifyResponse> => {
    const { data } = await api.post<LoanVerifyResponse>(`/loans/${id}/verify`);
    return data;
  },
};

// Exception queue endpoints for reviewer triage (open, approve, reject, comment).
export const exceptionsApi = {
  // Reviewer approves an exception, optionally supplying a corrected value.
  approve: async (
    id: string,
    body: ExceptionApproveBody
  ): Promise<Partial<ExceptionDetail>> => {
    const { data } = await api.post<Partial<ExceptionDetail>>(
      `/exceptions/${id}/approve`,
      body
    );
    return data;
  },
  // Adds a reviewer comment/note to an exception's discussion thread.
  comment: async (
    id: string,
    body: ExceptionCommentBody
  ): Promise<ExceptionDetail> => {
    const { data } = await api.post<ExceptionDetail>(
      `/exceptions/${id}/comment`,
      body
    );
    return data;
  },
  // Full exception detail (message, severity, AI recommendation, decisions).
  detail: async (id: string): Promise<ExceptionDetail> => {
    const { data } = await api.get<ExceptionDetail>(`/exceptions/${id}`);
    return data;
  },
  // Filtered exception list; optional fields pair with PaginationQuery.
  list: async (
    query: Partial<{
      batchId: string;
      search: string;
      severity: string;
      status: string;
      type: string;
    }> &
      PaginationQuery
  ) => {
    const { data } = await api.get<Paginated<ExceptionListItem>>(
      "/exceptions",
      { params: query } // Present filter fields become the query string
    );
    return data;
  },
  // Records the reviewer decision on the AI suggestion (accepted/edited/rejected).
  recordAiDecision: async (
    id: string,
    body: ExceptionDecisionBody
  ): Promise<ExceptionDecisionResponse> => {
    const { data } = await api.post<ExceptionDecisionResponse>(
      `/exceptions/${id}/decision`,
      body
    );
    return data;
  },
  // Reviewer rejects an exception; the note documents why.
  reject: async (
    id: string,
    note: string
  ): Promise<Partial<ExceptionDetail>> => {
    const { data } = await api.post<Partial<ExceptionDetail>>(
      `/exceptions/${id}/reject`,
      { note }
    );
    return data;
  },
};

// AI assistant endpoints (explain, severity, draft note, rule, batch summary).
export const aiApi = {
  // Assesses an exception's severity level for triage ordering.
  classifySeverity: async (
    exceptionId: string
  ): Promise<AiClassifySeverityResponse> => {
    const { data } = await api.post<AiClassifySeverityResponse>(
      "/ai/classify-severity",
      { exceptionId }
    );
    return data;
  },
  // Drafts a reviewer note for an exception; reviewer edits before saving.
  draftNote: async (exceptionId: string): Promise<AiDraftNoteResponse> => {
    const { data } = await api.post<AiDraftNoteResponse>("/ai/draft-note", {
      exceptionId,
    });
    return data;
  },
  // Explains why a validation rule flagged the exception.
  explain: async (exceptionId: string): Promise<AiExplainResponse> => {
    const { data } = await api.post<AiExplainResponse>("/ai/explain", {
      exceptionId,
    });
    return data;
  },
  // Suggests a new validation rule based on a natural-language prompt.
  suggestRule: async (prompt: string): Promise<AiSuggestRuleResponse> => {
    const { data } = await api.post<AiSuggestRuleResponse>("/ai/suggest-rule", {
      prompt,
    });
    return data;
  },
  // Generates a natural-language summary of an entire upload batch.
  summarizeBatch: async (
    batchId: string
  ): Promise<AiSummarizeBatchResponse> => {
    const { data } = await api.post<AiSummarizeBatchResponse>(
      "/ai/summarize-batch",
      { batchId }
    );
    return data;
  },
};

// Verified (immutable) loan endpoints for the data-consumer views and exports.
export const verifiedLoansApi = {
  // Single verified-loan detail with its canonical snapshot and hash.
  detail: async (id: string): Promise<VerifiedLoanDetail> => {
    const { data } = await api.get<VerifiedLoanDetail>(`/verified-loans/${id}`);
    return data;
  },
  // Backwards-compatible helper producing a direct CSV export URL.
  exportCsv: (batchId?: string): string =>
    batchId
      ? `${API_BASE}/api/verified-loans/export?batchId=${encodeURIComponent(batchId)}` // Encode so batch ids with special chars stay valid
      : `${API_BASE}/api/verified-loans/export`, // No filter: export the whole verified dataset
  // Builds an export URL with optional batch filter and format (csv/json).
  exportUrl: (options?: {
    batchId?: string;
    format?: "csv" | "json";
  }): string => {
    const params = new URLSearchParams(); // URLSearchParams handles encoding of each value
    if (options?.batchId) {
      params.set("batchId", options.batchId);
    }
    if (options?.format) {
      params.set("format", options.format);
    }
    const query = params.toString();
    return query
      ? `${API_BASE}/api/verified-loans/export?${query}` // Only append "?" when there are params
      : `${API_BASE}/api/verified-loans/export`;
  },
  // Paginated verified-loan list with search; supports consumer dashboards.
  list: async (
    query: VerifiedLoanListQuery
  ): Promise<VerifiedLoanListResponse> => {
    const { data } = await api.get<VerifiedLoanListResponse>(
      "/verified-loans",
      { params: query }
    );
    return data;
  },
};

// Append-only audit trail endpoint per loan (timeline of events).
export const auditApi = {
  trail: async (loanId: string, query?: AuditListQuery) => {
    const { data } = await api.get<AuditTrailResponse>(`/audit/${loanId}`, {
      params: query, // Supports paging the trail (limit/page)
    });
    return data;
  },
};

// Dashboard summary endpoint (overview stats + recent activity).
export const summaryApi = {
  get: async (): Promise<SummaryResponse> => {
    const { data } = await api.get<SummaryResponse>("/summary");
    return data;
  },
};
