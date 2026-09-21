// Imports: Node fs/os/path for file handling, shared request/response types and Zod schemas from
// @repo/types, Express + multer for HTTP and multipart parsing, Prisma, auth/RBAC guards, and the
// three pipeline entry services (document manifest, public-data ingestion, streaming ingestion).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type BatchSummary,
  type CreateUploadResponse,
  fileTypeSchema,
  type GetBatchResponse,
  listUploadsQuerySchema,
} from "@repo/types";
import express, { type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import { processDocumentManifest } from "../services/document-manifest.service.js";
import { processStreamAndNormalize } from "../services/ingestion.service.js";
import { processPublicDataIngestion } from "../services/public-data/ingestion.service.js";

// Define the maximum allowed file size for uploads (500 Megabytes)
const MAX_FILE_SIZE = 500 * 1024 * 1024;
// Determine the system's temporary directory and create a specific folder for Luma uploads
const UPLOAD_DIR = path.join(os.tmpdir(), "luma-uploads");
// Create a Zod schema to validate that batch IDs are valid CUIDs (Collision Resistant Unique Identifiers)
const BATCH_ID_SCHEMA = z.string().cuid2().or(z.string().cuid());

// Helper function to ensure the upload directory physically exists on the disk
const ensureUploadDir = (): void => {
  // If the directory does not exist yet...
  if (!fs.existsSync(UPLOAD_DIR)) {
    // ...create it (and any necessary parent directories)
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
};

// Run the helper function immediately on startup to ensure the folder is ready
ensureUploadDir();

// Configure 'multer', a middleware for handling multipart/form-data (file uploads)
const storage = multer.diskStorage({
  // Define where the file should be saved on the server
  destination: (_req, _file, cb) => {
    // Double-check the directory exists before saving
    ensureUploadDir();
    // Callback with no error (null) and the destination path
    cb(null, UPLOAD_DIR);
  },
  // Define how the uploaded file should be named on the server
  filename: (_req, file, cb) => {
    // Create a safe, unique filename by prepending the current timestamp and stripping out any dangerous characters
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    // Callback with no error (null) and the generated safe filename
    cb(null, safeName);
  },
});

// Initialize the multer instance with our storage configuration and file size limit
const upload = multer({
  limits: { fileSize: MAX_FILE_SIZE },
  storage,
});

// Create a new Express router object to handle upload-related API endpoints
const router = express.Router();

// Apply an authentication middleware to ALL routes in this router so only logged-in users can access them
router.use(requireAuth);

// POST / upload endpoint: operator-only, accepts a single CSV, stages it, then async pipelines it.
router.post(
  "/",
  requireRole("data_operator"),
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    // Pull the multer-parsed file (if any) from the request under a typed cast.
    const { file } = req as Request & { file?: Express.Multer.File };
    // Read the declared fileType discriminator from the multipart form body.
    const { fileType } = req.body as { fileType?: string };

    // Reject with 400 before anything else if no file was actually sent.
    if (!file) {
      res.status(400).json({ code: "BAD_REQUEST", error: "Missing file" });
      return;
    }

    // Only CSV files are accepted, so inspect the extension after lowercasing it.
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".csv") {
      try {
        fs.unlinkSync(file.path); // Discard the rejected file from disk to avoid orphaned files.
      } catch {
        // ignore
      }
      // Respond 415 Unsupported Media Type, the correct status for a wrong file format.
      res.status(415).json({
        code: "UNSUPPORTED_MEDIA_TYPE",
        error: "Only .csv files are allowed",
      });
      return;
    }

    // Reject if the caller did not state which of the five pipeline file types this is.
    if (!fileType) {
      try {
        fs.unlinkSync(file.path); // Same cleanup: remove the file we are not going to process.
      } catch {
        // ignore
      }
      res.status(400).json({ code: "BAD_REQUEST", error: "Missing fileType" });
      return;
    }

    // Validate fileType against the known union schema rather than trusting raw input.
    const parsedType = fileTypeSchema.safeParse(fileType);
    if (!parsedType.success) {
      try {
        fs.unlinkSync(file.path); // Invalid type, so nothing further will use this file.
      } catch {
        // ignore
      }
      // Return 400 listing the accepted values so clients can fix the request.
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid fileType",
        fields: {
          fileType:
            "Must be loan_tape | servicer_update | document_manifest | fannie_mae | freddie_mac",
        },
      });
      return;
    }

    const { user } = req;
    // The router already required auth, but narrow the type and fail defensively anyway.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    // Create the batch row and write the FILE_UPLOADED audit event atomically in one transaction.
    const batch = await prisma.$transaction(async (tx) => {
      // Persist the upload as a new batch marked "processing" and pinned to the very first pipeline step.
      const created = await tx.uploadBatch.create({
        data: {
          fileName: file.originalname,
          filePath: file.path, // Keep the on-disk path so the async worker can stream it later.
          fileType: parsedType.data,
          metadata: {
            pipelineStage: "staged", // Pipeline start: the batch is staged awaiting ingestion.
            pipelineStep: 1,
            stageMessage: "File received and staged for ingestion.",
          },
          recordCount: 0, // Rows are counted later by the streaming ingester.
          status: "processing",
          uploadedById: user.id, // Tie the batch to its operator for ownership-scoped queries.
        },
      });
      // Record the upload action so the audit trail shows who uploaded which file.
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          batchId: created.id,
          eventType: "FILE_UPLOADED",
          metadata: { fileName: created.fileName, fileType: created.fileType },
        },
      });
      return created;
    });

    // Build the payload the client receives immediately after a successful staging.
    const response: CreateUploadResponse = {
      batchId: batch.id,
      fileName: batch.fileName,
      fileType: batch.fileType as CreateUploadResponse["fileType"],
      message: "File uploaded. Processing has started.",
      status: "processing",
    };

    // Log the ingestion acceptance line to stdout for operational traces.
    process.stdout.write(
      `[Upload] Received "${file.originalname}" (${(file.size / 1024).toFixed(1)} KB, type: ${parsedType.data}) by ${user.email} -> batchId: ${batch.id}\n`
    );

    // Reply 202 Accepted immediately, since the heavy work runs in the background after this.
    res.status(202).json(response);

    // Document manifests bypass the loan pipeline entirely: they stream
    // their own format and apply documentStatus onto existing tape loans.
    if (batch.fileType === "document_manifest") {
      // Fire the manifest handler asynchronously so the HTTP response is not blocked.
      processDocumentManifest(file.path, batch.id).catch((err) => {
        // Surface any uncaught failure to stderr for debugging rather than crashing the process.
        process.stderr.write(
          `[Upload] Manifest processing uncaught error for batch ${batch.id}: ${err}\n`
        );
      });
      return;
    }

    // Public loan data (Fannie Mae / Freddie Mac) is loan-shaped pipe data:
    // same validation → exception → verification lineage as the synthetic
    // loan_tape, handled by a dedicated tolerant parser and incremental
    // contiguous-run fold (352522aa plan §4).
    if (batch.fileType === "fannie_mae" || batch.fileType === "freddie_mac") {
      // Run the public-data ingestion pipeline in the background for either agency file.
      processPublicDataIngestion(
        file.path,
        batch.id,
        batch.fileType as "fannie_mae" | "freddie_mac"
      ).catch((err) => {
        // Log background failures so operators can investigate without taking down the process.
        process.stderr.write(
          `[Upload] Public-data ingestion uncaught error for batch ${batch.id}: ${err}\n`
        );
      });
      return;
    }

    // Default path (loan_tape / servicer_update): stream the rows in O(1) memory in the background.
    processStreamAndNormalize(file.path, batch.id).catch((err) => {
      // Report any ingestion failure on stderr for later diagnosis.
      process.stderr.write(
        `[Upload] Ingestion stream uncaught error for batch ${batch.id}: ${err}\n`
      );
    });
  }
);

