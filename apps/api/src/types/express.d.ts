// Import the shared Role type so the augmented Express types stay in sync with @repo/types.
import type { Role } from "@repo/types";

// Global module augmentation: teaches TypeScript that Express Request always carries our shapes.
declare global {
  // biome-ignore lint/style/noNamespace: Express module augmentation requires the global Express namespace
  namespace Express {
    interface Request {
      // Session object attached by requireAuth from the resolved Better Auth session.
      session?: {
        id: string;
        userId: string; // Owner of the session, i.e. the authenticated user's id.
        expiresAt: Date; // When the session stops being valid; used for expiry checks.
      };
      // Authenticated user attached by requireAuth, role normalized to the app Role union.
      user?: {
        id: string;
        name: string;
        email: string;
        role: Role; // One of data_operator, reviewer, or data_consumer after normalizeRole.
        emailVerified: boolean;
        image?: string | null; // Optional avatar, null when the account has no picture.
      };
    }
  }
}
