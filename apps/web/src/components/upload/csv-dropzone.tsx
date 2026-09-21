// Shadcn primitives plus the create-upload mutation drive this operator-only dropzone.
import type { FileType } from "@repo/types";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateUpload } from "@/hooks/use-uploads";
import { cn } from "@/lib/utils";

// 500 MB cap plus the supported lender file types the staging pipeline can accept.
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const FILE_TYPES: FileType[] = [
  "loan_tape",
  "servicer_update",
  "document_manifest",
  "fannie_mae",
  "freddie_mac",
];

// Human-readable labels map each file-type enum to a picker-friendly name.
const FILE_TYPE_LABELS: Record<FileType, string> = {
  document_manifest: "Document manifest",
  fannie_mae: "Fannie Mae — SF Loan Performance",
  freddie_mac: "Freddie Mac — SF Loan-Level",
  loan_tape: "Loan tape",
  servicer_update: "Servicer update",
};

// Operator-only upload widget: validates a CSV locally, then streams it into staging.
export function CsvDropzone() {
  // Local state: hidden input ref, router, selected file type, staged file, and drag flag.
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [fileType, setFileType] = useState<FileType>("loan_tape");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // Create-upload mutation streams the file and reports upload progress as it goes.
  const createUpload = useCreateUpload();

  // Gatekeeper for picker and drag-drop: rejects missing, non-CSV, or oversized files.
  const validateAndSet = (candidate: File | undefined) => {
    // A cancelled picker yields no file, so nothing is staged.
    if (!candidate) {
      return;
    }
    // Extension guard keeps the staging layer free of non-CSV uploads.
    if (!candidate.name.toLowerCase().endsWith(".csv")) {
      toast.error("Only .csv files are supported");
      return;
    }
    // Size guard mirrors the 500 MB contract the backend enforces.
    if (candidate.size > MAX_FILE_BYTES) {
      toast.error("File too large", {
        description: "Maximum size is 500 MB.",
      });
      return;
    }
    // Passed all checks: stage the candidate so Start Ingestion can use it.
    setFile(candidate);
  };

  // Kicks off the create-upload mutation; progress flows into the bar via callback.
  const startUpload = () => {
    // No-op without a staged file or while a previous transfer is in flight.
    if (!file || createUpload.isPending) {
      return;
    }
    // Reset the bar, then stream the file with a live progress callback.
    setProgress(0);
    createUpload.mutate(
      { file, fileType, onProgress: setProgress },
      {
        onError: () => setProgress(null),
        onSuccess: (result) => {
          // Clear staged state now that the upload landed on the server.
          setFile(null);
          setProgress(null);
          // Reset the hidden input so the same file could be selected again.
          const input = inputRef.current;
          if (input instanceof HTMLInputElement) {
            input.value = "";
          }
          // Route the operator to the new batch's detail page.
          navigate(`/operator/uploads/${result.batchId}`);
        },
      }
    );
  };

  // Programmatically clicks the hidden input so the whole button acts as a picker.
  const openPicker = () => {
    inputRef.current?.click();
  };

  return (
    // Card section: header sets expectations, body holds dropzone and controls.
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Card header titles the widget and states the limits up front. */}
      <header className="border-border border-b px-6 py-5">
        <h3 className="font-semibold text-base tracking-tight">
          Upload loan data
        </h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Max size 500 MB — ingestion runs in the background with auto-detected
          schemas and validation tracking.
        </p>
      </header>
      {/* Body stacks the dropzone, file-type select, upload button, and progress bar. */}
      <div className="space-y-0 p-6">
        {/* Whole dropzone is one button: click opens the picker, drag handlers toggle state. */}
        <button
          aria-label="Upload CSV file"
          className={cn(
            "group flex h-[240px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200",
            dragging
              ? "border-primary bg-primary/[0.04]"
              : "border-border/80 bg-muted/30 hover:border-primary/50 hover:bg-accent/40"
          )}
          onClick={openPicker}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            validateAndSet(event.dataTransfer.files[0]);
          }}
          type="button"
        >
          {/* Staged file view: icon, name, and MB size; clicking again replaces. */}
          {file ? (
            <div className="flex flex-col items-center">
              {/* File glyph tile marks the staged upload. */}
              <span className="mb-2.5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <i aria-hidden="true" className="ri-file-text-line text-2xl" />
              </span>
              <p className="font-medium text-foreground text-sm">{file.name}</p>
              {/* Size in MB keeps the 500 MB contract visible to the operator. */}
              <p className="mt-0.5 text-muted-foreground text-xs">
                {(file.size / 1024 / 1024).toFixed(2)} MB · click to replace
              </p>
            </div>
          ) : (
            <>
              {/* Empty-state prompt: upload glyph plus the drag-and-click invite. */}
              <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground/60 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                <i
                  aria-hidden="true"
                  className="ri-upload-cloud-2-line text-2xl"
                />
              </span>
              <p className="font-medium text-foreground text-sm">
                Drag &amp; drop your CSV here, or click to browse
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                .csv files up to 500 MB
              </p>
            </>
          )}
          {/* Visually hidden input bound to the picker and programmatic clicks. */}
          <input
            accept=".csv"
            aria-label="Choose CSV file"
            className="sr-only"
            onChange={(event) => validateAndSet(event.target.files?.[0])}
            ref={inputRef}
            type="file"
          />
        </button>

        {/* Footer: file-type selector left, Start Ingestion right, progress underneath. */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-border border-t pt-5">
          <div className="flex items-center gap-3">
            <Label
              className="font-medium text-[11.5px] text-muted-foreground uppercase tracking-wider"
              htmlFor="file-type"
            >
              File type
            </Label>
            {/* Select picks which lender schema the pipeline will infer against. */}
            <Select
              onValueChange={(value) => setFileType(value as FileType)}
              value={fileType}
            >
              <SelectTrigger
                className="w-52 rounded-xl"
                id="file-type"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {FILE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Start Ingestion needs a staged valid file and no upload already running. */}
          <Button
            className="ml-auto rounded-full px-6 py-2.5 font-medium text-[14px]"
            disabled={!file || createUpload.isPending}
            onClick={startUpload}
          >
            {createUpload.isPending ? (
              <>
                <i
                  aria-hidden="true"
                  className="ri-loader-4-line animate-spin text-base"
                />
                Uploading...
              </>
            ) : (
              <>
                <i aria-hidden="true" className="ri-upload-cloud-2-line" />
                Start Ingestion
              </>
            )}
          </Button>
        </div>

        {/* Percent progress bar only renders while an upload is running. */}
        {progress === null ? null : (
          <div className="mt-4 space-y-1">
            <Progress value={progress} />
            <p className="text-right text-muted-foreground text-xs tabular-nums">
              {progress}%
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
