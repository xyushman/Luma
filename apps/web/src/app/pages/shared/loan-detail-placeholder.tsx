// useParams reads the :id URL param for the reviewer/consumer deep links
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

// ComingSoon: generic "not built yet" card shown where a detail view is still pending with an API contract
function ComingSoon({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* The loan identifier makes the placeholder feel contextual per route */}
      <h1 className="font-heading font-semibold text-2xl">{label}</h1>
      {/* Explains the view is Phase 2, though the API/type contract already exists */}
      <p className="text-muted-foreground text-sm">
        Loan detail view arrives in Phase 2 — the API contract and types are
        already in place.
      </p>
      {/* Browser-history back is the natural exit for a placeholder */}
      <Button onClick={() => window.history.back()} variant="outline">
        Go back
      </Button>
    </div>
  );
}

// ReviewerLoanDetail: placeholder guard for /reviewer/loans/:id until the reviewer detail is built
export function ReviewerLoanDetail() {
  const { id } = useParams<{ id: string }>();
  return <ComingSoon label={`Loan ${id ?? ""} (reviewer)`} />;
}

// ConsumerVerifiedLoanDetail: placeholder guard for /consumer/loans/:id until the verified detail is built
export function ConsumerVerifiedLoanDetail() {
  const { id } = useParams<{ id: string }>();
  return <ComingSoon label={`Verified loan ${id ?? ""}`} />;
}
