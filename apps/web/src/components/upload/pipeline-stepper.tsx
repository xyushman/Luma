// Types model the batch state machine and progress metadata; React + cn serve the cards.
import type { BatchStatus, PipelineProgressMetadata } from "@repo/types";
import type React from "react";
import { cn } from "@/lib/utils";

// One pipeline stage: id, title, icon glyph, and a one-line description of the work.
interface PipelineStep {
  description: string;
  icon: string;
  id: number;
  title: string;
}

// The four canonical stages in order, mirroring the backend ingestion state machine.
const PIPELINE_STEPS: readonly PipelineStep[] = [
  {
    description: "File received & staged",
    icon: "ri-upload-cloud-2-line",
    id: 1,
    title: "Upload & Staging",
  },
  {
    description: "Headers & schema checked",
    icon: "ri-file-search-line",
    id: 2,
    title: "Schema Verification",
  },
  {
    description: "Streaming 5k-row chunks",
    icon: "ri-database-2-line",
    id: 3,
    title: "Ingestion & Normalization",
  },
  {
    description: "10 rules & duplicate engine",
    icon: "ri-shield-check-line",
    id: 4,
    title: "Automated Validation",
  },
] as const;

// Per-step render state derived from the batch status and streaming progress.
type StepState = "completed" | "current" | "pending" | "failed";

// Props to the tracker: batch status, progress metadata, row counts, and a class.
interface PipelineTrackerProps {
  className?: string;
  failedCount?: number;
  metadata?: unknown;
  processedCount?: number;
  recordCount?: number;
  status?: BatchStatus;
}

// Maps a step id against the batch position into one of the four render states.
function computeStepState(
  stepId: number,
  currentStep: number,
  isDone: boolean,
  isFailed: boolean
): StepState {
  // On failure the current step reads red, earlier steps close out, later ones wait.
  if (isFailed) {
    if (stepId === currentStep) {
      return "failed";
    }
    if (stepId < currentStep) {
      return "completed";
    }
    return "pending";
  }

  // Anything finished already, or historically behind the current step, is completed.
  if (isDone || stepId < currentStep) {
    return "completed";
  }

  // The step the pipeline is sitting on at this moment is current.
  if (stepId === currentStep) {
    return "current";
  }

  // Whatever comes after the active step stays pending for now.
  return "pending";
}

// Converts stage state into a 0-100 bar width for the header progress strip.
function computeProgress(
  currentStep: number,
  isDone: boolean,
  isFailed: boolean
): number {
  // A completed pipeline fills the bar to 100%.
  if (isDone) {
    return 100;
  }
  // A failed run still shows the stage it reached, floored at 15% so it stays visible.
  if (isFailed) {
    return Math.max(15, (currentStep - 1) * 25);
  }
  // Per-phase fill targets approximate how far the streaming work has advanced.
  const map: Record<number, number> = { 1: 20, 2: 40, 3: 65, 4: 85, 5: 100 };
  return map[currentStep] ?? 20;
}

// Builds the human-readable status line shown under the header status icon.
function formatActiveMessage(
  meta: PipelineProgressMetadata,
  currentStep: number,
  isDone: boolean,
  isFailed: boolean,
  processedCount: number,
  failedCount: number,
  recordCount: number
): string {
  // A per-stage message from analytics wins, since it is the most precise.
  if (meta.stageMessage) {
    return meta.stageMessage;
  }
  // Completion line reports normalized rows and the malformed rows isolated.
  if (isDone) {
    return `Pipeline completed successfully (${processedCount} loans normalized, ${failedCount} malformed rows isolated).`;
  }
  // Failure surfaces the stored error, with a generic fallback for missing detail.
  if (isFailed) {
    return (
      meta.error ?? "Pipeline failed during processing. Check logs for details."
    );
  }
  // Phase one copy orients the operator while the file is staged.
  if (currentStep === 1) {
    return "Staging uploaded file...";
  }
  // Phase two checks headers against the canonical loan schema.
  if (currentStep === 2) {
    return "Validating CSV headers against canonical loan schema...";
  }
  // Phase three reports live row counts as the 5k-row chunks stream in.
  if (currentStep === 3) {
    return `Streaming rows into database (${processedCount} of ${recordCount || "..."} processed)...`;
  }
  // Final stage advertises the ten rules plus the cross-loan duplicate engine.
  if (currentStep === 4) {
    return "Running 10 validation rules and cross-loan duplicate analysis...";
  }
  return "Processing pipeline...";
}

// Icon glyph per state; a pending step falls back to showing its number.
function renderStepIcon(state: StepState, stepId: number): React.ReactNode {
  if (state === "completed") {
    return <i className="ri-check-line text-sm" />;
  }
  if (state === "failed") {
    return <i className="ri-close-line text-sm" />;
  }
  if (state === "current") {
    return <i className="ri-loader-4-line animate-spin text-sm" />;
  }
  return stepId;
}

// Card subtitle switches on state, otherwise showing the step's default description.
function getStepSubtitle(state: StepState, defaultDesc: string): string {
  if (state === "completed") {
    return "Completed";
  }
  if (state === "failed") {
    return "Failed here";
  }
  if (state === "current") {
    return "In progress...";
  }
  return defaultDesc;
}

