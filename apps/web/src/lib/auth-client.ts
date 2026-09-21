// Better Auth client for the React (web) app. It targets the API origin so the
// HttpOnly session cookie is sent with every request (same-origin via the Vite proxy).
import { createAuthClient } from "better-auth/react";

// Single shared auth client instance used across the whole client app.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000", // Env override; dev defaults to the local API
  fetchOptions: {
    credentials: "include", // Carry the session cookie even when origins differ
  },
});

export type Session = typeof authClient.$Infer.Session; // Inferred session shape from the client config
export type User = Session["user"]; // Convenience: the user object nested inside a Session
