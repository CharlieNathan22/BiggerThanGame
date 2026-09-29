/**
 * Difficulty bands and the relaxation ladder.
 *
 * Gap is **rank distance**: how far apart the two values sit in the deck's own
 * spread for that stat, as a fraction of it. Each value's percentile is its
 * mid-rank among eligible players (tied values share one), so 0 is the lowest
 * figure in the deck, 1 the highest, and a gap of 0.45 means the two players
 * are nearly half the deck apart. It replaced a raw ratio (`max / min - 1`),
 * which made a stat with a narrow range — every legend has 478 to 985 club
 * appearances — impossible to deal as an easy question. See DESIGN.md §8.
 *
 * A **floor alone does not create a ramp** — it only removes pairs that are too
 * close, so a late round with a low floor still admits every blowout that
 * qualified at round one. The ceiling is what makes a late round hard.
 */

import type { Band, Mode, Player, StatKey } from "./types.js";
import { STATS } from "./stats.js";
import { isEligible } from "./eligibility.js";

export interface BandRow {
  readonly upTo: number;
  readonly band: Band;
}

/**
 * The long schedule, for the modes with no finish line (Endless and Ranked),
 * in rank distance. `upTo` is inclusive; the final row catches everything after.
 *
 * Tuned against simulation.md on the 77-player legends deck. Re-check it
 * there after substantial deck growth — the floors are fractions of the deck,
 * so they scale with it, but the knife-edge band's absolute width shrinks as
 * the deck grows.
 */
const LONG_SCHEDULE: readonly BandRow[] = [
  { upTo: 10, band: { floor: 0.45, ceiling: null } },
  { upTo: 18, band: { floor: 0.25, ceiling: 0.7 } },
  { upTo: 26, band: { floor: 0.15, ceiling: 0.5 } },
  { upTo: 34, band: { floor: 0.1, ceiling: 0.35 } },
  { upTo: 42, band: { floor: 0.05, ceiling: 0.25 } },
  { upTo: Infinity, band: { floor: 0.02, ceiling: 0.12 } },
];

/**
 * Friendly's schedule: twenty questions (`WIN_ROUNDS`). Uncapped for the five
 * rounds that prefer iconic challengers (`ICONIC_ROUNDS`) and the five after,
 * then capped and **never easier**: from round 5 each band is at least as hard
 * as the one before (floor and ceiling never rise). Rounds 18–20 also carry the
 * final stretch's ratio floor (`FINAL_STRETCH`). Round 20, the **final
 * question**, is the hardest band in the run. DESIGN.md §8.
 *
 * The last rows are narrow because the ratio floor already rules out the
 * closest pairs: for dense stats (appearances, age, caps) no pair 10% apart
 * fits a narrow band, and relaxation lifts the ceiling, so a wide band there
 * only lets in easier pairs for the stats that can go close.
 *
 * Tuned against simulation.md on the 131-player legends deck with the `fan`
 * player model, for a win rate of 3–5%; re-tune when observed accuracy from
 * real play replaces the model's calibration points.
 */
const FRIENDLY_SCHEDULE: readonly BandRow[] = [
  { upTo: 5, band: { floor: 0.45, ceiling: null } },
  { upTo: 10, band: { floor: 0.35, ceiling: null } },
  { upTo: 13, band: { floor: 0.06, ceiling: 0.16 } },
  { upTo: 17, band: { floor: 0.02, ceiling: 0.08 } },
  { upTo: 19, band: { floor: 0.02, ceiling: 0.04 } },
  { upTo: Infinity, band: { floor: 0.01, ceiling: 0.03 } },
];

/**
 * The band schedule per mode. Changing one changes every run of that mode —
 * and every golden fingerprint for it.
 */
export const BAND_SCHEDULES: Readonly<Record<Mode, readonly BandRow[]>> = {
  friendly: FRIENDLY_SCHEDULE,
  endless: LONG_SCHEDULE,
  ranked: LONG_SCHEDULE,
};

/**
 * Volatile stats (followers) also need the two values at least this far apart
 * as a ratio, whatever the band. Rank distance says how far apart two players
 * sit in the deck; it says nothing about whether a refresh could swap them.
 * Two players on 41m and 43m can be a fifth of the deck apart and still flip.
 */
export const VOLATILE_FLOOR = 1.0;

/**
 * Friendly's final stretch: from round `from`, the two values must also be at
 * least `minRatio` apart as a ratio (0.1: the larger at least 1.10 times the
 * smaller). Rank distance alone can pair two figures a few percent apart, and
 * the last questions of a won run should be hard, not a coin flip. Unlike the
 * volatility floor this is **never relaxed** (`strictMinRatio`); it applies on
 * top of the volatility floor and tie exclusion. Null for a mode without one.
 */
export interface FinalStretch {
  readonly from: number;
  readonly minRatio: number;
}

export const FINAL_STRETCH: Readonly<Record<Mode, FinalStretch | null>> = {
  friendly: { from: 18, minRatio: 0.1 },
  endless: null,
  ranked: null,
};

/** 1-based round number and mode in, band out. */
export function bandForRound(round: number, mode: Mode): Band {
  const schedule = BAND_SCHEDULES[mode];
  const row = schedule.find((r) => round <= r.upTo);
  return row ? row.band : schedule[schedule.length - 1]!.band;
}

