/**
 * The search checks (site-check.ts): a clean fixture site passes, and each
 * thing that can go wrong is caught. `pnpm check:site` runs the same checks
 * on the real build. Also holds the committed images and robots.txt.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkPages,
  checkRobots,
  checkSitemap,
  pngSize,
  readHead,
  siteExpectations,
} from "../site-check.js";
import type { BuiltPage, SiteExpectations } from "../site-check.js";

const ORIGIN = "https://biggerthangame.com";
const publicDir = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  "apps",
  "web",
  "public",
);

const EXPECT: SiteExpectations = {
  origin: ORIGIN,
  lang: "en-GB",
  noindex: ["/404"],
  structuredData: { "/game": ["BreadcrumbList", "VideoGame"] },
  files: ["/robots.txt", "/og-image.png", "/og-game.png"],
  previewImage: "/og-image.png",
  previewImages: { "/game": "/og-game.png" },
};

const WEBSITE = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Bigger Than Game",
  url: `${ORIGIN}/`,
};
const GAME = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: "Football Legends Higher or Lower",
  description: "A game.",
  url: `${ORIGIN}/game`,
  image: `${ORIGIN}/og-image.png`,
  genre: "Quiz",
  gamePlatform: "Web browser",
  playMode: "https://schema.org/SinglePlayer",
  offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
};
const TRAIL = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
    { "@type": "ListItem", position: 2, name: "Game", item: `${ORIGIN}/game` },
  ],
};

interface PageSpec {
  title?: string | null;
  description?: string | null;
  canonical?: string | null;
  robots?: string;
  lang?: string;
  h1s?: number;
  ld?: readonly unknown[];
  omit?: readonly string[];
  links?: readonly string[];
  body?: string;
  image?: string;
  twitterImage?: string;
}

function page(path: string, spec: PageSpec = {}): BuiltPage {
  const canonical =
    spec.canonical === undefined
      ? path === "/"
        ? `${ORIGIN}/`
        : `${ORIGIN}${path}`
      : spec.canonical;
  const title =
    spec.title === undefined ? `The ${path} page, a title of a good length | Brand` : spec.title;
  const description =
    spec.description === undefined
      ? `A description of the ${path} page, written out long enough to fill a search result snippet without being cut off by the search engine.`
      : spec.description;
  const social: [string, string][] = [
    ["og:type", "website"],
    ["og:site_name", "Bigger Than Game"],
    ["og:locale", "en_GB"],
    ["og:title", title ?? ""],
    ["og:description", description ?? ""],
    ["og:url", canonical ?? ""],
    ["og:image", `${ORIGIN}${spec.image ?? (path === "/game" ? "/og-game.png" : "/og-image.png")}`],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
    ["og:image:alt", "Alt"],
    ["twitter:card", "summary_large_image"],
    [
      "twitter:image",
      `${ORIGIN}${spec.twitterImage ?? spec.image ?? (path === "/game" ? "/og-game.png" : "/og-image.png")}`,
    ],
  ];
  const ld = spec.ld ?? [WEBSITE];
  const html = [
    `<!doctype html><html lang="${spec.lang ?? "en-GB"}"><head>`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    title === null ? "" : `<title>${title}</title>`,
    description === null ? "" : `<meta name="description" content="${description}">`,
    canonical === null ? "" : `<link rel="canonical" href="${canonical}">`,
    spec.robots === undefined ? "" : `<meta name="robots" content="${spec.robots}">`,
    ...social
      .filter(([key]) => !spec.omit?.includes(key))
      .map(([key, value]) =>
        key.startsWith("og:")
          ? `<meta property="${key}" content="${value}">`
          : `<meta name="${key}" content="${value}">`,
      ),
    ...ld.map(
      (d) =>
        `<script type="application/ld+json">${typeof d === "string" ? d : JSON.stringify(d)}</script>`,
    ),
    `</head><body>`,
    ...Array.from({ length: spec.h1s ?? 1 }, () => `<h1>Heading</h1>`),
    ...(spec.links ?? []).map((href) => `<a href="${href}">Link</a>`),
    spec.body ?? "",
    `</body></html>`,
  ].join("");
  return { path, html };
}

function site(overrides: Record<string, PageSpec> = {}): BuiltPage[] {
  return [
    page("/", overrides["/"]),
    page("/about", overrides["/about"]),
    page("/game", { ld: [WEBSITE, TRAIL, GAME], ...overrides["/game"] }),
    page("/404", {
      canonical: null,
      robots: "noindex",
      title: "Not found | Brand",
      description: "Gone.",
      ...overrides["/404"],
    }),
  ];
}

describe("readHead", () => {
  it("reads the head Astro writes, entities decoded", () => {
    const head = readHead(
      page("/about", { title: "Rock &amp; roll &#39;quiz&#39; | Brand", links: ["/", "/x#y"] })
        .html,
    );
    expect(head.title).toBe("Rock & roll 'quiz' | Brand");
    expect(head.canonical).toBe(`${ORIGIN}/about`);
    expect(head.lang).toBe("en-GB");
    expect(head.social.get("twitter:card")).toBe("summary_large_image");
    expect(head.h1Count).toBe(1);
    expect(head.jsonLd).toEqual([WEBSITE]);
    expect(head.links).toEqual(["/", "/x#y"]);
  });
});

describe("checkPages", () => {
  it("passes a clean site", () => {
    expect(
      checkPages(site({ "/": { links: ["/about", "/game#top", "/robots.txt"] } }), EXPECT),
    ).toEqual([]);
  });

  it.each<[string, Record<string, PageSpec>, string]>([
    ["a missing title", { "/about": { title: null } }, "/about: no <title>"],
    ["a missing description", { "/about": { description: null } }, "/about: no meta description"],
    ["a short title", { "/about": { title: "Short | Brand" } }, "/about: title is 13 characters"],
    [
      "a long description",
      { "/about": { description: "x".repeat(200) } },
      "/about: description is 200",
    ],
    ["no canonical", { "/about": { canonical: null } }, "/about: canonical is missing"],
    [
      "a trailing-slash canonical",
      { "/about": { canonical: `${ORIGIN}/about/` } },
      "/about: canonical is",
    ],
    [
      "a canonical to another page",
      { "/about": { canonical: `${ORIGIN}/` } },
      "/about: canonical is",
    ],
    ["the wrong lang", { "/about": { lang: "en" } }, "/about: lang is en"],
    ["two h1s", { "/about": { h1s: 2 } }, "/about: 2 <h1> elements"],
    ["no h1", { "/about": { h1s: 0 } }, "/about: 0 <h1> elements"],
    ["a missing og:image", { "/about": { omit: ["og:image"] } }, "/about: no og:image"],
    ["a missing twitter:card", { "/about": { omit: ["twitter:card"] } }, "/about: no twitter:card"],
    [
      "the default preview on a page with its own",
      { "/game": { image: "/og-image.png" } },
      "/game: og:image is https://biggerthangame.com/og-image.png, not https://biggerthangame.com/og-game.png",
    ],
    [
      "a twitter:image that isn't og:image",
      { "/about": { twitterImage: "/og-game.png" } },
      "/about: twitter:image isn't og:image",
    ],
    [
      "a preview that wasn't built",
      { "/about": { image: "/og-missing.png" } },
      "/about: og:image https://biggerthangame.com/og-missing.png isn't a built file",
    ],
    [
      "an indexed page marked noindex",
      { "/about": { robots: "noindex" } },
      "/about: marked noindex",
    ],
    ["a 404 that isn't noindex", { "/404": { robots: "index" } }, "/404: not marked noindex"],
    ["a 404 with a canonical", { "/404": { canonical: `${ORIGIN}/404` } }, "/404: has a canonical"],
    [
      "JSON-LD that doesn't parse",
      { "/about": { ld: [WEBSITE, "{nope"] } },
      "/about: JSON-LD doesn't parse",
    ],
    ["no WebSite", { "/about": { ld: [] } }, "/about: 0 WebSite blocks"],
    ["a missing VideoGame", { "/game": { ld: [WEBSITE, TRAIL] } }, "/game: 0 VideoGame blocks"],
    [
      "a VideoGame without an offer",
      { "/game": { ld: [WEBSITE, TRAIL, { ...GAME, offers: undefined }] } },
      "/game: VideoGame offers",
    ],
    [
      "a VideoGame without a genre",
      { "/game": { ld: [WEBSITE, TRAIL, { ...GAME, genre: "" }] } },
      "/game: VideoGame has no genre",
    ],
    [
      "a breadcrumb that ends elsewhere",
      {
        "/game": {
          ld: [WEBSITE, GAME, { ...TRAIL, itemListElement: TRAIL.itemListElement.slice(0, 1) }],
        },
      },
      "/game: the breadcrumb's last item isn't this page",
    ],
    [
      "structured data where it isn't wanted",
      { "/about": { ld: [WEBSITE, GAME] } },
      "/about: unexpected VideoGame",
    ],
    ["a broken internal link", { "/": { links: ["/nowhere"] } }, "/: links to /nowhere"],
    [
      "a trailing-slash link",
      { "/": { links: ["/about/"] } },
      "/: links to /about/, with a trailing slash",
    ],
    [
      "a link glued to the word before it",
      { "/": { body: '<p>The<a href="/about">about</a> page</p>' } },
      '/: no space before "about"',
    ],
  ])("catches %s", (_name, overrides, problem) => {
    expect(checkPages(site(overrides), EXPECT).join("\n")).toContain(problem);
  });

  it("catches a title or description two pages share", () => {
    const same = { title: "The very same title on two different pages | Brand" };
    const problems = checkPages(site({ "/": same, "/about": same }), EXPECT);
    expect(problems).toContain("/about: same title as /");
  });
});

describe("checkSitemap", () => {
  const pages = site();
  const xml = (locs: readonly string[], lastmod = "2026-09-28") =>
    [
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...locs.map((loc) => `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`),
      "</urlset>",
    ].join("");
  const good = [`${ORIGIN}/`, `${ORIGIN}/about`, `${ORIGIN}/game`];

  it("passes exactly the indexable pages", () => {
    expect(checkSitemap(xml(good), pages, EXPECT)).toEqual([]);
  });

  it.each<[string, readonly string[], string]>([
    ["the 404", [...good, `${ORIGIN}/404`], "lists https://biggerthangame.com/404"],
    ["the API", [...good, `${ORIGIN}/api/round/next`], "under /api/"],
    ["a missing page", good.slice(1), `missing ${ORIGIN}/`],
    ["a duplicate", [...good, `${ORIGIN}/about`], "lists a URL twice"],
    [
      "a trailing slash",
      [`${ORIGIN}/`, `${ORIGIN}/about/`, `${ORIGIN}/game`],
      `missing ${ORIGIN}/about`,
    ],
  ])("catches %s", (_name, locs, problem) => {
    expect(checkSitemap(xml(locs), pages, EXPECT).join("\n")).toContain(problem);
  });

  it("wants a date on every URL", () => {
    expect(checkSitemap(xml(good, "yesterday"), pages, EXPECT).join("\n")).toContain("lastmod");
  });
});

describe("checkRobots", () => {
  it("passes the site's own robots.txt", () => {
    expect(checkRobots(readFileSync(join(publicDir, "robots.txt"), "utf8"), ORIGIN)).toEqual([]);
  });

  it("catches a robots.txt that blocks the site or hides the sitemap", () => {
    const blocking = "User-agent: *\nDisallow: /\nDisallow: /api/\n";
    expect(checkRobots(blocking, ORIGIN)).toEqual([
      "robots.txt: disallows /",
      `robots.txt: no Sitemap: ${ORIGIN}/sitemap.xml`,
    ]);
  });
});

describe("the committed images", () => {
  it.each([
    ["og-image.png", 1200, 630],
    ["og-friendly.png", 1200, 630],
    ["apple-touch-icon.png", 180, 180],
    ["icon-192.png", 192, 192],
    ["icon-512.png", 512, 512],
  ])("%s is a %i×%i PNG", (file, width, height) => {
    expect(pngSize(readFileSync(join(publicDir, file)))).toEqual({ width, height });
  });

  it.each(["og-image.png", "og-friendly.png"])("keeps %s under 200 KB", (file) => {
    expect(statSync(join(publicDir, file)).size).toBeLessThanOrEqual(200 * 1024);
  });

  it("reads no size from something that isn't a PNG", () => {
    expect(pngSize(new TextEncoder().encode("GIF89a not a png at all"))).toBeNull();
  });

  it("has a favicon SVG that parses as XML: no double hyphen inside a comment", () => {
    const svg = readFileSync(join(publicDir, "favicon.svg"), "utf8");
    for (const comment of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
      expect(comment[1]).not.toContain("--");
    }
  });
});

describe("siteExpectations", () => {
  const ENDLESS = "/football-higher-or-lower/legends/endless";
  const LEADERBOARD = `${ENDLESS}/leaderboard`;

  it("indexes Endless with a breadcrumb and the game, and the default preview", () => {
    const expect_ = siteExpectations(["/og-image.png"]);
    expect(expect_.noindex).toEqual(["/404"]);
    expect(expect_.structuredData[ENDLESS]).toEqual(["BreadcrumbList", "VideoGame"]);
    expect(expect_.previewImages?.[ENDLESS]).toBeUndefined();
    expect(expect_.previewImage).toBe("/og-image.png");
  });

  it("indexes the leaderboard with a breadcrumb and the default preview", () => {
    const expect_ = siteExpectations(["/og-image.png"]);
    expect(expect_.structuredData[LEADERBOARD]).toEqual(["BreadcrumbList"]);
    expect(expect_.previewImages?.[LEADERBOARD]).toBeUndefined();
  });
});
