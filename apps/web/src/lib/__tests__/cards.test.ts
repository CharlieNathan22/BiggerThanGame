/**
 * The homepage's, the football hub's and the Legends page's cards: every piece
 * of text on them, the dimmed "Coming soon" cards included, meets WCAG AA
 * (4.5:1) on its background.
 * Read from tokens.css, so a restyle that dims a card too far fails here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(
  fileURLToPath(new URL("../../styles/tokens.css", import.meta.url)),
  "utf8",
);

/** Every custom property in tokens.css's first `:root`, before any media query. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const root = css.replace(/\/\*[\s\S]*?\*\//g, "").split("@media")[0] ?? "";
  for (const match of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1] as string, (match[2] as string).trim());
  }
  return out;
}

const tokens = declarations(tokensCss);

type Rgba = readonly [number, number, number, number];

function resolve(value: string): string {
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (ref === null) return value;
  const next = tokens.get(ref[1] as string);
  if (next === undefined) throw new Error(`${ref[1]} missing from tokens.css`);
  return resolve(next);
}

function colour(property: string): Rgba {
  const value = resolve(tokens.get(property) ?? `missing ${property}`);
  if (value === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgba) {
    const [r, g, b, a] = rgba.slice(1).map((x) => (x === undefined ? 1 : Number(x)));
    return [r as number, g as number, b as number, a as number];
  }
  throw new Error(`${property}: can't read "${value}" as a colour`);
}

/** `top` drawn over an opaque `under`. */
function over(top: Rgba, under: Rgba): Rgba {
  const mix = (i: 0 | 1 | 2) => top[i] * top[3] + under[i] * (1 - top[3]);
  return [mix(0), mix(1), mix(2), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("card text contrast", () => {
  const page = colour("--night");
  const live = over(colour("--card-bg"), page);
  const soon = over(colour("--card-soon-bg"), page);

  it.each([
    ["an open card's name", "--card-name", live],
    ["an open card's description", "--card-body", live],
    ["a coming-soon card's name and description", "--card-soon-text", soon],
    ['a mode\'s "Your best" line', "--card-best", live],
    ['Instagram Endless\'s pink: its title on hover and its "Your best" line', "--instagram", live],
  ] as const)("%s meets AA", (_, property, background) => {
    const text = over(colour(property), background);
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("dims a coming-soon card: its name is quieter than an open card's", () => {
    const openName = contrast(over(colour("--card-name"), live), live);
    const soonName = contrast(over(colour("--card-soon-text"), soon), soon);
    expect(soonName).toBeLessThan(openName);
  });
});
