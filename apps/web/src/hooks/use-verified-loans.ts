// Verified-loan queries powering the data-consumer views (search, paging, detail).
import { useQuery } from "@tanstack/react-query";
import { verifiedLoansApi } from "@/lib/api";

// Fetches a paginated, searchable list of verified loans (20 per page).
export function useVerifiedLoans(page = 1, search = "") {
  return useQuery({
    queryFn: () => verifiedLoansApi.list({ limit: 20, page, search }), // Fixed page size keeps responses small
    queryKey: ["verified-loans", page, search], // Page + search are part of the key so changes re-fetch
  });
}

// Fetches one verified-loan detail; disabled until a real id exists.
export function useVerifiedLoanDetail(id: string) {
  return useQuery({
    enabled: Boolean(id), // Avoid firing requests while id is empty
    queryFn: () => verifiedLoansApi.detail(id),
    queryKey: ["verified-loan", id],
  });
}
