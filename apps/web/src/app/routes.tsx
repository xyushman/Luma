// Imports: router types + Navigate, the root Layout, and the three role shells (data_operator / reviewer / data_consumer)
import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { Layout } from "./layout";
import {
  ConsumerLayout,
  OperatorLayout,
  ReviewerLayout,
  SharedDocLayout,
} from "./layouts/role-layouts";
// Imports: every page component that a route can render, grouped by role silo and shared docs
import ApiExplorerPage from "./pages/consumer/api-explorer";
import AuditTrailPage from "./pages/consumer/audit";
import ConsumerDashboard from "./pages/consumer/dashboard";
import ExportPage from "./pages/consumer/export";
import ConsumerLoanDetailPage from "./pages/consumer/loan-detail";
import VerifiedRecordsPage from "./pages/consumer/verified";
import LoginPageDefault, { RoleRedirect } from "./pages/login";
import BatchDetailPage from "./pages/operator/batch-detail";
import OperatorDashboard from "./pages/operator/dashboard";
import ImportHistoryPage from "./pages/operator/imports";
import LoanRecordsPage from "./pages/operator/loans";
import UploadPage from "./pages/operator/upload";
import ReviewerDashboard from "./pages/reviewer/dashboard";
import ExceptionQueuePage from "./pages/reviewer/exceptions";
import LoanDetailPage from "./pages/reviewer/loan-detail";
import RuleBuilderPage from "./pages/reviewer/rules";
import AiDevelopmentLogPage from "./pages/shared/ai-development-log";
import ArchitecturePage from "./pages/shared/architecture";

// Alias the default export so the login route element reads cleanly below
const LoginPage = LoginPageDefault;

// The entire app's routing table; each entry is a "layout route" with nested child routes
export const routes: RouteObject[] = [
  {
    // All routes nest under the root <Layout> shell, which renders the matched child
    children: [
      // Bare "/" index route: redirects to the logged-in user's home (or /login) based on role
      { element: <RoleRedirect />, index: true },
      // Public login page (no role guard) for email/password authentication
      { element: <LoginPage />, path: "login" },
      {
        // Shared documentation group: wrapped in SharedDocLayout (sidebar + topbar but no role silo)
        children: [
          { element: <AiDevelopmentLogPage />, path: "ai-log" },
          { element: <ArchitecturePage />, path: "architecture" },
        ],
        element: <SharedDocLayout />,
      },
      {
        // OPERATOR SILO: all routes require the data_operator role inside <OperatorLayout>
        children: [
          {
            // "/operator" alone redirects to the operator dashboard (replace so history is not polluted)
            element: <Navigate replace to="/operator/dashboard" />,
            index: true,
          },
          { element: <OperatorDashboard />, path: "dashboard" },
          // Module A entry: file upload page for the five accepted tape formats
          { element: <UploadPage />, path: "upload" },
          // Full upload/import history with filters (Module A §4.3)
          { element: <ImportHistoryPage />, path: "imports" },
          // Searchable loan records scoped to operator batches (Module A §4.4)
          { element: <LoanRecordsPage />, path: "loans" },
          // Deep link to a loan row: reuses the loan page, which auto-opens the detail drawer
          { element: <LoanRecordsPage />, path: "loans/:id" },
          // Per-batch detail: pipeline progress, import/validation summaries, and AI summary
          { element: <BatchDetailPage />, path: "uploads/:batchId" },
        ],
        // Role guard + 248px sidebar/topbar layout wraps every operator route
        element: <OperatorLayout />,
        path: "operator",
      },
      {
        // REVIEWER SILO: role-guarded by <ReviewerLayout> (Module C review workflow)
        children: [
          {
            // "/reviewer" index: default to the reviewer dashboard after login/redirect
            element: <Navigate replace to="/reviewer/dashboard" />,
            index: true,
          },
          { element: <ReviewerDashboard />, path: "dashboard" },
          // Module C: the reviewer's triage queue of validation exceptions
          { element: <ExceptionQueuePage />, path: "exceptions" },
          // Rule builder for configuring validation severity/gates (Module C)
          { element: <RuleBuilderPage />, path: "rules" },
          // Per-loan review screen with AI recommendation and human-in-the-loop decisions
          { element: <LoanDetailPage />, path: "loans/:id" },
        ],
        element: <ReviewerLayout />,
        path: "reviewer",
      },
      {
        // CONSUMER SILO: role-guarded by <ConsumerLayout> for read-only downstream consumption
        children: [
          {
            // "/consumer" index: default to the consumer dashboard after login/redirect
            element: <Navigate replace to="/consumer/dashboard" />,
            index: true,
          },
          { element: <ConsumerDashboard />, path: "dashboard" },
          // Verified, hash-sealed loan records the consumer can inspect
          { element: <VerifiedRecordsPage />, path: "verified" },
          { element: <ConsumerLoanDetailPage />, path: "loans/:id" },
          // Audit trail: full lineage for all events (loans/:loanId optional deep link)
          { element: <AuditTrailPage />, path: "audit" },
          { element: <AuditTrailPage />, path: "audit/:loanId" },
          // Public API explorer for the consumer-facing endpoints
          { element: <ApiExplorerPage />, path: "api" },
          // Certified CSV/JSON export with audit lineage
          { element: <ExportPage />, path: "export" },
        ],
        element: <ConsumerLayout />,
        path: "consumer",
      },
    ],
    // Root layout element rendered for the whole route tree
    element: <Layout />,
  },
];
