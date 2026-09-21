// Imports: React state, page header, button/dialog UI, the verified-loans API client, and a class util.
import { useState } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { verifiedLoansApi } from "@/lib/api";
import { cn } from "@/lib/utils";

/* Spec §6.2 — Export with format choice behind a confirm modal. Every export
   is audit-logged server-side (RECORD_EXPORTED with format metadata). */

// The two downloadable payload formats offered by the export page.
type ExportFormat = "csv" | "json";

// Human-readable format descriptors shown as selectable cards.
const FORMAT_OPTIONS: {
  description: string;
  extension: string;
  value: ExportFormat;
}[] = [
  {
    description: "Canonical columns + verification metadata, spreadsheet-ready",
    extension: "csv",
    value: "csv",
  },
  {
    description: "Full structured records incl. nested canonical data",
    extension: "json",
    value: "json",
  },
];

// Purpose: one-click export page hidden behind a confirm modal; every export is audit-logged
// server-side as RECORD_EXPORTED with format metadata via the export endpoint.
export default function ExportPage() {
  // Currently selected export format, defaulting to CSV.
  const [format, setFormat] = useState<ExportFormat>("csv");
  // Governs whether the confirmation dialog is visible.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Builds the download URL for the chosen format from the verified-loans API client.
  const target = verifiedLoansApi.exportUrl({ format });

  return (
    // Page shell: a centred 900px column with consistent vertical spacing.
    <div className="mx-auto max-w-[900px] space-y-6 p-8">
      {/* Standard page header describing the export feature. */}
      <PageHeader
        description="Download verified records. Every export is written to the audit trail."
        eyebrow="Data Consumer"
        title="Export"
      />
      {/* Options card holding the format selector and the export action. */}
      <section className="rounded-xl border border-border bg-card p-5">
        {/* Heading for the format-selection step. */}
        <h3 className="mb-3 font-semibold text-[14px] tracking-tight">
          Choose a format
        </h3>
        {/* Two-column grid of selectable format cards. */}
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Maps each format option to a clickable card. */}
          {FORMAT_OPTIONS.map((option) => (
            // Card button; highlights when it is the currently selected format.
            <button
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors",
                format === option.value
                  ? "border-primary/40 bg-primary/[0.05]"
                  : "border-border hover:bg-accent/40"
              )}
              key={option.value}
              onClick={() => setFormat(option.value)}
              type="button"
            >
              {/* First row: format icon, extension label, and selection check. */}
              <span className="flex items-center gap-2">
                {/* Icon switches between excel (CSV) and braces (JSON). */}
                <i
                  aria-hidden="true"
                  className={
                    option.value === "csv"
                      ? "ri-file-excel-2-line text-[15px] text-primary"
                      : "ri-braces-line text-[15px] text-primary"
                  }
                />
                {/* Mono uppercase extension label. */}
                <span className="font-medium font-mono text-[13px] uppercase">
                  {option.extension}
                </span>
                {/* Filled check icon only on the selected format card. */}
                {format === option.value ? (
                  <i
                    aria-hidden="true"
                    className="ri-checkbox-circle-fill ml-auto text-[14px] text-primary"
                  />
                ) : null}
              </span>
              {/* Descriptive sentence for what the format contains. */}
              <span className="text-[12px] text-muted-foreground leading-relaxed">
                {option.description}
              </span>
            </button>
          ))}
        </div>
        {/* Footer row: tamper-evidence note plus the export trigger button. */}
        <div className="mt-5 flex items-center justify-between border-border border-t pt-4">
          {/* Note asserting exports are logged with actor, count, and format. */}
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {/* Shield-check icon signalling the audit guarantee. */}
            <i
              aria-hidden="true"
              className="ri-shield-check-line text-success"
            />
            Exports are tamper-evident: logged with actor, count, and format.
          </p>
          {/* Button that opens the confirmation dialog before exporting. */}
          <Button onClick={() => setConfirmOpen(true)}>
            {/* Download icon paired with the primary export label. */}
            <i aria-hidden="true" className="ri-download-2-line" />
            Export verified loans
          </Button>
        </div>
      </section>
      {/* Confirmation dialog guarding the actual download. */}
      <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        {/* Dialog body container. */}
        <DialogContent>
          {/* Dialog header with title and explanatory copy. */}
          <DialogHeader>
            {/* Title of the confirm-export dialog. */}
            <DialogTitle>Confirm export</DialogTitle>
            {/* Copy warning that downloads every record and writes an audit entry. */}
            <DialogDescription>
              You are about to download all verified loan records as{" "}
              <span className="font-mono text-foreground">
                {format.toUpperCase()}
              </span>
              . This action writes a &quot;Verified record exported&quot; entry
              to the audit trail.
            </DialogDescription>
          </DialogHeader>
          {/* Dialog footer with Cancel and Download actions. */}
          <DialogFooter>
            {/* Cancel button that merely closes the dialog. */}
            <Button
              onClick={() => setConfirmOpen(false)}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
            {/* Confirm button: closes the dialog then opens the export URL in a new tab. */}
            <Button
              onClick={() => {
                setConfirmOpen(false);
                window.open(target, "_blank", "noopener");
              }}
              size="sm"
            >
              {/* Download icon paired with the explicit format label. */}
              <i aria-hidden="true" className="ri-download-2-line" />
              Download {format.toUpperCase()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
