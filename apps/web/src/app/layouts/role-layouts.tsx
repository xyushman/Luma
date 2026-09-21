// Shared Role type from @repo/types used to key per-role layout titles
import type { Role } from "@repo/types";
// Outlet renders the matched child page of a role silo inside this layout
import { Outlet } from "react-router-dom";
// ProtectedRoute enforces authentication + role gating for each silo
import { ProtectedRoute } from "@/app/guards/ProtectedRoute";
import { Sidebar } from "@/components/nav/sidebar";
import { Topbar } from "@/components/nav/topbar";
import { useSession } from "@/hooks/use-session";

// Human-readable title shown in each role's topbar, keyed by the canonical role enum
const PAGE_TITLES: Record<Role, string> = {
  data_consumer: "Data Consumer",
  data_operator: "Data Operator",
  reviewer: "Reviewer",
};

// RoleShell: shared chrome (guarded sidebar + topbar + content outlet) reused by every role silo
function RoleShell({ requiredRole }: { requiredRole: Role }) {
  return (
    // Wrap everything in the guard so only users with this exact role can enter the silo
    <ProtectedRoute role={requiredRole}>
      {/* Two-column grid: fixed 248px navigation sidebar on the left, overflowing content on the right */}
      <div className="grid h-screen min-h-screen grid-cols-[248px_1fr] overflow-hidden bg-background">
        {/* Persistent nav for the current role (operator/reviewer/consumer entries) */}
        <Sidebar />
        {/* Right-hand column: topbar plus scrollable page area */}
        <div className="flex min-h-0 min-w-0 flex-col">
          {/* Per-role title/context banner (e.g. "Data Operator") */}
          <Topbar title={PAGE_TITLES[requiredRole]} />
          {/* Scrollable main region where the routed page for this silo renders */}
          <main className="custom-scrollbar-hide min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}

// OperatorLayout: mounts the silo chrome for data_operator routes (ingestion module A)
export function OperatorLayout() {
  return <RoleShell requiredRole="data_operator" />;
}

// ReviewerLayout: mounts the silo chrome for reviewer routes (exception/validation module C)
export function ReviewerLayout() {
  return <RoleShell requiredRole="reviewer" />;
}

// ConsumerLayout: mounts the silo chrome for data_consumer routes (read-only verified consumption)
export function ConsumerLayout() {
  return <RoleShell requiredRole="data_consumer" />;
}

// SharedDocLayout: chrome for the shared docs (/architecture, /ai-log) — any authenticated user may view
export function SharedDocLayout() {
  // Read the session purely to derive the topbar title from the visitor's own role
  const { user } = useSession();
  // Fall back to data_operator title for anonymous/unknown roles so the topbar never shows blank
  const role = (user?.role as Role | undefined) ?? "data_operator";
  const title = PAGE_TITLES[role] ?? "Luma";

  return (
    // Just an authentication check here (no role prop) since docs are visible to every logged-in role
    <ProtectedRoute>
      {/* Same 248px sidebar + content grid used by the role silos, for a consistent app shell */}
      <div className="grid h-screen min-h-screen grid-cols-[248px_1fr] overflow-hidden bg-background">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-col">
          <Topbar title={title} />
          <main className="custom-scrollbar-hide min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
