// Shared Role type used for the role -> home-path map and session normalization
import type { Role } from "@repo/types";
// Local state for the sign-in/register form fields and password visibility toggle
import { useState } from "react";
// Navigate does role-based redirects; useNavigate triggers navigation after auth
import { Navigate, useNavigate } from "react-router-dom";
// sonner toasts for success/error feedback during authentication
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
// Better Auth browser client that talks to the Express API for sign-in/sign-up
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

// Each role is routed to its own silo dashboard after a successful login
const ROLE_HOME: Record<Role, string> = {
  data_consumer: "/consumer/dashboard",
  data_operator: "/operator/dashboard",
  reviewer: "/reviewer/dashboard",
};

// The three demo accounts (password is always "password") offered as one-click quick-fill buttons
const DEMO_ACCOUNTS = [
  { email: "operator@luma.dev", label: "Operator", role: "data_operator" },
  { email: "reviewer@luma.dev", label: "Reviewer", role: "reviewer" },
  { email: "consumer@luma.dev", label: "Consumer", role: "data_consumer" },
];

// RoleRedirect: the "/" index element — sends a signed-in user to their role home, else to /login
export function RoleRedirect() {
  // Read the session (isPending while the auth check is in flight, user set once resolved)
  const { isPending, user } = useSession();

  // While the session is loading, show a small centered skeleton to avoid a blank flash
  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Skeleton className="h-10 w-56 rounded-full" />
      </div>
    );
  }
  // No session at all: the visitor is logged out, so send them to the login page
  if (!user) {
    return <Navigate replace to="/login" />;
  }
  // Coerce the session role to one of the three known roles; null for anything unrecognized
  const normalized = (() => {
    const r = user.role as string;
    // Whitelist the supported roles so unknown/legacy values fail closed (no wrong-silo redirect)
    if (r === "data_operator" || r === "reviewer" || r === "data_consumer") {
      return r as Role;
    }
    return null;
  })();
  // Unknown role: cannot pick a home, so force a re-login
  if (!normalized) {
    return <Navigate replace to="/login" />;
  }
  // Known role: replace-navigate to that role's dashboard (no back-history entry)
  return <Navigate replace to={ROLE_HOME[normalized]} />;
}