// GET /list endpoint, open to all three roles so dashboards can render batch history.
router.get(
  "/",
  requireRole("data_operator", "reviewer", "data_consumer"),
  async (req: Request, res: Response): Promise<void> => {
    // Validate the pagination and status filter query parameters against the shared Zod schema.
    const parsed = listUploadsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      // Reply 400, mapping each failed field to its human-readable error message.
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid query",
        fields: Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join("."),
            issue.message,
          ])
        ),
      });
      return;
    }

    const { page, limit, status } = parsed.data;
    const { user } = req;
    // Authed by router.use(requireAuth) above, but narrow the type and stay fail-closed anyway.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    // Operators see only their own batches; reviewer/consumer need batch
    // metadata (fileName, recordCount, fileType) for dashboards and filters.
    const where: Record<string, unknown> =
      user.role === "data_operator" ? { uploadedById: user.id } : {};
    // Apply the optional status filter on top of the role scoping.
    if (status) {
      where.status = status;
    }

    // Convert page/limit to an offset for skip-take pagination.
    const skip = (page - 1) * limit;
    // Fetch the matching row count and one page of batches in parallel.
    const [total, batches] = await Promise.all([
      prisma.uploadBatch.count({ where }),
      prisma.uploadBatch.findMany({
        orderBy: { createdAt: "desc" }, // Newest uploads first for the list UI.
        skip,
        take: limit,
        where,
      }),
    ]);

    // Project each batch to the slim fields the list UI consumes.
    const data = batches.map((batch) => ({
      createdAt: batch.createdAt.toISOString(),
      failedCount: batch.failedCount,
      fileName: batch.fileName,
      fileType: batch.fileType,
      id: batch.id,
      recordCount: batch.recordCount,
      status: batch.status,
    }));

    // Return the page along with enough pagination math for the frontend to render controls.
    res.json({
      data,
      pagination: {
        limit,
        page,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }
);

// GET /:batchId detail endpoint, restricted to the operator who owns the batch.
router.get(
  "/:batchId",
  requireRole("data_operator"),
  async (req: Request, res: Response): Promise<void> => {
    const rawBatchId = (req.params as { batchId: string }).batchId;
    // Validate the path param is a real cuid before touching the database.
    const parsedId = BATCH_ID_SCHEMA.safeParse(rawBatchId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid batchId",
        fields: { batchId: "Must be a valid cuid" },
      });
      return;
    }
    const { data: batchId } = parsedId;
    const { user } = req;
    // Already authed, but fail closed if user is somehow absent.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    // Scoped by operator id too, so an operator can never read another user's batch.
    const batch = await prisma.uploadBatch.findFirst({
      where: { id: batchId, uploadedById: user.id },
    });

    // 404 (rather than 403) intentionally, to avoid leaking whether a batch id exists.
    if (!batch) {
      res.status(404).json({ code: "NOT_FOUND", error: "Batch not found" });
      return;
    }

    // Read the stored metadata object, defaulting to an empty map when absent.
    const metadata = (batch.metadata as Record<string, unknown> | null) ?? {};
    // failedRows may not exist, so guard the shape before exposing it.
    const failedRows = Array.isArray(metadata.failedRows)
      ? (metadata.failedRows as unknown[])
      : [];

    // Compose the full batch detail response the operator UI renders.
    const response: GetBatchResponse = {
      createdAt: batch.createdAt.toISOString(),
      failedCount: batch.failedCount,
      failedRows: failedRows as GetBatchResponse["failedRows"],
      fileName: batch.fileName,
      fileType: batch.fileType as GetBatchResponse["fileType"],
      id: batch.id,
      metadata: batch.metadata,
      recordCount: batch.recordCount,
      status: batch.status as GetBatchResponse["status"],
      updatedAt: batch.updatedAt.toISOString(),
      uploadedById: batch.uploadedById,
    };

    res.json(response);
  }
);

