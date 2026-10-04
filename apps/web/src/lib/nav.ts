/**
 * The title bar's site navigation. The brand links home; these follow it.
 * Rendered twice by TitleBar.svelte — inline on desktop, in the menu on
 * phones — and only one of the two is ever displayed.
 */

import type { MessageKey } from "../i18n";
import {
  ABOUT_PATH,
  FOOTBALL_PATH,
  HOW_TO_PLAY_PATH,
  LEADERBOARD_PATH,
  LEGENDS_PATH,
  isWithin,
} from "./paths";

export interface NavLink {
  readonly href: string;
  readonly label: MessageKey;
  /** The part of the site the link stands for, when that's more than its own page. */
  readonly section?: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  { href: LEGENDS_PATH, label: "nav.play", section: FOOTBALL_PATH },
  { href: LEADERBOARD_PATH, label: "nav.leaderboards" },
  { href: HOW_TO_PLAY_PATH, label: "nav.howToPlay" },
  { href: ABOUT_PATH, label: "nav.about" },
];

/**
 * The link's `aria-current`: `"page"` when `href` is the page being shown;
 * `"true"` when the page is elsewhere in the link's `section`, so Play is
 * current across the football pages; otherwise none. A link to a section of a
 * page (`/about#how-to-play`) is never the page itself, so on /about only
 * "About" is current.
 */
export function currentPage(
  href: string,
  current: string | undefined,
  section?: string,
): "page" | "true" | undefined {
  if (current === undefined || href.includes("#")) return undefined;
  if (href === current) return "page";
  return section !== undefined && isWithin(current, section) ? "true" : undefined;
}

/**
 * A nav link's `aria-current` among `links`: as `currentPage`, except that a
 * link current only for its section stands down when another link is the
 * page itself — on the leaderboard page, Leaderboards is current, not Play.
 */
export function navCurrent(
  link: NavLink,
  current: string | undefined,
  links: readonly NavLink[] = NAV_LINKS,
): "page" | "true" | undefined {
  const mark = currentPage(link.href, current, link.section);
  if (mark !== "true") return mark;
  return links.some((other) => currentPage(other.href, current) === "page") ? undefined : mark;
}
