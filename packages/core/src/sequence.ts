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
import type { Match, MatchContext } from "./engine.js";
import { RELAXATION_LADDERS, bandFor, pairFits, percentiles, relaxations } from "./ramp.js";
import type { BandRules } from "./ramp.js";
import { STATS, STAT_KEYS } from "./stats.js";
import { resolveVariant, variantDeck } from "./variants.js";
import type { EndlessVariant, EndlessVariantId } from "./variants.js";
import { chooseStat, nextDwell, weightedPick } from "./wheel.js";
import type { Mode, Player, Round, StatKey, Tier } from "./types.js";

export interface RunOptions {
  readonly deck: readonly Player[];
  readonly seed: string;
  /** Sets how many opening rounds prefer iconic challengers (`ICONIC_ROUNDS`). */
  readonly mode: Mode;
  /** Reference date — age is derived from it, so it must be fixed per run. */
  readonly now: Date;
  /** Hard cap on rounds generated. Defaults to the mode's `roundCap`. */
  readonly maxRounds?: number;
  /**
   * Endless only: the variant being played (variants.ts) — its pool, its fixed
   * stat, its bands, or a "Clear the squad" theme of `deck`'s. General Endless
   * when absent, and naming it changes nothing.
   */
  readonly variant?: EndlessVariantId;
  /**
   * Twitch Mode (stream.ts) only: the band rules a match is dealt by, in place
   * of its pool's — its own schedule and pair rules, whose rows are fractions
   * of the match's `questions` (which also cap it). The pool, its fixed stat
   * and a squad's no-repeat rule are the variant's as ever. Absent, as in
   * every other mode, it changes nothing.
   */
  readonly bands?: BandRules;
}

/**
 * The most rounds a run of each mode can deal. Friendly's is its win target
 * (`WIN_ROUNDS`); in the modes with no finish line a run that reaches its cap
 * has exhausted the deck (`deck-exhausted`). Endless's is set well past where
 * any run ends — simulation.md shows how many get near it.
 */
export const MAX_ROUNDS: Readonly<Record<Mode, number>> = {
  friendly: 20,
  endless: 150,
  // Daily Ranked's twenty questions and its bonus rounds, to Endless's cap.
  ranked: 150,
};

/** The highest round any mode can deal: the bound on a round number in any request. */
export const MAX_ANY_ROUND = Math.max(...Object.values(MAX_ROUNDS));

/**
 * How the wheel decides a stat is **viable** — that it may switch to it — per
 * mode (DESIGN.md §7):
 *
 * - `band`: a challenger can be dealt within the round's own band, unrelaxed.
 *   A stat with nothing in the band is skipped for that switch.
 * - `any`: a challenger can be dealt at all, at any step of the relaxation
 *   ladder, the recently-seen queue included. The wheel never skips a stat
 *   that can be played; Endless's pair rules (ramp.ts) keep what it then deals
 *   hard rather than letting it relax to an easy pair.
 *
 * Changing a value changes every run of that mode.
 */
export const WHEEL_VIABILITY: Readonly<Record<Mode, "band" | "any">> = {
  friendly: "band",
  endless: "any",
  ranked: "any",
};

/**
 * Rounds that win a run, per mode: answer this many correctly and the run ends,
 * won. Null for a mode with no finish line, which runs until a miss or
 * `MAX_ROUNDS`. Friendly is a 20-question challenge (DESIGN.md §3).
 */
export const WIN_ROUNDS: Readonly<Record<Mode, number | null>> = {
  friendly: 20,
  endless: null,
  ranked: null,
};

/** Whether `round` is `mode`'s final question: the last round of its win target. */
export function isFinalRound(round: number, mode: Mode): boolean {
  return WIN_ROUNDS[mode] === round;
}

/** The most rounds a run of `mode` can deal: its win target, or its `MAX_ROUNDS`. */
export function roundCap(mode: Mode): number {
  return WIN_ROUNDS[mode] ?? MAX_ROUNDS[mode];
}

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
 * deck is used before any other relaxation (engine.ts). Friendly's window
 * matches its opening band (rounds 1–5, `BAND_SCHEDULES`).
 *
 * Changing a value changes every run of that mode — and every golden
 * fingerprint for it.
 */
