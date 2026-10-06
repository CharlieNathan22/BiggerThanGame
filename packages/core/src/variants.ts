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
 * "Clear the squad" is a family of them, one per theme (themes.ts): a club, a
 * league or an era's players, each dealt once, every stat in play, bands that
 * ramp by progress through the squad, no boards. Its ids are `squad:<theme
 * id>` (`squad:club-barcelona`), and its config is built from the deck that
 * has the theme (`resolveVariant`), since which themes exist is the deck's
 * business.
 *
 * The id is the variant's name everywhere it shows: the device's stores
 * (`bt:best:legends:endless-instagram`, `bt:best:legends:squad:club-barcelona`)
 * and the log lines.
 */

import {
  BAND_SCHEDULES,
  INSTAGRAM_SCHEDULE,
  PAIR_RULES,
  SQUAD_PAIR_RULES,
  squadSchedule,
} from "./ramp.js";
import type { BandRow, BandRules, PairRules } from "./ramp.js";
import { STATS } from "./stats.js";
import { inTheme, themeById } from "./themes.js";
import type { SquadTheme } from "./themes.js";
import type { Player, StatKey } from "./types.js";

/** The variants with a fixed config: general Endless and Instagram Endless. */
export type StaticVariantId = "endless" | "endless-instagram";

/** A "Clear the squad" theme's variant: `squad:club-barcelona`. */
export type SquadVariantId = `squad:${string}`;

export type EndlessVariantId = StaticVariantId | SquadVariantId;

/** A variant other than general Endless: what a request or token names when it names one. */
export type NamedVariant = Exclude<EndlessVariantId, "endless">;

/**
 * How a run of the variant is played: `endless`, a streak with no finish line;
 * or `squad`, every player in the pool dealt once, and answering them all wins.
 */
export type VariantFormat = "endless" | "squad";

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
  /** How many opening rounds prefer iconic challengers, when not the mode's (`ICONIC_ROUNDS`). */
  readonly iconicRounds?: number;
  /** "Clear the squad": the theme. Its `questions` (squad size − 1) are in `BandRules`. */
  readonly theme?: SquadTheme;
}

