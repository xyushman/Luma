// Loan data hooks: list, detail, optimistic field editing, and verification.
import type {
  LoanDetail,
  LoanFieldsPatchBody,
  LoanListQuery,
} from "@repo/types"; // Shared, typed contract with the backend
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"; // Data fetching + cache invalidation
import { toast } from "sonner"; // Toast notifications for mutation outcomes
import { loansApi } from "@/lib/api";

// Fetches one loan's detail; disabled until a real id exists (e.g. "new" routes).
export function useLoan(id: string) {
  return useQuery({
    enabled: Boolean(id),
    queryFn: () => loansApi.detail(id),
    queryKey: ["loan", id],
  });
}

// PATCHes loan fields with optimistic UI: update the cache first, roll back on error.
export function useUpdateLoanFields(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoanFieldsPatchBody) =>
      loansApi.patchFields(loanId, body),
    onError: (
      error: Error,
      _body,
      context: { previous: LoanDetail | null } | undefined
    ) => {
      if (context?.previous) {
        // Revert the cache to the pre-mutation snapshot
        queryClient.setQueryData(["loan", loanId], context.previous);
      }
      toast.error("Field update failed", { description: error.message });
    },
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: ["loan", loanId] }); // Cancel in-flight reads so they don't clobber the optimistic value
      const previous = queryClient.getQueryData<LoanDetail>(["loan", loanId]); // Snapshot the old detail for rollback
      queryClient.setQueryData<LoanDetail>(
        ["loan", loanId],
        (old) => (old ? { ...old, ...body.fields } : old) // Apply the edited fields to the cached detail immediately
      );
      return { previous: previous ?? null }; // Hand the snapshot to onError/onSettled
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["loan", loanId] }); // Re-sync detail with the server truth
      void queryClient.invalidateQueries({ queryKey: ["audit", loanId] }); // Field edits append audit events
    },
    onSuccess: (result) => {
      toast.success(`Updated: ${result.updatedFields.join(", ")}`); // Confirm which fields changed
    },
  });
}

// Verifies a loan (seals an immutable VerifiedLoan) and refreshes every affected view.
export function useVerifyLoan(loanId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => loansApi.verify(loanId),
    onError: (error: Error) => {
      toast.error("Verification failed", { description: error.message });
    },
    onSuccess: (result) => {
      toast.success("Loan verified and sealed", {
        description: `Record hash: ${result.verifiedLoan.recordHash.slice(0, 18)}…`, // Show the tamper-evidence hash (truncated)
      });
      void queryClient.invalidateQueries({ queryKey: ["loan", loanId] }); // Detail is no longer unverified
      void queryClient.invalidateQueries({ queryKey: ["loan"] });
      void queryClient.invalidateQueries({ queryKey: ["loans"] }); // Loans leave the review queue
      void queryClient.invalidateQueries({ queryKey: ["exceptions"] }); // Resolved exceptions disappear
      void queryClient.invalidateQueries({ queryKey: ["audit", loanId] }); // Verification is an auditable event
      void queryClient.invalidateQueries({ queryKey: ["summary"] }); // Dashboard counts change
    },
  });
}

// Paginated loans list; placeholderData keeps the previous page during refetches.
export function useLoanList(query: LoanListQuery) {
  return useQuery({
    placeholderData: (previous) => previous, // Keep stale rows visible while the next fetch resolves
    queryFn: () => loansApi.list(query),
    queryKey: ["loans", query], // Whole query object is the key, so any filter change re-fetches
  });
}
