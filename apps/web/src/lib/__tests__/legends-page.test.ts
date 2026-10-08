/**
 * The Legends page's modes (DESIGN.md §17): their order — Daily Ranked, in
 * gold at the top, then Endless, Instagram Endless, Friendly, then "Clear the
 * squad"'s Clubs, Leagues and Eras — the theme sections' grid, and the cards'
 * "Your best" lines from this device. Read from the page and card sources: the built page is
 * checked by `pnpm check:site`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const page = source("../../pages/football-higher-or-lower/legends.astro");
const card = source("../../components/Card.astro");
const cardsList = source("../../components/Cards.astro");
const dailyStatus = source("../../components/DailyCardStatus.svelte");

/** Each `<Card …/>` or `<Card …>` on the page, in order, as its attribute text. */
const cards = [...page.matchAll(/<Card\b([^>]*?)\/?>/g)].map((m) => m[1] ?? "");
const nameOf = (attrs: string) =>
  /name=\{t\("mode\.(\w+)\.name"\)\}/.exec(attrs)?.[1] ??
  (/name=\{theme\.name\}/.test(attrs) ? "theme" : undefined);

/** The card's inline scripts: the mode's best, and a squad's. */
const scripts = [...card.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
const modeScript = scripts.find((s) => s.includes("data-best-key")) ?? "";
const squadScript = scripts.find((s) => s.includes("data-squad-key")) ?? "";

describe("the Legends page's modes", () => {
  it("run Daily Ranked first, then Endless, Instagram Endless, Friendly and the themes", () => {
    expect(cards.map(nameOf)).toEqual(["ranked", "endless", "instagram", "friendly", "theme"]);
    for (const attrs of cards.slice(0, 4)) expect(attrs).toMatch(/\bwide\b/);
  });

  it("put the themes in a section per type, after the modes", () => {
    const at = (text: string) => page.indexOf(text);
    expect(page).toMatch(/THEME_TYPES\.map\(\(type\) =>/);
    expect(page).toMatch(/<h2 class="themes-heading" id=\{`themes-\$\{type\}`\}>/);
    expect(page).toMatch(/\{t\(`themes\.\$\{type\}`\)\}/);
    expect(page).toMatch(/<Cards label=\{t\(`themes\.\$\{type\}`\)\} grid>/);
    expect(at("themes-heading")).toBeGreaterThan(at('t("mode.friendly.name")'));
    expect(at("themes-heading")).toBeGreaterThan(at('t("mode.ranked.name")'));
    // A type the deck has no theme of gets no section.
    expect(page).toMatch(/\.filter\(\(section\) => section\.themes\.length > 0\)/);
  });

  it("head each section in the gold Cinzel with its glow, centred", () => {
    const style = /\.themes-heading \{([\s\S]*?)\}/.exec(page)?.[1] ?? "";
    expect(style).toMatch(/font-family: var\(--font-display\)/);
    expect(style).toMatch(/color: var\(--gold\)/);
    expect(style).toMatch(/text-shadow: var\(--heading-glow\)/);
    expect(style).toMatch(/text-align: center/);
  });

  it("give Daily Ranked the gold card, its game, its board and its live lines", () => {
    const ranked = cards[0]!;
    expect(ranked).toMatch(/href=\{DAILY_PATH\}/);
    expect(ranked).toMatch(/accent="daily"/);
    expect(ranked).toMatch(/extra=\{\{ href: DAILY_LEADERBOARD_PATH/);
    expect(page).toMatch(/<DailyCardStatus client:load \/>/);
    // Nothing is coming soon any more.
    expect(page).not.toMatch(/mode\.soon/);
  });

  it("show this device's best on every open mode's and theme's card", () => {
    expect(cards[1]).toMatch(/bestKey=\{bestKey\("legends", "endless"\)\}/);
    expect(cards[2]).toMatch(/bestKey=\{bestKey\("legends", "endless-instagram"\)\}/);
    expect(cards[3]).toMatch(/bestKey=\{bestKey\("legends", "friendly"\)\}/);
    expect(cards[3]).toMatch(/bestOf=\{WIN_ROUNDS\.friendly \?\? undefined\}/);
    expect(cards[4]).toMatch(/bestKey=\{bestKey\("legends", squadVariantId\(theme\)\)\}/);
    expect(cards[4]).toMatch(/bestOf=\{squadQuestions\(theme\.players\)\}/);
    // Daily Ranked shows today's result instead.
    expect(cards[0]).not.toMatch(/bestKey=/);
  });

  it("give each theme its page, its player count and its colours", () => {
    const theme = cards[4]!;
    expect(theme).toMatch(/href=\{themePagePath\(theme\)\}/);
    expect(theme).toMatch(/body=\{themeText\("theme\.players", theme\)\}/);
    expect(theme).toMatch(/colours: themeColours\(theme\)/);
  });

  it("give Instagram Endless its page, accent and best line, and no leaderboard button", () => {
    const instagram = cards[2]!;
    expect(instagram).toMatch(/href=\{INSTAGRAM_PATH\}/);
    expect(instagram).toMatch(/accent="instagram"/);
    expect(instagram).not.toMatch(/extra=/);
    expect(cards[1]).toMatch(/extra=/);
  });
});

describe("the Daily card's button place", () => {
  const markup = dailyStatus.slice(
    dailyStatus.indexOf('<div class="status">'),
    dailyStatus.indexOf("<style>"),
  );
  const style = dailyStatus.slice(dailyStatus.indexOf("<style>"));
  const action = markup.slice(markup.indexOf('<div class="action">'));
  const rule = (selector: string) =>
    new RegExp(`(^|\\n)\\s*${selector.replace(/[.()]/g, (c) => `\\${c}`)} \\{([^}]*)\\}`).exec(
      style,
    )?.[2] ?? "";

  it("puts every state in the one action area: the placeholder, Play, Carry on, and done", () => {
    expect(markup.match(/<div class="action">/g)).toHaveLength(1);
    expect(action).toMatch(/class="pill pending"/);
    expect(action).toMatch(/class="pill play"/);
    expect(action).toMatch(/t\("daily\.resume"\)/);
    expect(action).toMatch(/t\("mode\.ranked\.play"\)/);
    expect(action).toMatch(/class="result"/);
    expect(action).toMatch(/class="done" role="status"/);
  });

  it("never collapses: it keeps one height, at least the 44px target, in every state", () => {
    expect(rule(".action")).toMatch(/min-height: var\(--daily-card-action-h\);/);
    const tokens = source("../../styles/tokens.css");
    const h = Number(/--daily-card-action-h: (\d+)px;/.exec(tokens)?.[1]);
    expect(h).toBeGreaterThanOrEqual(44);
    // The lines above it keep their height while they're still empty, before mount.
    expect(rule(".game")).toMatch(/min-height: 1lh;/);
    expect(rule(".next")).toMatch(/min-height: 1lh;/);
    // The placeholder is Play's size: the same pill, with Play's words, hidden.
    expect(action).toMatch(
      /class="pill pending" aria-hidden="true"\s*><span class="ghost">\{t\("mode\.ranked\.play"\)\}/,
    );
    expect(rule(".ghost")).toMatch(/visibility: hidden;/);
  });

  it("starts out asking, never showing Play before the server has answered", () => {
    expect(dailyStatus).toMatch(/let action = \$state<CardAction>\(\{ kind: "pending" \}\);/);
  });

  it("glows on Play and Carry on only: the placeholder and the done line never do", () => {
    expect(rule(".play")).toMatch(/box-shadow: var\(--glow\);/);
    expect(style).toMatch(/:global\(\.card\.open:hover\) \.play,/);
    expect(style).toMatch(
      /:global\(\.card\.open:active\) \.play \{\s*box-shadow: var\(--glow-strong\);/,
    );
    expect(rule(".done")).not.toMatch(/box-shadow|transform|cursor/);
    expect(rule(".pending")).not.toMatch(/box-shadow/);
    // No hover, focus or press rule reaches the done line or the placeholder.
    expect(style).not.toMatch(/\)\s*\.(done|pending)\b/);
  });
});

describe("the themes' grid", () => {
  it("is four to a row from 900px, two below, one on the narrowest phones", () => {
    expect(cardsList).toMatch(/\.cards\.grid \{[^}]*--grid-cols: 1;/);
    expect(cardsList).toMatch(
      /@media \(min-width: 360px\) \{\s*\.cards\.grid \{\s*--grid-cols: 2;/,
    );
    expect(cardsList).toMatch(
      /@media \(min-width: 900px\)[\s\S]*\.cards\.grid \{\s*--grid-cols: 4;/,
    );
    expect(cardsList).toMatch(/align-items: stretch/);
  });

  it("centres a row that isn't full, rather than starting it from the left", () => {
    const grid = /\.cards\.grid \{([^}]*)\}/.exec(cardsList)?.[1] ?? "";
    expect(grid).toMatch(/display: flex/);
    expect(grid).toMatch(/flex-wrap: wrap/);
    expect(grid).toMatch(/justify-content: center/);
    // Each card a column's width, gaps included, so full rows line up as a grid would.
    expect(cardsList).toMatch(
      /flex: 0 0 calc\(\(100% - \(var\(--grid-cols\) - 1\) \* var\(--card-gap\)\) \/ var\(--grid-cols\)\)/,
    );
  });

  it("gives every theme card the same minimum height, over the 44px target", () => {
    expect(card).toMatch(/\.card\.theme \{\s*min-height: var\(--theme-card-min-h\);/);
    const tokens = source("../../styles/tokens.css");
    const min = /--theme-card-min-h: (\d+)px;/.exec(tokens)?.[1];
    expect(Number(min)).toBeGreaterThanOrEqual(44);
  });
});

/** A best line and its card, standing in for the DOM the inline scripts read. */
function runScript(
  script: string,
  attrs: Record<string, string>,
  storage: () => string | null,
  of = "",
): { text: string; hidden: boolean } {
  const line = {
    textContent: "",
    hidden: true,
    getAttribute: (name: string) => attrs[name] ?? null,
    style: { getPropertyValue: (name: string) => (name === "--best-of" ? ` ${of}` : "") },
  };
  const key = Object.keys(attrs).find((name) => name.endsWith("-key"))!;
  const card = { querySelector: (selector: string) => (selector === `[${key}]` ? line : null) };
  const document = { currentScript: { parentElement: card } };
  const localStorage = { getItem: storage };
  new Function("document", "localStorage", script)(document, localStorage);
  return { text: line.textContent, hidden: line.hidden };
}

describe("a mode card's best line", () => {
  const runWith = (storage: () => string | null, of = "") =>
    runScript(
      modeScript,
      {
        "data-best-key": "bt:best:legends:endless-instagram",
        "data-template": "Your best: {best}",
      },
      storage,
      of,
    );

  it("shows this device's best", () => {
    expect(runWith(() => "14")).toEqual({ text: "Your best: 14", hidden: false });
  });

  it("shows a best out of the mode's target where it has one", () => {
    expect(runWith(() => "12", "20")).toEqual({ text: "Your best: 12/20", hidden: false });
    expect(runWith(() => "0", "20")).toEqual({ text: "", hidden: true });
  });

  it("does nothing with no best, a zero, or something that isn't one", () => {
    for (const stored of [null, "0", "", "abc", "-3", "1.5", "<b>9</b>"]) {
      expect(runWith(() => stored)).toEqual({ text: "", hidden: true });
    }
  });

  it("does nothing, and throws nothing, when storage is blocked", () => {
    expect(
      runWith(() => {
        throw new Error("SecurityError");
      }),
    ).toEqual({ text: "", hidden: true });
  });
});

describe("a theme card's best line", () => {
  const runWith = (storage: () => string | null) =>
    runScript(
      squadScript,
      {
        "data-squad-key": "bt:best:legends:squad:club-barcelona",
        "data-template": "Best {best}/{of}",
        "data-cleared": "Cleared ✓",
      },
      storage,
      "34",
    );

  it("shows how far through the squad this device has been", () => {
    expect(runWith(() => '{"best":12,"cleared":false}')).toEqual({
      text: "Best 12/34",
      hidden: false,
    });
  });

  it("says Cleared once the squad has been", () => {
    expect(runWith(() => '{"best":34,"cleared":true}')).toEqual({
      text: "Cleared ✓",
      hidden: false,
    });
    expect(runWith(() => '{"best":31,"cleared":true}').text).toBe("Cleared ✓");
  });

  it("does nothing with no best, a zero, or something that isn't one", () => {
    for (const stored of [
      null,
      "",
      "12",
      "abc",
      '{"best":0,"cleared":false}',
      '{"best":"12","cleared":false}',
      '{"best":1.5,"cleared":false}',
      '{"best":12}',
      "null",
    ]) {
      expect(runWith(() => stored)).toEqual({ text: "", hidden: true });
    }
  });

  it("does nothing, and throws nothing, when storage is blocked", () => {
    expect(
      runWith(() => {
        throw new Error("SecurityError");
      }),
    ).toEqual({ text: "", hidden: true });
  });
});

describe("every open card", () => {
  it("is one link, clickable anywhere: the link's hit area covers the card", () => {
    expect(card).toMatch(/\.card a::after \{\s*content: "";\s*position: absolute;\s*inset: 0;/);
  });

  it("never gives its link a filter or transform, which would shrink that hit area to the name", () => {
    const rules = [...card.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [, selector, body] of rules) {
      if (!/(^|[\s,])\.card[^,{]*\sa(:[\w-]+)?\s*(,|$)/.test(selector!.trim())) continue;
      expect(body, selector).not.toMatch(/\b(filter|transform|perspective|contain)\s*:/);
    }
  });
});

describe("Instagram Endless's card", () => {
  it("fades its pink into gold, like a theme's card, along its edge and across its name", () => {
    expect(card).toMatch(/coloured: theme\?\.colours !== undefined \|\| accent === "instagram"/);
    const rule = /\.card\.instagram \{([^}]*)\}/.exec(card)?.[1] ?? "";
    expect(rule).toMatch(/--theme-1: var\(--instagram\);/);
    expect(rule).toMatch(/--theme-2: var\(--instagram-gold\);/);
    expect(rule).toMatch(/--theme-text-1: var\(--instagram\);/);
    expect(rule).toMatch(/--theme-text-2: var\(--instagram-gold\);/);
    const tokens = source("../../styles/tokens.css");
    expect(tokens).toMatch(/--instagram-gold: var\(--gold\);/);
  });
});

describe("the cards' scripts and glyphs", () => {
  it("hold no digits, so the leak scan has nothing to weigh", () => {
    expect(scripts).toHaveLength(2);
    for (const script of scripts) expect(script).not.toMatch(/[0-9]/);
  });

  it("draw an original glyph, never a brand's mark: a red heart that fills in on hover", () => {
    expect(card).toMatch(/class="glyph"/);
    expect(card).toMatch(
      /\.card\.open:hover \.glyph,\s*\.card\.open:has\(a:focus-visible\) \.glyph \{\s*fill: var\(--heart\);/,
    );
    expect(card.toLowerCase()).not.toMatch(/instagram\.(svg|png)|glyph-instagram|logo/);
  });

  it("give clubs their colours only: no crest, badge, shield, emblem or initials", () => {
    const lower = card.toLowerCase();
    for (const word of ["crest", "badge.svg", "shield", "emblem", "<img"]) {
      expect(lower).not.toContain(word);
    }
    // The theme card draws no glyph of its own: the only one is Instagram's heart.
    expect([...card.matchAll(/<svg\b/g)]).toHaveLength(1);
  });
});
