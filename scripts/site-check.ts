/**
 * The search checks over the built site: every page's head (title,
 * description, canonical, Open Graph and Twitter tags, `lang`, viewport), one
 * `<h1>`, structured data that parses and has what it needs, internal links
 * that go somewhere, and a sitemap and robots.txt that agree with the pages.
 *
 * Pure, over text, so tests feed it fixtures; `check-site.ts` runs it on
 * `apps/web/dist` as the last step of `pnpm build`. The HTML is Astro's own
 * output, so a few regular expressions read it reliably; no parser needed.
 */

export interface BuiltPage {
  /** As served: `/`, `/about`, `/football-higher-or-lower/legends`. */
  readonly path: string;
  readonly html: string;
}

export interface PageHead {
  readonly lang: string | undefined;
  readonly viewport: string | undefined;
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly canonical: string | undefined;
  readonly robots: string | undefined;
  /** `og:*` and `twitter:*` meta tags by name. */
  readonly social: ReadonlyMap<string, string>;
  readonly h1Count: number;
  /** Each JSON-LD block, parsed; a block that doesn't parse is its error message. */
  readonly jsonLd: readonly (Record<string, unknown> | string)[];
  /** Every `href` on an `<a>`. */
  readonly links: readonly string[];
}

/** Titles and descriptions as search results show them, give or take. */
export const TITLE_LENGTH = { min: 30, max: 65 } as const;
export const DESCRIPTION_LENGTH = { min: 110, max: 170 } as const;

export const REQUIRED_SOCIAL = [
  "og:type",
  "og:site_name",
  "og:locale",
  "og:title",
  "og:description",
  "og:url",
  "og:image",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "twitter:card",
] as const;

function decode(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/([a-zA-Z][\w:-]*)="([^"]*)"/g)) {
    attrs.set(m[1]!.toLowerCase(), decode(m[2]!));
  }
  return attrs;
}

export function readHead(html: string): PageHead {
  const metas = [...html.matchAll(/<meta\s[^>]*>/g)].map((m) => attributes(m[0]));
  const meta = (name: string) => metas.find((a) => a.get("name") === name)?.get("content");
  const social = new Map<string, string>();
  for (const a of metas) {
    const key = a.get("property") ?? a.get("name");
    const content = a.get("content");
    if (key !== undefined && content !== undefined && /^(og|twitter):/.test(key)) {
      social.set(key, content);
    }
  }
  const canonicalTag = [...html.matchAll(/<link\s[^>]*>/g)]
    .map((m) => attributes(m[0]))
    .find((a) => a.get("rel") === "canonical");
  const jsonLd = [
    ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => {
    try {
      const value: unknown = JSON.parse(m[1]!);
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : "not a JSON object";
    } catch (err) {
      return err instanceof Error ? err.message : "does not parse";
    }
  });
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  return {
    lang: attributes(/<html\s[^>]*>/.exec(html)?.[0] ?? "").get("lang"),
    viewport: meta("viewport"),
    title: title === undefined ? undefined : decode(title),
    description: meta("description"),
    canonical: canonicalTag?.get("href"),
    robots: meta("robots"),
    social,
    h1Count: [...html.matchAll(/<h1[\s>]/g)].length,
    jsonLd,
    links: [...html.matchAll(/<a\s[^>]*>/g)]
      .map((m) => attributes(m[0]).get("href"))
      .filter((href): href is string => href !== undefined),
  };
}

/** What a page must carry beyond the WebSite every page has. */
export type LdType = "VideoGame" | "BreadcrumbList";

export interface SiteExpectations {
  /** The canonical origin: `https://biggerthangame.com`. */
  readonly origin: string;
  readonly lang: string;
  /** Pages kept out of search: `noindex`, no canonical, not in the sitemap. */
  readonly noindex: readonly string[];
  readonly structuredData: Readonly<Record<string, readonly LdType[]>>;
  /** Paths that exist besides the pages: `/robots.txt`, `/favicon.ico`… */
  readonly files: readonly string[];
  /** The link preview every indexed page uses, as a path… */
  readonly previewImage: string;
  /** …but for the pages that have their own. */
  readonly previewImages?: Readonly<Record<string, string>>;
}

