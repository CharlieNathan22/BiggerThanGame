/**
 * The "Clear the squad" themes, for their pages and the Legends page, read at
 * build time.
 *
 * `themes.json` is a deck build artifact: each theme's id, type, name, slug
 * and player count, and nothing else — no player id, no figure. It is read
 * with `fs` while the pages prerender and never imported, so nothing from
 * `packages/deck/dist` enters the module graph or the client bundle
 * (ARCHITECTURE.md §4, §6), as with `credits.json`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { THEME_FOLDERS, THEME_TYPES, squadVariantId } from "@bt/core";
import type { SquadVariantId, ThemeType } from "@bt/core";
import type { Theme } from "../game/variant";
import { themePagePath } from "./paths";

// `astro build` and `astro dev` run from apps/web.
const THEMES_PATH = resolve(process.cwd(), "../../packages/deck/dist/themes.json");

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The themes in `text`, checked field by field: a malformed file fails the build. */
export function parseThemes(text: string): Theme[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("themes.json: expected an array");
  return data.map((entry: unknown, i): Theme => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const { id, type, name, slug, players } = e;
    if (typeof type !== "string" || !(THEME_TYPES as readonly string[]).includes(type)) {
      throw new Error(`themes.json[${i}]: type must be club, league or era`);
    }
    if (typeof name !== "string" || name === "") throw new Error(`themes.json[${i}]: name missing`);
    if (typeof slug !== "string" || !SLUG.test(slug))
      throw new Error(`themes.json[${i}]: bad slug`);
    if (id !== `${type}-${slug}`) throw new Error(`themes.json[${i}]: id must be type-slug`);
    if (typeof players !== "number" || !Number.isInteger(players) || players < 2) {
      throw new Error(`themes.json[${i}]: players must be a count`);
    }
    return { id, type: type as ThemeType, name, slug, players };
  });
}

let cached: Theme[] | undefined;

/** Every theme the deck has, in the deck build's order: clubs, leagues, eras, biggest first. */
export function loadThemes(): Theme[] {
  if (cached !== undefined) return cached;
  let text: string;
  try {
    text = readFileSync(THEMES_PATH, "utf8");
  } catch {
    throw new Error(
      `themes.json not found at ${THEMES_PATH}. Build the deck first: pnpm --filter @bt/deck build --no-sim`,
    );
  }
  cached = parseThemes(text);
  return cached;
}

/** One theme's game page, and what its island plays. */
export interface ThemePage {
  readonly theme: Theme;
  readonly path: string;
  /** The folder under the Legends page: `clubs`, `leagues`, `eras`. */
  readonly kind: string;
  readonly variant: SquadVariantId;
}

export function themePages(themes: readonly Theme[] = loadThemes()): ThemePage[] {
  return themes.map((theme) => ({
    theme,
    path: themePagePath(theme),
    kind: THEME_FOLDERS[theme.type],
    variant: squadVariantId(theme),
  }));
}

/**
 * The themes with colours of their own, by id: tokens.css has, for each,
 * `--<id>-1` and `--<id>-2` (its two colours, for the edge and the hover
 * glow), `--<id>-rgb` (the glow's colour), and `--<id>-text-1` and
 * `--<id>-text-2` (the name's two tints, which read at AA on the card:
 * cards.test.ts). A club's are its own colours — colours only, never a crest,
 * badge or emblem; a league's and an era's, an accent of their own. A theme
 * that qualifies later without an entry here gets the gold card, and the build
 * says so (`themesWithoutColours`).
 */
export const THEME_COLOURS: ReadonlySet<string> = new Set([
  "club-barcelona",
  "club-ac-milan",
  "club-juventus",
  "club-real-madrid",
  "club-manchester-united",
  "club-inter",
  "club-chelsea",
  "club-bayern-munich",
  "league-la-liga",
  "league-premier-league",
  "league-serie-a",
  "league-ligue-1",
  "league-bundesliga",
  "era-1990s",
  "era-2000s",
  "era-2010s",
]);

/** The theme's colours, as the custom properties its card reads; none for the gold card. */
export function themeColours(theme: Pick<Theme, "id">): string | undefined {
  if (!THEME_COLOURS.has(theme.id)) return undefined;
  const id = theme.id;
  return [
    `--theme-1: var(--${id}-1)`,
    `--theme-2: var(--${id}-2)`,
    `--theme-rgb: var(--${id}-rgb)`,
    `--theme-text-1: var(--${id}-text-1)`,
    `--theme-text-2: var(--${id}-text-2)`,
  ].join("; ");
}

/** Themes the build found with no colours of their own: they get the gold card. */
export function themesWithoutColours(themes: readonly Theme[]): Theme[] {
  return themes.filter((theme) => !THEME_COLOURS.has(theme.id));
}
