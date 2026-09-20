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

router.post(
  "/",
  requireRole("data_operator"),
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const { file } = req as Request & { file?: Express.Multer.File };
    const { fileType } = req.body as { fileType?: string };

    if (!file) {
      res.status(400).json({ code: "BAD_REQUEST", error: "Missing file" });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".csv") {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
      res.status(415).json({
        code: "UNSUPPORTED_MEDIA_TYPE",
        error: "Only .csv files are allowed",
      });
      return;
    }

    if (!fileType) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
      res.status(400).json({ code: "BAD_REQUEST", error: "Missing fileType" });
      return;
    }

    const parsedType = fileTypeSchema.safeParse(fileType);
    if (!parsedType.success) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
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
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.uploadBatch.create({
        data: {
          fileName: file.originalname,
          filePath: file.path,
          fileType: parsedType.data,
          metadata: {
            pipelineStage: "staged",
            pipelineStep: 1,
            stageMessage: "File received and staged for ingestion.",
          },
          recordCount: 0,
          status: "processing",
          uploadedById: user.id,
        },
      });
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

    const response: CreateUploadResponse = {
      batchId: batch.id,
      fileName: batch.fileName,
      fileType: batch.fileType as CreateUploadResponse["fileType"],
      message: "File uploaded. Processing has started.",
      status: "processing",
    };

    process.stdout.write(
      `[Upload] Received "${file.originalname}" (${(file.size / 1024).toFixed(1)} KB, type: ${parsedType.data}) by ${user.email} -> batchId: ${batch.id}\n`
    );

    res.status(202).json(response);

    // Document manifests bypass the loan pipeline entirely: they stream
    // their own format and apply documentStatus onto existing tape loans.
    if (batch.fileType === "document_manifest") {
      processDocumentManifest(file.path, batch.id).catch((err) => {
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
      processPublicDataIngestion(
        file.path,
        batch.id,
        batch.fileType as "fannie_mae" | "freddie_mac"
      ).catch((err) => {
        process.stderr.write(
          `[Upload] Public-data ingestion uncaught error for batch ${batch.id}: ${err}\n`
        );
      });
      return;
    }

    processStreamAndNormalize(file.path, batch.id).catch((err) => {
      process.stderr.write(
        `[Upload] Ingestion stream uncaught error for batch ${batch.id}: ${err}\n`
      );
    });
  }
);

router.get(
  "/",
  requireRole("data_operator", "reviewer", "data_consumer"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = listUploadsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
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
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    // Operators see only their own batches; reviewer/consumer need batch
    // metadata (fileName, recordCount, fileType) for dashboards and filters.
    const where: Record<string, unknown> =
      user.role === "data_operator" ? { uploadedById: user.id } : {};
    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * limit;
    const [total, batches] = await Promise.all([
      prisma.uploadBatch.count({ where }),
      prisma.uploadBatch.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        where,
      }),
    ]);

    const data = batches.map((batch) => ({
      createdAt: batch.createdAt.toISOString(),
      failedCount: batch.failedCount,
      fileName: batch.fileName,
      fileType: batch.fileType,
      id: batch.id,
      recordCount: batch.recordCount,
      status: batch.status,
    }));

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

router.get(
  "/:batchId",
  requireRole("data_operator"),
  async (req: Request, res: Response): Promise<void> => {
    const rawBatchId = (req.params as { batchId: string }).batchId;
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
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const batch = await prisma.uploadBatch.findFirst({
      where: { id: batchId, uploadedById: user.id },
    });

    if (!batch) {
      res.status(404).json({ code: "NOT_FOUND", error: "Batch not found" });
      return;
    }

    const metadata = (batch.metadata as Record<string, unknown> | null) ?? {};
    const failedRows = Array.isArray(metadata.failedRows)
      ? (metadata.failedRows as unknown[])
      : [];

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

router.get(
  "/:batchId/summary",
  requireRole("data_operator"),
  async (req: Request, res: Response): Promise<void> => {
    const rawBatchId = (req.params as { batchId: string }).batchId;
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
    if (!user) {
      res.status(401).json({ code: "UNAUTHENTICATED", error: "Unauthorized" });
      return;
    }

    const batch = await prisma.uploadBatch.findFirst({
      where: { id: batchId, uploadedById: user.id },
    });

    if (!batch) {
      res.status(404).json({ code: "NOT_FOUND", error: "Batch not found" });
      return;
    }

    const totalImported = await prisma.loan.count({
      where: { sourceBatchId: batchId },
    });

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
        where: { sourceBatchId: batchId, exceptions: { some: {} } },
      }),
    ]);

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

    const exceptionsBySeverity: Record<string, number> = {
      critical: 0,
      high: 0,
      low: 0,
      medium: 0,
    };

    for (const row of byType) {
      const key = row.exceptionType;
      if (key in exceptionsByType) {
        exceptionsByType[key] = row._count.exceptionType ?? 0;
      }
    }
    for (const row of bySeverity) {
      const key = row.severity;
      if (key in exceptionsBySeverity) {
        exceptionsBySeverity[key] = row._count.severity ?? 0;
      }
    }

    const passedValidation = Math.max(0, totalImported - failedValidation);

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
