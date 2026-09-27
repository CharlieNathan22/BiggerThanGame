/**
 * The title bar's site navigation. The brand links home; these follow it.
 * Rendered twice by TitleBar.svelte — inline on desktop, in the menu on
 * phones — and only one of the two is ever displayed.
 */

import type { MessageKey } from "../i18n";
import { ABOUT_PATH, FOOTBALL_PATH, HOW_TO_PLAY_PATH } from "./paths";

export interface NavLink {
  readonly href: string;
  readonly label: MessageKey;
}

export const NAV_LINKS: readonly NavLink[] = [
  { href: FOOTBALL_PATH, label: "nav.play" },
  { href: HOW_TO_PLAY_PATH, label: "nav.howToPlay" },
  { href: ABOUT_PATH, label: "nav.about" },
];

/**
 * `"page"` when `href` is the page being shown, for `aria-current`. A link to a
 * section of a page (`/about#how-to-play`) is never the page itself, so on
 * /about only "About" is current.
 */
export function currentPage(href: string, current: string | undefined): "page" | undefined {
  return current !== undefined && !href.includes("#") && href === current ? "page" : undefined;
}
