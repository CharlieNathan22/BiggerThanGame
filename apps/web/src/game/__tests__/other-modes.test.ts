/**
 * "Try other modes" on every game-over panel: a link to the Legends page, the
 * last of the panel's actions, never inside a condition, so it shows on every
 * end panel in every mode. Endless, Instagram Endless, the squads and Friendly
 * (wins and losses alike) share one game-over panel; Daily Ranked's game-over
 * panel and its already-played result are the daily panel's "played" state.
 * Read from Game.svelte's source: the built page is checked in a browser.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { LEGENDS_PATH } from "../../lib/paths";

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const game = source("../../components/game/Game.svelte");
const tokensCss = source("../../styles/tokens.css");

const LINK = '<a class="cta othermodes" href={LEGENDS_PATH}>{t("over.otherModes")}</a>';

/** The text from `start` up to the end of the panel it opens. */
function block(start: string, end: string): string {
  const from = game.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const to = game.indexOf(end, from);
  expect(to, end).toBeGreaterThan(from);
  return game.slice(from, to);
}

/** The inside of the first `<div class="actions">` in `markup`, to its matching `</div>`. */
function actions(markup: string): string {
  const open = '<div class="actions">';
  const from = markup.indexOf(open);
  expect(from).toBeGreaterThan(-1);
  let depth = 1;
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = from + open.length;
  for (let m = tags.exec(markup); m !== null; m = tags.exec(markup)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return markup.slice(from + open.length, m.index);
  }
  throw new Error("unclosed actions");
}

/** How many `{#if}` / `{#each}` blocks are open at `index` of `markup`. */
function blockDepth(markup: string, index: number): number {
  const before = markup.slice(0, index);
  const opened = (before.match(/\{#(if|each)\b/g) ?? []).length;
  const closed = (before.match(/\{\/(if|each)\}/g) ?? []).length;
  return opened - closed;
}

const panels = {
  // Every mode but Daily Ranked, the wins included ("You won", "Squad cleared").
  "the game-over panel": block('{:else if phase === "over" && !ranked}', "{/if}\n  </main>"),
  // Daily Ranked after a run, and today's result when already played.
  "Daily Ranked's result": block('{:else if daily.kind === "played"}', "{/snippet}"),
};

describe("Try other modes", () => {
  it("is a link to the Legends page, labelled from i18n", () => {
    expect(LEGENDS_PATH).toBe("/football-higher-or-lower/legends");
    expect(t("over.otherModes")).toBe("Try other modes");
    expect(game).toMatch(/^\s+LEGENDS_PATH,$/m);
    // A link, not a button, and in this tab.
    expect(LINK).not.toMatch(/target=|<button/);
  });

  it("is on exactly the two end panels", () => {
    expect(game.split(LINK).length - 1).toBe(2);
  });

  describe.each(Object.entries(panels))("on %s", (_, panel) => {
    const inner = actions(panel);
    const at = inner.indexOf(LINK);

    it("is always there: in the actions, outside every condition", () => {
      expect(at).toBeGreaterThan(-1);
      expect(blockDepth(inner, at)).toBe(0);
    });

    it("is the last button, below the others", () => {
      const after = inner.slice(at + LINK.length);
      expect(after).not.toMatch(/<(button|a)\b/);
      // Below Play again (or the board link in its place on Daily) and the shares.
      expect(inner.indexOf('class="cta"')).toBeLessThan(at);
      expect(inner.indexOf('<div class="shares">')).toBeLessThan(at);
    });
  });

  it("covers every mode: the game-over panel is every mode's but Daily Ranked's", () => {
    expect(game).toMatch(/\{:else if phase === "over" && !ranked\}/);
    // The shared panel's win: "You won", or "Squad cleared" for a squad.
    expect(panels["the game-over panel"]).toMatch(/\{#if won\}/);
    expect(panels["the game-over panel"]).toMatch(/t\("over\.squadCleared"\)/);
  });

  it("is Play again's button in a chrome band, from the tokens, with a still band under reduced motion", () => {
    const rule = /\.actions > a\.cta\.othermodes \{([\s\S]*?)\n {2}\}/.exec(game)?.[1] ?? "";
    expect(rule).toMatch(/border: var\(--chrome-band-w\) solid transparent/);
    expect(rule).toMatch(/linear-gradient\(var\(--gold\), var\(--gold\)\) padding-box/);
    expect(rule).toMatch(/var\(--chrome-band\) border-box/);
    expect(rule).toMatch(/padding: 0 calc\(var\(--cta-pad-x\) - var\(--chrome-band-w\)\)/);
    expect(game).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s+\.actions > a\.cta\.othermodes:hover \{\s+animation: none;/,
    );
    for (const token of ["--silver-hi", "--silver", "--silver-mid", "--silver-lo"]) {
      expect(tokensCss).toMatch(new RegExp(`${token}: #[0-9a-f]{6};`));
    }
    // The silver sits with the gold.
    expect(tokensCss.indexOf("--silver-hi:")).toBeGreaterThan(tokensCss.indexOf("--gold-rule:"));
    expect(tokensCss.indexOf("--silver-hi:") - tokensCss.indexOf("--gold-rule:")).toBeLessThan(200);
  });
});
