/**
 * Daily Ranked (DESIGN.md §3): one game a day, the same twenty questions for
 * everyone, then sudden-death bonus rounds for a run that gets all twenty.
 *
 * - **Game numbers.** Game 1 is launch day, `DAILY_EPOCH` at 00:00 UTC, and
 *   the epoch never moves: game numbers become permanent once people share
 *   them. A game runs from 00:00 UTC to the next 00:00 UTC, and a run belongs
 *   to the game it started in.
 * - **The score** is the questions answered right out of twenty, plus the
 *   bonus streak after a perfect twenty: 20/20 and five bonus rounds is 25.
 * - **Mistakes don't end the run.** A wrong answer or a timeout is marked and
 *   the run carries on to question 20. Only a perfect run goes on, into the
 *   bonus, where the first miss ends it.
 *
 * Pure: the Worker and the web app share it.
 */

import { DAY_MS } from "./periods.js";

/**
 * Launch day, `YYYY-MM-DD` (UTC): Game 1. **Set it to the launch date before
 * merging, and never move it.** While it is null the site runs on
 * `DEV_DAILY_EPOCH`, and a production build refuses to run
 * (`assertDailyEpoch`).
 */
export const DAILY_EPOCH: string | null = "2026-10-08";

/** The epoch dev and tests use while `DAILY_EPOCH` is unset. */
export const DEV_DAILY_EPOCH = "2026-10-01";

/** The questions every player gets. Answering all of them right opens the bonus rounds. */
export const DAILY_QUESTIONS = 20;

/** A run with no activity for this long is finished by its Durable Object, and posted. */
export const IDLE_FINISH_MS = 5 * 60_000;

/** 00:00 UTC on an epoch date, ms; throws on anything but a real `YYYY-MM-DD`. */
export function epochMs(epoch: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(epoch);
  if (match === null) throw new Error(`not a YYYY-MM-DD date: ${epoch}`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`not a real date: ${epoch}`);
  }
  return ms;
}

/** The epoch in force: `DAILY_EPOCH`, or the dev epoch while it is unset. */
export function dailyEpochMs(epoch: string | null = DAILY_EPOCH): number {
  return epochMs(epoch ?? DEV_DAILY_EPOCH);
}

/**
 * Fails while `DAILY_EPOCH` is unset or malformed: the production build runs
 * it, so the site never goes live on the dev epoch.
 */
export function assertDailyEpoch(epoch: string | null = DAILY_EPOCH): void {
  if (epoch === null) {
    throw new Error(
      "DAILY_EPOCH is not set: set it to launch day (packages/core/src/daily.ts) before a production build",
    );
  }
  epochMs(epoch);
}

/**
 * The game being played at `now`: `floor((now − epoch) / 1 day) + 1`. Below 1
 * before launch day ("Game 1 starts in …").
 */
export function gameNoAt(now: number, epoch: number = dailyEpochMs()): number {
  return Math.floor((now - epoch) / DAY_MS) + 1;
}

/** When game `gameNo` starts: its 00:00 UTC, ms. */
export function gameStartsAt(gameNo: number, epoch: number = dailyEpochMs()): number {
  return epoch + (gameNo - 1) * DAY_MS;
}

/** Game `gameNo`'s day at 00:00 UTC: the reference date its ages are computed from. */
export function gameDate(gameNo: number, epoch: number = dailyEpochMs()): Date {
  return new Date(gameStartsAt(gameNo, epoch));
}

/** When the next game starts after `now`, ms: what the countdown counts to. Game 1's start before launch. */
export function nextGameAt(now: number, epoch: number = dailyEpochMs()): number {
  return gameStartsAt(Math.max(1, gameNoAt(now, epoch) + 1), epoch);
}

/** Whether a game number is a real game: from Game 1 on. */
export function isGame(gameNo: number): boolean {
  return Number.isInteger(gameNo) && gameNo >= 1;
}

/** A run's score: the right answers out of twenty, plus the bonus streak. */
export function dailyScore(correct: number, bonus: number): number {
  return correct + bonus;
}

/** Whether every one of the twenty questions was answered right. */
export function isPerfect(correct: number): boolean {
  return correct === DAILY_QUESTIONS;
}

/** Whether `round` is a bonus round: past the twenty, reached only by a perfect run. */
export function isBonusRound(round: number): boolean {
  return round > DAILY_QUESTIONS;
}

/**
 * Whether a run carries on after answering `round`. `correct` is the run's
 * right answers among the twenty after this one; `right`, this answer.
 *
 * - Questions 1–19: always, right or wrong.
 * - Question 20: only when all twenty were right; otherwise the run is over,
 *   `finished`.
 * - A bonus round: only on a right answer; the first miss ends it.
 */
export function dailyContinues(round: number, correct: number, right: boolean): boolean {
  if (round < DAILY_QUESTIONS) return true;
  if (round === DAILY_QUESTIONS) return isPerfect(correct);
  return right;
}
