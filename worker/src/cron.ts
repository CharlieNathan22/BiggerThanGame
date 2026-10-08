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
 * **Daily Ranked.** At 00:00 it freezes the new game (daily-game.ts; the
 * game's first start does it if this fails), and on both runs it snapshots
 * the game that has just closed, so the 01:30 run catches runs started before
 * midnight and finished after it. It prunes Daily entries by the scores' rule,
 * stored games and attempts after `DAILY_KEEP_DAYS`, and the connection hashes
 * after `CONNECTIONS_KEEP_MS`. Nothing happens for a game before Game 1.
 *
 * Pure over D1 and a clock, so a test can run it across any midnight.
 */

import { DAY_MS, dayKey, gameNoAt, isGame, periodsClosedBy, startOfDay } from "@bt/core";
import { snapshotDailyGame } from "./daily-board.js";
import { pruneDaily } from "./daily-scores.js";
import type { DailyPruned } from "./daily-scores.js";
import { publicBoard, pruneScores, saveSnapshot } from "./scores.js";
import type { D1Like } from "./scores.js";

/** Scores are kept this many days after the day their run started. */
export const RETAIN_DAYS = 100;

/** The two triggers, as in wrangler.toml. */
export const CRONS = ["0 0 * * *", "30 1 * * *"] as const;

/** Stored Daily games and the attempts on them are kept this many days. */
export const DAILY_KEEP_DAYS = 3;

/** The connection hashes behind the repeat count are kept this long. */
export const CONNECTIONS_KEEP_MS = 48 * 60 * 60 * 1000;

/** The midnight trigger: the one that freezes the new Daily game. */
export const MIDNIGHT_CRON = "0 0 * * *";

export interface NightlyResult {
  /** `day:2026-09-29`, `week:2026-W40`…, and `game:12` for a Daily game. */
  readonly snapshots: readonly string[];
  readonly pruned: number;
  /** Daily Ranked's part, when it ran. */
  readonly daily?: {
    /** The game frozen, if this run froze one. */
    readonly built: number | null;
    readonly pruned: DailyPruned;
  };
}

export interface NightlyOptions {
  /** Which trigger fired: the game is frozen only at midnight. */
  readonly cron?: string;
  readonly daily?: {
    /** The epoch in force, ms. */
    readonly epoch: number;
    /** Freezes game `gameNo` (idempotent); absent when the Worker can't (no secret). */
    readonly build: ((gameNo: number) => Promise<void>) | undefined;
  };
}

export async function runNightly(
  db: D1Like,
  now: Date,
  options: NightlyOptions = {},
): Promise<NightlyResult> {
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
  if (options.daily === undefined) return { snapshots, pruned };

  const { epoch, build } = options.daily;
  const gameNo = gameNoAt(now.getTime(), epoch);
  let built: number | null = null;
  if (isGame(gameNo) && options.cron === MIDNIGHT_CRON && build !== undefined) {
    await build(gameNo);
    built = gameNo;
  }
  if (isGame(gameNo - 1)) {
    await snapshotDailyGame(db, gameNo - 1, now.getTime());
    snapshots.push(`game:${gameNo - 1}`);
  }
  const dailyPruned = await pruneDaily(db, {
    entriesBefore: gameNo - RETAIN_DAYS,
    gamesBefore: gameNo - DAILY_KEEP_DAYS,
    connectionsBefore: now.getTime() - CONNECTIONS_KEEP_MS,
  });
  return { snapshots, pruned, daily: { built, pruned: dailyPruned } };
}
