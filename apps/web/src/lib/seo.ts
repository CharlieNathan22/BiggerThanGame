/**
 * Search and link-preview metadata: the site's name, the preview image, the
 * canonical URL of every page, the sitemap and the structured data (JSON-LD).
 * Pure, so tests hold it; `Base.astro` writes it into every page's head and
 * `pages/sitemap.xml.ts` into the sitemap.
 *
 * Canonical URLs are absolute, on the apex, with no trailing slash
 * (DESIGN.md §17). The homepage's is the bare origin with its "/", which is
 * the same URL.
 */

import { SITE_PAGES } from "@bt/core";
import type { SitePage } from "@bt/core";
import { SITE_URL } from "../config";
import { t } from "../i18n";
import {
  ENDLESS_PATH,
  FOOTBALL_PATH,
  FRIENDLY_PATH,
  HOME_PATH,
  INSTAGRAM_PATH,
  DAILY_LEADERBOARD_PATH,
  DAILY_PATH,
  ENDLESS_LEADERBOARD_PATH,
  LEGENDS_PATH,
} from "./paths";

/** `og:site_name`, the WebSite's name, and the end of every title. */
export const SITE_NAME = "Bigger Than Game";

/** `og:locale`. The page's `lang` is its BCP 47 form, `en-GB`. */
export const OG_LOCALE = "en_GB";
export const LANG = "en-GB";

/** A link preview: 1200 × 630, drawn by `pnpm site:images` from the tokens. */
export interface PreviewImage {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

/**
 * The link preview every page shares but the game (scripts/site-images.ts).
 * No player photos: their licences need an attribution a preview can't carry.
 */
export const OG_IMAGE: PreviewImage = {
  path: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "Bigger Than Game: Football Legends, higher or lower",
};

/** The game page's own preview: the start panel's names and a plaque asking a question. */
export const FRIENDLY_OG_IMAGE: PreviewImage = {
  path: "/og-friendly.png",
  width: 1200,
  height: 630,
  alt: "Bigger Than Game, Football Legends, Friendly: 20 questions. International caps: higher or lower?",
};

/** The web manifest's and the theme's colour: the title bar's --ink. */
export const THEME_COLOUR = "#06121a";

/** A site path as its absolute canonical URL: `/about` → `https://biggerthangame.com/about`. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).href;
}

/**
 * Every page that should be in search: all of them but the 404. The themes'
 * pages join them from `themes.json` (`indexablePages`).
 */
export const INDEXABLE_PAGES: readonly SitePage[] = SITE_PAGES.filter((page) => page !== "/404");

/** The fixed pages, then each theme's page (lib/themes.ts reads which exist). */
export function indexablePages(themePaths: readonly string[]): readonly string[] {
  return [...INDEXABLE_PAGES, ...themePaths];
}

export interface SitemapEntry {
  /** The absolute canonical URL. */
  readonly loc: string;
  /** `YYYY-MM-DD`. */
  readonly lastmod: string;
}

/** `sitemap.xml`, in the sitemaps.org format, one `<url>` per entry. */
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map(
    (e) =>
      `  <url>\n    <loc>${escapeXml(e.loc)}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A JSON-LD object: plain JSON, with `@context` and `@type`. */
export type JsonLd = { readonly [key: string]: unknown };

const CONTEXT = "https://schema.org";

/** The site itself. On every page, so every page names the site the same way. */
export function websiteLd(): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": `${absoluteUrl(HOME_PATH)}#website`,
    name: SITE_NAME,
    url: absoluteUrl(HOME_PATH),
    inLanguage: LANG,
  };
}

/**
 * The game, on the Legends page and the game page: one entity with one `@id`,
 * whose `url` is where it's played.
 */
export function gameLd(): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "VideoGame",
    "@id": `${absoluteUrl(LEGENDS_PATH)}#game`,
    name: "Football Legends Higher or Lower",
    description:
      "A free football higher or lower game with retired legends. Two players, one stat: guess whether the hidden number is higher or lower, and watch the plaque, because the stat keeps changing.",
    url: absoluteUrl(FRIENDLY_PATH),
    image: absoluteUrl(OG_IMAGE.path),
    genre: "Quiz",
    gamePlatform: "Web browser",
    playMode: "https://schema.org/SinglePlayer",
    applicationCategory: "GameApplication",
    operatingSystem: "Any",
    inLanguage: LANG,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
    isPartOf: { "@id": `${absoluteUrl(HOME_PATH)}#website` },
  };
}

export interface Crumb {
  readonly name: string;
  readonly path: string;
}

/**
 * Where a football page sits, from the homepage down, as its URL does. The
 * Legends page shows this trail without its first step ("Football ›
 * Legends"); the brand in the title bar is the way home on every page. The
 * game page shows none (DESIGN.md §17) but sits under the same trail.
 */
export function breadcrumbTrail(path: string): readonly Crumb[] {
  const home = { name: t("breadcrumb.home"), path: HOME_PATH };
  const football = { name: t("breadcrumb.football"), path: FOOTBALL_PATH };
  const legends = { name: t("breadcrumb.legends"), path: LEGENDS_PATH };
  const friendly = { name: t("mode.friendly.name"), path: FRIENDLY_PATH };
  const endless = { name: t("mode.endless.name"), path: ENDLESS_PATH };
  const instagram = { name: t("mode.instagram.subtitle"), path: INSTAGRAM_PATH };
  const daily = { name: t("mode.ranked.name"), path: DAILY_PATH };
  const leaderboard = { name: t("over.leaderboard"), path: ENDLESS_LEADERBOARD_PATH };
  const dailyBoard = { name: t("over.leaderboard"), path: DAILY_LEADERBOARD_PATH };
  switch (path) {
    case FOOTBALL_PATH:
      return [home, football];
    case LEGENDS_PATH:
      return [home, football, legends];
    case FRIENDLY_PATH:
      return [home, football, legends, friendly];
    case ENDLESS_PATH:
      return [home, football, legends, endless];
    case INSTAGRAM_PATH:
      return [home, football, legends, endless, instagram];
    case ENDLESS_LEADERBOARD_PATH:
      return [home, football, legends, endless, leaderboard];
    case DAILY_PATH:
      return [home, football, legends, daily];
    case DAILY_LEADERBOARD_PATH:
      return [home, football, legends, daily, dailyBoard];
    default:
      return [];
  }
}

/**
 * A "Clear the squad" theme's trail: Home › Football › Legends › Barcelona.
 * Straight from Legends, since there is no Clubs, Leagues or Eras page.
 */
export function themeTrail(name: string, path: string): readonly Crumb[] {
  return [...breadcrumbTrail(LEGENDS_PATH), { name, path }];
}

export function breadcrumbLd(trail: readonly Crumb[]): JsonLd {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/**
 * JSON for a `<script type="application/ld+json">`: `<` escaped, so no text
 * in it can close the script element.
 */
export function jsonLdText(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
