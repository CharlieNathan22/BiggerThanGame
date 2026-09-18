/**
 * The stat registry — the single place a stat is defined.
 *
 * Adding an eleventh stat should touch this file and the `StatKey` union, and
 * nothing else. See DESIGN.md §5 and §6.
 */

import type { Player, StatKey, Tier } from "./types.js";

export interface StatDef {
  readonly key: StatKey;
  /** Shown on the plaque. */
  readonly label: string;
  readonly tier: Tier;
  /**
   * Matched on tie-exclusion alone, with no band, because the whole range is
   * a handful of values. Band-exempt stats are barred from the opening rounds
   * (see ramp.ts) so a rare one can't end a run during the easy phase.
   */
  readonly bandExempt?: boolean;
  /** Can still move between deck refreshes, so it needs a wider floor. */
  readonly volatile?: boolean;
  /** Returns undefined when the player has no figure for this stat. */
  get(player: Player, now: Date): number | undefined;
  format(value: number): string;
  /** Small print under the number — the fee's year, the follower snapshot date. */
  qualifier?(player: Player): string | undefined;
}

const int = (v: number): string => Math.round(v).toLocaleString("en-GB");

/** Whole years at `now`. Deliberately reference-dated so runs stay reproducible. */
export function ageAt(dob: string, now: Date): number | undefined {
  const born = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return undefined;
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : undefined;
}

export const STATS: Readonly<Record<StatKey, StatDef>> = {
  club_goals: {
    key: "club_goals",
    label: "Club goals",
    tier: "basic",
    get: (p) => p.stats.club_goals,
    format: int,
  },
  caps: {
    key: "caps",
    label: "Caps",
    tier: "basic",
    get: (p) => p.stats.caps,
    format: int,
  },
  apps: {
    key: "apps",
    label: "Club appearances",
    tier: "basic",
    get: (p) => p.stats.apps,
    format: int,
  },
  ig: {
    key: "ig",
    label: "Instagram followers",
    tier: "basic",
    volatile: true,
    get: (p) => p.stats.ig?.value,
    format: (v) => (v >= 10 ? `${Math.round(v)}m` : `${Number(v.toFixed(1))}m`),
    qualifier: (p) => p.stats.ig?.asOf,
  },
  fee: {
    key: "fee",
    label: "Highest transfer fee",
    tier: "uncommon",
    get: (p) => p.stats.fee?.value,
    format: (v) => `€${Number.isInteger(v) ? v : Number(v.toFixed(1))}m`,
    qualifier: (p) => (p.stats.fee ? String(p.stats.fee.year) : undefined),
  },
  igoals: {
    key: "igoals",
    label: "International goals",
    tier: "uncommon",
    get: (p) => p.stats.igoals,
    format: int,
  },
  ct: {
    key: "ct",
    label: "Club trophies",
    tier: "rare",
    get: (p) => p.stats.ct,
    format: int,
  },
  it: {
    key: "it",
    label: "International trophies",
    tier: "rare",
    bandExempt: true,
    get: (p) => p.stats.it,
    format: int,
  },
  clubs: {
    key: "clubs",
    label: "Clubs played for",
    tier: "rare",
    bandExempt: true,
    get: (p) => p.stats.clubs,
    format: int,
  },
  age: {
    key: "age",
    label: "Age",
    tier: "rare",
    bandExempt: true,
    get: (p, now) => (p.deceased === true ? undefined : ageAt(p.dob, now)),
    format: int,
  },
};

export const STAT_KEYS: readonly StatKey[] = Object.keys(STATS) as StatKey[];

/**
 * Share of spins per tier. Divided across each tier's members, never applied
 * per stat — with 4 basic and 2 uncommon, a naive per-stat weighting would
 * give basic twice uncommon's share. This was a real bug in the prototype.
 */
export const TIER_WEIGHT: Readonly<Record<Tier, number>> = {
  basic: 70,
  uncommon: 22,
  rare: 8,
};

/**
 * Stats that move together. The wheel must not switch directly between a pair,
 * because winning on one usually means winning on the other, which kills the
 * dissonance the stat switch exists to create.
 *
 * **Driven by viability.md's correlation report, not by intuition.** The first
 * version of this list paired caps with international goals and club goals with
 * appearances; the report showed the real pairs run the other way — goals
 * correlate with goals, appearances with appearances. Re-read the report after
 * every substantial deck change and update this list to match.
 */
export const CORRELATED_PAIRS: ReadonlyArray<readonly [StatKey, StatKey]> = [
  ["club_goals", "igoals"],
  ["caps", "apps"],
];

export function areCorrelated(a: StatKey, b: StatKey): boolean {
  return CORRELATED_PAIRS.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}
