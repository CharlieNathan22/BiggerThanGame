/**
 * Difficulty bands and the relaxation ladder.
 *
 * Gap is a ratio: `max / min - 1`. A **floor alone does not create a ramp** —
 * it only removes pairs that are too close, so a late round with a low floor
 * still admits every blowout that qualified at round one. The ceiling is what
 * makes a late round hard. See DESIGN.md §8.
 */

import type { Band, StatKey } from "./types.js";
import { STATS } from "./stats.js";

interface BandRow {
  readonly upTo: number;
  readonly band: Band;
}

/**
 * The schedule. `upTo` is inclusive; the final row catches everything after.
 *
 * These numbers are a considered guess, not a finding. simulation.md settles
 * them — in particular whether the last band is populated at all once the
 * recently-seen queue and tie exclusion have taken their cut.
 */
const SCHEDULE: readonly BandRow[] = [
  { upTo: 10, band: { floor: 2.0, ceiling: null } },
  { upTo: 18, band: { floor: 1.5, ceiling: 8.0 } },
  { upTo: 26, band: { floor: 1.0, ceiling: 4.0 } },
  { upTo: 34, band: { floor: 0.75, ceiling: 2.5 } },
  { upTo: 42, band: { floor: 0.5, ceiling: 1.5 } },
  { upTo: Infinity, band: { floor: 0.3, ceiling: 0.8 } },
];

/** Rounds before which a band-exempt stat may not be dealt. */
export const BAND_EXEMPT_MIN_ROUND = 11;

/** Volatile stats (followers) never go tighter than this, whatever the band. */
export const VOLATILE_FLOOR = 1.0;

/** 1-based round number in, band out. */
export function bandForRound(round: number): Band {
  const row = SCHEDULE.find((r) => round <= r.upTo);
  return row ? row.band : { floor: 0.3, ceiling: 0.8 };
}

/**
 * The band actually applied to a given stat at a given round.
 *
 * Band-exempt stats are matched on tie-exclusion alone: a band is meaningless
 * when the entire range is 1 to 11.
 */
export function bandFor(stat: StatKey, round: number): Band {
  if (STATS[stat].bandExempt === true) return { floor: 0, ceiling: null };
  const base = bandForRound(round);
  if (STATS[stat].volatile === true && base.floor < VOLATILE_FLOOR) {
    return { floor: VOLATILE_FLOOR, ceiling: base.ceiling };
  }
  return base;
}

/** Whether a stat may be dealt at this round at all. */
export function statAllowedAtRound(stat: StatKey, round: number): boolean {
  if (STATS[stat].bandExempt !== true) return true;
  return round >= BAND_EXEMPT_MIN_ROUND;
}

/**
 * Relative distance between two values.
 *
 * Zero against a positive value is an infinite gap, which is semantically
 * right: "did they score more than none" is an easy question. It clears any
 * floor and fails any ceiling, so it shows up early and never at the knife
 * edge. Two zeroes are a tie and excluded elsewhere.
 */
export function gap(a: number, b: number): number {
  if (a === b) return 0;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (lo <= 0) return hi > 0 ? Infinity : 0;
  return hi / lo - 1;
}

export function withinBand(g: number, band: Band): boolean {
  if (g < band.floor) return false;
  if (band.ceiling !== null && g > band.ceiling) return false;
  return true;
}

/**
 * Progressively looser bands, tried in order when the candidate pool is empty.
 *
 * Ceiling first — a too-easy question beats a repeated player. Then the floor,
 * in steps. Shortening the recently-seen queue is the engine's next move after
 * this list is exhausted, and tie exclusion is never relaxed.
 */
export function relaxations(band: Band): Band[] {
  const out: Band[] = [band];
  if (band.ceiling !== null) {
    out.push({ floor: band.floor, ceiling: band.ceiling * 2 });
    out.push({ floor: band.floor, ceiling: null });
  }
  let floor = band.floor;
  for (let i = 0; i < 4 && floor > 0.05; i++) {
    floor = floor * 0.6;
    out.push({ floor, ceiling: null });
  }
  out.push({ floor: 0, ceiling: null });
  return out;
}
