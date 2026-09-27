/**
 * The site's pages, as served: no trailing slashes (DESIGN.md §17). One place
 * for the paths that links, challenge URLs and the title bar depend on.
 */

/** The Bigger Than homepage. */
export const HOME_PATH = "/";

/** The football hub: the modes, and the page search traffic lands on. */
export const FOOTBALL_PATH = "/football-higher-or-lower";

/** The Legends deck. For now the hub's content, canonical to FOOTBALL_PATH. */
export const LEGENDS_PATH = "/football-higher-or-lower/legends";

/** The game: Friendly Mode on the Legends deck. */
export const FRIENDLY_PATH = "/football-higher-or-lower/legends/friendly";

/**
 * A built page's URL path as it is served: `/about.html` and `/index.html`
 * read as `/about` and `/`, since pages build to files (astro.config.mjs).
 */
export function servedPath(pathname: string): string {
  return pathname.replace(/(\/index)?\.html$/, "") || HOME_PATH;
}

/** Whether a page is the Legends deck or under it, where the title bar says "Legends". */
export function isLegendsPath(path: string): boolean {
  return path === LEGENDS_PATH || path.startsWith(`${LEGENDS_PATH}/`);
}
