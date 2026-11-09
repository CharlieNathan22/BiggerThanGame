/**
 * 1v1 ("Play a friend", DESIGN.md §3): two players in a private room answer
 * the same questions at the same moment. The server mode is `duel`.
 *
 * A match borrows a **pool**'s questions, as a Twitch Mode match does
 * (stream.ts): general Endless's whole deck, Instagram Endless's, or a "Clear
 * the squad" theme. It is dealt by Endless's engine with the pool's variant,
 * by **Twitch Mode's match bands** for the pool and length (`streamBandsFor`,
 * the same objects, not a copy), under a seed domain of its own
 * (`duelSeedDomain`). So the sequence-level `Mode` and every table keyed by
 * it are untouched, and no other mode's run changes.
 *
 * **Sudden death** is the same deal carried on past the match's questions
 * (`RunOptions.extraRounds`): every row of the bands is a share of the
 * match's questions, so a round past them falls in the last row, the hardest.
 *
 * One point per right answer; speed never matters. The time limit is chosen
 * when the room is made and is the same on every question.
 */

import { deadlineWithLimit } from "./clock.js";
import { buildRun } from "./sequence.js";
import { STREAM_LENGTHS, isStreamPool, streamBandsFor, streamQuestions } from "./stream.js";
import type { StreamLength, StreamPool } from "./stream.js";
import { hasWheel } from "./variants.js";
import type { Player, Round } from "./types.js";

/** The questions a match can have: Twitch Mode's lengths. */
export const DUEL_LENGTHS = STREAM_LENGTHS;
export type DuelLength = StreamLength;

/** The time limits a room can have, in seconds: Fast, Relaxed and Slow. */
export const DUEL_LIMITS = [10, 20, 30] as const;
export type DuelLimit = (typeof DUEL_LIMITS)[number];

export const DEFAULT_DUEL_LENGTH: DuelLength = 10;
export const DEFAULT_DUEL_LIMIT: DuelLimit = 20;

/** The players in a 1v1 room. */
export const DUEL_PLAYERS = 2;

/** The most sudden-death questions a level match plays before it is a draw. */
export const SUDDEN_DEATH_MAX = 10;

/** The pool a match's questions come from: an Endless variant's id, as Twitch Mode's. */
export type DuelPool = StreamPool;

export function isDuelLength(value: unknown): value is DuelLength {
  return (DUEL_LENGTHS as readonly unknown[]).includes(value);
}

export function isDuelLimit(value: unknown): value is DuelLimit {
  return (DUEL_LIMITS as readonly unknown[]).includes(value);
}

/** Whether `value` is shaped like a pool id. A squad's theme is only known once the deck has it. */
export function isDuelPool(value: unknown): value is DuelPool {
  return isStreamPool(value);
}

/**
 * The questions a match asked for `requested` gets: capped by the pool, as a
 * Twitch Mode match is. Undefined for a squad the deck doesn't have.
 */
export function duelQuestions(
  pool: DuelPool,
  requested: DuelLength,
  deck: readonly Player[],
): number | undefined {
  return streamQuestions(pool, requested, deck);
}

/**
 * What a match's seed is derived under: `HMAC(RUN_SECRET, domain + matchId)`.
 * Its own per pool, and never another mode's, so a match can't be learned
 * from an Endless run or a Twitch Mode match, nor one pool's from another's.
 */
export function duelSeedDomain(pool: DuelPool): string {
  return `duel:${pool}:`;
}

export interface DuelRunOptions {
  readonly deck: readonly Player[];
  readonly seed: string;
  readonly now: Date;
  readonly pool: DuelPool;
  /** The match's questions (`duelQuestions`), before any sudden death. */
  readonly questions: number;
  /** Deal at most this many rounds. Defaults to the match and all its sudden death. */
  readonly maxRounds?: number;
}

/**
 * A match's rounds: its questions, then up to `SUDDEN_DEATH_MAX` more for
 * sudden death, fewer if the pool runs out first (a squad never repeats a
 * player). A pure function of the seed, the pool and the length, never of the
 * answers, so both players are dealt the same questions.
 */
export function buildDuelRun(opts: DuelRunOptions): Round[] {
  const { deck, seed, now, pool, questions } = opts;
  const most = questions + SUDDEN_DEATH_MAX;
  return buildRun({
    deck,
    seed,
    now,
    mode: "endless",
    variant: pool,
    maxRounds: Math.min(most, opts.maxRounds ?? most),
    bands: streamBandsFor(pool, questions),
    extraRounds: SUDDEN_DEATH_MAX,
  });
}

/** Whether question `index` of a match of `questions` is a sudden-death one. */
export function isSuddenDeath(index: number, questions: number): boolean {
  return index > questions;
}

/** The server's deadline on a match's question: the room's limit on every round. */
export function duelDeadline(
  issuedAt: number,
  round: number,
  statChanged: boolean,
  limit: DuelLimit,
  pool: DuelPool,
): number {
  return deadlineWithLimit(issuedAt, round, statChanged, limit * 1000, hasWheel(pool));
}
