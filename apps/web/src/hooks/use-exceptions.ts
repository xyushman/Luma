// Data hooks for the exception review queue, summary cards, and reviewer actions.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ExceptionListFilters } from "@/hooks/use-exceptions-filters"; // Filter shape shared with the URL-driven hook
import { exceptionsApi, summaryApi } from "@/lib/api";

// Dashboard headline stats (totals, severity breakdown, recent activity).
export function useDashboardSummary() {
  return useQuery({
    queryFn: () => summaryApi.get(),
    queryKey: ["summary"],
  });
}

// Filtered exception queue list; empty filter values are dropped server-side.
export function useExceptions(filters: ExceptionListFilters) {
  return useQuery({
    placeholderData: (previous) => previous, // Keep previous page visible while refetching
    queryFn: () =>
      exceptionsApi.list({
        ...filters,
        batchId: filters.batchId || undefined, // "" -> undefined so the API ignores empty filters
        limit: 20,
        search: filters.search || undefined,
        severity: filters.severity || undefined,
        status: filters.status || undefined,
        type: filters.type || undefined,
      }),
    queryKey: ["exceptions", filters], // Filters in the key => any change triggers a new fetch
  });
}

// One exception's full detail (message, severity, AI recommendation, thread).
export function useException(id: string) {
  return useQuery({
    enabled: Boolean(id), // Skip until a real id arrives
    queryFn: () => exceptionsApi.detail(id),
    queryKey: ["exception", id],
  });
}

// Adds a reviewer note to an exception, then refreshes the detail thread.
export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { exceptionId: string; note: string }) =>
      exceptionsApi.comment(input.exceptionId, { note: input.note }),
    onError: (error: Error) => {
      toast.error("Could not add note", { description: error.message });
    },
    onSuccess: (_data, variables) => {
      toast.success("Note added");
      void queryClient.invalidateQueries({
        queryKey: ["exception", variables.exceptionId], // Re-fetch so the new note appears in the thread
      });
    },
  });
}

// Approve/reject mutations for the review workflow; both refresh every affected query.
export function useExceptionReview() {
  const queryClient = useQueryClient();
  const invalidate = (exceptionId: string) => {
    // Shared invalidation set keeps lists/detail/dashboard consistent
    void queryClient.invalidateQueries({ queryKey: ["exceptions"] }); // Queue counts change on resolution
    void queryClient.invalidateQueries({
      queryKey: ["exception", exceptionId],
    });
    void queryClient.invalidateQueries({ queryKey: ["loan"] }); // Resolution may mutate the loan
    void queryClient.invalidateQueries({ queryKey: ["loans"] });
    void queryClient.invalidateQueries({ queryKey: ["audit"] }); // Approve/reject are audited events
    void queryClient.invalidateQueries({ queryKey: ["summary"] }); // Dashboard aggregates shift
  };

  const approve = useMutation({
    mutationFn: (input: {
      id: string;
      note?: string;
      correctedValue?: string;
    }) =>
      exceptionsApi.approve(input.id, {
        correctedValue: input.correctedValue,
        note: input.note,
      }),
    onError: (error: Error) =>
      toast.error("Approve failed", { description: error.message }),
    onSuccess: (_data, variables) => {
      toast.success("Exception approved and resolved");
      invalidate(variables.id); // Pull fresh data everywhere the exception appears
    },
  });

  const reject = useMutation({
    mutationFn: (input: { id: string; note: string }) =>
      exceptionsApi.reject(input.id, input.note), // The rejection note is mandatory
    onError: (error: Error) =>
      toast.error("Reject failed", { description: error.message }),
    onSuccess: (_data, variables) => {
      toast.success("Exception rejected");
      invalidate(variables.id);
    },
  });

  return { approve, reject }; // Expose both actions for the review bar UI
}
