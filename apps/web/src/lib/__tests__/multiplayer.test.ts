/**
 * The Multiplayer hub, Twitch Mode's page and 1v1's (DESIGN.md §17): the
 * hub's cards from config, live and coming soon; the footer's Twitch Mode link
 * and where it steps out; the pages' trails, structured data and places in
 * the site; and the way back to the modes from full time. Read from the
 * sources: the built pages are checked by `pnpm check:site`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITE_PAGES, isSitePage } from "@bt/core";
import { t } from "../../i18n";
import { MULTIPLAYER_MODES } from "../multiplayer";
import { INDEXABLE_PAGES, absoluteUrl, breadcrumbTrail, duelGameLd, twitchGameLd } from "../seo";
import { DUEL_PATH, MULTIPLAYER_PATH, TWITCH_PATH } from "../paths";

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const hub = source("../../pages/football-higher-or-lower/legends/multiplayer.astro");
const twitch = source("../../pages/football-higher-or-lower/legends/multiplayer/twitch.astro");
const footer = source("../../components/Footer.astro");
const result = source("../../components/stream/StreamResult.svelte");
const icon = source("../../components/ChatVsYouIcon.astro");
const duel = source("../../pages/football-higher-or-lower/legends/multiplayer/1v1.astro");
const duelIcon = source("../../components/PlayersFacingIcon.astro");
const duelResult = source("../../components/duel/DuelResult.svelte");

describe("the Multiplayer hub", () => {
  it("lists Twitch Mode and 1v1 live, and Last Man Standing coming soon", () => {
    expect(MULTIPLAYER_MODES.map((m) => [t(m.name), m.href])).toEqual([
      ["Twitch Mode", TWITCH_PATH],
      ["1v1", DUEL_PATH],
      ["Last Man Standing", null],
    ]);
    expect(t(MULTIPLAYER_MODES[1]!.body)).toBe(
      "Play a friend head to head.\nMake a room and send the invite link.",
    );
    expect(t(MULTIPLAYER_MODES[2]!.body)).toBe("Up to 10 players, one mistake and you're out.");
  });

  it("makes 1v1 live through its config alone: a page, and an icon of its own", () => {
    const mode = MULTIPLAYER_MODES.find((m) => m.id === "1v1")!;
    expect(mode.href).toBe("/football-higher-or-lower/legends/multiplayer/1v1");
    expect(mode.icon).toBe("players-facing");
    expect(hub).toMatch(/mode\.icon === "players-facing" && <PlayersFacingIcon \/>/);
    // Last Man Standing has no page, so its card is no link.
    expect(MULTIPLAYER_MODES.find((m) => m.id === "last-man-standing")!.href).toBeNull();
  });

  it("draws 1v1's icon itself: two players facing each other, no one's marks", () => {
    expect(duelIcon).toMatch(/<svg class="facing"/);
    const drawing = duelIcon.slice(duelIcon.indexOf("<svg"), duelIcon.indexOf("</svg>"));
    // Two heads and two pairs of shoulders, in the two colours a match is scored in.
    expect(drawing.match(/<circle/g)).toHaveLength(2);
    expect(drawing.match(/class="you"/g)).toHaveLength(2);
    expect(drawing.match(/class="them"/g)).toHaveLength(2);
    expect(drawing).not.toMatch(/<image|<text|href|url\(/i);
    expect(duelIcon).toMatch(/stroke: var\(--duel-you\)/);
    expect(duelIcon).toMatch(/stroke: var\(--duel-them\)/);
  });

  it("says how 1v1 works under the cards, with a way in", () => {
    expect(hub).toMatch(/t\("multiplayer\.duel\.heading"\)/);
    expect(hub).toMatch(/<a class="cta" href=\{DUEL_PATH\}>/);
    for (const key of ["multiplayer.duel.body", "multiplayer.description"] as const) {
      expect(t(key)).not.toContain("\u2014");
    }
    expect(t("multiplayer.description")).toMatch(/Last Man Standing is coming soon/);
  });

  it("builds its cards from the config, a link only where a mode has a page", () => {
    expect(hub).toMatch(/MULTIPLAYER_MODES\.map\(/);
    expect(hub).toMatch(/\.\.\.\(mode\.href !== null \? \{ href: mode\.href \} : \{\}\)/);
    // No mode is named in the markup: going live is a config change.
    for (const name of ["Twitch Mode", "1v1", "Last Man Standing"]) expect(hub).not.toContain(name);
    expect(hub).toMatch(/<ChatVsYouIcon \/>/);
  });

  it("draws its own icon, never a platform's mark or colours", () => {
    expect(icon).toMatch(/<svg class="chatvs"/);
    const drawing = icon.slice(icon.indexOf("<svg"));
    expect(drawing).not.toMatch(/#9146ff|#6441a5|#772ce8|glitch|twitch/i);
  });
});

describe("Twitch Mode's page", () => {
  it("plays the island in stream mode, with the themes the squad pages use", () => {
    expect(twitch).toMatch(/mode="stream"/);
    expect(twitch).toMatch(/path=\{TWITCH_PATH\}/);
    expect(twitch).toMatch(/loadThemes\(\)/);
    expect(twitch).toMatch(/twitchGameLd\(\)/);
  });

  it("is a MultiPlayer game of its own", () => {
    expect(twitchGameLd()).toMatchObject({
      "@type": "VideoGame",
      url: `https://biggerthangame.com${TWITCH_PATH}`,
      playMode: "https://schema.org/MultiPlayer",
    });
  });
});

describe("1v1's page", () => {
  it("plays the island in duel mode, with the themes the squad pages use", () => {
    expect(duel).toMatch(/mode="duel"/);
    expect(duel).toMatch(/path=\{DUEL_PATH\}/);
    expect(duel).toMatch(/loadThemes\(\)/);
    expect(duel).toMatch(/duelGameLd\(\)/);
    expect(duel).toMatch(/breadcrumbLd\(breadcrumbTrail\(DUEL_PATH\)\)/);
  });

  it("is a MultiPlayer game of its own, for two", () => {
    expect(duelGameLd()).toMatchObject({
      "@type": "VideoGame",
      name: "1v1: Play a Friend",
      url: `https://biggerthangame.com${DUEL_PATH}`,
      playMode: "https://schema.org/MultiPlayer",
      numberOfPlayers: { "@type": "QuantitativeValue", value: 2 },
    });
  });

  it("is titled for search, ending as every page's title does", () => {
    expect(t("duel.title")).toBe("1v1 Football Quiz: Play a Friend | Bigger Than Game");
    expect(t("duel.heading")).toBe("1v1: Play a Friend");
    expect(t("duel.title")).not.toContain("\u2014");
    expect(t("duel.description")).not.toContain("\u2014");
  });

  it("is canonical to itself, so a room's invite link is never a page to index", () => {
    // Set by name, not left to the address: the query can't reach it.
    expect(duel).toMatch(/canonical=\{DUEL_PATH\}/);
    expect(absoluteUrl(DUEL_PATH)).toBe(
      "https://biggerthangame.com/football-higher-or-lower/legends/multiplayer/1v1",
    );
    expect(absoluteUrl(DUEL_PATH)).not.toContain("?");
    expect(duelGameLd()["url"]).toBe(absoluteUrl(DUEL_PATH));
  });

  it("sits under Legends: Legends › Multiplayer › 1v1", () => {
    expect(breadcrumbTrail(DUEL_PATH).map((c) => [c.name, c.path])).toEqual([
      ["Home", "/"],
      ["Football", "/football-higher-or-lower"],
      ["Legends", "/football-higher-or-lower/legends"],
      ["Multiplayer", MULTIPLAYER_PATH],
      ["1v1", DUEL_PATH],
    ]);
  });

  it("is a site page, in the sitemap", () => {
    expect((SITE_PAGES as readonly string[]).includes(DUEL_PATH)).toBe(true);
    expect(isSitePage(DUEL_PATH)).toBe(true);
    expect((INDEXABLE_PAGES as readonly string[]).includes(DUEL_PATH)).toBe(true);
    // Only the page: nothing with a room in it.
    expect(INDEXABLE_PAGES.filter((p) => p.includes("1v1"))).toEqual([DUEL_PATH]);
  });

  it("ends full time with Try other modes, and has no board, publish or challenge", () => {
    expect(duelResult).toMatch(
      /<a class="cta othermodes" href=\{LEGENDS_PATH\}>\{t\("over\.otherModes"\)\}<\/a>/,
    );
    const actions = duelResult.slice(
      duelResult.indexOf('<div class="actions">'),
      duelResult.indexOf("<style>"),
    );
    const last = [...actions.matchAll(/<(button|a)\b[^>]*>/g)].at(-1)?.[0] ?? "";
    expect(last).toMatch(/othermodes/);
    for (const label of ["duel.result.rematch", "duel.result.newRoom", "over.share"]) {
      expect(duelResult).toContain(`t("${label}"`);
    }
    const markup = duelResult.slice(duelResult.indexOf("</script>"), duelResult.indexOf("<style>"));
    expect(markup).not.toMatch(/publish|challenge|leaderboard|best/i);
  });
});

describe("both pages", () => {
  it("are site pages, in the sitemap", () => {
    for (const path of [MULTIPLAYER_PATH, TWITCH_PATH]) {
      expect((SITE_PAGES as readonly string[]).includes(path)).toBe(true);
      expect(isSitePage(path)).toBe(true);
      expect((INDEXABLE_PAGES as readonly string[]).includes(path)).toBe(true);
    }
  });

  it("sit under Legends: Legends › Multiplayer › Twitch Mode", () => {
    expect(breadcrumbTrail(MULTIPLAYER_PATH).map((c) => c.name)).toEqual([
      "Home",
      "Football",
      "Legends",
      "Multiplayer",
    ]);
    expect(breadcrumbTrail(TWITCH_PATH).map((c) => [c.name, c.path])).toEqual([
      ["Home", "/"],
      ["Football", "/football-higher-or-lower"],
      ["Legends", "/football-higher-or-lower/legends"],
      ["Multiplayer", MULTIPLAYER_PATH],
      ["Twitch Mode", TWITCH_PATH],
    ]);
  });

  it("have titles ending as every page's do, and no em dash", () => {
    for (const key of ["multiplayer.title", "twitch.title", "duel.title"] as const) {
      expect(t(key)).toMatch(/ \| Bigger Than Game$/);
      expect(t(key)).not.toContain("—");
    }
  });
});

describe("the footer", () => {
  it("links Twitch Mode, which steps out first on a narrow screen", () => {
    expect(footer).toMatch(/\{ href: TWITCH_PATH, label: t\("footer\.twitch"\), widest: true \}/);
    expect(footer).toMatch(/@media \(max-width: 599px\) \{\s*\.widest \{\s*display: none;/);
    // Below 440px Leaderboards goes too, and the first link left loses its separator.
    expect(footer).toMatch(
      /@media \(max-width: 439px\) \{\s*\.wider,\s*\.widest \+ span > \.sep \{\s*display: none;/,
    );
  });
});

describe("full time", () => {
  it("ends with Try other modes, as every game-over panel does", () => {
    expect(result).toMatch(
      /<a class="cta othermodes" href=\{LEGENDS_PATH\}>\{t\("over\.otherModes"\)\}<\/a>/,
    );
    const actions = result.slice(
      result.indexOf('<div class="actions">'),
      result.indexOf("<style>"),
    );
    const last = [...actions.matchAll(/<(button|a)\b[^>]*>/g)].at(-1)?.[0] ?? "";
    expect(last).toMatch(/othermodes/);
    for (const label of [
      "stream.result.again",
      "stream.result.changeQuestions",
      "stream.result.changeChannel",
    ]) {
      expect(result).toContain(`t("${label}")`);
    }
    // No Publish, no challenge, no best.
    const markup = result.slice(result.indexOf("</script>"), result.indexOf("<style>"));
    expect(markup).not.toMatch(/publish|challenge|best/i);
  });
});
