/**
 * Which stats a player can be asked about.
 *
 * Two rules today, both from DESIGN.md §5:
 *   - goalkeepers are excluded from club goals and international goals;
 *   - age is unavailable for deceased players.
 *
 * Everything else is simply "is there a figure for it". Note that **zero is a
 * legitimate value** for international goals, club trophies and international
 * trophies — absence is expressed by the key being missing, never by a 0.
 */

import { STATS, STAT_KEYS } from "./stats.js";
import type { Player, StatKey } from "./types.js";

/** Stats a goalkeeper is never asked about. */
const GK_EXCLUDED: ReadonlySet<StatKey> = new Set<StatKey>(["club_goals", "igoals"]);

export function isEligible(player: Player, key: StatKey, now: Date): boolean {
  if (player.position === "GK" && GK_EXCLUDED.has(key)) return false;
  const value = STATS[key].get(player, now);
  return value !== undefined && Number.isFinite(value);
}

export function eligibleStats(player: Player, now: Date): StatKey[] {
  return STAT_KEYS.filter((key) => isEligible(player, key, now));
}

/**
 * Precomputed map of player id → eligible stats.
 *
 * Built once per run rather than recomputed per round. The build pipeline
 * emits the same shape so the Worker doesn't pay for it at request time.
 */
export type EligibilityMap = ReadonlyMap<string, ReadonlySet<StatKey>>;

export function buildEligibilityMap(deck: readonly Player[], now: Date): EligibilityMap {
  const map = new Map<string, ReadonlySet<StatKey>>();
  for (const player of deck) {
    map.set(player.id, new Set(eligibleStats(player, now)));
  }
  return map;
}
