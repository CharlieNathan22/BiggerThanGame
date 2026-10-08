/**
 * Daily Ranked's games, frozen (ARCHITECTURE.md §7).
 *
 * Each game is dealt once, from `seed = HMAC(RUN_SECRET, "ranked:" + gameNo)`
 * with the deck and rules in force at that moment, and stored in D1
 * (`daily_games`): the twenty questions and the bonus rounds up to Endless's
 * cap, each with both players as their cards show them and both figures.
 * Every start, guess and resume plays from the stored game, so a deploy or a
 * deck update during the day never changes a question; it takes effect from
 * the next game. The midnight cron stores it; if it hasn't (it failed, or it
 * is the first day), the game's first start does.
 *
 * **Idempotent and safe against a race.** Two requests that both find the
 * game missing both build it — the same seed and deck deal the same rounds —
 * and both `INSERT … ON CONFLICT DO NOTHING`; each then reads back the one row
 * that won. A game, once stored, is never written again.
 *
 * **Server-only.** A `StoredRound` holds every figure. It never leaves the
 * Worker: daily-payload.ts copies what a response may carry field by field.
 */

import {
  BAND_SCHEDULES,
  ICONIC_ROUNDS,
  MAX_ROUNDS,
  PAIR_RULES,
  RELAXATION_LADDERS,
  STATS,
  WHEEL_VIABILITY,
  buildRun,
  dayKey,
  gameDate,
  hashSeed,
  roundCap,
} from "@bt/core";
import type { Player, PlayerImage, Position, Relaxation, StatKey } from "@bt/core";
import { bandLabel, pairRankDistance } from "./analytics.js";
import { figureFor } from "./payload.js";
import type { ImageLookup } from "./payload.js";
import type { D1Like } from "./scores.js";
import { rankedSeed } from "./seed.js";

/** A player in a stored round: the card as dealt, and the figure for the round's stat. */
export interface StoredPlayer {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly position: Position;
  /** The photo as dealt; resolved against the current manifest when served (daily-payload.ts). */
  readonly image?: { readonly key: string; readonly width: number; readonly height: number };
  readonly focus?: string;
  readonly value: number;
  readonly display: string;
  readonly qualifier?: string;
}

/** One round of a frozen game. Never sent anywhere. */
export interface StoredRound {
  readonly index: number;
  readonly stat: StatKey;
  readonly statChanged: boolean;
  readonly relaxation: Relaxation;
  /** The round's scheduled band, as analytics labels it. */
  readonly band: string;
  /** How far apart the two figures sit in the deck, 0 to 1. */
  readonly distance: number;
  readonly anchor: StoredPlayer;
  readonly challenger: StoredPlayer;
}

export interface DailyGame {
  readonly gameNo: number;
  /** The game's day, `YYYYMMDD`. */
  readonly dayKey: number;
  readonly deckVersion: string;
  readonly rulesVersion: string;
  readonly createdAt: number;
  readonly rounds: readonly StoredRound[];
}

/**
 * Which rules a game was dealt under: a short hash of every setting that
 * shapes a Daily run, so a stored game says whether it predates a ramp change.
 */
export const RULES_VERSION = `ranked-${hashSeed(
  JSON.stringify({
    schedule: BAND_SCHEDULES.ranked.map((row) => ({ ...row, upTo: String(row.upTo) })),
    pairs: PAIR_RULES.ranked,
    ladder: RELAXATION_LADDERS.ranked,
    wheel: WHEEL_VIABILITY.ranked,
    iconic: ICONIC_ROUNDS.ranked,
    cap: MAX_ROUNDS.ranked,
  }),
).toString(16)}`;

export interface BuildInputs {
  readonly deck: readonly Player[];
  readonly images: ImageLookup;
  readonly secret: string;
  readonly deckVersion: string;
  /** The epoch in force, ms (`dailyEpochMs`). */
  readonly epoch: number;
  /** The server's clock, for `createdAt`. */
  readonly clock: () => Date;
}

