/**
 * The site's pages, as served: no trailing slashes (DESIGN.md §17). One place
 * for the paths that links, challenge URLs and the title bar depend on.
 */

import { themePath } from "@bt/core";
import type { SquadTheme } from "@bt/core";

/** The Bigger Than homepage. */
export const HOME_PATH = "/";

/** The football page: football higher or lower in general, and a card per deck. */
export const FOOTBALL_PATH = "/football-higher-or-lower";

/** The Legends deck: its intro and the three modes. Where "Play" goes. */
export const LEGENDS_PATH = "/football-higher-or-lower/legends";

/** The game: Friendly Mode on the Legends deck. */
export const FRIENDLY_PATH = "/football-higher-or-lower/legends/friendly";

/** Endless on the Legends deck: a streak against the clock. */
export const ENDLESS_PATH = "/football-higher-or-lower/legends/endless";

/** Instagram Endless: Endless with Instagram followers on every question, no boards. */
export const INSTAGRAM_PATH = "/football-higher-or-lower/legends/endless/instagram";

/**
 * A "Clear the squad" theme's page, generated from the deck's themes:
 * `/football-higher-or-lower/legends/clubs/real-madrid`, `…/leagues/la-liga`,
 * `…/eras/2000s` (`themePath` in @bt/core, which the Worker's checks share).
 */
export function themePagePath(theme: Pick<SquadTheme, "type" | "slug">): string {
  return themePath(theme);
}

/** Endless's boards: today, this week and this month. */
export const LEADERBOARD_PATH = "/football-higher-or-lower/legends/endless/leaderboard";

export const ABOUT_PATH = "/about";
export const CREDITS_PATH = "/credits";
export const PRIVACY_PATH = "/privacy";

/** How to play is a section of the about page. */
export const HOW_TO_PLAY_PATH = "/about#how-to-play";

/**
 * A built page's URL path as it is served: `/about.html` and `/index.html`
 * read as `/about` and `/`, since pages build to files (astro.config.mjs).
 */
export function servedPath(pathname: string): string {
  return pathname.replace(/(\/index)?\.html$/, "") || HOME_PATH;
}

/** Whether `path` is `root` or a page under it. */
export function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** Whether a page is the Legends deck or under it, where the title bar says "Legends". */
export function isLegendsPath(path: string): boolean {
  return isWithin(path, LEGENDS_PATH);
}
