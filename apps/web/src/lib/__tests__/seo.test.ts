import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITE_PAGES } from "@bt/core";
import {
  INDEXABLE_PAGES,
  OG_IMAGE,
  SITE_NAME,
  THEME_COLOUR,
  absoluteUrl,
  breadcrumbLd,
  breadcrumbTrail,
  gameLd,
  jsonLdText,
  sitemapXml,
  websiteLd,
} from "../seo";
import {
  ENDLESS_PATH,
  FOOTBALL_PATH,
  FRIENDLY_PATH,
  HOME_PATH,
  INSTAGRAM_PATH,
  LEGENDS_PATH,
} from "../paths";

const ORIGIN = "https://biggerthangame.com";

describe("canonical URLs", () => {
  it("are absolute on the apex, with no trailing slash but the root's", () => {
    expect(absoluteUrl(HOME_PATH)).toBe(`${ORIGIN}/`);
    expect(absoluteUrl("/about")).toBe(`${ORIGIN}/about`);
    expect(absoluteUrl(FRIENDLY_PATH)).toBe(`${ORIGIN}/football-higher-or-lower/legends/friendly`);
  });
});

describe("the pages in search", () => {
  it("are every page but the 404, the privacy and Endless pages included", () => {
    expect(INDEXABLE_PAGES).toEqual(SITE_PAGES.filter((p) => p !== "/404"));
    expect(INDEXABLE_PAGES).toContain("/privacy");
    expect(INDEXABLE_PAGES).toContain(ENDLESS_PATH);
    expect(INDEXABLE_PAGES).not.toContain("/404");
  });

  it("include Instagram Endless, under the Endless page", () => {
    expect(INDEXABLE_PAGES).toContain(INSTAGRAM_PATH);
    expect(breadcrumbTrail(INSTAGRAM_PATH).map((c) => c.path)).toEqual([
      HOME_PATH,
      FOOTBALL_PATH,
      LEGENDS_PATH,
      ENDLESS_PATH,
      INSTAGRAM_PATH,
    ]);
    expect(breadcrumbTrail(INSTAGRAM_PATH).at(-1)?.name).toBe("Instagram");
  });

  it("put the Endless page under the Legends page, like Friendly", () => {
    expect(breadcrumbTrail(ENDLESS_PATH).map((c) => c.path)).toEqual([
      HOME_PATH,
      FOOTBALL_PATH,
      LEGENDS_PATH,
      ENDLESS_PATH,
    ]);
  });
});

describe("sitemapXml", () => {
  it("writes a sitemaps.org urlset, one url per entry, escaped", () => {
    const xml = sitemapXml([
      { loc: `${ORIGIN}/`, lastmod: "2026-09-28" },
      { loc: `${ORIGIN}/a?b&c`, lastmod: "2026-09-27" },
    ]);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>\n    <lastmod>2026-09-28</lastmod>`);
    expect(xml).toContain(`<loc>${ORIGIN}/a?b&amp;c</loc>`);
    expect(xml.match(/<url>/g)).toHaveLength(2);
  });
});

describe("structured data", () => {
  it("names the site the same way everywhere", () => {
    expect(websiteLd()).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${ORIGIN}/`,
    });
  });

  it("describes the game as a free single-player quiz in the browser", () => {
    expect(gameLd()).toMatchObject({
      "@type": "VideoGame",
      url: absoluteUrl(FRIENDLY_PATH),
      image: absoluteUrl(OG_IMAGE.path),
      genre: "Quiz",
      gamePlatform: "Web browser",
      playMode: "https://schema.org/SinglePlayer",
      applicationCategory: "GameApplication",
      offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
    });
    expect(String(gameLd().description).length).toBeGreaterThan(50);
  });

  it("follows the URLs down from the homepage, each trail ending at its page", () => {
    expect(breadcrumbTrail(FOOTBALL_PATH).map((c) => c.path)).toEqual([HOME_PATH, FOOTBALL_PATH]);
    expect(breadcrumbTrail(LEGENDS_PATH).map((c) => c.path)).toEqual([
      HOME_PATH,
      FOOTBALL_PATH,
      LEGENDS_PATH,
    ]);
    expect(breadcrumbTrail(FRIENDLY_PATH).map((c) => c.path)).toEqual([
      HOME_PATH,
      FOOTBALL_PATH,
      LEGENDS_PATH,
      FRIENDLY_PATH,
    ]);
    expect(breadcrumbTrail("/about")).toEqual([]);
  });

  it("matches the Legends page's visible breadcrumb, Football › Legends, after Home", () => {
    expect(breadcrumbTrail(LEGENDS_PATH).map((c) => c.name)).toEqual([
      "Home",
      "Football",
      "Legends",
    ]);
  });

  it("numbers a breadcrumb list from one, with absolute URLs", () => {
    expect(breadcrumbLd(breadcrumbTrail(FOOTBALL_PATH))).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
        {
          "@type": "ListItem",
          position: 2,
          name: "Football",
          item: `${ORIGIN}/football-higher-or-lower`,
        },
      ],
    });
  });

  it("can't close its script element, whatever the text", () => {
    const text = jsonLdText({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});

describe("the web manifest", () => {
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../public/site.webmanifest", import.meta.url)),
      "utf8",
    ),
  ) as { name: string; theme_color: string; background_color: string; icons: { src: string }[] };
  const tokens = readFileSync(
    fileURLToPath(new URL("../../styles/tokens.css", import.meta.url)),
    "utf8",
  );

  it("is named for the site, in the title bar's --ink", () => {
    expect(manifest.name).toBe(SITE_NAME);
    expect(manifest.theme_color).toBe(THEME_COLOUR);
    expect(manifest.background_color).toBe(THEME_COLOUR);
    expect(tokens).toContain(`--ink: ${THEME_COLOUR};`);
  });

  it("points at icons that exist", () => {
    for (const icon of manifest.icons) {
      expect(() =>
        readFileSync(fileURLToPath(new URL(`../../../public${icon.src}`, import.meta.url))),
      ).not.toThrow();
    }
  });
});