const FOOTBALL = "/football-higher-or-lower";
const LEGENDS = `${FOOTBALL}/legends`;
const FRIENDLY = `${LEGENDS}/friendly`;
const ENDLESS = `${LEGENDS}/endless`;
const INSTAGRAM = `${ENDLESS}/instagram`;
const LEADERBOARD = `${ENDLESS}/leaderboard`;

/**
 * What the built site must be, given its non-page files. The Endless page is a
 * game page like Friendly's, with its own canonical and the site's default
 * preview; its leaderboard is an ordinary page under it, with a breadcrumb.
 * Instagram Endless is a game page under Endless, like Endless itself.
 */
export function siteExpectations(files: readonly string[]): SiteExpectations {
  return {
    origin: "https://biggerthangame.com",
    lang: "en-GB",
    noindex: ["/404"],
    structuredData: {
      [FOOTBALL]: ["BreadcrumbList"],
      [LEGENDS]: ["BreadcrumbList", "VideoGame"],
      [FRIENDLY]: ["BreadcrumbList", "VideoGame"],
      [ENDLESS]: ["BreadcrumbList", "VideoGame"],
      [INSTAGRAM]: ["BreadcrumbList", "VideoGame"],
      [LEADERBOARD]: ["BreadcrumbList"],
    },
    files,
    previewImage: "/og-image.png",
    previewImages: { [FRIENDLY]: "/og-friendly.png" },
  };
}

/** A page's canonical URL: the origin and path, with no trailing slash but the root's. */
export function canonicalFor(origin: string, path: string): string {
  return path === "/" ? `${origin}/` : `${origin}${path}`;
}

