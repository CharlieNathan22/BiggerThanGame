/**
 * The "Clear the squad" themes on the site (lib/themes.ts): read from the deck
 * build's themes.json, held to their shape, and turned into pages, colours and
 * search entries.
 */

import { describe, expect, it } from "vitest";
import { breadcrumbTrail, indexablePages, INDEXABLE_PAGES, themeTrail } from "../seo";
import { LEGENDS_PATH } from "../paths";
import {
  THEME_COLOURS,
  parseThemes,
  themeColours,
  themePages,
  themesWithoutColours,
} from "../themes";

const THEMES = [
  { id: "club-barcelona", type: "club", name: "Barcelona", slug: "barcelona", players: 35 },
  { id: "league-la-liga", type: "league", name: "La Liga", slug: "la-liga", players: 69 },
  { id: "era-2000s", type: "era", name: "2000s", slug: "2000s", players: 51 },
  { id: "club-napoli", type: "club", name: "Napoli", slug: "napoli", players: 12 },
] as const;

describe("themes.json", () => {
  it("is read theme by theme", () => {
    expect(parseThemes(JSON.stringify(THEMES))).toEqual(THEMES);
  });

  it.each([
    ["not an array", "{}"],
    ["an unknown type", JSON.stringify([{ ...THEMES[0], type: "team" }])],
    ["a slug with capitals", JSON.stringify([{ ...THEMES[0], slug: "Barcelona" }])],
    ["an id that isn't type-slug", JSON.stringify([{ ...THEMES[0], id: "barcelona" }])],
    ["no count", JSON.stringify([{ ...THEMES[0], players: "35" }])],
    ["no name", JSON.stringify([{ ...THEMES[0], name: "" }])],
  ])("fails the build on %s", (_, text) => {
    expect(() => parseThemes(text)).toThrow(/themes\.json/);
  });
});

describe("the themes' pages", () => {
  it("are one per theme, under the Legends page, playing the theme's squad", () => {
    expect(themePages(parseThemes(JSON.stringify(THEMES)))).toEqual([
      {
        theme: THEMES[0],
        path: "/football-higher-or-lower/legends/clubs/barcelona",
        kind: "clubs",
        variant: "squad:club-barcelona",
      },
      {
        theme: THEMES[1],
        path: "/football-higher-or-lower/legends/leagues/la-liga",
        kind: "leagues",
        variant: "squad:league-la-liga",
      },
      {
        theme: THEMES[2],
        path: "/football-higher-or-lower/legends/eras/2000s",
        kind: "eras",
        variant: "squad:era-2000s",
      },
      {
        theme: THEMES[3],
        path: "/football-higher-or-lower/legends/clubs/napoli",
        kind: "clubs",
        variant: "squad:club-napoli",
      },
    ]);
  });

  it("are in search, after the fixed pages, with a trail straight from Legends", () => {
    const paths = themePages(parseThemes(JSON.stringify(THEMES))).map((p) => p.path);
    expect(indexablePages(paths)).toEqual([...INDEXABLE_PAGES, ...paths]);
    expect(themeTrail("Barcelona", paths[0]!)).toEqual([
      ...breadcrumbTrail(LEGENDS_PATH),
      { name: "Barcelona", path: paths[0] },
    ]);
  });
});

describe("the themes' colours", () => {
  it("read from tokens by theme id, and leave a theme without them on the gold card", () => {
    expect(themeColours(THEMES[0])).toBe(
      "--theme-1: var(--club-barcelona-1); --theme-2: var(--club-barcelona-2); " +
        "--theme-rgb: var(--club-barcelona-rgb); --theme-text-1: var(--club-barcelona-text-1); " +
        "--theme-text-2: var(--club-barcelona-text-2)",
    );
    expect(themeColours(THEMES[3])).toBeUndefined();
    expect(themesWithoutColours(parseThemes(JSON.stringify(THEMES)))).toEqual([THEMES[3]]);
  });

  it("cover every club, league and era the current deck has", () => {
    for (const id of [
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
      "era-classic-era",
      "club-arsenal",
      "club-manchester-city",
    ]) {
      expect(THEME_COLOURS.has(id), id).toBe(true);
    }
  });
});
