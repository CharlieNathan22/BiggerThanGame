/**
 * Posting a finished Daily run to its game's board (ARCHITECTURE.md §8, §12).
 * There is no submit step: whoever finishes the run — the guess that ends
 * it, a resume that finds its last question timed out, or the Durable
 * Object's alarm for a run left quiet — posts it. Idempotent: the entry is
 * finished once (`finishEntry`), and a second post only reads it back.
 *
 * **Thinking time**, the tiebreak on equal scores: for each answer from
 * question 2, the server-measured time less the animation its client played
 * first, held between 0 and the question's limit. Running out of time never
 * helps: a timeout — the client's own, a late answer, or a question left open
 * — counts its whole limit (question 1's included, though an answered
 * question 1 is left out, its title card being skippable), and so does every
 * question of the twenty a run never answered.
 *
 * **Shadowing**: the Endless heuristics over the answer times, and one for the
 * Daily game's own risk — someone who already knows the day's answers (a
 * second device, a friend's spoiler) answering near-perfectly at a pace no one
 * reading the cards could keep. A shadowed run is posted and its player sees
 * it and their rank as usual; it is left out of everyone else's view.
 */

import { DAILY_QUESTIONS, dailyScore } from "@bt/core";
import type { DailyResult } from "@bt/core";
import type { DailyAnswer, DailyRunRecord } from "./daily-ledger.js";
import { bonusOf, correctOf, limitFor } from "./daily-ledger.js";
import { entryByRunKey, entryResult, finishEntry } from "./daily-scores.js";
import type { D1Like } from "./scores.js";
import type { AnswerRecord } from "./run-ledger.js";
import { THINK_FLOOR_MS, shadowReasons } from "./shadow.js";
import type { ShadowReason } from "./shadow.js";

/** One answer's thinking time, ms. */
export function answerThinkMs(answer: DailyAnswer): number {
  if (answer.timedOut) return answer.limitMs;
  if (answer.round === 1) return 0;
  return Math.min(answer.limitMs, Math.max(0, answer.ms - answer.allowanceMs));
}

/** A run's thinking time: every answer's, and the full limit for each of the twenty never answered. */
export function dailyThinkMs(answers: readonly DailyAnswer[]): number {
  const answered = new Set(answers.map((a) => a.round));
  let total = answers.reduce((sum, a) => sum + answerThinkMs(a), 0);
  for (let round = 1; round <= DAILY_QUESTIONS; round++) {
    if (!answered.has(round)) total += limitFor(round);
  }
  return total;
}

export const REPLAY_MIN_CORRECT = 19;
export const REPLAY_FIRST_ROUND = 2;
export const REPLAY_LAST_ROUND = 10;
export const REPLAY_MEDIAN_MS = 700;

export type DailyShadowReason = ShadowReason | "replay";

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * The replay check: a near-perfect twenty whose early questions were answered
 * faster than anyone reading the cards could.
 */
export function isReplayLike(answers: readonly DailyAnswer[]): boolean {
  const main = answers.filter((a) => a.round <= DAILY_QUESTIONS);
  if (main.filter((a) => a.correct).length < REPLAY_MIN_CORRECT) return false;
  const early = main
    .filter((a) => a.round >= REPLAY_FIRST_ROUND && a.round <= REPLAY_LAST_ROUND && !a.timedOut)
    .map((a) => Math.max(0, a.ms - a.allowanceMs));
  if (early.length < REPLAY_LAST_ROUND - REPLAY_FIRST_ROUND + 1) return false;
  return median(early) < REPLAY_MEDIAN_MS;
}

/** Which heuristics a Daily run trips; empty for a run that looks like a person. */
export function dailyShadowReasons(answers: readonly DailyAnswer[]): DailyShadowReason[] {
  // The Endless heuristics read answers as Endless records: a timeout is left out there.
  const records: AnswerRecord[] = answers.map((a) => ({
    round: a.round,
    nonce: a.nonce,
    guess: a.timedOut ? "timeout" : a.guess,
    issuedAt: a.issuedAt,
    receivedAt: a.receivedAt,
    ms: a.ms,
    correct: a.correct,
  }));
  const reasons: DailyShadowReason[] = shadowReasons(records);
  if (isReplayLike(answers)) reasons.push("replay");
  return reasons;
}

/** The floor the Endless heuristics use, re-exported for the tests' fixtures. */
export { THINK_FLOOR_MS };

export interface Posted {
  readonly result: DailyResult;
  /** True when this call finished the entry; false when it already was. */
  readonly fresh: boolean;
  readonly shadowed: boolean;
  readonly reasons: readonly DailyShadowReason[];
}

/** Posts a finished run (idempotent), and reads back where it stands. */
export async function postDailyRun(
  db: D1Like,
  run: DailyRunRecord,
  answers: readonly DailyAnswer[],
): Promise<Posted> {
  if (run.status !== "ended" || run.end === null || run.endedAt === null) {
    throw new Error("only a finished run is posted");
  }
  const correct = correctOf(run.results);
  const bonus = bonusOf(run.results);
  const reasons = dailyShadowReasons(answers);
  const fresh = await finishEntry(db, {
    runKey: run.key,
    score: dailyScore(correct, bonus),
    correct,
    bonus,
    thinkMs: dailyThinkMs(answers),
    results: run.results,
    end: run.end,
    finishedAt: run.endedAt,
    shadow: reasons.length > 0,
    shadowReason: reasons.length > 0 ? reasons.join(",") : null,
  });
  const entry = await entryByRunKey(db, run.key);
  if (entry === undefined) throw new Error("a finished run with no entry");
  const { result } = await entryResult(db, entry);
  return { result, fresh, shadowed: entry.shadow === 1, reasons };
}

/** A finished run's result before it is on the board: no rank yet. */
export function unpostedResult(run: DailyRunRecord, nickname: string | null): DailyResult {
  const correct = correctOf(run.results);
  const bonus = bonusOf(run.results);
  return {
    gameNo: run.gameNo,
    score: dailyScore(correct, bonus),
    correct,
    bonus,
    results: run.results,
    end: run.end ?? "finished",
    nickname,
    rank: null,
    total: null,
  };
}
