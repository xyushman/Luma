// Imports: Google's Gemini provider for the AI SDK and the generic LanguageModel type.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

// Custom error: the AI backend is unavailable or disabled; surfaced to reviewers as such.
export class AiUnavailableError extends Error {
  constructor(message = "AI unavailable", options?: ErrorOptions) {
    // Initialize the base Error, optionally preserving the original error as the cause.
    super(message, options);
    // Tag the error name so callers can detect it without relying on instanceof details.
    this.name = "AiUnavailableError";
  }
}

// Custom error: an entity the AI route expected (loan, exception, batch) was not found.
export class NotFoundError extends Error {
  constructor(message: string) {
    // Pass the descriptive message about the missing entity to the base Error.
    super(message);
    // Tag the error name so route handlers can map it to a 404 response.
    this.name = "NotFoundError";
  }
}

// The Gemini model used for explanations/fixes, overridable via env; flash-lite keeps cost and latency low.
export const AI_MODEL_ID = process.env.AI_MODEL_ID ?? "gemini-3.5-flash-lite";

// MOCK_AI=true swaps real Gemini calls for deterministic fakes so tests and CI need no API key.
export const isMockAi = (): boolean => process.env.MOCK_AI === "true";

// True when either mock mode is on or a real GEMINI_API_KEY is present; drives feature gating.
export const isAiConfigured = (): boolean =>
  isMockAi() || Boolean(process.env.GEMINI_API_KEY);

// Hold one model instance for the process; creating providers on every call is wasteful.
let cachedModel: LanguageModel | null = null;

// Return a ready Gemini model, building and caching it lazily; throws when AI cannot be used.
export const getModel = (): LanguageModel => {
  // In mock mode there is no real model; signal that clearly instead of returning a fake.
  if (isMockAi()) {
    throw new AiUnavailableError("Mock AI is enabled — real model not needed");
  }
  // Read the Gemini API key from the environment.
  const apiKey = process.env.GEMINI_API_KEY;
  // Without a key, fail with a descriptive error rather than a cryptic SDK message later.
  if (!apiKey) {
    throw new AiUnavailableError("GEMINI_API_KEY is not configured");
  }
  // Build the model only once, then reuse it for all subsequent calls.
  if (!cachedModel) {
    // Create the Google AI provider bound to this server's API key.
    const provider = createGoogleGenerativeAI({ apiKey });
    // Instantiate the configured Gemini model; the cast bridges SDK version type differences.
    cachedModel = provider(AI_MODEL_ID) as unknown as LanguageModel;
  }
  // Hand the cached model to callers, which use it for structured generation.
  return cachedModel;
};

// Test helper: clears the cached model so tests can simulate a cold start.
export const __resetAiModelCache = (): void => {
  // Drop the cached instance so the next getModel() call builds a fresh provider.
  cachedModel = null;
};