export const ICONIC_ROUNDS: Readonly<Record<Mode, number>> = {
  friendly: 5,
  endless: 5,
  ranked: 3,
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
  base: MatchContext,
  stat: StatKey,
  mode: Mode,
  rng: Rng,
  variant?: EndlessVariant,
): Player | undefined {
  const band = bandFor(stat, 1, mode, variant);
  const ctx = { ...base, seen: [] };
  const dealable = (base.pool ?? base.deck).filter(
    (p) => isEligible(p, stat, base.now) && candidates(p, stat, band, ctx).length > 0,
  );
  const famous = dealable.filter((p) => p.iconic === true);
  return rng.pick(famous.length > 0 ? famous : dealable);
}

export function buildRun(opts: RunOptions): Round[] {
  const { seed, mode, now } = opts;
  const variant = runVariant(opts);
  // "Clear the squad" deals each of its squad once, measuring distance on the whole deck.
  const squad = variant?.format === "squad" ? variantDeck(opts.deck, variant) : undefined;
  // Any other variant's pool is the deck its runs see: rank distance is measured within it too.
  const deck =
    variant === undefined || squad !== undefined ? opts.deck : variantDeck(opts.deck, variant);
  // A variant that fixes the stat has no wheel: no opening draw, no switch.
  const fixed = variant?.stat ?? null;
  const maxRounds = Math.min(
    opts.maxRounds ?? Infinity,
    roundCap(mode),
    variant?.questions ?? Infinity,
  );
  const iconicRounds = variant?.iconicRounds ?? ICONIC_ROUNDS[mode];
  const rng = createRng(seed);
  const links =
    squad === undefined || variant === undefined
      ? undefined
      : squadLinks(squad, opts.deck, mode, now, variant);
  /** What every pick works from: the squad's pool and its no-repeat rule, if it is one. */
  const context = (seen: readonly string[]): MatchContext =>
    squad === undefined || links === undefined
      ? { deck, now, seen }
      : { deck, now, seen, pool: squad, unique: true, ...links.prefer(seen) };

  let stat: StatKey | undefined;
  let anchor: Player | undefined;

  if (fixed !== null) {
    const pick = openingAnchor(context([]), fixed, mode, rng, variant);
    if (pick !== undefined) {
      stat = fixed;
      anchor = pick;
    }
  }

  // Opening round: a weighted draw over the opening tiers, then a curated
  // anchor. A stat no player can open on is dropped and the draw repeated.
  let openers = fixed !== null ? [] : STAT_KEYS.filter((key) => OPENING_TIERS.has(STATS[key].tier));
  while (openers.length > 0) {
    const candidateStat = weightedPick(openers, rng)!;
    const pick = openingAnchor(context([]), candidateStat, mode, rng, variant);
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

    // Who has been dealt, the anchor on screen included: a squad never brings one back.
    const ctx = context(squad === undefined ? seen : [anchor.id, ...seen]);

    // A squad also switches early when the held stat can't be dealt within the
    // round's own band but another can: as the squad runs short, holding on
    // would mean widening the band to whoever is left, an easy pair.
    const dwelt = heldFor >= dwell;
    const early =
      squad !== undefined &&
      !dwelt &&
      index > 1 &&
      !inBand(anchor, stat, index, mode, ctx, variant);
    /**
     * The stats the wheel may fall back to for `current`: any that can be dealt
     * at all. A squad's prefer those that can be dealt keeping their own floors
     * (followers 2× apart); only when none can does a floor give way (§10).
     */
    const fallback = (current: Player): StatKey[] => {
      const dealable = STAT_KEYS.filter((key) => isViable(current, key, index, mode, ctx, variant));
      if (squad === undefined) return dealable;
      const kept = dealable.filter((key) => keepsFloor(current, key, index, mode, ctx, variant));
      return kept.length > 0 ? kept : dealable;
    };

    if (fixed === null && (dwelt || early) && index > 1) {
      const current = anchor;
      // A squad's wheel lands where the round's own band can be met if it can,
      // so the closing questions stay hard as the squad runs short.
      let viable =
        squad === undefined
          ? []
          : STAT_KEYS.filter((key) => inBand(current, key, index, mode, ctx, variant));
      if (viable.length === 0 && dwelt) viable = fallback(current);
      const next = chooseStat({ current: stat, viable, rng });
      if (next !== undefined) {
        stat = next;
        dwell = nextDwell(rng);
        heldFor = 0;
      }
    }

    const preferIconic = index <= iconicRounds;
    let match = selectChallenger(anchor, stat, index, mode, ctx, rng, preferIconic, variant);
    // The held stat can't be dealt to this anchor at all. Where the wheel
    // counts any dealable stat (Endless), switch rather than end the run: a
    // value rule never relaxes, so an anchor at the edge of a narrow stat's
    // values may have no partner on it.
    // A fixed stat never switches: with no partner left, the run ends. So does
    // a squad with nobody left who can be dealt: it counts as cleared.
    if (match === undefined && fixed === null && WHEEL_VIABILITY[mode] === "any") {
      const viable = fallback(anchor);
      const next = chooseStat({ current: stat, viable, rng });
      if (next !== undefined) {
        stat = next;
        dwell = nextDwell(rng);
        heldFor = 0;
        match = selectChallenger(anchor, stat, index, mode, ctx, rng, preferIconic, variant);
      }
    }
    // A squad's held stat could only be dealt by dropping its floor (followers
    // under 2× apart): every other stat that keeps its own is tried first, and
    // the floor gives way only when none can be dealt. Ties are never dealt.
    if (
      squad !== undefined &&
      match !== undefined &&
      droppedFloor(stat, match, index, mode, variant)
    ) {
      const current = anchor;
      const held = stat;
      const others = STAT_KEYS.filter(
        (key) => key !== held && keepsFloor(current, key, index, mode, ctx, variant),
      );
      const next = chooseStat({ current: held, viable: others, rng });
      if (next !== undefined) {
        stat = next;
        dwell = nextDwell(rng);
        heldFor = 0;
        match = selectChallenger(anchor, stat, index, mode, ctx, rng, preferIconic, variant);
      }
    }
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

    seen = squad === undefined ? remember(seen, anchor.id) : [anchor.id, ...seen];
    anchor = match.challenger;
    heldFor += 1;
  }

  return rounds;
}

