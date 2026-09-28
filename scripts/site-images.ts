/**
 * `pnpm site:images` — draws the site's generated images into
 * `apps/web/public/`: the 1200 × 630 link preview (`og-image.png`) and the
 * app icons (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`), from the
 * placeholder favicon (`favicon.svg`).
 *
 * Each is an HTML page rendered by headless Chrome's own `--screenshot`, so
 * there is no dependency. The preview uses the site's real tokens and fonts:
 * `tokens.css` and the self-hosted font files are inlined, so it follows a
 * restyle when it's run again. No player photos: their licences need an
 * attribution a preview can't carry.
 *
 * Chrome is found at the usual install paths, or set `CHROME_PATH`. Re-run it
 * after changing the favicon, the brand or the tokens it uses, and commit the
 * PNGs; the build doesn't draw them.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { optimisePng } from "./png.js";
import { pngSize } from "./site-check.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps", "web");
const publicDir = join(web, "public");

/** Keep the preview small enough for every link-preview crawler. */
const MAX_OG_BYTES = 200 * 1024;

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function findChrome(): string {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (found === undefined) {
    throw new Error(
      "site:images: no Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.",
    );
  }
  return found;
}

function fontFace(family: string, file: string, weight: string, stretch?: string): string {
  const data = readFileSync(join(web, "node_modules", file)).toString("base64");
  return `@font-face {
  font-family: "${family}";
  font-weight: ${weight};
  ${stretch !== undefined ? `font-stretch: ${stretch};` : ""}
  src: url(data:font/woff2;base64,${data}) format("woff2");
}`;
}

/**
 * The preview's background alone, the site's floodlit night, drawn small.
 * Chrome dithers gradients, and that noise alone would make a full-size PNG
 * several hundred KB; drawn at a sixteenth of the size and scaled up (below), it
 * comes out smooth and compresses to a fraction of that.
 */
function ogBackgroundHtml(width: number, height: number): string {
  const tokens = readFileSync(join(web, "src", "styles", "tokens.css"), "utf8");
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
${tokens}
html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
body { background: var(--bg-lights), var(--bg-vignette), var(--night); }
</style></head><body></body></html>`;
}

/**
 * A link preview's page: 1200 × 630, the site's fonts and tokens inline, the
 * pre-drawn floodlit background, then the preview's own styles and markup.
 */
function previewHtml(background: string, css: string, body: string): string {
  const tokens = readFileSync(join(web, "src", "styles", "tokens.css"), "utf8");
  const fonts = [
    fontFace(
      "Archivo Variable",
      "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2",
      "100 900",
      "62% 125%",
    ),
    fontFace("Cinzel", "@fontsource/cinzel/files/cinzel-latin-600-normal.woff2", "600"),
  ].join("\n");
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8" />
<style>
${fonts}
${tokens}
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body {
  background: url(data:image/png;base64,${background}) center / 100% 100% no-repeat, var(--night);
  color: var(--chalk);
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
}
h1, p { margin: 0; }
.url {
  position: absolute; bottom: 36px; left: 0; right: 0;
  font-size: 24px; letter-spacing: 0.06em; color: var(--dim);
  font-variation-settings: var(--fv-caps);
}
${css}
</style></head>
<body>
${body}
  <p class="url">biggerthangame.com</p>
</body></html>`;
}

/** The default preview, every page but the game: the brand in gold, the deck in Cinzel. */
function ogHtml(background: string): string {
  const css = `
.rule { width: 360px; height: 2px; background: linear-gradient(90deg, transparent, var(--gold), transparent); opacity: 0.7; }
.brand {
  margin: 34px 0 0;
  font-size: 92px; line-height: 1;
  font-variation-settings: var(--fv-display);
  letter-spacing: var(--tracking-display);
  color: var(--gold);
  text-shadow: 0 0 28px rgba(var(--glow-rgb), 0.55);
  white-space: nowrap;
}
.deck {
  margin: 30px 0 34px;
  font-family: var(--font-display); font-weight: 600;
  font-size: 46px; letter-spacing: 0.08em;
  background: var(--legends-gradient);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: var(--legends-shadow);
}
.deck .dot { padding: 0 0.35em; }`;
  const body = `
  <div class="rule"></div>
  <h1 class="brand">Bigger Than Game</h1>
  <p class="deck">Football Legends<span class="dot">·</span>Higher or Lower</p>
  <div class="rule"></div>`;
  return previewHtml(background, css, body);
}

/**
 * The game page's preview: the start panel's brand ("Than" in gold, in the
 * gold glow), "Football Legends" in Cinzel, the mode, and a plaque as the game
 * draws it (the basic tier's colour, gold rim, gloss, bevel, a glow in its own
 * colour) with a first question. Big type, so it still reads as a thumbnail.
 */
