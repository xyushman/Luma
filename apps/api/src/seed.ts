// Imports: shared Role type, Better Auth instance for realistic sign-up, and Prisma for direct DB writes.
import type { Role } from "@repo/types";
import { auth } from "./lib/auth.js";
import { prisma } from "./lib/prisma.js";

// Shape of a seed account; role is the app RBAC role enforced after Better Auth sign-up.
interface SeedUser {
  email: string;
  name: string;
  password: string;
  role: Role;
}

// One labelled account per role so challenge reviewers can test operator, reviewer, and consumer flows.
const SEED_USERS: SeedUser[] = [
  {
    email: "operator@luma.dev",
    name: "Operator User",
    password: "password",
    role: "data_operator",
  },
  {
    email: "reviewer@luma.dev",
    name: "Reviewer User",
    password: "password",
    role: "reviewer",
  },
  {
    email: "consumer@luma.dev",
    name: "Consumer User",
    password: "password",
    role: "data_consumer",
  },
];

// Force the stored role to match the seed definition since Better Auth's defaultRole may differ.
const ensureRole = async (email: string, role: Role): Promise<void> => {
  // Look the user up by email so we can compare their actual stored role.
  const user = await prisma.user.findUnique({ where: { email } });
  // No user means there is nothing to enforce yet; the caller decides what to do.
  if (!user) {
    return;
  }
  // Only write when the role differs, avoiding a pointless UPDATE on every seed run.
  if (user.role !== role) {
    // Update the user's role directly in the DB to the intended value.
    await prisma.user.update({ data: { role }, where: { id: user.id } });
  }
};

// Idempotent seed: create the user via Better Auth sign-up, then pin the correct role and verify it.
const upsertSeedUser = async (seedUser: SeedUser): Promise<string> => {
  // Read the user by email so we can decide between "update existing" and "create new".
  const existing = await prisma.user.findUnique({
    where: { email: seedUser.email },
  });

  if (existing) {
    // The account already exists; detect whether name or role drifted from the seed definition.
    const needsUpdate =
      existing.name !== seedUser.name || existing.role !== seedUser.role;
    if (needsUpdate) {
      // Keep stored name/role in sync with the seed definition on reruns.
      await prisma.user.update({
        data: { name: seedUser.name, role: seedUser.role },
        where: { id: existing.id },
      });
      // Log the sync so seed runs stay auditable in CI output.
      process.stdout.write(
        `updated ${seedUser.email} -> role=${seedUser.role}\n`
      );
    } else {
      // No drift found; just report the current role for an existing account.
      process.stdout.write(`exists ${seedUser.email} (${existing.role})\n`);
    }
    // verify role after update
    // Re-enforce the role after updates because Better Auth writes can race with seed writes.
    await ensureRole(seedUser.email, seedUser.role);
    // Report which path was taken so the top-level loop can log a meaningful status.
    return "exists";
  }

  try {
    // Create the account through Better Auth so password hashing matches runtime sign-up exactly.
    await auth.api.signUpEmail({
      body: {
        email: seedUser.email,
        name: seedUser.name,
        password: seedUser.password,
      },
      headers: new Headers(),
    });

    // signUp creates user with defaultRole; force correct role and verify
    // Override the defaultRole Better Auth assigned with the intended seed role.
    await ensureRole(seedUser.email, seedUser.role);

    // Re-read the user to confirm the account truly exists and the role stuck.
    const created = await prisma.user.findUnique({
      where: { email: seedUser.email },
    });

    // Fail loudly if the role did not persist; silent drift would break RBAC tests.
    if (!created || created.role !== seedUser.role) {
      throw new Error(
        `role mismatch after create for ${seedUser.email}: expected ${seedUser.role} got ${created?.role ?? "null"}`
      );
    }

    // Log a successful create together with the role that was applied.
    process.stdout.write(
      `created ${seedUser.email} -> role=${seedUser.role}\n`
    );
    // Report the create path so the caller can distinguish fresh users from existing ones.
    return "created";
  } catch (error) {
    // Sign-up can throw on uniqueness races when parallel seeds collide; handle that case below.
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);

    // After a failure, check whether the email actually made it in (another seed likely won the race).
    const raceUser = await prisma.user.findUnique({
      where: { email: seedUser.email },
    });

    // An account now exists: someone else won the race, so just pin the role and carry on.
    if (raceUser) {
      // Enforce the intended role on the account that won the race.
      await ensureRole(seedUser.email, seedUser.role);
      // Log the race outcome and treat it as success so seed remains idempotent.
      process.stdout.write(
        `exists (race) ${seedUser.email} (${raceUser.role})\n`
      );
      return "race";
    }

    // A genuine failure (no account, role still wrong): rethrow with cause so the seed aborts.
    throw new Error(`seed failed for ${seedUser.email}: ${message}`, {
      cause: error,
    });
  }
};

// Top-level seed orchestrator: create/pin each user, then verify every stored role matches.
const seed = async (): Promise<void> => {
  // Process accounts one by one because Better Auth sign-up performs serial DB writes.
  for (const seedUser of SEED_USERS) {
    await upsertSeedUser(seedUser);
  }

  // Count total users to give an overall picture in the final seed summary.
  const count = await prisma.user.count();
  // Print how many users now exist so seed results are visible in CI logs.
  process.stdout.write(`seed done: ${count} user(s) in db\n`);

  // Pull just email/role for every seed account to perform a final consistency check.
  const seeded = await prisma.user.findMany({
    select: { email: true, role: true },
    where: { email: { in: SEED_USERS.map((u) => u.email) } },
  });

  // Flag any seeded account whose stored role disagrees with the seed definition.
  const mismatched = seeded.filter(
    (u: { email: string; role: string }) =>
      SEED_USERS.find((s: SeedUser) => s.email === u.email)?.role !== u.role
  );

  // Hard-fail on any role mismatch so RBAC drift can never silently enter the challenge environment.
  if (mismatched.length > 0) {
    throw new Error(`role verification failed: ${JSON.stringify(mismatched)}`);
  }
};

// Run the seed now, using top-level await (valid in ESM) so the script is entry-point only.
try {
  await seed();
} catch (error) {
  // Normalize whatever was thrown into readable text so the log stays clear.
  const message = error instanceof Error ? error.message : String(error);
  // Send the failure to stderr so CI surfaces seed problems distinctly.
  process.stderr.write(`seed error: ${message}\n`);
  // Mark a non-zero exit so pipelines fail on a broken seed.
  process.exitCode = 1;
} finally {
  // Always release the database connection, even when seeding failed midway.
  await prisma.$disconnect();
}
