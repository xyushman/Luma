// Import Express middleware types used by the rate limiter signature.
import type { NextFunction, Request, Response } from "express";

// Default ceiling: at most 20 AI requests per key (user or IP) per window.
const DEFAULT_LIMIT = 20;
// Default window length: one minute, expressed in milliseconds.
const DEFAULT_WINDOW_MS = 60_000;

// A bucket stores the timestamps of recent requests issued by one key.
type Bucket = number[];

// In-memory store keyed by user id (or IP) mapping to that key's request timestamps.
const buckets = new Map<string, Bucket>();

// Sliding window helper: drops timestamps older than the window so only live requests count.
const prune = (timestamps: Bucket, now: number, windowMs: number): Bucket => {
  // Any request at or before this instant has fallen outside the current window.
  const cutoff = now - windowMs;
  // Walk the front of the array to locate the run of expired timestamps.
  let start = 0;
  while (
    start < timestamps.length &&
    timestamps[start] !== undefined &&
    (timestamps[start] as number) <= cutoff
  ) {
    start += 1;
  }
  // Strip the expired entries from the front of the array.
  if (start > 0) {
    timestamps.splice(0, start);
  }
  return timestamps;
};

// Factory that builds the AI-route rate limiter; options let tests inject a fake clock and limits.
export const createAiRateLimiter = (opts?: {
  clock?: () => number;
  limit?: number;
  windowMs?: number;
}): ((req: Request, res: Response, next: NextFunction) => void) => {
  // Resolve configuration values, falling back to the module defaults when nothing is provided.
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  // Prefer an injected clock so tests can control time deterministically.
  const clock = opts?.clock ?? Date.now;

  // Return the actual per-request middleware.
  return (req: Request, res: Response, next: NextFunction): void => {
    // Bucket by authenticated user id first, falling back to IP so anonymous callers are still limited.
    const key = req.user?.id ?? req.ip ?? "anon";
    const now = clock();
    // Load this key's existing bucket, or start with an empty one on first request.
    const existing = buckets.get(key) ?? [];
    // Prune stale timestamps first so the busy count only reflects the sliding window.
    const bucket = prune(existing, now, windowMs);

    // Delete the bucket entirely once empty so the map does not grow without bound.
    if (bucket.length === 0) {
      buckets.delete(key);
    }

    // If the bucket still holds the max number of requests, this call is over the limit.
    if (bucket.length >= limit) {
      // Estimate when the oldest request expires so we can tell the client when to retry.
      const retryAfterMs = (bucket[0] ?? now) + windowMs - now;
      // Round up to whole seconds, never below 1 (Retry-After must be a future time).
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      // Emit Retry-After so clients and proxies can back off predictably.
      res.setHeader("Retry-After", String(retryAfterSec));
      // Reject with the documented 429 payload the frontend recognizes as rate limiting.
      res.status(429).json({
        code: "RATE_LIMITED",
        error: "Too many AI requests — please try again shortly.",
      });
      return;
    }

    // Allow the request through: log its timestamp and continue to the route handler.
    bucket.push(now);
    buckets.set(key, bucket);
    next();
  };
};

// Test helper: clears all rate-limit state so tests start from a known clean state.
export const __resetRateLimitBuckets = (): void => {
  buckets.clear();
};

// Test helper: exposes the current request count for a key so tests can assert limiter behavior.
export const __getRateLimitBucketSize = (key: string): number =>
  buckets.get(key)?.length ?? 0;