/** The run's Endless variant, if it names one. Only Endless has variants. */
function runVariant(opts: RunOptions): EndlessVariant | undefined {
  if (opts.variant === undefined) return undefined;
  if (opts.mode !== "endless") throw new Error(`variant ${opts.variant} outside Endless`);
  const variant = resolveVariant(opts.variant, opts.deck);
  if (variant === undefined) throw new Error(`no theme for ${opts.variant} in this deck`);
  const { bands } = opts;
  if (bands === undefined) return variant;
  if (bands.questions === undefined) throw new Error(`bands for ${opts.variant} without questions`);
  return {
    ...variant,
    schedule: bands.schedule,
    pairRules: bands.pairRules,
    volatileFloor: bands.volatileFloor,
    questions: bands.questions,
  };
}

/** A number per band schedule, so a squad's memo can tell a match's rules from its own. */
const scheduleIds = new WeakMap<object, number>();
let nextScheduleId = 1;
function scheduleId(schedule: object): number {
  const known = scheduleIds.get(schedule);
  if (known !== undefined) return known;
  const id = nextScheduleId++;
  scheduleIds.set(schedule, id);
  return id;
}

/**
 * Whether a challenger for `stat` can be dealt at some step of the relaxation
 * ladder that keeps the band's volatility floor (`minRatio`, followers 2×
 * apart): every step but the last, for a stat that has one.
 */
function keepsFloor(
  anchor: Player,
  stat: StatKey,
  round: number,
  mode: Mode,
  ctx: MatchContext,
  variant?: EndlessVariant,
): boolean {
  if (!isEligible(anchor, stat, ctx.now)) return false;
  const band = bandFor(stat, round, mode, variant);
  return relaxations(band, RELAXATION_LADDERS[mode])
    .filter((step) => band.minRatio === undefined || step.minRatio !== undefined)
    .some((step) => candidates(anchor, stat, step, ctx).length > 0);
}

/** Whether `match` was dealt by dropping its stat's volatility floor, the ladder's last resort. */
function droppedFloor(
  stat: StatKey,
  match: Match,
  round: number,
  mode: Mode,
  variant?: EndlessVariant,
): boolean {
  return (
    bandFor(stat, round, mode, variant).minRatio !== undefined && match.band.minRatio === undefined
  );
}

