// Shared Role type (data_operator / reviewer / data_consumer) from the monorepo's @repo/types package
import type { Role } from "@repo/types";
// Navigate performs a client-side redirect when a user is unauthenticated
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";

// Props accepted by the guard: children to protect plus the role(s) allowed to render them
interface ProtectedRouteProps {
  children: React.ReactNode;
  // Single role or list, via either prop name (role/roles) for flexibility
  role?: Role | Role[];
  roles?: Role | Role[];
}

// normalizeRoles: converts the optional role/roles props into a flat array (or null when neither is given)
function normalizeRoles(
  role?: Role | Role[],
  roles?: Role | Role[]
): Role[] | null {
  // Prefer the plural "roles" prop when provided, else fall back to single "role"
  const raw = roles ?? role;
  // No allowed role specified means this guard only requires authentication, not a specific role
  if (!raw) {
    return null;
  }
  // Normalize to an array so inclusion checks work the same for both singular and list forms
  return Array.isArray(raw) ? raw : [raw];
}

// Forbidden: a full-screen "access denied" card shown when a logged-in user's role is not allowed
export function Forbidden({ requiredRole }: { requiredRole?: string }) {
  return (
    // Centers the card vertically/horizontally with padding, full height minus the topbar offset
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {/* Lock icon communicates "no access" at a glance (decorative, hidden from screen readers) */}
            <i aria-hidden="true" className="ri-lock-line text-lg" />
            Forbidden
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Explains that backend APIs would also return 403, so the block is enforced server-side too */}
          <p className="text-muted-foreground text-sm">
            You do not have permission to view this page
            {requiredRole ? ` (requires ${requiredRole})` : ""}. The API will
            return 403 for any data request.
          </p>
          {/* Escape hatch: full page reload back to the login view */}
          <Button
            onClick={() => {
              window.location.assign("/login");
            }}
            variant="outline"
          >
            <i aria-hidden="true" className="ri-login-box-line mr-2" />
            Go to login
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ProtectedRoute: route guard that gates a subtree on auth + optional role(s); render children only when allowed
export function ProtectedRoute({ children, role, roles }: ProtectedRouteProps) {
  // useSession reads the Better Auth session; user is null while logged out, isPending during initial auth check
  const { user, isPending } = useSession();
  // Resolve which roles (if any) are permitted to render the protected content
  const allowedRoles = normalizeRoles(role, roles);

  // While the auth/session request is still in flight, show skeleton placeholders instead of flashing content
  if (isPending) {
    return (
      <div className="space-y-4 p-8">
        {/* Placeholder bars approximate the upcoming page layout to prevent layout shift */}
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // No user means not signed in: bounce to the login page, replacing history so Back cannot loop
  if (!user) {
    return <Navigate replace to="/login" />;
  }

  // Normalize the session role to one of the three known roles; null for anything unexpected (fail-closed)
  const normalizedRole = ((): Role | null => {
    const r = user.role;
    // Whitelist only the three supported roles; unknown/legacy values fall through to null
    if (r === "data_operator" || r === "reviewer" || r === "data_consumer") {
      return r;
    }
    return null;
  })();

  if (allowedRoles) {
    // An allowed-role list exists: require the user to be in it, otherwise show the Forbidden card
    if (!(normalizedRole && allowedRoles.includes(normalizedRole))) {
      // Join role options into a human-readable "requires data_operator or reviewer" message
      return <Forbidden requiredRole={allowedRoles.join(" or ")} />;
    }
  } else if (!normalizedRole) {
    // No specific role required, but the session role is unrecognized: treat it as unauthorized (fail-closed)
    return <Forbidden />;
  }

  // Passed all checks: render the protected subtree (the wrapped page/layout)
  return <>{children}</>;
}
