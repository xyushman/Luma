import { authClient } from "@/lib/auth-client";

// Shape returned by useSession: the raw hook result plus convenient session/user.
export interface UseSessionReturn {
  data: { session: unknown; user: unknown } | null; // Raw session payload from Better Auth
  error: unknown; // Auth/session fetch error, if any
  isPending: boolean; // True while the initial session check is loading
  isRefetching: boolean; // True during background refetches after first load
  refetch: () => Promise<void>; // Manually re-fetch the session
  session: unknown | null; // Convenience: just the session object
  user: { id: string; email: string; name: string; role: string } | null; // Convenience: the signed-in user
}

// Wraps Better Auth's useSession and exposes the authenticated user + role for RBAC.
export function useSession(): UseSessionReturn {
  // Better Auth's inferred types are broader than what this app consumes, so
  // we cast the result into our narrower shape here once.
  const result = authClient.useSession() as unknown as {
    data: {
      session: unknown;
      user: { id: string; email: string; name: string; role: string } | null;
    } | null;
    error: unknown;
    isPending: boolean;
    isRefetching: boolean;
    refetch: () => Promise<void>;
  };
  return {
    data: result.data as unknown as { session: unknown; user: unknown } | null, // Keep the raw data for callers that need it
    error: result.error,
    isPending: result.isPending,
    isRefetching: result.isRefetching,
    refetch: result.refetch,
    session:
      (result.data as unknown as { session: unknown } | null)?.session ?? null, // Null-safe read of the nested session object
    user: result.data?.user ?? null, // Null when logged out, so views can gate on it
  };
}