/** Whether a challenger for `stat` can be dealt within the round's own band, unrelaxed. */
function inBand(
  anchor: Player,
  stat: StatKey,
  round: number,
  mode: Mode,
  ctx: MatchContext,
  variant?: EndlessVariant,
): boolean {
  if (!isEligible(anchor, stat, ctx.now)) return false;
  return candidates(anchor, stat, bandFor(stat, round, mode, variant), ctx).length > 0;
}

/**
 * Which of a squad's players could ever be paired: some stat both are eligible
 * for whose values fit its loosest band at the run's last question, where the
 * rules are strictest — so a link holds at every round. A player whose every
 * link is to someone already dealt can only be saved by dealing them now:
 * `prefer` names them, and the engine draws from them first when it can. With
 * more than one, someone is stranded, and the run ends cleared when it gets
 * there (simulation.md counts how often).
 */
interface SquadLinks {
  prefer(seen: readonly string[]): { prefer?: (player: Player) => boolean };
}

/** Per squad array and reference date: the same for every run of the theme that day. */
const linksMemo = new WeakMap<readonly Player[], Map<string, SquadLinks>>();

function squadLinks(
  squad: readonly Player[],
  deck: readonly Player[],
  mode: Mode,
  now: Date,
  variant: EndlessVariant,
): SquadLinks {
  let byKey = linksMemo.get(squad);
  if (byKey === undefined) {
    byKey = new Map();
    linksMemo.set(squad, byKey);
  }
  const key = `${variant.id}@${now.getTime()}#${variant.questions ?? 0}#${scheduleId(variant.schedule)}`;
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const built = buildLinks(squad, deck, mode, now, variant);
  byKey.set(key, built);
  return built;
}

function buildLinks(
  squad: readonly Player[],
  deck: readonly Player[],
  mode: Mode,
  now: Date,
  variant: EndlessVariant,
): SquadLinks {
  const n = squad.length;
  const linked = new Uint8Array(n * n);
  const last = variant.questions ?? 1;
  for (const stat of STAT_KEYS) {
    const band = bandFor(stat, last, mode, variant);
    const loosest = relaxations(band, RELAXATION_LADDERS[mode]).at(-1) ?? band;
    const table = percentiles(deck, stat, now);
    const values = squad.map((p) =>
      isEligible(p, stat, now) ? STATS[stat].get(p, now) : undefined,
    );
    for (let i = 0; i < n; i++) {
      const a = values[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < n; j++) {
        const b = values[j];
        if (b === undefined || linked[i * n + j] === 1) continue;
        if (pairFits(table, a, b, loosest)) {
          linked[i * n + j] = 1;
          linked[j * n + i] = 1;
        }
      }
    }
  }
  return {
    prefer(seen) {
      const used = new Set(seen);
      const open: number[] = [];
      for (let i = 0; i < n; i++) if (!used.has(squad[i]!.id)) open.push(i);
      const stranded = new Set<string>();
      for (const i of open) {
        if (!open.some((j) => j !== i && linked[i * n + j] === 1)) stranded.add(squad[i]!.id);
      }
      return stranded.size === 0 ? {} : { prefer: (player) => stranded.has(player.id) };
    },
  };
}

/**
 * Whether the wheel may switch to `stat` for this anchor at this round, by the
 * mode's `WHEEL_VIABILITY`: a challenger within the unrelaxed band, or a
 * challenger at all — the loosest step of the relaxation ladder with the
 * recently-seen queue ignored, the engine's last resort.
 */
export function isViable(
  anchor: Player,
  stat: StatKey,
  round: number,
  mode: Mode,
  ctx: MatchContext,
  variant?: EndlessVariant,
): boolean {
  if (!isEligible(anchor, stat, ctx.now)) return false;
  const band = bandFor(stat, round, mode, variant);
  if (WHEEL_VIABILITY[mode] === "band") return candidates(anchor, stat, band, ctx).length > 0;
  const loosest = relaxations(band, RELAXATION_LADDERS[mode]).at(-1) ?? band;
  return candidates(anchor, stat, loosest, ctx, true).length > 0;
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