function ogFriendlyHtml(background: string): string {
  const css = `
body { justify-content: flex-start; padding-top: 72px; box-sizing: border-box; }
.brand {
  font-size: 58px; line-height: 1;
  font-variation-settings: var(--fv-display);
  letter-spacing: var(--tracking-display);
  text-shadow: 0 0 24px rgba(var(--glow-rgb), 0.6);
  white-space: nowrap;
}
.brand em { font-style: normal; color: var(--gold); }
.deck {
  margin-top: 16px;
  font-family: var(--font-display); font-weight: var(--fw-legends);
  font-size: 76px; line-height: 1.05; letter-spacing: var(--tracking-legends);
  background: var(--legends-gradient);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: var(--legends-shadow) drop-shadow(0 0 10px rgba(var(--glow-rgb), 0.5));
}
.mode {
  margin-top: 14px;
  font-size: 30px; letter-spacing: 0.16em; text-transform: uppercase;
  font-variation-settings: var(--fv-caps);
  color: var(--gold);
  text-shadow: 0 0 14px rgba(var(--glow-rgb), 0.6);
}
.mode .dot { padding: 0 0.4em; }
/* The plaque: the rim is the outer pill, the tier's glass the inner one. */
.plaque {
  --tier: var(--t-basic);
  margin-top: 40px;
  padding: 4px;
  border-radius: 999px;
  background: var(--plaque-rim);
  box-shadow:
    0 8px 26px rgba(0, 0, 0, 0.5),
    0 0 26px 2px color-mix(in srgb, var(--tier) var(--plaque-glow-strength), transparent);
}
.glass {
  width: 640px; height: 96px;
  border-radius: 999px;
  background: var(--plaque-gloss), var(--tier);
  box-shadow: inset 0 3px 3px rgba(255, 255, 255, 0.45), inset 0 -5px 8px rgba(0, 0, 0, 0.3);
  display: flex; align-items: center; justify-content: center;
  color: var(--ink);
  font-size: 44px;
  font-variation-settings: var(--fv-plaque);
}
.question {
  margin-top: 28px;
  font-size: 40px;
  font-variation-settings: var(--fv-heading);
  color: var(--chalk);
}`;
  const body = `
  <p class="brand">Bigger <em>Than</em> Game</p>
  <h1 class="deck">Football Legends</h1>
  <p class="mode">Friendly<span class="dot">·</span>20 questions</p>
  <div class="plaque"><div class="glass">International caps</div></div>
  <p class="question">Higher or lower?</p>`;
  return previewHtml(background, css, body);
}

/**
 * An app icon: the favicon's mark, full-bleed on --ink. The favicon's rounded
 * corners are ink on ink, so the square is solid; phones round it themselves.
 * The mark sits well inside the maskable safe zone.
 */
function iconHtml(size: number): string {
  const svg = readFileSync(join(publicDir, "favicon.svg")).toString("base64");
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
html, body { margin: 0; width: ${size}px; height: ${size}px; overflow: hidden; background: #06121a; }
img { display: block; width: ${size}px; height: ${size}px; }
</style></head>
<body><img src="data:image/svg+xml;base64,${svg}" alt="" /></body></html>`;
}

function render(chrome: string, html: string, width: number, height: number, out: string): void {
  const dir = mkdtempSync(join(tmpdir(), "bt-site-images-"));
  try {
    const page = join(dir, "page.html");
    writeFileSync(page, html);
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--user-data-dir=${join(dir, "profile")}`,
        `--window-size=${width},${height}`,
        `--screenshot=${out}`,
        // Fonts are inline; give them a moment to decode before the shot.
        "--virtual-time-budget=2000",
        pathToFileURL(page).href,
      ],
      { stdio: "pipe" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Chrome compresses quickly; recompress losslessly, same pixels.
  writeFileSync(out, optimisePng(readFileSync(out)));
  const size = pngSize(readFileSync(out));
  if (size === null || size.width !== width || size.height !== height) {
    throw new Error(`site:images: ${out} came out ${JSON.stringify(size)}, not ${width}×${height}`);
  }
}

function main(): void {
  const chrome = findChrome();
  const scratch = mkdtempSync(join(tmpdir(), "bt-og-bg-"));
  let background: string;
  try {
    const small = join(scratch, "background.png");
    render(chrome, ogBackgroundHtml(75, 40), 75, 40, small);
    background = readFileSync(small).toString("base64");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const jobs: [string, string, number, number][] = [
    ["og-image.png", ogHtml(background), 1200, 630],
    ["og-friendly.png", ogFriendlyHtml(background), 1200, 630],
    ["apple-touch-icon.png", iconHtml(180), 180, 180],
    ["icon-192.png", iconHtml(192), 192, 192],
    ["icon-512.png", iconHtml(512), 512, 512],
  ];
  for (const [name, html, width, height] of jobs) {
    const out = join(publicDir, name);
    render(chrome, html, width, height, out);
    const kb = Math.round(statSync(out).size / 1024);
    console.log(`site:images: ${name} ${width}×${height}, ${kb} KB`);
  }
  for (const name of ["og-image.png", "og-friendly.png"]) {
    const bytes = statSync(join(publicDir, name)).size;
    if (bytes > MAX_OG_BYTES) {
      throw new Error(`site:images: ${name} is ${Math.round(bytes / 1024)} KB, over 200 KB`);
    }
  }
}

main();