export const ENDLESS_VARIANTS: Readonly<Record<StaticVariantId, EndlessVariant>> = {
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

export const ENDLESS_VARIANT_IDS = Object.keys(ENDLESS_VARIANTS) as StaticVariantId[];

/** General Endless: what a run, request or token without a variant is. */
export const DEFAULT_VARIANT: EndlessVariantId = "endless";

/** `squad:` and a theme id: lower-case letters and digits in dash-separated runs. */
const SQUAD_ID = /^squad:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SQUAD_ID_MAX = 80;

export function isStaticVariantId(value: unknown): value is StaticVariantId {
  return typeof value === "string" && Object.hasOwn(ENDLESS_VARIANTS, value);
}

/** Whether `value` is shaped like a squad variant's id. Says nothing about the deck. */
export function isSquadVariantId(value: unknown): value is SquadVariantId {
  return typeof value === "string" && value.length <= SQUAD_ID_MAX && SQUAD_ID.test(value);
}

/**
 * Whether `value` is shaped like a variant id. A squad id's theme is only known
 * to exist once `resolveVariant` finds it in the deck.
 */
export function isEndlessVariantId(value: unknown): value is EndlessVariantId {
  return isStaticVariantId(value) || isSquadVariantId(value);
}

/** Whether `value` names a variant other than general Endless. */
export function isNamedVariant(value: unknown): value is NamedVariant {
  return isEndlessVariantId(value) && value !== DEFAULT_VARIANT;
}

/** What a request or token says about its variant: absent means general Endless. */
export function variantOf(named: NamedVariant | undefined): EndlessVariantId {
  return named ?? DEFAULT_VARIANT;
}

/** The variant of a theme: `squad:club-barcelona`. */
export function squadVariantId(theme: Pick<SquadTheme, "id">): SquadVariantId {
  return `squad:${theme.id}`;
}

/** The theme id a squad variant names: `club-barcelona`. */
export function themeIdOf(variant: SquadVariantId): string {
  return variant.slice("squad:".length);
}

/** The variant's format, from its id alone. */
export function formatOf(variant: EndlessVariantId): VariantFormat {
  return isSquadVariantId(variant) ? "squad" : ENDLESS_VARIANTS[variant].format;
}

/** Whether the variant's questions come from the wheel: false when it fixes the stat. */
export function hasWheel(variant: EndlessVariantId): boolean {
  return isSquadVariantId(variant) || ENDLESS_VARIANTS[variant].stat === null;
}

/** Whether the variant's runs can be published: general Endless's alone, for now. */
export function hasBoards(variant: EndlessVariantId): boolean {
  return !isSquadVariantId(variant) && ENDLESS_VARIANTS[variant].boards;
}

/** What a run's seed is derived under (see `EndlessVariant.seedDomain`), from its id alone. */
export function seedDomainOf(variant: EndlessVariantId): string {
  return isSquadVariantId(variant) ? `${variant}:` : ENDLESS_VARIANTS[variant].seedDomain;
}

/** How many opening rounds of a squad run prefer iconic challengers. */
export const SQUAD_ICONIC_ROUNDS = 3;

const squads = new WeakMap<readonly Player[], Map<string, EndlessVariant | null>>();

/**
 * The variant's config: a static one, or a squad built from the theme `deck`
 * has. Undefined when the deck has no such theme (or it no longer qualifies).
 */
export function resolveVariant(
  variant: EndlessVariantId,
  deck: readonly Player[],
): EndlessVariant | undefined {
  if (!isSquadVariantId(variant)) return ENDLESS_VARIANTS[variant];
  let byId = squads.get(deck);
  if (byId === undefined) {
    byId = new Map();
    squads.set(deck, byId);
  }
  const hit = byId.get(variant);
  if (hit !== undefined) return hit ?? undefined;
  const theme = themeById(deck, themeIdOf(variant));
  const built = theme === undefined ? null : squadVariant(theme);
  byId.set(variant, built);
  return built ?? undefined;
}

/** "Clear the squad" for one theme. */
function squadVariant(theme: SquadTheme): EndlessVariant {
  const id = squadVariantId(theme);
  return {
    id,
    pool: (player) => inTheme(player, theme),
    stat: null,
    schedule: squadSchedule(theme.players),
    pairRules: SQUAD_PAIR_RULES,
    volatileFloor: true,
    format: "squad",
    boards: false,
    seedDomain: seedDomainOf(id),
    iconicRounds: SQUAD_ICONIC_ROUNDS,
    questions: squadQuestions(theme.players),
    theme,
  };
}

/** A squad run's questions: one fewer than its players, since the first anchor isn't asked. */
export function squadQuestions(players: number): number {
  return Math.max(players - 1, 1);
}

/**
 * A stat's label in a variant. In "Clear the squad" club goals reads "Total
 * career club goals": the figure is the player's whole club career, and a
 * Barcelona squad would otherwise read it as goals for Barcelona. The plaque,
 * the wheel, the reveal and the round payload all take the label from here.
 */
export function statLabel(stat: StatKey, variant?: EndlessVariantId): string {
  if (stat === "club_goals" && variant !== undefined && isSquadVariantId(variant)) {
    return "Total career club goals";
  }
  return STATS[stat].label;
}

/** The line under the plaque that says what a squad's club goals count, or undefined. */
export function squadNote(
  stat: StatKey,
  theme: Pick<SquadTheme, "type" | "name"> | undefined,
): string | undefined {
  if (stat !== "club_goals" || theme === undefined) return undefined;
  switch (theme.type) {
    case "club":
      return `Whole career, not just ${theme.name}`;
    case "league":
      return "Whole career, every league";
    case "era":
      return `Whole career, not just the ${theme.name}`;
  }
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
