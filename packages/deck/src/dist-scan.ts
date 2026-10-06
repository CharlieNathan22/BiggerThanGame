/**
 * The post-build leak scan over the built site, `apps/web/dist`.
 * ARCHITECTURE.md §4, invariant 1: the client never receives a stat value it
 * hasn't been shown.
 *
 * The browser's only source of player data is the round response, so the
 * built site should hold none. The ESLint import ban stops the obvious leak at
 * the source; this checks what actually ships. Two checks, over every text
 * file in the output:
 *
 * 1. **No player id, anywhere.** Ids only exist in the deck and the round
 *    payload; one in the bundle means deck data was imported. This check is
 *    never relaxed.
 * 2. **No stat value near a player's name.** Names legitimately appear — the
 *    credits page lists every photographed player — so a value is only a leak
 *    when it sits within `NAME_WINDOW` characters of that player's name, as
 *    raw data (`"caps":105`) or as a card shows it (`€72m`, `1,234`).
 *
 * Check 2 reads text the way a person would, so it can't be tripped by
 * markup: HTML entities are decoded, and comments (Svelte's hydration markers
 * are `<!--[-1-->`), link targets, Astro's scoping attributes, inline styles
 * and licence codes (`CC-BY-SA-2.5`) are removed first. So is any element
 * marked `data-scan="attribution"`: the credits page's photo attribution,
 * written by photographers ("No 10 Downing Street") and read from
 * `credits.json`, which holds no stat values. Only the name window is narrowed
 * — the id check always sees the raw file.
 */

import { STATS, STAT_KEYS } from "@bt/core";
import type { Player } from "@bt/core";

/** How far either side of a player's name a value counts as next to it. */
export const NAME_WINDOW = 500;

export interface DistFile {
  /** Relative to the dist folder, for the report. */
  readonly path: string;
  readonly text: string;
}

/** The file types a leak could hide in. Images and fonts are skipped. */
export const SCANNED_EXTENSIONS = [
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".txt",
  ".xml",
  ".svg",
  ".webmanifest",
];

export function scanDist(
  files: readonly DistFile[],
  players: readonly Player[],
  now: Date,
): string[] {
  const problems: string[] = [];
  for (const file of files) {
    for (const player of players) {
      if (containsId(file.text, player.id)) {
        problems.push(`${file.path} contains the player id "${player.id}"`);
      }
    }
    const readable = readableText(file.path, file.text);
    for (const player of players) {
      problems.push(...valuesNearName(readable, player, now).map((p) => `${file.path}: ${p}`));
    }
  }
  return [...new Set(problems)];
}

/** An id as a whole token: not part of a longer id or word. */
function containsId(text: string, id: string): boolean {
  return new RegExp(`(^|[^a-z0-9-])${escape(id)}([^a-z0-9-]|$)`).test(text);
}

/** Every value of `player` that sits within `NAME_WINDOW` of their name in `text`. */
export function valuesNearName(text: string, player: Player, now: Date): string[] {
  const windows: string[] = [];
  for (let at = text.indexOf(player.name); at !== -1; at = text.indexOf(player.name, at + 1)) {
    windows.push(text.slice(Math.max(0, at - NAME_WINDOW), at + player.name.length + NAME_WINDOW));
  }
  if (windows.length === 0) return [];

  const problems: string[] = [];
  for (const key of STAT_KEYS) {
    const def = STATS[key];
    const value = def.get(player, now);
    if (value === undefined) continue;
    const forms = new Set([String(value), def.format(value)]);
    for (const form of forms) {
      // Whole numbers only: not inside a word or a longer number (`1105`, `v105`,
      // `105px`, `1,105`, `105.5`), but a sentence's comma or full stop is fine.
      const pattern = new RegExp(`(?<![0-9A-Za-z_.]|\\d,)${escape(form)}(?![0-9A-Za-z_]|[.,]\\d)`);
      if (windows.some((w) => pattern.test(w))) {
        problems.push(
          `"${form}" (${player.id}'s ${key}) appears within ${NAME_WINDOW} characters of ` +
            `"${player.name}" — invariant 1 says no stat value may reach the client`,
        );
      }
    }
  }
  return problems;
}

/** Licence codes as the credits page prints them: `CC0`, `CC-BY-2.5`, `CC-BY-SA-3.0-BR`. */
const LICENCE_CODE = /\bCC(?:0|-BY(?:-SA)?-\d\.\d(?:-[A-Z]{2})?)\b/g;

/**
 * The file's text as a reader meets it, for the name window only: entities
 * decoded, and the markup that carries numbers but no data removed.
 */
export function readableText(path: string, text: string): string {
  let out = decodeEscapes(text);
  if (path.endsWith(".html")) {
    out = out
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(\w+)\b[^>]*\sdata-scan="attribution"[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/\s(?:href|src|srcset)="[^"]*"/gi, " ")
      .replace(/\sdata-astro-[\w-]+(?:="[^"]*")?/gi, " ")
      .replace(/\sstyle="[^"]*"/gi, " ");
  }
  return out.replace(LICENCE_CODE, " ");
}

function decodeEscapes(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Markers of `pnpm dev`'s tools, which a production build must drop entirely
 * (apps/web's game/dev.ts sits behind `import.meta.env.DEV`). Any one of them
 * in the built site means a dev branch was bundled.
 */
export const DEV_TOOL_MARKERS = ["mockEnd"] as const;

/** Every file in the built site that carries a dev tool's marker. */
export function devToolsIn(files: readonly DistFile[]): string[] {
  return files.flatMap((file) =>
    DEV_TOOL_MARKERS.filter((marker) => file.text.includes(marker)).map(
      (marker) => `${file.path} contains "${marker}", a pnpm dev tool`,
    ),
  );
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