/**
 * The band actually applied to a given stat at a given round: the round's band,
 * plus the volatility floor for a volatile stat and the final stretch's ratio
 * floor in its rounds. Everything that asks "is this pair dealable" — the
 * engine and viability.md alike — goes through this, so they can't disagree.
 */
export function bandFor(stat: StatKey, round: number, mode: Mode): Band {
  let band = bandForRound(round, mode);
  if (STATS[stat].volatile === true) band = { ...band, minRatio: VOLATILE_FLOOR };
  const stretch = FINAL_STRETCH[mode];
  if (stretch !== null && round >= stretch.from) {
    band = { ...band, strictMinRatio: stretch.minRatio };
  }
  return band;
}

/**
 * Relative distance between two values, `max / min - 1`. No longer what the
 * bands measure — see `rankDistance` — but still the right measure for the
 * volatility floor, and for "how different are these figures" in reports.
 *
 * Zero against a positive value is an infinite gap. Two zeroes are a tie.
 */
export function gap(a: number, b: number): number {
  if (a === b) return 0;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (lo <= 0) return hi > 0 ? Infinity : 0;
  return hi / lo - 1;
}

/** Each distinct value of one stat → its percentile in the deck, 0 to 1. */
export type Percentiles = ReadonlyMap<number, number>;

/**
 * Memoised per deck array and stat. The deck is fixed for the life of a Worker
 * isolate and of a run, so this is computed once, not per round. Keyed on the
 * array itself: a different deck is a different table.
 */
const tables = new WeakMap<readonly Player[], Map<string, Percentiles>>();

/**
 * Percentile of every distinct value of `stat` among the deck's eligible
 * players: the mean of the positions the value occupies in the sorted list,
 * divided by the last position. Ties share a percentile, so a tie is always a
 * distance of 0.
 *
 * Pure arithmetic on the deck and `now` (which fixes everyone's age), so the
 * browser, the Worker and Node compute identical tables — the sequence stays a
 * function of seed and mode.
 */
export function percentiles(deck: readonly Player[], stat: StatKey, now: Date): Percentiles {
  let byDeck = tables.get(deck);
  if (byDeck === undefined) {
    byDeck = new Map();
    tables.set(deck, byDeck);
  }
  const key = `${stat}@${now.getTime()}`;
  const hit = byDeck.get(key);
  if (hit !== undefined) return hit;

  const values: number[] = [];
  for (const p of deck) {
    if (!isEligible(p, stat, now)) continue;
    const v = STATS[stat].get(p, now);
    if (v !== undefined) values.push(v);
  }
  values.sort((a, b) => a - b);

  const table = new Map<number, number>();
  const last = values.length - 1;
  let i = 0;
  while (i <= last) {
    let j = i;
    while (j < last && values[j + 1] === values[i]) j += 1;
    table.set(values[i]!, last > 0 ? (i + j) / 2 / last : 0.5);
    i = j + 1;
  }
  byDeck.set(key, table);
  return table;
}

/**
 * How far apart two values sit in the deck, 0 to 1. NaN for a value the table
 * doesn't hold (a player not eligible for the stat), which no band admits.
 */
export function rankDistance(table: Percentiles, a: number, b: number): number {
  const pa = table.get(a);
  const pb = table.get(b);
  if (pa === undefined || pb === undefined) return NaN;
  return Math.abs(pa - pb);
}

export function withinBand(distance: number, band: Band): boolean {
  if (!(distance >= band.floor)) return false; // also rejects NaN
  if (band.ceiling !== null && distance > band.ceiling) return false;
  return true;
}

/**
 * The single test for "may these two values be paired in this band": not
 * tied, rank distance within the band, and far enough apart as a ratio when
 * the band carries a `minRatio` or a `strictMinRatio`.
 */
export function pairFits(table: Percentiles, a: number, b: number, band: Band): boolean {
  if (a === b) return false; // tie — never relaxed
  if (!withinBand(rankDistance(table, a, b), band)) return false;
  if (band.minRatio !== undefined && gap(a, b) < band.minRatio) return false;
  if (band.strictMinRatio !== undefined && gap(a, b) < band.strictMinRatio) return false;
  return true;
}

/**
 * Progressively looser bands, tried in order when the candidate pool is empty.
 *
 * Ceiling first — a too-easy question beats a repeated player. Then the floor,
 * in steps. The volatility floor holds through every step but the last, which
 * drops it so a pair can always be dealt. Shortening the recently-seen queue is
 * the engine's next move after this list is exhausted. Tie exclusion and the
 * final stretch's `strictMinRatio` are never relaxed.
 */
export function relaxations(band: Band): Band[] {
  const strict = band.strictMinRatio !== undefined ? { strictMinRatio: band.strictMinRatio } : {};
  const keep = band.minRatio !== undefined ? { minRatio: band.minRatio, ...strict } : strict;
  const out: Band[] = [band];
  if (band.ceiling !== null) {
    out.push({ floor: band.floor, ceiling: Math.min(band.ceiling * 2, 1), ...keep });
    out.push({ floor: band.floor, ceiling: null, ...keep });
  }
  let floor = band.floor;
  for (let i = 0; i < 4 && floor > 0.01; i++) {
    floor = floor * 0.6;
    out.push({ floor, ceiling: null, ...keep });
  }
  out.push({ floor: 0, ceiling: null, ...strict });
  return out;
}
