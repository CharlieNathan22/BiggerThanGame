/**
 * Limits for the feedback forms (`POST /api/feedback`), shared so the form and
 * the Worker can't disagree about what fits.
 */

export const FEEDBACK_LIMITS = {
  /** A suggested legend's name. */
  name: 80,
  /** The optional note on either form. */
  note: 1000,
  /** Turnstile's own ceiling on a token's length. */
  token: 2048,
} as const;

/**
 * Length in characters as a person counts them — code points, so an accented
 * name or an emoji is one character, not two UTF-16 units.
 */
export function textLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Every page the site serves, as its path. "Report a problem" names the page
 * it came from, and the Worker accepts only these. A test in apps/web keeps
 * the list equal to the pages it builds.
 */
export const SITE_PAGES = [
  "/",
  "/about",
  "/credits",
  "/football-higher-or-lower",
  "/football-higher-or-lower/legends",
  "/football-higher-or-lower/legends/friendly",
  "/404",
] as const;

export type SitePage = (typeof SITE_PAGES)[number];

export function isSitePage(path: string): path is SitePage {
  return (SITE_PAGES as readonly string[]).includes(path);
}