// GET /:batchId/summary endpoint: per-batch exception breakdown for the operator dashboard.
router.get(
  "/:batchId/summary",
  requireRole("data_operator"),
  async (req: Request, res: Response): Promise<void> => {
    const rawBatchId = (req.params as { batchId: string }).batchId;
    // Validate the batch id path param as a cuid before querying.
    const parsedId = BATCH_ID_SCHEMA.safeParse(rawBatchId);
    if (!parsedId.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid batchId",
        fields: { batchId: "Must be a valid cuid" },
      });
      return;
    }
    const { data: batchId } = parsedId;
    const { user } = req;
    // Defensive check though requireAuth already guarantees a user.
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    // Ownership-scoped lookup, mirroring the GET /:batchId guard.
    const batch = await prisma.uploadBatch.findFirst({
      where: { id: batchId, uploadedById: user.id },
    });

    // Unknown or foreign batches return 404 without revealing existence.
    if (!batch) {
      res.status(404).json({ code: "NOT_FOUND", error: "Batch not found" });
      return;
    }

    // Count every loan that came from this batch to serve as the summary denominator.
    const totalImported = await prisma.loan.count({
      where: { sourceBatchId: batchId },
    });

    // Run three aggregation queries in parallel: exceptions by type, by severity, and failed loans.
    const [byType, bySeverity, failedValidation] = await Promise.all([
      prisma.exception.groupBy({
        _count: { exceptionType: true },
        by: ["exceptionType"],
        where: { loan: { sourceBatchId: batchId } },
      }),
      prisma.exception.groupBy({
        _count: { severity: true },
        by: ["severity"],
        where: { loan: { sourceBatchId: batchId } },
      }),
      prisma.loan.count({
        where: { sourceBatchId: batchId, exceptions: { some: {} } }, // Loans with >= 1 open exception.
      }),
    ]);

    // Pre-fill every known exception type with zero so report charts never show gaps.
    const exceptionsByType: Record<string, number> = {
      balance_error: 0,
      conflicting_source: 0,
      date_error: 0,
      duplicate: 0,
      invalid_state: 0,
      missing_field: 0,
      rate_out_of_range: 0,
      stale_record: 0,
      status_inconsistency: 0,
    };

    // Same zero-fill strategy for the four severity buckets.
    const exceptionsBySeverity: Record<string, number> = {
      critical: 0,
      high: 0,
      low: 0,
      medium: 0,
    };

    // Fold the grouped exception-type counts into the pre-seeded map, ignoring unknown keys.
    for (const row of byType) {
      const key = row.exceptionType;
      if (key in exceptionsByType) {
        exceptionsByType[key] = row._count.exceptionType ?? 0;
      }
    }
    // Fold the grouped severity counts into the pre-seeded severity map.
    for (const row of bySeverity) {
      const key = row.severity;
      if (key in exceptionsBySeverity) {
        exceptionsBySeverity[key] = row._count.severity ?? 0;
      }
    }

    // Loans that imported cleanly are those without any exception; clamp at zero defensively.
    const passedValidation = Math.max(0, totalImported - failedValidation);

    // Assemble the typed summary payload for the dashboard.
    const summary: BatchSummary = {
      batchId,
      exceptionsBySeverity:
        exceptionsBySeverity as BatchSummary["exceptionsBySeverity"],
      exceptionsByType: exceptionsByType as BatchSummary["exceptionsByType"],
      failedValidation,
      passedValidation,
      totalImported,
    };

    res.json(summary);
  }
);

export default router;
