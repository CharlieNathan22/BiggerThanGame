/**
 * The clock in the timed modes (DESIGN.md §9, ARCHITECTURE.md §8).
 *
 * Each question has a limit — 15 seconds for the first, 10 for the rest — that
 * starts when the question becomes answerable: after the cards are dealt and,
 * on a stat change, after the wheel lands. The **server owns the clock**: it
 * never trusts the client's, so each progress token carries a `deadline`
 * worked out from when the server issued it:
 *
 *   deadline = issuedAt + animation before the question is answerable
 *                       + the question's limit + NETWORK_GRACE_MS
 *
 * The animation allowance is the worst case for an honest client — an instant
 * response, a full title card and photo hold on round one, a full spin on a
 * stat change — so a player who waits out every animation still gets the whole
 * limit. The client counts down only from when it can answer, and sends a
 * `timeout` when it reaches zero, so an honest player never meets the server's
 * deadline except on a connection slower than the grace.
 *
 * `ANSWER_TIMINGS` are the game's animation lengths. The web app's timing.ts
 * takes them from here, and its test holds them to `styles/tokens.css`, so the
 * deadline and what the player sees can't drift apart.
 */

import type { Mode } from "./types.js";

/** A timed mode's limits, in milliseconds: the first question, and every one after. */
export interface QuestionLimit {
  readonly first: number;
  readonly rest: number;
}

/** Per mode; null for a mode with no clock (Friendly, DESIGN.md §3). */
export const QUESTION_LIMITS: Readonly<Record<Mode, QuestionLimit | null>> = {
  friendly: null,
  endless: { first: 15_000, rest: 10_000 },
  ranked: { first: 15_000, rest: 10_000 },
};

/**
 * Added to every deadline for the network: the answer's trip to the server and
 * the token's trip to the client. A slower connection than this loses time.
 */
export const NETWORK_GRACE_MS = 3000;

/** The limit on question `round` of `mode`, in ms; null when the mode has no clock. */
export function questionLimit(mode: Mode, round: number): number | null {
  const limits = QUESTION_LIMITS[mode];
  if (limits === null) return null;
  return round === 1 ? limits.first : limits.rest;
}

/**
 * The animation lengths that stand between a round's response and its question
 * being answerable, in ms. The names are the web app's `Timings`.
 */
export const ANSWER_TIMINGS = {
  /** Round one's title card ("Question 1"), on the first run of a visit (the longer one). */
  title: 1800,
  /** The plaque's hold after it, at least... */
  holdMin: 1000,
  /** ...and at most this much longer, while round one's photos load. */
  holdExtra: 3000,
  /** Round one's cards sliding in. */
  introMin: 1000,
  /** Players shown, then a beat before the wheel. */
  beat: 700,
  /** No spin: the pause before the anchor's value shows. */
  hold: 340,
  /** The wheel. */
  spin: 1800,
  /** From the reel stopping to the anchor's value. */
  land: 40,
  /** From the guess to the verdict colour, when the response is on time. */
  verdict: 2540,
  /** From the verdict colour to the next deal. */
  next: 1400,
} as const;

/**
 * The most animation an honest client plays between receiving a round and
 * being able to answer it. Round one: the title card, the longest hold, the
 * cards coming in, the beat and the spin. A later round: its response can land
 * the instant the guess goes, so the rest of the reveal to the verdict, the gap
 * to the next deal, and then the beat and spin on a stat change or the short
 * hold without one.
 */
export function answerAllowance(round: number, statChanged: boolean): number {
  const t = ANSWER_TIMINGS;
  const spun = t.beat + t.spin + t.land;
  if (round === 1) return t.title + t.holdMin + t.holdExtra + t.introMin + spun;
  return t.verdict + t.next + (statChanged ? spun : t.hold);
}

/**
 * When the server stops accepting an answer to question `round`, for a token
 * issued at `issuedAt` (ms since the epoch). Null for a mode with no clock.
 */
export function deadlineFor(
  issuedAt: number,
  round: number,
  statChanged: boolean,
  mode: Mode,
): number | null {
  const limit = questionLimit(mode, round);
  if (limit === null) return null;
  return issuedAt + answerAllowance(round, statChanged) + limit + NETWORK_GRACE_MS;
}
