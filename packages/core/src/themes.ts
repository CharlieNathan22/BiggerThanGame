/**
 * Themes for "Clear the squad" (DESIGN.md §3): a club, a league or an era, and
 * the deck's players in it. They come from the deck itself — a player's
 * `mainClubs` (loans count, as the data records them), `leagues` and `era` —
 * so a theme appears on its own once it has `THEME_MIN_PLAYERS`, and nothing
 * here names a club. Each decade from the 1990s is an era of its own; the
 * 1980s and every decade before share one, the Classic Era (`eraTheme`).
 *
 * Pure, and memoised per deck array: the deck build writes the list for the
 * site's pages (`themes.json`), and the Worker derives the same list from the
 * deck it bundles, so the two can't disagree.
 */

import type { Player } from "./types.js";

/** The fewest players a theme needs for a mode of its own. */
export const THEME_MIN_PLAYERS = 10;

/** The era the 1980s and every decade before them share. */
export const CLASSIC_ERA = "Classic Era";

/** The first decade with an era of its own; every earlier one is the Classic Era. */
export const FIRST_OWN_ERA = 1990;

/**
 * The era theme a player's `era` falls in: the decade itself ("2000s"), or the
 * Classic Era for the 1980s and before.
 */
export function eraTheme(era: string): string {
  const decade = /^(\d{4})s$/.exec(era);
  return decade !== null && Number(decade[1]) < FIRST_OWN_ERA ? CLASSIC_ERA : era;
}

export type ThemeType = "club" | "league" | "era";

/** In the order the Legends page lists them. */
export const THEME_TYPES: readonly ThemeType[] = ["club", "league", "era"];

export interface SquadTheme {
  /** `club-barcelona`, `league-premier-league`, `era-2000s`: the type, then the slug. */
  readonly id: string;
  readonly type: ThemeType;
  /** As the deck spells it: "Barcelona", "Premier League", "2000s". */
  readonly name: string;
  /** The name, lower-cased, everything but letters and digits run into `-`. */
  readonly slug: string;
  /** How many of the deck's players are in it. */
  readonly players: number;
}

/** `Real Madrid` → `real-madrid`, `Ligue 1` → `ligue-1`, `Atlético` → `atletico`. */
export function themeSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** What a theme draws on in a player: their main clubs, leagues, or the era of their peak. */
function namesOf(player: Player, type: ThemeType): readonly string[] {
  switch (type) {
    case "club":
      return player.mainClubs ?? [];
    case "league":
      return player.leagues ?? [];
    case "era":
      return player.era === undefined ? [] : [eraTheme(player.era)];
  }
}

/** Whether `player` is in `theme`'s squad. */
export function inTheme(player: Player, theme: Pick<SquadTheme, "type" | "name">): boolean {
  return namesOf(player, theme.type).includes(theme.name);
}

const memo = new WeakMap<readonly Player[], Map<number, readonly SquadTheme[]>>();

/**
 * Every theme with at least `min` players: clubs, then leagues, then eras, each
 * biggest first (then by name). A player counts once per theme however the data
 * repeats a name.
 */
export function squadThemes(
  deck: readonly Player[],
  min: number = THEME_MIN_PLAYERS,
): readonly SquadTheme[] {
  let byMin = memo.get(deck);
  if (byMin === undefined) {
    byMin = new Map();
    memo.set(deck, byMin);
  }
  const hit = byMin.get(min);
  if (hit !== undefined) return hit;

  const out: SquadTheme[] = [];
  for (const type of THEME_TYPES) {
    const counts = new Map<string, number>();
    for (const player of deck) {
      for (const name of new Set(namesOf(player, type))) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    const themes = [...counts]
      .filter(([name, players]) => players >= min && themeSlug(name) !== "")
      .map(([name, players]) => {
        const slug = themeSlug(name);
        return { id: `${type}-${slug}`, type, name, slug, players };
      })
      .sort((a, b) => b.players - a.players || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    out.push(...themes);
  }
  byMin.set(min, out);
  return out;
}

/** The theme named by `id` in this deck, if it qualifies. */
export function themeById(deck: readonly Player[], id: string): SquadTheme | undefined {
  return squadThemes(deck).find((theme) => theme.id === id);
}

/** Each type's folder under the Legends page. */
export const THEME_FOLDERS: Readonly<Record<ThemeType, string>> = {
  club: "clubs",
  league: "leagues",
  era: "eras",
};

/** The Legends page, the root of every theme's page. */
export const LEGENDS_ROOT = "/football-higher-or-lower/legends";

/** `/football-higher-or-lower/legends/clubs/real-madrid`: the theme's game page. */
export function themePath(theme: Pick<SquadTheme, "type" | "slug">): string {
  return `${LEGENDS_ROOT}/${THEME_FOLDERS[theme.type]}/${theme.slug}`;
}
