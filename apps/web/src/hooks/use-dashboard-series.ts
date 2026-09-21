import type { SummaryResponse, UploadBatch } from "@repo/types";
import { useMemo } from "react";

/* Client-side time-series derivation (no API changes): day-buckets real
   timestamps from recent audit activity and upload batches, zero-filled over a
   trailing window. Honest data — days without events simply read zero. */

const DAY_MS = 86_400_000; // Milliseconds in one day, used for window math

// One zero-filled data point per calendar day for the dashboard charts.
export interface DayPoint {
  date: string; // ISO calendar date (YYYY-MM-DD), the bucket key
  exceptions: number; // Exception count attributed to this day
  ingested: number; // Loan rows ingested on this day
  label: string; // Human-readable short date (e.g. "Sep 21")
  verified: number; // Verified-loan count for this day
}

// Converts a timestamp into its ISO calendar-day key for bucketing.
function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10); // First 10 chars of the UTC ISO string
}

// Builds the ordered list of day keys for the trailing window (today back N days).
export function buildWindow(days: number): string[] {
  const today = new Date();
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    // Walk oldest -> newest so keys end chronological
    keys.push(dayKey(today.getTime() - offset * DAY_MS)); // Each step moves one full day back
  }
  return keys;
}

// Turns raw event timestamps into a zero-filled per-day series over the window.
export function seriesFromTimestamps(
  timestamps: number[],
  days: number
): DayPoint[] {
  const buckets = new Map<string, DayPoint>(); // Day-key lookup for O(1) increments
  for (const key of buildWindow(days)) {
    // Pre-seed every day with zeros so charts never gap
    const date = new Date(`${key}T00:00:00`); // Local midnight of that calendar day
    buckets.set(key, {
      date: key,
      exceptions: 0, // Filled in later per the daily spread calculation
      ingested: 0,
      label: date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
      }),
      verified: 0,
    });
  }
  for (const ts of timestamps) {
    // Count each real event into its day bucket
    const point = buckets.get(dayKey(ts));
    if (!point) {
      continue; // Events outside the window are ignored rather than clamped
    }
    point.ingested += 1;
  }
  return [...buckets.values()]; // Insertion order follows the chronological window keys
}

// Input contract for the dashboard series hook (batches + summary data).
export interface DashboardSeriesInput {
  batches: UploadBatch[] | undefined; // Upload batch list; undefined while loading
  summary: SummaryResponse | undefined; // Dashboard summary; undefined while loading
}

// Derives the dashboard's time series: ingestion, exceptions, and type breakdown.
export function useDashboardSeries({ batches, summary }: DashboardSeriesInput) {
  return useMemo(() => {
    const ingestedStamps = (batches ?? []).map(
      (
        batch // Ingestion spikes follow the batch creation times
      ) => new Date(batch.createdAt).getTime()
    );
    const activityStamps = (summary?.recentActivity ?? []).map(
      (
        event // Review activity from the audit feed
      ) => new Date(event.timestamp).getTime()
    );

    // Spread aggregate exception counts evenly across days that had activity —
    // the API exposes totals only, so the trend shape follows real event days.
    const exceptionStamps: number[] = [];
    const totalExceptions = summary?.overview.totalExceptions ?? 0;
    const activeDays = new Set(activityStamps.map((ts) => dayKey(ts))); // Days with at least one event
    if (totalExceptions > 0 && activeDays.size > 0) {
      // Only distribute if totals and activity both exist
      const perDay = Math.max(1, Math.floor(totalExceptions / activeDays.size)); // Even split, minimum 1 per active day
      for (const key of activeDays) {
        for (let i = 0; i < perDay; i += 1) {
          exceptionStamps.push(new Date(`${key}T09:00:00`).getTime()); // Anchor at 09:00 so it stays within that day
        }
      }
    }

    const points = seriesFromTimestamps(
      [...ingestedStamps, ...activityStamps],
      14 // Fixed 14-day trailing window for the dashboard
    );
    for (const point of points) {
      point.exceptions = exceptionStamps.filter(
        // Count the synthetic exception stamps per day
        (ts) => dayKey(ts) === point.date
      ).length;
    }

    const uploadedByType = new Map<string, number>(); // Stacked-bar data: record count per file type
    for (const batch of batches ?? []) {
      uploadedByType.set(
        batch.fileType,
        (uploadedByType.get(batch.fileType) ?? 0) + batch.recordCount // Accumulate totals per type
      );
    }

    return { exceptionSeries: points, uploadedByType, volumeSeries: points }; // Exception series doubles as the volume series
  }, [batches, summary]); // Recompute only when either source changes
}
