// Better Auth rejects secrets shorter than 32 chars; mirror that here to fail even faster at boot.
const MIN_SECRET_LENGTH = 32;

// The exact env keys the app boot depends on, kept partial so tests can inject fake env objects.
export type BootEnv = Partial<
  Record<"BETTER_AUTH_SECRET" | "DATABASE_URL" | "FRONTEND_URL", string>
>;

/**
 * Fail loud at boot (G5). A missing/short secret silently falls back to a
 * publicly-known constant inside better-auth when NODE_ENV !== "production",
 * which makes sessions forgeable -> full privilege takeover.
 */
// Default to the real process.env but allow unit tests to inject a controlled env object.
export const assertBootEnv = (env: BootEnv = process.env as BootEnv): void => {
  // Grab the session signing secret; a broken secret is the most dangerous failure mode.
  const secret = env.BETTER_AUTH_SECRET;

  // Refuse to boot when the secret is missing or short: a weak secret allows session forgery.
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters (generate: openssl rand -base64 32)`
    );
  }

  // No DATABASE_URL means Prisma cannot connect; crash early instead of timing out at first query.
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  // Missing FRONTEND_URL is only a warning because CORS falls back to localhost:3000 for local dev.
  if (!env.FRONTEND_URL) {
    process.stderr.write(
      "[env] FRONTEND_URL not set - CORS/trustedOrigins defaulting to http://localhost:3000\n"
    );
  }
};
