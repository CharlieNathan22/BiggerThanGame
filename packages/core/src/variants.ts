/**
 * Endless variants: the same game as Endless — the clock, one life, the round
 * protocol, challenge links, the streak titles — over a different pool or
 * question. DESIGN.md §3.
 *
 * General Endless is the first variant: the whole deck, every stat, the wheel,
 * and the boards. Its settings here are the mode's own (`BAND_SCHEDULES`,
 * `PAIR_RULES`), so naming it changes nothing about a run — its golden
 * fingerprint holds that. Instagram Endless is the second: players with an
 * Instagram figure, followers on every question, its own bands, no boards.
 *
 * The id is the variant's name everywhere it shows: the device's stores
 * (`bt:best:legends:endless-instagram`), the analytics `mode` column, the log
 * lines.
 */

import { INSTAGRAM_SCHEDULE, PAIR_RULES, BAND_SCHEDULES } from "./ramp.js";
import type { BandRow, BandRules, PairRules } from "./ramp.js";
import type { Player, StatKey } from "./types.js";

export type EndlessVariantId = "endless" | "endless-instagram";

/** A variant other than general Endless: what a request or token names when it names one. */
export type NamedVariant = Exclude<EndlessVariantId, "endless">;

/** How a run of the variant is played. Only `endless`; "Clear the squad" adds its own. */
export type VariantFormat = "endless";

export interface EndlessVariant extends BandRules {
  readonly id: EndlessVariantId;
  /** Which players can appear; null for the whole deck. */
  readonly pool: ((player: Player) => boolean) | null;
  /** The stat every question asks; null for the wheel. */
  readonly stat: StatKey | null;
  readonly schedule: readonly BandRow[];
  readonly pairRules: PairRules | null;
  /** Whether a volatile stat also gets the general volatility floor (`VOLATILE_FLOOR`). */
  readonly volatileFloor: boolean;
  readonly format: VariantFormat;
  /** Whether its runs can be published to leaderboards. */
  readonly boards: boolean;
  /**
   * What the run's seed is derived under: `HMAC(RUN_SECRET, seedDomain + runId)`
   * (the Worker's seed.ts). Different per variant, so two variants' runs can
   * never share a sequence.
   */
  readonly seedDomain: string;
}

export const ENDLESS_VARIANTS: Readonly<Record<EndlessVariantId, EndlessVariant>> = {
  endless: {
    id: "endless",
    pool: null,
    stat: null,
    schedule: BAND_SCHEDULES.endless,
    pairRules: PAIR_RULES.endless,
    volatileFloor: true,
    format: "endless",
    boards: true,
    seedDomain: "endless:",
  },
  "endless-instagram": {
    id: "endless-instagram",
    pool: (player) => player.stats.ig !== undefined,
    stat: "ig",
    schedule: INSTAGRAM_SCHEDULE,
    pairRules: null,
    // Its schedule carries its own closeness floor, row by row (ramp.ts).
    volatileFloor: false,
    format: "endless",
    boards: false,
    seedDomain: "endless:instagram:",
  },
};

export const ENDLESS_VARIANT_IDS = Object.keys(ENDLESS_VARIANTS) as EndlessVariantId[];

/** General Endless: what a run, request or token without a variant is. */
export const DEFAULT_VARIANT: EndlessVariantId = "endless";

export function isEndlessVariantId(value: unknown): value is EndlessVariantId {
  return typeof value === "string" && Object.hasOwn(ENDLESS_VARIANTS, value);
}

/** Whether `value` names a variant other than general Endless. */
export function isNamedVariant(value: unknown): value is NamedVariant {
  return isEndlessVariantId(value) && value !== DEFAULT_VARIANT;
}

/** What a request or token says about its variant: absent means general Endless. */
export function variantOf(named: NamedVariant | undefined): EndlessVariantId {
  return named ?? DEFAULT_VARIANT;
}

/** Whether the variant's questions come from the wheel: false when it fixes the stat. */
export function hasWheel(variant: EndlessVariantId): boolean {
  return ENDLESS_VARIANTS[variant].stat === null;
}

/** Memoised per deck array, so the percentile tables (keyed on the array) are built once. */
const pools = new WeakMap<readonly Player[], Map<EndlessVariantId, readonly Player[]>>();

/** The players a run of `variant` can deal: the deck itself when it has no pool filter. */
export function variantDeck(deck: readonly Player[], variant: EndlessVariant): readonly Player[] {
  const { pool } = variant;
  if (pool === null) return deck;
  let byVariant = pools.get(deck);
  if (byVariant === undefined) {
    byVariant = new Map();
    pools.set(deck, byVariant);
  }
  const hit = byVariant.get(variant.id);
  if (hit !== undefined) return hit;
  const filtered = deck.filter(pool);
  byVariant.set(variant.id, filtered);
  return filtered;
}
