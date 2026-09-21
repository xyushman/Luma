// Page header, button link styling, and the drag-and-drop CSV upload component
import { PageHeader } from "@/components/dashboard/page-header";
import { buttonVariants } from "@/components/ui/button";
import { CsvDropzone } from "@/components/upload/csv-dropzone";
import { cn } from "@/lib/utils";

/* Spec §4.2 — Upload Data (Module A ingestion flow entry point). */

// Sample CSVs offered for download so a demo can seed realistic test data instantly
const SAMPLE_FILES = [
  {
    description: "137 loans · 15 anomaly types",
    filename: "loan_tape.csv",
    href: "/sample-files/loan_tape.csv",
    label: "Loan Tape",
  },
  {
    description: "Conflicting balances & status updates",
    filename: "servicer_update.csv",
    href: "/sample-files/servicer_update.csv",
    label: "Servicer Update",
  },
  {
    description: "Document checklist & verification flags",
    filename: "document_manifest.csv",
    href: "/sample-files/document_manifest.csv",
    label: "Document Manifest",
  },
] as const;

// The five file types the ingestion pipeline accepts, with what each one contains
const ACCEPTED = [
  {
    description:
      "Primary loan tape export containing borrower and credit profile data",
    name: "loan_tape.csv",
    type: "Loan tape",
  },
  {
    description: "Servicer balance, delinquency status, and payment updates",
    name: "servicer_update.csv",
    type: "Servicer update",
  },
  {
    description: "Collateral document index and verification manifests",
    name: "document_manifest.csv",
    type: "Document manifest",
  },
  {
    // Fannie Mae data is pipe-delimited and registration-gated; folded per loanId (first-wins, latest-wins rules)
    description:
      "Fannie Mae Single-Family Loan Performance — pipe-delimited, 108 cols, registration-gated (sample at capitalmarkets.fanniemae.com). Folded per loanId (first-wins immutable, latest-wins balance/rate/delinquency).",
    name: "fannie_mae.csv",
    type: "Fannie Mae",
  },
  {
    // Freddie Mac is similar, free via Clarity, with the same fold and a tolerant 40+ column gate
    description:
      "Freddie Mac Single-Family Loan-Level — pipe-delimited, 108 cols, free non-commercial via Clarity. Same fold and tolerant ≥40-col gate.",
    name: "freddie_mac.csv",
    type: "Freddie Mac",
  },
];

// UploadPage: Module A entry point where a data_operator ingests a tape via the dropzone (driver of the pipeline)
export default function UploadPage() {
  return (
    <div className="mx-auto max-w-[880px] space-y-6 p-8">
      <PageHeader
        description="Drop a file to parse, validate, and import it. Headers are auto-detected."
        eyebrow="Data Operator"
        title="Upload Data"
      />

      {/* The core drag-and-drop / file-picker zone that streams the tape to the API */}
      <CsvDropzone />

      {/* Sample files section: links let the demo user download curated test CSVs */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                <i
                  aria-hidden="true"
                  className="ri-download-cloud-2-line text-sm"
                />
              </span>
              <h3 className="font-semibold text-[13.5px] tracking-tight">
                Download sample files
              </h3>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Test ingestion and AI exception handling with curated datasets
            </p>
          </div>
          {/* One outline button per sample file; triggers a browser download */}
          <div className="flex flex-wrap items-center gap-2.5">
            {SAMPLE_FILES.map((sample) => (
              <a
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" }),
                  "h-8 gap-2 rounded-xl border-border/80 bg-background/80 px-3 text-[12px] shadow-xs hover:border-primary/40 hover:bg-accent/40"
                )}
                download={sample.filename}
                href={sample.href}
                key={sample.filename}
              >
                <i
                  aria-hidden="true"
                  className="ri-download-2-line text-muted-foreground"
                />
                <span>{sample.label}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Accepted formats list: documents what the parser will accept from the operator */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <header className="border-border border-b px-6 py-4">
          <h3 className="font-semibold text-[14px] tracking-tight">
            Accepted file formats
          </h3>
          <p className="text-[12px] text-muted-foreground">
            Standard CSV schemas supported by the ingestion pipeline
          </p>
        </header>
        <ul className="divide-y divide-border">
          {ACCEPTED.map((file) => (
            <li
              className="flex items-center justify-between gap-4 px-6 py-3.5"
              key={file.name}
            >
              <div className="flex items-center gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/60 text-muted-foreground shadow-xs">
                  <i
                    aria-hidden="true"
                    className="ri-file-excel-2-line text-[16px]"
                  />
                </span>
                <div>
                  {/* Filename in monospace, with a human explanation underneath */}
                  <p className="font-medium font-mono text-[13px] text-foreground">
                    {file.name}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {file.description}
                  </p>
                </div>
              </div>
              {/* Badge showing the friendly type name (Loan tape, Fannie Mae, etc.) */}
              <span className="rounded-md border border-border bg-muted/60 px-2.5 py-0.5 font-medium text-[11px] text-muted-foreground">
                {file.type}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
