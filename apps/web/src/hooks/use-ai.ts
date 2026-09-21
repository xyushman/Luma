// AI copilot mutations: exception explanation, decision recording, batch summary, note drafting.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { aiApi, exceptionsApi } from "@/lib/api";

// Asks the AI to explain why a validation rule flagged the exception (detail card).
export function useExplainException() {
  return useMutation({
    mutationFn: (exceptionId: string) => aiApi.explain(exceptionId),
    onError: (error: Error) => {
      toast.error("AI unavailable", {
        description:
          error instanceof Error
            ? error.message
            : "Proceed with manual review.", // Fallback text if the error shape is unexpected
      });
    },
  });
}

// Records the reviewer's accept/edit/reject decision on an AI suggestion.
export function useAiDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      editedValue?: string | null; // Reviewer's edited value when choosing "edited"
      exceptionId: string;
      decision: "accepted" | "edited" | "rejected"; // The three human-in-the-loop outcomes
    }) =>
      exceptionsApi.recordAiDecision(input.exceptionId, {
        decision: input.decision,
        editedValue: input.editedValue ?? null, // Normalize undefined to null for the API
      }),
    onError: (error: Error) => {
      toast.error("Could not record decision", { description: error.message });
    },
    onSuccess: (result) => {
      toast.success(`AI suggestion ${result.aiDecision}`);
      void queryClient.invalidateQueries({ queryKey: ["exceptions"] }); // Queue states may change (e.g. severity)
      void queryClient.invalidateQueries({
        queryKey: ["exception", result.exceptionId], // Detail now reflects the recorded decision
      });
    },
  });
}

// Generates a natural-language summary of a whole upload batch.
export function useSummarizeBatch() {
  return useMutation({
    mutationFn: (batchId: string) => aiApi.summarizeBatch(batchId),
    onError: (error: Error) => {
      toast.error("AI summary unavailable", {
        description:
          error instanceof Error
            ? error.message
            : "Could not generate summary.",
      });
    },
  });
}

// Drafts a reviewer note for an exception; the reviewer edits it before saving.
export function useDraftNote() {
  return useMutation({
    mutationFn: (exceptionId: string) => aiApi.draftNote(exceptionId),
    onError: (error: Error) => {
      toast.error("Note drafting unavailable", { description: error.message });
    },
    onSuccess: (result) => {
      if (result.note) {
        // Only toast when the AI actually returned draft text
        toast.success("Reviewer note drafted — edit before saving");
      }
    },
  });
}