// AuthInput: reusable labeled text/password input with an optional show-password toggle
function AuthInput({
  autoComplete,
  id,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  autoComplete?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  // Tracks whether the password toggle is showing the plaintext value
  const [showPassword, setShowPassword] = useState(false);
  // Only password fields get the visibility toggle
  const isPassword = type === "password";
  // Switch between "text" and "password" input types based on the toggle state
  const effectiveType = isPassword && showPassword ? "text" : type;

  return (
    <div className="space-y-1.5">
      {/* Accessible label linked to the input via htmlFor/id */}
      <label
        className="block font-medium text-[12px] text-foreground"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="relative">
        {/* Controlled input: every keystroke bubbles up via onChange(value) */}
        <input
          autoComplete={autoComplete}
          className={cn(
            "h-10 w-full rounded-xl border border-input bg-background px-3.5 text-[13.5px] outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
            isPassword && "pr-10"
          )}
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={true}
          type={effectiveType}
          value={value}
        />
        {/* For password fields only, overlay the show/hide toggle button */}
        {isPassword ? (
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground/60 transition-colors hover:text-foreground focus:outline-none"
            onClick={() => setShowPassword(!showPassword)}
            type="button"
          >
            {/* Swap between the eye and eye-off remix icons based on visibility */}
            <i
              aria-hidden="true"
              className={
                showPassword
                  ? "ri-eye-off-line text-base"
                  : "ri-eye-line text-base"
              }
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// getSubmitButtonContent: returns the correct label/spinner for the submit button by mode and state
function getSubmitButtonContent(
  submitting: boolean,
  mode: "signin" | "register"
) {
  // While the request is in flight, render a spinning loader with "Please wait"
  if (submitting) {
    return (
      <>
        <i
          aria-hidden="true"
          className="ri-loader-4-line animate-spin text-sm"
        />
        Please wait…
      </>
    );
  }
  // Static label differs between the two auth modes
  return mode === "register" ? "Create account" : "Sign in";
}

// LoginPage: the public sign-in/register screen with demo quick-fill and role-aware post-auth redirect
export default function LoginPage() {
  // Router hook used to send the user to their role home after authenticating
  const navigate = useNavigate();
  // refetch refreshes the cached session so user.role reflects the just-created login
  const { refetch } = useSession();
  // Toggle between the two auth flows: "signin" or "register"
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Disables the submit button while an auth network call is outstanding
  const [submitting, setSubmitting] = useState(false);

  // navigateByRole: after a successful login, fetch the fresh session and go to the role-specific dashboard
  const navigateByRole = async () => {
    // Re-pull the session so React Query has the updated, authenticated user object
    await refetch();
    // Also fetch directly from the auth client to read fresh user.role from the server
    const session = await authClient.getSession();
    const role = (session?.data?.user as { role?: string } | undefined)?.role;
    // Normalize the role to one of the three known enums; anything else means no valid home
    const normalized: Role | null =
      role === "data_operator" ||
      role === "reviewer" ||
      role === "data_consumer"
        ? (role as Role)
        : null;
    // Unknown role: stay on login rather than guess a destination
    if (!normalized) {
      navigate("/login", { replace: true });
      return;
    }
    // Known role: land exactly on that role's dashboard silo
    navigate(ROLE_HOME[normalized], { replace: true });
  };

  // handleSubmit: runs either Better Auth register+signin or the plain signin flow
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    // Block the native form reload so we stay in the SPA
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "register") {
        // Create the account first (name, email, password) via Better Auth
        const { error } = await authClient.signUp.email({
          email,
          name,
          password,
        });
        // Surface the API's error message if creation failed (duplicate email, weak password, etc.)
        if (error) {
          toast.error("Sign up failed", { description: error.message });
          return;
        }
        // Auto sign-in right after a successful registration
        await authClient.signIn.email({ email, password });
      } else {
        // Plain sign-in path with email + password
        const { error } = await authClient.signIn.email({ email, password });
        if (error) {
          toast.error("Invalid credentials", {
            description: "Check your email and password, then try again.",
          });
          return;
        }
      }
      // Auth succeeded: resolve the session role and redirect to the right dashboard
      await navigateByRole();
    } catch {
      // Covers network/server failures (e.g. API not running) that Better Auth throws on
      toast.error("Authentication failed", {
        description: "Could not reach the auth server. Is the API running?",
      });
    } finally {
      // Always re-enable the submit button, success or failure
      setSubmitting(false);
    }
  };

  // fillDemoAccount: quick-fill a demo account's email and the shared "password" password
  const fillDemoAccount = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("password");
    toast.success(`Demo credentials filled for ${demoEmail}`);
  };

  return (
    // Full-viewport flex container splitting the page into a left image panel and right form panel
    <div className="flex h-screen w-full overflow-hidden bg-background font-sans">
      {/* Left: Container with 2xl rounded corners taking half the width */}
      <section className="relative hidden h-full w-1/2 p-2 sm:p-2.5 lg:block">
        {/* Clipped rounded container for the marketing image and glass overlays */}
        <div className="relative size-full overflow-hidden rounded-2xl border border-border bg-muted shadow-xs">
          {/* Full-bleed background image of the brand/architecture visual */}
          <img
            alt="Luma Verification Platform"
            className="size-full object-cover object-center"
            height={3840}
            src="/login-bg.webp"
            width={2160}
          />
          {/* Centrally Aligned Glassmorphic Brand Panel (Fully Rounded Pill) */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* Frosted-glass pill containing the logo mark and wordmark */}
            <div className="flex items-center gap-3 rounded-full border border-white/20 bg-black/40 px-7 py-3.5 shadow-2xl backdrop-blur-md">
              <img
                alt="Luma Logo"
                className="size-8 shrink-0 drop-shadow-md"
                height={32}
                src="/luma.svg"
                width={32}
              />
              <span className="font-bold text-[22px] text-white tracking-tight">
                Luma
              </span>
            </div>
          </div>

          {/* Bottom Glassmorphic Info Pane */}
          <div className="absolute inset-x-3.5 bottom-3.5 rounded-2xl border border-white/15 bg-black/45 p-4 text-white shadow-xl backdrop-blur-md">
            {/* One-line product pitch */}
            <p className="mb-1 font-semibold text-[13px] tracking-tight">
              Loan Tape Verification
            </p>
            {/* Short value proposition for the verification pipeline */}
            <p className="max-w-[480px] text-[12px] text-white/80 leading-relaxed">
              Ingest multi-source tapes, resolve data discrepancies with rule
              checks, and export verified mortgage records with cryptographic
              seals.
            </p>
          </div>
        </div>
      </section>

      {/* Right: Auth Form Section */}
      <section className="flex h-full w-full flex-col justify-between overflow-y-auto p-6 sm:p-8 lg:w-1/2">
        {/* Header Branding */}
        <div className="flex items-center gap-2.5">
          <img
            alt="Luma Logo"
            className="size-7 shrink-0"
            height={28}
            src="/luma.svg"
            width={28}
          />
          <span className="font-semibold text-base tracking-tight">Luma</span>
        </div>

        {/* Form Container */}
        <div className="mx-auto my-auto w-full max-w-[380px] py-2">
          {/* Heading block whose text switches with signin/register mode */}
          <div className="mb-6 space-y-1.5">
            <h1 className="font-semibold text-[24px] text-foreground tracking-tight">
              {mode === "register" ? "Create your account" : "Welcome back"}
            </h1>
            <p className="text-[13px] text-muted-foreground">
              {mode === "register"
                ? "Start turning unverified loan tapes into verified assets."
                : "Sign in to access loan ingestion, review, and verification."}
            </p>
          </div>

          {/* Quick Demo Selector */}
          {/* Show one-click demo role buttons only on the sign-in flow */}
          {mode === "signin" ? (
            <div className="mb-5 rounded-xl border border-border bg-muted/30 p-3">
              <p className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                Quick Demo Accounts
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DEMO_ACCOUNTS.map((acc) => (
                  // Each pill pre-fills that demo email and the shared password
                  <button
                    className="rounded-full border border-border/80 bg-background px-3 py-1 font-medium text-[11.5px] text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 active:scale-95"
                    key={acc.email}
                    onClick={() => fillDemoAccount(acc.email)}
                    type="button"
                  >
                    {acc.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Auth form: name (register only), email, then password with submit */}
          <form
            className="space-y-3.5"
            onSubmit={(event) => void handleSubmit(event)}
          >
            {/* Registration gathers the full name; sign-in skips it */}
            {mode === "register" ? (
              <AuthInput
                autoComplete="name"
                id="name"
                label="Full name"
                onChange={setName}
                placeholder="Jane Operator"
                type="text"
                value={name}
              />
            ) : null}
            <AuthInput
              autoComplete="email"
              id="email"
              label="Email address"
              onChange={setEmail}
              placeholder="operator@luma.dev"
              type="email"
              value={email}
            />
            <div>
              <AuthInput
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                id="password"
                label="Password"
                onChange={setPassword}
                placeholder="••••••••"
                type="password"
                value={password}
              />
              {/* Hint about the minimum password length for the register flow */}
              {mode === "register" ? (
                <span className="mt-1.5 block text-[11.5px] text-muted-foreground">
                  Must be at least 8 characters.
                </span>
              ) : null}
            </div>

            {/* Full-width pill submit button, disabled while the request is running */}
            <Button
              className="mt-2 h-10 w-full rounded-full text-[13.5px]"
              disabled={submitting}
              type="submit"
            >
              {getSubmitButtonContent(submitting, mode)}
            </Button>
          </form>

          {/* Mode switch: flip between "Don't have an account?" and "Already have an account?" */}
          <div className="mt-6 text-center text-[12.5px] text-muted-foreground">
            {mode === "register"
              ? "Already have an account?"
              : "Don't have an account?"}
            <button
              className="ml-1.5 font-medium text-primary hover:underline"
              onClick={() =>
                setMode(mode === "register" ? "signin" : "register")
              }
              type="button"
            >
              {mode === "register" ? "Sign in" : "Create one"}
            </button>
          </div>
        </div>

        {/* Footer Copyright / Status */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground/70">
          <span>© 2026 Luma Systems</span>
          <span>Cryptographic Verification Pipeline</span>
        </div>
      </section>
    </div>
  );
}
