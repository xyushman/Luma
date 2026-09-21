import { useQuery } from "@tanstack/react-query";
import { auditApi } from "@/lib/api";

// Fetches the append-only audit trail for one loan, 50 events per page.
export function useAuditTrail(loanId: string, page = 1) {
  return useQuery({
    enabled: Boolean(loanId), // No request until a loan id exists
    queryFn: () => auditApi.trail(loanId, { limit: 50, page }),
    queryKey: ["audit", loanId, page], // Page in the key => loading more pages re-fetches
  });
}
