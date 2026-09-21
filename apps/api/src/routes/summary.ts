// Imports: Express types, Prisma for the aggregated queries, and auth + RBAC guards.
import express, { type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";

// Create the Express router for the dashboard summary endpoint.
const router = express.Router();

// Every exception type known to the validation rules, used to zero-fill the report buckets.
const EXCEPTION_TYPES: string[] = [
  "missing_field",
  "duplicate",
  "date_error",
  "balance_error",
  "rate_out_of_range",
  "status_inconsistency",
  "stale_record",
  "conflicting_source",
  "invalid_state",
];

// Every severity level the pipeline can assign, likewise pre-seeded for the report.
const SEVERITIES: string[] = ["critical", "high", "medium", "low"];

// GET / dashboard endpoint: aggregates pipeline-wide numbers for all three roles.
router.get(
  "/",
  requireAuth,
  requireRole("data_operator", "reviewer", "data_consumer"),
  async (_req: Request, res: Response): Promise<void> => {
    // Fire off all eight aggregate queries in parallel to keep the dashboard fast.
    const [
      totalBatches,
      totalLoansImported,
      totalExceptions,
      openExceptions,
      verifiedLoans,
      byType,
      bySeverity,
      recentLogs,
    ] = await Promise.all([
      prisma.uploadBatch.count(), // Number of uploaded batches so far.
      prisma.loan.count(), // Total imported loans, the quality denominator.
      prisma.exception.count(), // All exceptions ever raised across the pipeline.
      prisma.exception.count({ where: { status: "open" } }), // Still-unreviewed exceptions.
      prisma.verifiedLoan.count(), // Loans that reached the verified end state.
      prisma.exception.groupBy({
        _count: { exceptionType: true }, // Histogram of exceptions by validation rule.
        by: ["exceptionType"],
      }),
      prisma.exception.groupBy({
        _count: { severity: true }, // Histogram of exceptions by severity.
        by: ["severity"],
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          actor: { select: { name: true } }, // Actor name for the activity feed.
          createdAt: true,
          eventType: true,
          loanId: true,
        },
        take: 5, // Only the five latest events for the "recent activity" strip.
      }),
    ]);

    // qualityScore = verified/total as a percentage, rounded to two decimals; 0 if nothing imported.
    const qualityScore =
      totalLoansImported > 0
        ? Math.round((verifiedLoans / totalLoansImported) * 100 * 100) / 100
        : 0;

    // Pre-fill every exception type with zero so empty periods still render bars.
    const exceptionsByType: Record<string, number> = Object.fromEntries(
      EXCEPTION_TYPES.map((t) => [t, 0])
    );
    // Fold the grouped counts into the pre-seeded map, only touching known keys.
    for (const row of byType) {
      const key = row.exceptionType;
      if (key in exceptionsByType) {
        exceptionsByType[key] = row._count.exceptionType ?? 0;
      }
    }

    // Same zero-fill treatment for the severity buckets.
    const exceptionsBySeverity: Record<string, number> = Object.fromEntries(
      SEVERITIES.map((s) => [s, 0])
    );
    // Fold the grouped severity counts into the seeded map.
    for (const row of bySeverity) {
      const key = row.severity;
      if (key in exceptionsBySeverity) {
        exceptionsBySeverity[key] = row._count.severity ?? 0;
      }
    }

    // Shape the recent audit rows into the slim activity feed the UI renders.
    const recentActivity = recentLogs.map((log) => ({
      actor: log.actor?.name ?? null,
      eventType: log.eventType,
      loanId: log.loanId ?? null,
      timestamp: log.createdAt.toISOString(),
    }));

    // Compose the full dashboard payload under overview/feed sections.
    res.json({
      exceptionsBySeverity,
      exceptionsByType,
      overview: {
        openExceptions,
        qualityScore,
        totalBatches,
        totalExceptions,
        totalLoansImported,
        verifiedLoans,
      },
      recentActivity,
    });
  }
);

export default router;