export function checkPages(pages: readonly BuiltPage[], expect: SiteExpectations): string[] {
  const problems: string[] = [];
  const heads = pages.map((page) => ({ page, head: readHead(page.html) }));
  const paths = new Set(pages.map((p) => p.path));

  for (const { page, head } of heads) {
    const at = (problem: string) => problems.push(`${page.path}: ${problem}`);
    const indexed = !expect.noindex.includes(page.path);

    if (head.lang !== expect.lang) at(`lang is ${head.lang ?? "missing"}, not ${expect.lang}`);
    if (head.viewport === undefined || !head.viewport.includes("width=device-width")) {
      at("no viewport meta with width=device-width");
    }
    if (head.title === undefined || head.title.trim() === "") at("no <title>");
    if (head.description === undefined || head.description.trim() === "") {
      at("no meta description");
    }
    if (head.h1Count !== 1) at(`${head.h1Count} <h1> elements, not one`);

    if (indexed) {
      const want = canonicalFor(expect.origin, page.path);
      if (head.canonical !== want) at(`canonical is ${head.canonical ?? "missing"}, not ${want}`);
      if (head.robots?.includes("noindex")) at("marked noindex");
      const title = head.title ?? "";
      if (title.length < TITLE_LENGTH.min || title.length > TITLE_LENGTH.max) {
        at(`title is ${title.length} characters, not ${TITLE_LENGTH.min}–${TITLE_LENGTH.max}`);
      }
      const description = head.description ?? "";
      if (
        description.length < DESCRIPTION_LENGTH.min ||
        description.length > DESCRIPTION_LENGTH.max
      ) {
        at(
          `description is ${description.length} characters, not ${DESCRIPTION_LENGTH.min}–${DESCRIPTION_LENGTH.max}`,
        );
      }
      for (const key of REQUIRED_SOCIAL) {
        if (!head.social.get(key)) at(`no ${key}`);
      }
      if (head.social.get("og:url") !== want) at(`og:url is not ${want}`);
      if (head.social.get("twitter:card") !== "summary_large_image") {
        at("twitter:card is not summary_large_image");
      }
      const image = head.social.get("og:image") ?? "";
      const wantImage = `${expect.origin}${expect.previewImages?.[page.path] ?? expect.previewImage}`;
      if (image !== wantImage) at(`og:image is ${image || "missing"}, not ${wantImage}`);
      if (head.social.get("twitter:image") !== image) at("twitter:image isn't og:image");
      if (!expect.files.includes(image.slice(expect.origin.length))) {
        at(`og:image ${image} isn't a built file`);
      }
    } else {
      if (head.canonical !== undefined) at("has a canonical but is kept out of search");
      if (!head.robots?.includes("noindex")) at("not marked noindex");
    }

    problems.push(...checkStructuredData(page.path, head, expect).map((p) => `${page.path}: ${p}`));

    // Astro drops the line break between a word and a link that starts the
    // next source line, gluing them together ("Theabout page").
    for (const m of page.html.matchAll(/[A-Za-z,.;:!?](<a\s[^>]*>|<strong>)([A-Za-z]+)/g)) {
      at(`no space before "${m[2]}": a link or bold text glued to the word before it`);
    }

    for (const href of head.links) {
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const target = href.replace(/[#?].*$/, "") || "/";
      if (!paths.has(target) && !expect.files.includes(target)) {
        at(`links to ${href}, which isn't a page`);
      }
      if (target !== "/" && target.endsWith("/")) at(`links to ${href}, with a trailing slash`);
    }
  }

  for (const field of ["title", "description"] as const) {
    const seen = new Map<string, string>();
    for (const { page, head } of heads) {
      const value = head[field];
      if (value === undefined) continue;
      const other = seen.get(value);
      if (other !== undefined) problems.push(`${page.path}: same ${field} as ${other}`);
      else seen.set(value, page.path);
    }
  }
  return problems;
}

function checkStructuredData(path: string, head: PageHead, expect: SiteExpectations): string[] {
  const problems: string[] = [];
  const blocks: Record<string, unknown>[] = [];
  for (const block of head.jsonLd) {
    if (typeof block === "string") problems.push(`JSON-LD doesn't parse: ${block}`);
    else blocks.push(block);
  }
  for (const block of blocks) {
    if (block["@context"] !== "https://schema.org") problems.push("JSON-LD without schema.org");
  }
  const ofType = (type: string) => blocks.filter((b) => b["@type"] === type);

  const sites = ofType("WebSite");
  if (sites.length !== 1) problems.push(`${sites.length} WebSite blocks, not one`);
  for (const site of sites) {
    if (typeof site.name !== "string" || site.name === "") problems.push("WebSite has no name");
    if (site.url !== `${expect.origin}/`) problems.push("WebSite url isn't the homepage");
  }

  const wanted = expect.structuredData[path] ?? [];
  for (const type of ["VideoGame", "BreadcrumbList"] as const) {
    const found = ofType(type);
    if (!wanted.includes(type)) {
      if (found.length > 0) problems.push(`unexpected ${type}`);
      continue;
    }
    if (found.length !== 1) {
      problems.push(`${found.length} ${type} blocks, not one`);
      continue;
    }
    problems.push(...(type === "VideoGame" ? checkGame : checkTrail)(found[0]!, path, expect));
  }
  return problems;
}

function checkGame(game: Record<string, unknown>, _path: string, expect: SiteExpectations) {
  const problems: string[] = [];
  for (const key of ["name", "description", "url", "image", "genre", "gamePlatform"]) {
    if (typeof game[key] !== "string" || game[key] === "") problems.push(`VideoGame has no ${key}`);
  }
  for (const key of ["url", "image"]) {
    const value = game[key];
    if (typeof value === "string" && !value.startsWith(`${expect.origin}/`)) {
      problems.push(`VideoGame ${key} isn't on ${expect.origin}`);
    }
  }
  if (typeof game.playMode !== "string" || !game.playMode.endsWith("SinglePlayer")) {
    problems.push("VideoGame playMode isn't SinglePlayer");
  }
  const offer = game.offers as Record<string, unknown> | undefined;
  if (offer?.["@type"] !== "Offer" || Number(offer.price) !== 0 || offer.priceCurrency !== "GBP") {
    problems.push("VideoGame offers isn't a free Offer in GBP");
  }
  return problems;
}

function checkTrail(list: Record<string, unknown>, path: string, expect: SiteExpectations) {
  const problems: string[] = [];
  const items = Array.isArray(list.itemListElement)
    ? (list.itemListElement as Record<string, unknown>[])
    : [];
  if (items.length < 2) problems.push("BreadcrumbList has fewer than two items");
  items.forEach((item, i) => {
    if (item["@type"] !== "ListItem") problems.push(`breadcrumb ${i + 1} isn't a ListItem`);
    if (item.position !== i + 1) problems.push(`breadcrumb ${i + 1} has position ${item.position}`);
    if (typeof item.name !== "string" || item.name === "") {
      problems.push(`breadcrumb ${i + 1} has no name`);
    }
    if (typeof item.item !== "string" || !item.item.startsWith(`${expect.origin}/`)) {
      problems.push(`breadcrumb ${i + 1} has no URL on ${expect.origin}`);
    }
  });
  const last = items.at(-1)?.item;
  if (items.length > 0 && last !== canonicalFor(expect.origin, path)) {
    problems.push("the breadcrumb's last item isn't this page");
  }
  return problems;
}

/** The sitemap's URLs, or its problems. */
export function checkSitemap(
  xml: string,
  pages: readonly BuiltPage[],
  expect: SiteExpectations,
): string[] {
  const problems: string[] = [];
  if (!xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) {
    problems.push("sitemap.xml: not a sitemaps.org urlset");
  }
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: /<loc>([^<]*)<\/loc>/.exec(m[1]!)?.[1] ?? "",
    lastmod: /<lastmod>([^<]*)<\/lastmod>/.exec(m[1]!)?.[1],
  }));
  const locs = entries.map((e) => e.loc);
  const want = pages
    .filter((p) => !expect.noindex.includes(p.path))
    .map((p) => canonicalFor(expect.origin, p.path));
  for (const loc of locs) {
    if (!want.includes(loc))
      problems.push(`sitemap.xml lists ${loc}, which isn't an indexable page`);
    if (loc.includes("/api/")) problems.push(`sitemap.xml lists ${loc}, under /api/`);
  }
  for (const url of want) {
    if (!locs.includes(url)) problems.push(`sitemap.xml is missing ${url}`);
  }
  if (new Set(locs).size !== locs.length) problems.push("sitemap.xml lists a URL twice");
  for (const e of entries) {
    if (e.lastmod === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(e.lastmod)) {
      problems.push(`sitemap.xml: ${e.loc} has no YYYY-MM-DD lastmod`);
    }
  }
  return problems;
}

export function checkRobots(text: string, origin: string): string[] {
  const problems: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line !== "");
  if (!lines.includes("User-agent: *")) problems.push("robots.txt: no User-agent: *");
  if (!lines.includes("Disallow: /api/")) problems.push("robots.txt: doesn't disallow /api/");
  const disallowed = lines.filter((l) => /^Disallow:/i.test(l)).map((l) => l.slice(9).trim());
  for (const path of disallowed) {
    if (path !== "/api/") problems.push(`robots.txt: disallows ${path || "(nothing)"}`);
  }
  if (!lines.includes(`Sitemap: ${origin}/sitemap.xml`)) {
    problems.push(`robots.txt: no Sitemap: ${origin}/sitemap.xml`);
  }
  return problems;
}

/** A PNG's size from its IHDR chunk, or null if it isn't a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
