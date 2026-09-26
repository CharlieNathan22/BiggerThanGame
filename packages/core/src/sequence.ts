/**
 * Deterministic run construction.
 *
 * Same seed, same mode, same deck, same reference date → identical rounds, in
 * every runtime. This is the property Daily Ranked rests on, and the one the Worker
 * relies on to re-derive a round and verify a guess without storing it.
 *
 * Replay is from round one every time. That is O(n) per lookup, but n is a few
 * dozen and the work is microseconds, so the server recomputes rather than
 * keeping per-round state.
 */

import { createRng } from "./prng.js";
import type { Rng } from "./prng.js";
import { isEligible } from "./eligibility.js";
import { candidates, remember, selectChallenger } from "./engine.js";
import { bandFor } from "./ramp.js";
import { STATS, STAT_KEYS } from "./stats.js";
import { chooseStat, nextDwell, weightedPick } from "./wheel.js";
import type { Mode, Player, Round, StatKey, Tier } from "./types.js";

export interface RunOptions {
  readonly deck: readonly Player[];
  readonly seed: string;
  /** Sets how many opening rounds prefer iconic challengers (`ICONIC_ROUNDS`). */
  readonly mode: Mode;
  /** Reference date — age is derived from it, so it must be fixed per run. */
  readonly now: Date;
  /** Hard cap on rounds generated. Defaults to `MAX_ROUNDS`. */
  readonly maxRounds?: number;
}

/** Default cap on a run's length. A run that reaches it has exhausted the deck. */
export const MAX_ROUNDS = 60;

/**
 * How many rounds the opening stat holds. Fixed, unlike every later stat's
 * 2–5: the first switch always comes at round 3, so every player who gets two
 * right sees the stat change — the mechanic the game is built on. Holding the
 * opening stat longer also crowded rare stats into the later rounds, since
 * they never open a run. DESIGN.md §7.
 */
export const OPENING_DWELL = 2;

/**
 * For rounds 1..N of a run, the challenger is drawn from iconic players
 * whenever one can be dealt within the round's band. When none can, the whole
 * deck is used before any other relaxation (engine.ts). Friendly is the mode a
 * newcomer meets through a shared link, so it holds the preference longest.
 *
 * Changing a value changes every run of that mode — and every golden
 * fingerprint for it.
 */
export const ICONIC_ROUNDS: Readonly<Record<Mode, number>> = {
  friendly: 10,
  endless: 5,
  ranked: 5,
};

/**
 * Tiers a run may open on. Rare stats never open a run: the first question a
 * newcomer sees should be one they can read at a glance. The opening stat is
 * otherwise drawn by the wheel's own tier weights, so it doesn't skew the mix —
 * it holds for roughly half of all rounds played. DESIGN.md §7.
 */
const OPENING_TIERS: ReadonlySet<Tier> = new Set<Tier>(["basic", "uncommon"]);

/**
 * Most people who open the link play one run and never come back, so round one
 * is curated rather than random: a recognisable name and a question they can
 * answer. The `iconic` flag marks the names recognisable enough to open on.
 *
 * Drawn with the run's PRNG from every iconic player who can actually be dealt
 * a round-one pair, so different seeds open on different names. Falls back to
 * any dealable player only when no iconic one is.
 */
function openingAnchor(
  deck: readonly Player[],
  stat: StatKey,
  now: Date,
  rng: Rng,
): Player | undefined {
  const band = bandFor(stat, 1);
  const dealable = deck.filter(
    (p) =>
      isEligible(p, stat, now) && candidates(p, stat, band, { deck, now, seen: [] }).length > 0,
  );
  const famous = dealable.filter((p) => p.iconic === true);
  return rng.pick(famous.length > 0 ? famous : dealable);
}

export function buildRun(opts: RunOptions): Round[] {
  const { deck, seed, now } = opts;
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS;
  const iconicRounds = ICONIC_ROUNDS[opts.mode];
  const rng = createRng(seed);

  let stat: StatKey | undefined;
  let anchor: Player | undefined;

  // Opening round: a weighted draw over the opening tiers, then a curated
  // anchor. A stat no player can open on is dropped and the draw repeated.
  let openers = STAT_KEYS.filter((key) => OPENING_TIERS.has(STATS[key].tier));
  while (openers.length > 0) {
    const candidateStat = weightedPick(openers, rng)!;
    const pick = openingAnchor(deck, candidateStat, now, rng);
    if (pick !== undefined) {
      stat = candidateStat;
      anchor = pick;
      break;
    }
    openers = openers.filter((key) => key !== candidateStat);
  }

  if (stat === undefined || anchor === undefined) return [];

  const rounds: Round[] = [];
  let seen: string[] = [];
  let dwell = OPENING_DWELL;
  let heldFor = 0;

  for (let index = 1; index <= maxRounds; index++) {
    const previousStat = stat;

    if (heldFor >= dwell && index > 1) {
      const viable = STAT_KEYS.filter((key) => {
        if (!isEligible(anchor as Player, key, now)) return false;
        return (
          candidates(anchor as Player, key, bandFor(key, index), { deck, now, seen }).length > 0
        );
      });
      const next = chooseStat({ current: stat, viable, rng });
      if (next !== undefined) {
        stat = next;
        dwell = nextDwell(rng);
        heldFor = 0;
      }
    }

    const preferIconic = index <= iconicRounds;
    const match = selectChallenger(anchor, stat, index, { deck, now, seen }, rng, preferIconic);
    if (match === undefined) break;

    rounds.push({
      index,
      stat,
      anchor,
      challenger: match.challenger,
      band: match.band,
      relaxation: match.relaxation,
      statChanged: index > 1 && stat !== previousStat,
    });

    seen = remember(seen, anchor.id);
    anchor = match.challenger;
    heldFor += 1;
  }

  return rounds;
}

/** One round, without materialising the whole run for the caller. */
export function roundAt(opts: RunOptions, index: number): Round | undefined {
  const rounds = buildRun({ ...opts, maxRounds: Math.max(index, 1) });
  return rounds[index - 1];
}

/** Convenience for display code. */
export function labelFor(stat: StatKey): string {
  return STATS[stat].label;
}