/** Deals game `gameNo` from its seed: the twenty questions and the bonus rounds. */
export async function buildDailyGame(gameNo: number, inputs: BuildInputs): Promise<DailyGame> {
  const now = gameDate(gameNo, inputs.epoch);
  const rounds = buildRun({
    deck: inputs.deck,
    seed: await rankedSeed(inputs.secret, gameNo),
    mode: "ranked",
    now,
    maxRounds: roundCap("ranked"),
  });
  const stored = (p: Player, stat: StatKey): StoredPlayer => {
    const image: PlayerImage | undefined = inputs.images[p.id];
    return {
      id: p.id,
      name: p.name,
      country: p.country,
      position: p.position,
      ...(image !== undefined
        ? { image: { key: image.key, width: image.width, height: image.height } }
        : {}),
      ...(image !== undefined && p.imageFocus !== undefined ? { focus: p.imageFocus } : {}),
      ...figureFor(p, stat, now),
    };
  };
  return {
    gameNo,
    dayKey: dayKey(now),
    deckVersion: inputs.deckVersion,
    rulesVersion: RULES_VERSION,
    createdAt: inputs.clock().getTime(),
    rounds: rounds.map((r) => ({
      index: r.index,
      stat: r.stat,
      statChanged: r.statChanged,
      relaxation: r.relaxation,
      band: bandLabel(r.index, "ranked"),
      distance: pairRankDistance(inputs.deck, r, now),
      anchor: stored(r.anchor, r.stat),
      challenger: stored(r.challenger, r.stat),
    })),
  };
}

/** A stored game whose day isn't the game's own: only possible if the epoch moved. */
export class GameDayMismatchError extends Error {
  constructor(gameNo: number) {
    super(`stored game ${gameNo} is for another day: has DAILY_EPOCH moved?`);
    this.name = "GameDayMismatchError";
  }
}

/** Games already read, per database: a stored game never changes, so it is safe to keep. */
const memo = new WeakMap<D1Like, Map<number, DailyGame>>();

/** How many games an isolate keeps: today's, yesterday's, and room for tomorrow's. */
const MEMO_GAMES = 3;

function remember(db: D1Like, game: DailyGame): DailyGame {
  let games = memo.get(db);
  if (games === undefined) {
    games = new Map();
    memo.set(db, games);
  }
  games.set(game.gameNo, game);
  while (games.size > MEMO_GAMES) {
    const oldest = Math.min(...games.keys());
    games.delete(oldest);
  }
  return game;
}

/** The stored game, or undefined if it hasn't been stored yet. */
export async function readDailyGame(
  db: D1Like,
  gameNo: number,
  epoch: number,
): Promise<DailyGame | undefined> {
  const cached = memo.get(db)?.get(gameNo);
  if (cached !== undefined) return cached;
  const row = await db
    .prepare(
      "SELECT game_no, day_key, deck_version, rules_version, created_at, rounds " +
        "FROM daily_games WHERE game_no = ?1",
    )
    .bind(gameNo)
    .first<{
      game_no: number;
      day_key: number;
      deck_version: string;
      rules_version: string;
      created_at: number;
      rounds: string;
    }>();
  if (row === null) return undefined;
  if (row.day_key !== dayKey(gameDate(gameNo, epoch))) throw new GameDayMismatchError(gameNo);
  return remember(db, {
    gameNo: row.game_no,
    dayKey: row.day_key,
    deckVersion: row.deck_version,
    rulesVersion: row.rules_version,
    createdAt: row.created_at,
    rounds: JSON.parse(row.rounds) as StoredRound[],
  });
}

/**
 * Game `gameNo` as stored, storing it first if it isn't. Idempotent, and safe
 * when two requests race: the first row in stands, and both read it back.
 */
export async function ensureDailyGame(
  db: D1Like,
  gameNo: number,
  inputs: BuildInputs,
): Promise<DailyGame> {
  const stored = await readDailyGame(db, gameNo, inputs.epoch);
  if (stored !== undefined) return stored;
  const game = await buildDailyGame(gameNo, inputs);
  await db
    .prepare(
      "INSERT INTO daily_games (game_no, day_key, deck_version, rules_version, created_at, rounds) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (game_no) DO NOTHING",
    )
    .bind(
      game.gameNo,
      game.dayKey,
      game.deckVersion,
      game.rulesVersion,
      game.createdAt,
      JSON.stringify(game.rounds),
    )
    .run();
  const won = await readDailyGame(db, gameNo, inputs.epoch);
  if (won === undefined) throw new Error(`game ${gameNo} was not stored`);
  return won;
}

/** Forgets every game this isolate has read: for tests that rewrite a stored game. */
export function forgetDailyGames(db: D1Like): void {
  memo.delete(db);
}

/** A round's tier, from the stat. */
export function tierOf(round: StoredRound): (typeof STATS)[StatKey]["tier"] {
  return STATS[round.stat].tier;
}
