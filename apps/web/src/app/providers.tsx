// React Query (server-state cache/async data) and its devtools panel
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "@/components/ui/sonner";

// Single shared QueryClient: caches every data fetch and de-dupes concurrent requests app-wide
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Do not refetch data just because the browser tab regained focus (avoids churn on the API)
      refetchOnWindowFocus: false,
      // Retry a failed query at most once, keeping UI failures predictable over flaky networks
      retry: 1,
      // Treat fresh data as cacheable for 30 seconds, reducing redundant requests to the Express API
      staleTime: 30_000,
    },
  },
});

// Providers: the root context wrapper mounted in main.tsx; gives every page React Query + toasts + devtools
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // React Query provider makes useQuery/useMutation hooks work in every child component
    <QueryClientProvider client={queryClient}>
      {/* The rest of the app (router tree) renders inside the query provider */}
      {children}
      {/* Global toast surface for sonner notifications (success/error/dismissible with close button) */}
      <Toaster closeButton richColors />
      {/* Query devtools show cache state/cached queries; kept closed by default */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
