// Imports: AI request schemas, Express types, Zod, AI error classes, Prisma, validation helper,
// the AI rate limiter, auth/RBAC guards, and the AI service functions backing each endpoint.
import {
  aiClassifySeverityRequestSchema,
  aiExplainRequestSchema,
  aiSuggestRuleRequestSchema,
  aiSummarizeBatchRequestSchema,
} from "@repo/types";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { AiUnavailableError, NotFoundError } from "../lib/ai.js";
import { prisma } from "../lib/prisma.js";
import { mapZodIssuesToFields } from "../lib/validation.js";
import { createAiRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  classifySeverity,
  draftReviewerNote,
  explainException,
  suggestRule,
  summarizeBatch,
} from "../services/ai.service.js";

// Create the Express router for all AI copilot endpoints.
const router = express.Router();

// Every AI route requires authentication first (otherwise the limiter cannot key by user).
router.use(requireAuth);
// AI endpoints share the stricter default rate limiter (20 req/min per user) to cap LLM spend.
router.use(createAiRateLimiter());

// POST /explain: reviewer asks the AI to explain an exception in plain language.
router.post(
  "/explain",
  requireRole("reviewer"),
  async (req: Request, res: Response): Promise<void> => {
    // Validate the explain request body against its schema.
    const parsed = aiExplainRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsed.error.issues),
      });
      return;
    }
    const actorId = req.user?.id; // Actor identity passed to the AI service for authorization + audit. // Actor is used to authorize + audit the AI call.
    try {
      const result = await explainException(parsed.data.exceptionId, actorId);
      res.json(result);
    } catch (err) {
      // Unknown exception ids map cleanly to 404 for the client.
      if (err instanceof NotFoundError) {
        res.status(404).json({ code: "NOT_FOUND", error: err.message });
        return;
      }
      // AI provider down: respond 200 with AI_UNAVAILABLE so the UI degrades gracefully.
      if (err instanceof AiUnavailableError) {
        res.json({
          code: "AI_UNAVAILABLE",
          error: err.message,
          exceptionId: parsed.data.exceptionId,
          recommendation: null,
        });
        return;
      }
      throw err; // Unexpected errors bubble to the global handler.
    }
  }
);

// POST /summarize-batch: produces an AI overview of a batch for reviewer and operator contexts.
router.post(
  "/summarize-batch",
  requireRole("reviewer", "data_operator"),
  async (req: Request, res: Response): Promise<void> => {
    // Validate the summarize request body against its schema.
    const parsed = aiSummarizeBatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsed.error.issues),
      });
      return;
    }
    const actorId = req.user?.id; // Actor identity passed to the AI service for authorization + audit.
    try {
      const result = await summarizeBatch(parsed.data.batchId, actorId);
      res.json(result);
    } catch (err) {
      // Batch not found is a client-facing 404.
      if (err instanceof NotFoundError) {
        res.status(404).json({ code: "NOT_FOUND", error: err.message });
        return;
      }
      // Model unavailable: degrade with AI_UNAVAILABLE in a 200 so the UI can still render.
      if (err instanceof AiUnavailableError) {
        res.json({
          batchId: parsed.data.batchId,
          code: "AI_UNAVAILABLE",
          error: err.message,
          model: "unavailable",
          summary: null,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      throw err;
    }
  }
);

// POST /classify-severity: AI suggests a severity for an exception to help reviewers triage.
router.post(
  "/classify-severity",
  requireRole("reviewer"),
  async (req: Request, res: Response): Promise<void> => {
    // Validate the classify request body.
    const parsed = aiClassifySeverityRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsed.error.issues),
      });
      return;
    }
    const actorId = req.user?.id; // Actor identity passed to the AI service for authorization + audit.
    try {
      const result = await classifySeverity(parsed.data.exceptionId, actorId);
      res.json(result);
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ code: "NOT_FOUND", error: err.message });
        return;
      }
      // On AI outage, still reply 200 and echo the currently stored severity as a fallback.
      if (err instanceof AiUnavailableError) {
        let severity: string | null = null;
        try {
          // Read the exception's current stored severity so the fallback is accurate.
          const row = await prisma.exception.findUnique({
            select: { severity: true },
            where: { id: parsed.data.exceptionId },
          });
          severity = row?.severity ?? null;
        } catch {
          severity = null; // If this secondary read fails, the fallback just reports medium.
        }
        res.json({
          code: "AI_UNAVAILABLE",
          currentSeverity: severity ?? "medium",
          error: err.message,
          exceptionId: parsed.data.exceptionId,
          model: "unavailable",
          reasoning: null,
          suggestedSeverity: null,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      throw err;
    }
  }
);

// POST /suggest-rule: asks the AI to draft a new validation rule idea from a prompt.
router.post(
  "/suggest-rule",
  requireRole("data_operator", "reviewer"),
  async (req: Request, res: Response): Promise<void> => {
    // Validate the suggest-rule prompt body.
    const parsed = aiSuggestRuleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsed.error.issues),
      });
      return;
    }
    const actorId = req.user?.id; // Actor identity passed to the AI service for authorization + audit.
    try {
      const result = await suggestRule(parsed.data.prompt, actorId);
      res.json(result);
    } catch (err) {
      // Rule drafting has no not-found case, so only the AI-unavailable path is handled.
      if (err instanceof AiUnavailableError) {
        // Degrade with AI_UNAVAILABLE in a 200; the prompt summary aids debugging.
        res.json({
          code: "AI_UNAVAILABLE",
          error: err.message,
          model: "unavailable",
          promptSummary: parsed.data.prompt.slice(0, 80),
          rule: null,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      throw err;
    }
  }
);

// Minimal inline schema for draft-note: the exception id must be a non-empty string.
const aiDraftNoteRequestSchema = z.object({
  exceptionId: z.string().min(1),
});

// POST /draft-note: AI drafts a ready-to-post reviewer note for an exception.
router.post(
  "/draft-note",
  requireRole("reviewer"),
  async (req: Request, res: Response): Promise<void> => {
    // Validate the draft-note body against the inline schema.
    const parsed = aiDraftNoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        code: "BAD_REQUEST",
        error: "Invalid body",
        fields: mapZodIssuesToFields(parsed.error.issues),
      });
      return;
    }
    const actorId = req.user?.id; // Actor identity passed to the AI service for authorization + audit.
    try {
      const result = await draftReviewerNote(parsed.data.exceptionId, actorId);
      res.json(result);
    } catch (err) {
      // Unknown exception id maps to 404.
      if (err instanceof NotFoundError) {
        res.status(404).json({ code: "NOT_FOUND", error: err.message });
        return;
      }
      // AI unavailable: return 200 with AI_UNAVAILABLE and a null note.
      if (err instanceof AiUnavailableError) {
        res.json({
          code: "AI_UNAVAILABLE",
          error: err.message,
          exceptionId: parsed.data.exceptionId,
          note: null,
        });
        return;
      }
      throw err;
    }
  }
);

export default router;
