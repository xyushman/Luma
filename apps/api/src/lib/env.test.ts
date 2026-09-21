import { describe, expect, it } from "bun:test";
import { assertBootEnv } from "./env.js";

const VALID_SECRET = "a".repeat(32); // Reliable 32-char secret for positive tests.
const SECRET_ERROR = /BETTER_AUTH_SECRET/; // Regex the missing-secret error must match.
const MIN_LENGTH_ERROR = /at least 32/; // Regex the too-short error must match.
const DATABASE_URL_ERROR = /DATABASE_URL/; // Regex the missing-url error must match.

describe("assertBootEnv", () => {
  it("throws when BETTER_AUTH_SECRET is missing", () => {
    expect(
      () =>
        assertBootEnv({
          BETTER_AUTH_SECRET: undefined,
          DATABASE_URL: "postgres://x",
        }) // Passing no secret should fail boot checks immediately.
    ).toThrow(SECRET_ERROR);
  });

  it("throws when BETTER_AUTH_SECRET is shorter than 32 chars", () => {
    expect(
      () =>
        assertBootEnv({
          BETTER_AUTH_SECRET: "too-short",
          DATABASE_URL: "postgres://x",
        }) // Undersized secret must be rejected to protect session signing.
    ).toThrow(MIN_LENGTH_ERROR);
  });

  it("throws when DATABASE_URL is missing even with a valid secret", () => {
    expect(() => assertBootEnv({ BETTER_AUTH_SECRET: VALID_SECRET })).toThrow(
      DATABASE_URL_ERROR
    ); // A valid secret alone must not let the app boot without a database.
  });

  it("passes with valid secret and database url (frontend url optional)", () => {
    expect(
      () =>
        assertBootEnv({
          BETTER_AUTH_SECRET: VALID_SECRET,
          DATABASE_URL: "postgresql://localhost/luma",
        }) // Both required vars present, optional FRONTEND_URL absent, so no throw.
    ).not.toThrow();
  });

  it("defaults to process.env when called without arguments", () => {
    const prevSecret = process.env.BETTER_AUTH_SECRET; // Save the original secret for restore.
    const prevUrl = process.env.DATABASE_URL; // Save the original URL for restore.
    process.env.BETTER_AUTH_SECRET = VALID_SECRET; // Provide a valid secret in the environment.
    process.env.DATABASE_URL = "postgresql://localhost/luma"; // Provide a valid URL in the environment.
    try {
      expect(() => assertBootEnv()).not.toThrow(); // No-args call reads from process.env instead.
    } finally {
      if (prevSecret === undefined) {
        delete process.env.BETTER_AUTH_SECRET; // Restore the missing-secret state.
      } else {
        process.env.BETTER_AUTH_SECRET = prevSecret; // Restore the original secret.
      }
      if (prevUrl === undefined) {
        delete process.env.DATABASE_URL; // Restore the missing-url state.
      } else {
        process.env.DATABASE_URL = prevUrl; // Restore the original URL.
      }
    }
  });
});
