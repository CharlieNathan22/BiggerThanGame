/**
 * Twitch Mode ("Chat vs You", DESIGN.md §3): a streamer plays a fixed-length
 * match against their own chat. The server mode is `stream`.
 *
 * A match borrows a **pool**'s questions and difficulty and plays by match
 * rules. The pool is one of the Endless variants (variants.ts): general
 * Endless's whole deck (`endless`), Instagram Endless's (`endless-instagram`),
 * or a "Clear the squad" theme (`squad:<theme id>`). Daily Ranked is not a
 * pool: streaming it would show the day's answers to every viewer.
 *
 * The rounds are dealt by Endless's engine with the pool's variant, under a
 * seed domain of the match's own (`streamSeedDomain`), cut at the match's
 * length. So the sequence-level `Mode` and every table keyed by it are
 * untouched, and no other mode's run changes. Its bands are its own
 * (`streamBands`, `RunOptions.bands`): a friendly opening of 2 or 3 questions,
 * then hard all the way by progress through the match, on every pool.
 *
 * Every question is scored for both sides and play goes on to the last one:
 * a wrong answer or a timeout is a point not won. The time limit is chosen at
 * setup and is the same for every question, the first included.
 */

import { deadlineWithLimit } from "./clock.js";
import {
  STREAM_INSTAGRAM_OPENING_BAND,
  STREAM_INSTAGRAM_SCHEDULE,
  STREAM_OPENING_BAND,
  STREAM_SCHEDULE,
  STREAM_SQUAD_SCHEDULE,
} from "./ramp.js";
import type { BandRules } from "./ramp.js";
import { buildRun } from "./sequence.js";
import {
  hasWheel,
  isEndlessVariantId,
  isSquadVariantId,
  resolveVariant,
  squadQuestions,
} from "./variants.js";
import type { EndlessVariantId } from "./variants.js";

/** The friendly opening's questions: 2 in a short match, 3 from 15 questions. */
export function streamOpening(questions: number): number {
  return questions >= 15 ? 3 : 2;
}

/**
 * A match's band rules (DESIGN.md §8): the friendly opening, then the pool's
 * stream schedule (`STREAM_SCHEDULE`, `STREAM_SQUAD_SCHEDULE`,
 * `STREAM_INSTAGRAM_SCHEDULE`), every row a share of the match's questions.
 * No pair rules: the rows carry their own ratio floors. Followers keep the
 * volatility floor everywhere but Instagram, whose rows carry its closeness
 * floor.
 */
export function streamBands(pool: StreamPool, questions: number): BandRules {
  const instagram = pool === "endless-instagram";
  const rows = instagram
    ? STREAM_INSTAGRAM_SCHEDULE
    : isSquadVariantId(pool)
      ? STREAM_SQUAD_SCHEDULE
      : STREAM_SCHEDULE;
  return {
    schedule: [
      {
        upTo: (streamOpening(questions) + 0.5) / questions,
        band: instagram ? STREAM_INSTAGRAM_OPENING_BAND : STREAM_OPENING_BAND,
      },
      ...rows,
    ],
    pairRules: null,
    volatileFloor: !instagram,
    questions,
  };
}
import type { Player, Round } from "./types.js";

/** The questions a match can have. */
export const STREAM_LENGTHS = [10, 20] as const;
export type StreamLength = (typeof STREAM_LENGTHS)[number];

/** The voting windows a match can have, in seconds: the time limit on every question. */
export const STREAM_LIMITS = [10, 20, 30, 60] as const;
export type StreamLimit = (typeof STREAM_LIMITS)[number];

export const DEFAULT_STREAM_LENGTH: StreamLength = 10;
export const DEFAULT_STREAM_LIMIT: StreamLimit = 30;

/**
 * "End voting" closes the window early, once this much of it has gone, on
 * every limit but the shortest (`canEndVoting`).
 */
export const END_VOTING_AFTER_MS = 8000;

/** The pool a match's questions come from: an Endless variant's id. */
export type StreamPool = EndlessVariantId;

export function isStreamLength(value: unknown): value is StreamLength {
  return (STREAM_LENGTHS as readonly unknown[]).includes(value);
}

export function isStreamLimit(value: unknown): value is StreamLimit {
  return (STREAM_LIMITS as readonly unknown[]).includes(value);
}

/** Whether `value` is shaped like a pool id. A squad's theme is only known once the deck has it. */
export function isStreamPool(value: unknown): value is StreamPool {
  return isEndlessVariantId(value);
}

/**
 * The most questions a match on `pool` can have: a squad's size less one (its
 * first anchor isn't asked), otherwise the longest match. Undefined for a
 * squad the deck doesn't have.
 */
export function streamCap(pool: StreamPool, deck: readonly Player[]): number | undefined {
  const longest = STREAM_LENGTHS[1];
  if (!isSquadVariantId(pool)) return longest;
  const variant = resolveVariant(pool, deck);
  if (variant?.theme === undefined) return undefined;
  return Math.min(longest, squadQuestions(variant.theme.players));
}

/** The questions a match asked for `requested` gets: capped by the pool. */
export function streamQuestions(
  pool: StreamPool,
  requested: StreamLength,
  deck: readonly Player[],
): number | undefined {
  const cap = streamCap(pool, deck);
  return cap === undefined ? undefined : Math.min(requested, cap);
}

/**
 * What a match's seed is derived under: `HMAC(RUN_SECRET, domain + runBody)`.
 * Its own per pool, and never another mode's, so a match can't be learned
 * from an Endless run, nor one pool's from another's.
 */
export function streamSeedDomain(pool: StreamPool): string {
  return `stream:${pool}:`;
}

export interface StreamRunOptions {
  readonly deck: readonly Player[];
  readonly seed: string;
  readonly now: Date;
  readonly pool: StreamPool;
  /** The match's questions (`streamQuestions`). */
  readonly questions: number;
  /** Deal at most this many rounds (the server deals one round ahead, never more). */
  readonly maxRounds?: number;
}

/**
 * A match's rounds: Endless's engine on the pool's variant, cut at the
 * match's length, by the match's own bands (`streamBands`). A pure function
 * of the seed, the pool and the length, never of the answers.
 */
export function buildStreamRun(opts: StreamRunOptions): Round[] {
  const { deck, seed, now, pool, questions } = opts;
  return buildRun({
    deck,
    seed,
    now,
    mode: "endless",
    variant: pool,
    maxRounds: Math.min(questions, opts.maxRounds ?? questions),
    bands: streamBandsFor(pool, questions),
  });
}

/** One `BandRules` object per pool and length, so the dealer's memos see the same rules each time. */
const bandsMemo = new Map<string, BandRules>();
function streamBandsFor(pool: StreamPool, questions: number): BandRules {
  const key = `${pool}#${questions}`;
  let rules = bandsMemo.get(key);
  if (rules === undefined) bandsMemo.set(key, (rules = streamBands(pool, questions)));
  return rules;
}

/** The server's deadline on a match's question: the chosen limit on every round. */
export function streamDeadline(
  issuedAt: number,
  round: number,
  statChanged: boolean,
  limit: StreamLimit,
  pool: StreamPool,
): number {
  return deadlineWithLimit(issuedAt, round, statChanged, limit * 1000, hasWheel(pool));
}

/** Whether "End voting" is offered: not on the shortest limit, and only once `END_VOTING_AFTER_MS` has gone. */
export function canEndVoting(limit: StreamLimit, elapsedMs: number): boolean {
  return limit !== STREAM_LIMITS[0] && elapsedMs >= END_VOTING_AFTER_MS;
}
