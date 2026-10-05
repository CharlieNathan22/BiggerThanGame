/**
 * The nightly job (ARCHITECTURE.md §13), on two cron triggers: 00:00 UTC and
 * 01:30 UTC.
 *
 * Both snapshot the periods that closed at the most recent midnight — the day,
 * and on a Monday the ISO week, and on the 1st the month — as their top 50
 * and total, into `board_snapshots`: "Yesterday's winner", "Last week's
 * winner" and "Last month's winner". A snapshot replaces an earlier one of the
 * same period, so the 01:30 run just takes it again, now including runs
 * started before midnight and published after it (a run can last most of an
 * hour, and publishing is open for 30 minutes after it ends).
 *
 * Then it prunes scores from runs that started more than `RETAIN_DAYS` ago.
 * Snapshots are kept: a hundred small rows a period.
 *
 * Pure over D1 and a clock, so a test can run it across any midnight.
 */

import { DAY_MS, dayKey, periodsClosedBy, startOfDay } from "@bt/core";
import { publicBoard, pruneScores, saveSnapshot } from "./scores.js";
import type { D1Like } from "./scores.js";

/** Scores are kept this many days after the day their run started. */
export const RETAIN_DAYS = 100;

/** The two triggers, as in wrangler.toml. */
export const CRONS = ["0 0 * * *", "30 1 * * *"] as const;

export interface NightlyResult {
  /** `day:2026-09-29`, `week:2026-W40`… */
  readonly snapshots: readonly string[];
  readonly pruned: number;
}

export async function runNightly(db: D1Like, now: Date): Promise<NightlyResult> {
  const snapshots: string[] = [];
  for (const period of periodsClosedBy(now)) {
    const board = await publicBoard(db, "endless", period);
    await saveSnapshot(db, "endless", period.period, period.key, {
      takenAt: now.getTime(),
      total: board.total,
      entries: board.entries,
    });
    snapshots.push(`${period.period}:${period.key}`);
  }
  const cutoff = dayKey(new Date(startOfDay(now) - RETAIN_DAYS * DAY_MS));
  const pruned = await pruneScores(db, cutoff);
  return { snapshots, pruned };
}
