/**
 * `/sitemap.xml`, written at build time: every page in search (all but the
 * 404) at its canonical URL, with the date its page file last changed.
 *
 * `lastmod` is the last commit to the page's `.astro` file, which is where
 * each page's copy lives; a file with uncommitted changes, or a build without
 * git history, gets the build date. A shallow clone (CI's default) has one
 * commit, so there every page gets that commit's date. The themes' pages
 * (lib/themes.ts) share one file, their route's.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { APIRoute } from "astro";
import { indexablePages, absoluteUrl, sitemapXml } from "../lib/seo";
import { themePages } from "../lib/themes";

// Astro bundles this file before running it, so its own URL isn't in
// src/pages. The build runs in apps/web.
const pagesDir = join(process.cwd(), "src", "pages");

/** The route every theme's page is built from. */
const THEME_ROUTE = join(pagesDir, "football-higher-or-lower", "legends", "[kind]", "[slug].astro");

function sourceOf(page: string, themes: ReadonlySet<string>): string {
  if (themes.has(page)) return THEME_ROUTE;
  return join(pagesDir, `${page === "/" ? "index" : page.slice(1)}.astro`);
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: pagesDir, encoding: "utf8", stdio: "pipe" }).trim();
}

function lastChanged(file: string, today: string): string {
  try {
    if (git(["status", "--porcelain", "--", file]) !== "") return today;
    const date = git(["log", "-1", "--format=%cs", "--", file]);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  } catch {
    return today;
  }
}

export const GET: APIRoute = () => {
  const today = new Date().toISOString().slice(0, 10);
  const themes = new Set(themePages().map((page) => page.path));
  const entries = indexablePages([...themes]).map((page) => ({
    loc: absoluteUrl(page),
    lastmod: lastChanged(sourceOf(page, themes), today),
  }));
  return new Response(sitemapXml(entries), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
};