// One timeline card: state-colored border, circular icon/status, title, and subtitle.
function PipelineStepCard({
  step,
  state,
}: {
  step: PipelineStep;
  state: StepState;
}) {
  return (
    // Card frame tints per state: success, primary, destructive, or muted pending.
    <div
      className={cn(
        "relative flex items-start gap-3 rounded-lg border p-3 transition-colors",
        state === "completed" &&
          "border-success/30 bg-success/8 text-foreground",
        state === "current" && "border-primary/40 bg-primary/8",
        state === "failed" &&
          "border-destructive/40 bg-destructive/8 text-destructive",
        state === "pending" &&
          "border-border bg-transparent text-muted-foreground opacity-70"
      )}
    >
      {/* Circular status badge mirrors the card tint so the icon reads at a glance. */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-semibold text-xs",
          state === "completed" && "bg-success text-success-foreground",
          state === "current" &&
            "animate-pulse bg-primary text-primary-foreground",
          state === "failed" && "bg-destructive text-white",
          state === "pending" && "bg-muted text-muted-foreground"
        )}
      >
        {renderStepIcon(state, step.id)}
      </div>

      {/* Step title plus a state-aware subtitle that fits on one line. */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-xs">{step.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {getStepSubtitle(state, step.description)}
        </p>
      </div>
    </div>
  );
}

// Header icon tile: a green check, a red warning, or a spinning loader by state.
function HeaderStatusIcon({
  isDone,
  isFailed,
}: {
  isDone: boolean;
  isFailed: boolean;
}) {
  if (isDone) {
    return (
      // Done shows the checkbox glyph inside a success-toned tile.
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 font-semibold text-success text-xs">
        <i className="ri-checkbox-circle-line text-lg" />
      </div>
    );
  }
  if (isFailed) {
    return (
      // Failed shows the warning glyph inside a destructive-toned tile.
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 font-semibold text-destructive text-xs">
        <i className="ri-error-warning-line text-lg" />
      </div>
    );
  }
  return (
    // Running falls back to an accent tile with a spinning loader.
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-semibold text-accent-foreground text-xs">
      <i className="ri-loader-4-line animate-spin text-lg" />
    </div>
  );
}

// Header pill such as "Phase 2 of 4"; swaps to complete/failed copy when finished.
function HeaderBadge({
  isDone,
  isFailed,
  currentStep,
}: {
  isDone: boolean;
  isFailed: boolean;
  currentStep: number;
}) {
  // Default shows the phase index; done and failed replace the copy entirely.
  let text = `Phase ${Math.min(currentStep, 4)} of 4`;
  if (isDone) {
    text = "All Stages Complete";
  } else if (isFailed) {
    text = "Pipeline Failed";
  }

  // Running means neither finished nor failed, which drives the pulsing dot.
  const isRunning = !(isDone || isFailed);

  return (
    // Pill tints by state; the ping dot animates while a stage is still running.
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-xs",
        isDone && "border border-success/30 bg-success/10 text-success",
        isFailed &&
          "border border-destructive/30 bg-destructive/10 text-destructive",
        isRunning && "border border-primary/30 bg-primary/10 text-primary"
      )}
    >
      {isRunning ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      ) : null}
      {text}
    </span>
  );
}

// Upload widget visualizing where a batch sits inside the four-stage ingestion pipeline.
export function PipelineTracker({
  status = "processing",
  metadata,
  recordCount = 0,
  processedCount = 0,
  failedCount = 0,
  className,
}: PipelineTrackerProps) {
  // Progress metadata is optional; the current step defaults from the done flag.
  const meta = (metadata as PipelineProgressMetadata | null) ?? {};
  const currentStep = meta.pipelineStep ?? (status === "done" ? 5 : 1);
  // Failed when the status enum or the progress stage says so.
  const isFailed = status === "failed" || meta.pipelineStage === "failed";
  // Done covers both the status enum and the completed progress stage.
  const isDone = status === "done" || meta.pipelineStage === "completed";

  // Bar width plus the status line derive from the same step/state inputs.
  const progressPercentage = computeProgress(currentStep, isDone, isFailed);
  const message = formatActiveMessage(
    meta,
    currentStep,
    isDone,
    isFailed,
    processedCount,
    failedCount,
    recordCount
  );

  return (
    // Card container re-tints by state so failure reads red and success reads green.
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-5 transition-all",
        isFailed && "border-destructive/30 bg-destructive/8",
        isDone && "border-success/25 bg-success/[0.03]",
        className
      )}
    >
      {/* Header row: status icon, title + message on the left, phase badge on the right. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <HeaderStatusIcon isDone={isDone} isFailed={isFailed} />
          <div>
            <h3 className="font-semibold text-sm">Ingestion Pipeline Status</h3>
            <p
              className={cn(
                "text-xs",
                isFailed
                  ? "font-medium text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <HeaderBadge
            currentStep={currentStep}
            isDone={isDone}
            isFailed={isFailed}
          />
        </div>
      </div>

      {/* Linear progress bar tracks the streamed-row progress as a fraction. */}
      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {/* Filler smooths to the width; its color follows the pipeline state. */}
        <div
          className={cn(
            "h-full transition-all duration-500 ease-out",
            isDone && "bg-success",
            isFailed && "bg-destructive",
            !(isDone || isFailed) && "bg-primary"
          )}
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      {/* 4 Step Timeline renders one card per stage in a responsive grid. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PIPELINE_STEPS.map((step) => {
          // Each step resolves its own state against the batch position.
          const state = computeStepState(
            step.id,
            currentStep,
            isDone,
            isFailed
          );
          return <PipelineStepCard key={step.id} state={state} step={step} />;
        })}
      </div>
    </div>
  );
}
