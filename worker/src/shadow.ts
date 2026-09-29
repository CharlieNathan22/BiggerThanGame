/**
 * Shadow-flagging (DESIGN.md §13, ARCHITECTURE.md §12): timing heuristics over
 * the answer times a run's Durable Object measured. A flagged score is still
 * accepted and its player sees it and their rank as normal; it is left out of
 * everyone else's board and every total. Flag, never block: a visible
 * rejection only tells a cheater what to change.
 *
 * The stats are public facts, so a script with its own copy of the data can
 * always answer correctly. What it can't easily fake is a person's timing.
 *
 * **Think time.** The server measures each answer from the moment it issued
 * the question's token to the guess arriving. Before a question can be
 * answered, every honest client plays the verdict, the gap to the next pair
 * and at least the short hold — `ANSWER_TIMINGS.verdict + next + hold`, even
 * with reduced motion, which drops only the wheel's spin. Anything under that
 * is time a person couldn't have had. Think time is the measured time less
 * that floor; a stat change adds the beat and (with motion) the spin on top, so
 * the estimate errs long, on the side of not flagging. Round one is left out:
 * its title card can be skipped. Timeouts are left out too.
 *
 * The thresholds are deliberately not in the public docs; the handoff doc has
 * them with the rate-limit numbers.
 */

import { ANSWER_TIMINGS, bandForRound } from "@bt/core";
import type { AnswerRecord } from "./run-ledger.js";

/** The animation every honest client plays before a question from round two on. */
export const THINK_FLOOR_MS = ANSWER_TIMINGS.verdict + ANSWER_TIMINGS.next + ANSWER_TIMINGS.hold;

/** FAST: this many right answers, each thought about for under `FAST_MS`. */
export const FAST_COUNT = 5;
export const FAST_MS = 300;

/** FLAT: at least this many timed answers whose think times barely vary. */
export const FLAT_MIN_ANSWERS = 10;
export const FLAT_STDEV_MS = 150;

/** KNIFE: this many right answers in the knife-edge bands, at a fast median. */
export const KNIFE_MIN_ROUNDS = 10;
export const KNIFE_MEDIAN_MS = 1200;
/** A band this tight or tighter is knife-edge: rounds 16 and on in Endless. */
export const KNIFE_CEILING = 0.04;

export type ShadowReason = "fast" | "flat" | "knife";

/** A timed answer from round two on, and how long the player had to think. */
function thinking(
  answers: readonly AnswerRecord[],
): { round: number; think: number; correct: boolean }[] {
  return answers
    .filter((a) => a.round >= 2 && a.guess !== "timeout")
    .map((a) => ({ round: a.round, think: a.ms - THINK_FLOOR_MS, correct: a.correct }));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function stdev(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

function isKnifeEdge(round: number): boolean {
  const { ceiling } = bandForRound(round, "endless");
  return ceiling !== null && ceiling <= KNIFE_CEILING;
}

/** Which heuristics a run's answers trip; empty for a run that looks like a person. */
export function shadowReasons(answers: readonly AnswerRecord[]): ShadowReason[] {
  const timed = thinking(answers);
  const reasons: ShadowReason[] = [];
  if (timed.filter((a) => a.correct && a.think < FAST_MS).length >= FAST_COUNT) {
    reasons.push("fast");
  }
  if (timed.length >= FLAT_MIN_ANSWERS && stdev(timed.map((a) => a.think)) < FLAT_STDEV_MS) {
    reasons.push("flat");
  }
  const knife = timed.filter((a) => a.correct && isKnifeEdge(a.round));
  if (knife.length >= KNIFE_MIN_ROUNDS && median(knife.map((a) => a.think)) < KNIFE_MEDIAN_MS) {
    reasons.push("knife");
  }
  return reasons;
}
