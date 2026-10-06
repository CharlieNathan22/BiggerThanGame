import { describe, expect, it } from "vitest";
import type { Player } from "@bt/core";
import {
  DEV_TOOL_MARKERS,
  NAME_WINDOW,
  devToolsIn,
  readableText,
  scanDist,
  valuesNearName,
} from "../dist-scan.js";

const NOW = new Date("2026-09-26T00:00:00Z");

const vale: Player = {
  id: "ainsley-vale",
  name: "Ainsley Vale",
  country: "Norlandia",
  position: "FW",
  dob: "1979-04-13",
  stats: {
    club_goals: 480,
    caps: 105,
    it: 2,
    clubs: 4,
    igoals: 0,
    fee: { value: 72, year: 2004 },
    ig: { value: 10.75, asOf: "2026-09-01" },
  },
};

const scan = (path: string, text: string) => scanDist([{ path, text }], [vale], NOW);

describe("the id check", () => {
  it("fails on a player id anywhere in the output", () => {
    expect(scan("_assets/game.js", 'const d={id:"ainsley-vale"}')).toEqual([
      '_assets/game.js contains the player id "ainsley-vale"',
    ]);
  });

  it("fails on a whole deck, as a bundled deck.full.json would put it", () => {
    const bundle = `var e=${JSON.stringify({ players: [vale] })};console.log(e)`;
    const problems = scan("_assets/Game.js", bundle);
    expect(problems.some((p) => p.includes("player id"))).toBe(true);
    expect(problems.some((p) => p.includes("caps"))).toBe(true);
  });

  it("matches only the whole id", () => {
    expect(scan("a.js", '"ainsley-vale-2" "xainsley-vale"')).toEqual([]);
  });

  it("is not narrowed by the markup stripping", () => {
    expect(scan("credits.html", '<a href="/p/ainsley-vale">x</a>')).toHaveLength(1);
  });
});

describe("the name window", () => {
  it("fails on a value next to its player's name, raw or as a card shows it", () => {
    expect(scan("about.html", "<p>Ainsley Vale won 105 caps.</p>")).toHaveLength(1);
    expect(scan("about.html", "<p>Ainsley Vale cost €72m.</p>")[0]).toContain("fee");
    expect(scan("about.html", "<p>Ainsley Vale: 10.75m followers</p>")[0]).toContain("ig");
    expect(scan("a.js", '{name:"Ainsley Vale",caps:105}')).toHaveLength(1);
  });

  it("catches small values too, within the window", () => {
    expect(scan("a.html", "<p>Ainsley Vale, 2 international trophies</p>")).toHaveLength(1);
  });

  it(`ignores values more than ${NAME_WINDOW} characters away`, () => {
    const far = " ".repeat(NAME_WINDOW + 5);
    expect(scan("a.html", `<p>Ainsley Vale</p>${far}<p>105 of them</p>`)).toEqual([]);
  });

  it("ignores values that aren't that player's", () => {
    expect(scan("a.html", "<p>Ainsley Vale, 106 caps</p>")).toEqual([]);
  });

  it("doesn't read a number inside a longer one or a word", () => {
    expect(scan("a.html", "<p>Ainsley Vale 1105 v105 105px 4.0 2.5</p>")).toEqual([]);
  });

  it("isn't tripped by the credits page's licence codes and links", () => {
    const credits =
      "<li data-astro-cid-j7pv25f6><strong>Ainsley Vale</strong><p>Photo by Jo Bloggs · " +
      '<a href="https://creativecommons.org/licenses/by-sa/2.5/es/" rel="license">CC-BY-SA-2.5-ES</a> · ' +
      '<a href="https://commons.wikimedia.org/wiki/File:Vale_2_105.jpg">Source</a></p></li>' +
      "<li><strong>Another</strong><p>CC0 · CC-BY-4.0 · CC-BY-3.0 · PD</p></li>";
    expect(scan("credits.html", credits)).toEqual([]);
  });

  it("skips photo attribution, whose authors' names can hold numbers", () => {
    const credits =
      '<li><strong>Ainsley Vale</strong><p data-scan="attribution" data-astro-cid-x1>' +
      "Photo by No 105 Downing Street · CC-BY-2.0</p></li>";
    expect(scan("credits.html", credits)).toEqual([]);
    // Without the mark, the same text is a leak.
    expect(scan("credits.html", credits.replace(' data-scan="attribution"', ""))).toHaveLength(1);
  });

  it("skips HTML comments, such as Svelte's hydration markers", () => {
    expect(scan("a.html", "<p>Ainsley Vale</p><!--[-1--><!--]--><!--105-->")).toEqual([]);
  });

  it("reads names through HTML entities", () => {
    const player = { ...vale, name: "Ainsley O'Vale" };
    const html = "<p>Ainsley O&#39;Vale has 105 caps</p>";
    expect(valuesNearName(readableText("a.html", html), player, NOW)).toHaveLength(1);
  });

  it("skips inline styles, whose numbers aren't data", () => {
    const html = '<style>.x{padding:0 4px;margin:105px}</style><p style="order:0">Ainsley Vale</p>';
    expect(scan("a.html", html)).toEqual([]);
  });
});

describe("the dev tools check", () => {
  it("finds pnpm dev's mockEnd shim anywhere in the built site", () => {
    const files = [
      { path: "index.html", text: "<p>clean</p>" },
      { path: "_astro/Game.js", text: 'const m=new URLSearchParams(l).get("mockEnd")' },
    ];
    expect(devToolsIn(files)).toEqual(['_astro/Game.js contains "mockEnd", a pnpm dev tool']);
    expect(devToolsIn([{ path: "index.html", text: "<p>clean</p>" }])).toEqual([]);
    expect(DEV_TOOL_MARKERS).toContain("mockEnd");
  });
});
