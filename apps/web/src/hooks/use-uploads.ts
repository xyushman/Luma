// Upload pipeline hooks: list batches, poll processing, and initiate uploads.
import type { BatchStatus, FileType } from "@repo/types"; // Shared batch/file-type enums
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { uploadsApi } from "@/lib/api";

// Paginated upload-batch list, optionally filtered by processing status.
export function useUploads(page = 1, status?: BatchStatus) {
  return useQuery({
    queryFn: () => uploadsApi.list({ limit: 20, page, status }),
    queryKey: ["uploads", page, status], // Page + status in the key => changes re-fetch
  });
}

// Single batch detail that self-polls every 1.5s while the batch is processing.
export function useUploadBatch(batchId: string) {
  return useQuery({
    enabled: Boolean(batchId), // Don't fire until a batch id exists
    queryFn: () => uploadsApi.detail(batchId),
    queryKey: ["uploads", batchId],
    refetchInterval: (
      query // Conditionally poll only while the pipeline is mid-flight
    ) => (query.state.data?.status === "processing" ? 1500 : false), // Stop polling once done/failed
  });
}

// Batch summary (per-type counts) also polled while processing for live stats.
export function useUploadBatchSummary(batchId: string, isProcessing = false) {
  return useQuery({
    enabled: Boolean(batchId),
    queryFn: () => uploadsApi.summary(batchId),
    queryKey: ["uploads", batchId, "summary"],
    refetchInterval: isProcessing ? 1500 : false, // Parent decides when processing is active
  });
}

// Payload contract for starting an upload (file, detected type, progress cb).
export interface CreateUploadVariables {
  file: File; // Raw file selected by the operator
  fileType: FileType; // Detected category (loan_tape, servicer_update, ...)
  onProgress?: (percent: number) => void; // Optional callback feeding a progress bar
}

// Starts an ingestion batch and refreshes uploads, summary, and exceptions.
export function useCreateUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, fileType, onProgress }: CreateUploadVariables) =>
      uploadsApi.create(file, fileType, onProgress),
    onError: (error: Error) => {
      toast.error("Upload failed", { description: error.message });
    },
    onSuccess: (result) => {
      toast.success(result.message ?? "Upload started");
      void queryClient.invalidateQueries({ queryKey: ["uploads"] }); // New batch must appear in the list
      void queryClient.invalidateQueries({ queryKey: ["summary"] }); // Dashboard counts shift
      void queryClient.invalidateQueries({ queryKey: ["exceptions"] }); // New ingestion may raise exceptions
    },
  });
}
