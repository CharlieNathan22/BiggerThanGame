/**
 * `pnpm check:site` — the search checks (site-check.ts) over the built site,
 * `apps/web/dist`. Runs as the last step of `pnpm build` and `pnpm
 * build:prod`, after the leak scan, so CI and every deploy fail on a page
 * without its title, description, canonical, preview tags or structured data,
 * a sitemap that disagrees with the pages, or a missing preview image.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPages, checkRobots, checkSitemap, pngSize, siteExpectations } from "./site-check.js";
import type { BuiltPage } from "./site-check.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps", "web", "dist");

/** Every generated image, at the size it must be (scripts/site-images.ts). */
const IMAGES: readonly [string, number, number][] = [
  ["og-image.png", 1200, 630],
  ["og-friendly.png", 1200, 630],
  ["apple-touch-icon.png", 180, 180],
  ["icon-192.png", 192, 192],
  ["icon-512.png", 512, 512],
];
const MAX_OG_BYTES = 200 * 1024;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** `about.html` → `/about`, `index.html` → `/`, as the site serves them. */
function servedPath(file: string): string {
  return `/${file}`.replace(/(\/index)?\.html$/, "") || "/";
}

function main(): number {
  if (!existsSync(dist)) {
    console.error(`check:site: ${dist} not found. Build the site first.`);
    return 1;
  }
  const files = walk(dist).map((path) => relative(dist, path).replace(/\\/g, "/"));
  const pages: BuiltPage[] = files
    .filter((f) => f.endsWith(".html"))
    .map((f) => ({ path: servedPath(f), html: readFileSync(join(dist, f), "utf8") }));

  const expect = siteExpectations(files.filter((f) => !f.endsWith(".html")).map((f) => `/${f}`));

  const problems = [...checkPages(pages, expect)];
  const read = (file: string) =>
    existsSync(join(dist, file)) ? readFileSync(join(dist, file), "utf8") : null;
  const sitemap = read("sitemap.xml");
  const robots = read("robots.txt");
  if (sitemap === null) problems.push("sitemap.xml is missing");
  else problems.push(...checkSitemap(sitemap, pages, expect));
  if (robots === null) problems.push("robots.txt is missing");
  else problems.push(...checkRobots(robots, expect.origin));

  for (const [file, width, height] of IMAGES) {
    const path = join(dist, file);
    const size = existsSync(path) ? pngSize(readFileSync(path)) : null;
    if (size?.width !== width || size.height !== height) {
      problems.push(`${file} isn't a ${width}×${height} PNG (run pnpm site:images)`);
    }
  }
  for (const name of ["og-image.png", "og-friendly.png"]) {
    const og = join(dist, name);
    if (existsSync(og) && statSync(og).size > MAX_OG_BYTES) {
      problems.push(`${name} is over ${MAX_OG_BYTES / 1024} KB`);
    }
  }
  for (const file of ["favicon.ico", "favicon.svg", "site.webmanifest"]) {
    if (!files.includes(file)) problems.push(`${file} is missing`);
  }

  console.log(`check:site: ${pages.length} page(s) in ${relative(root, dist)}`);
  if (problems.length === 0) {
    console.log(
      "  titles, descriptions, canonicals, previews, structured data, sitemap and robots.txt all in order",
    );
    return 0;
  }
  console.error(`\ncheck:site: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  return 1;
}

process.exit(main());
