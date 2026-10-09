/**
 * The Multiplayer hub and Twitch Mode's page (DESIGN.md §17): the hub's cards
 * from config, live and coming soon; the footer's Twitch Mode link and where
 * it steps out; both pages' trails, structured data and places in the site;
 * and the way back to the modes from full time. Read from the sources: the
 * built pages are checked by `pnpm check:site`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITE_PAGES, isSitePage } from "@bt/core";
import { t } from "../../i18n";
import { MULTIPLAYER_MODES } from "../multiplayer";
import { INDEXABLE_PAGES, breadcrumbTrail, twitchGameLd } from "../seo";
import { MULTIPLAYER_PATH, TWITCH_PATH } from "../paths";

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const hub = source("../../pages/football-higher-or-lower/legends/multiplayer.astro");
const twitch = source("../../pages/football-higher-or-lower/legends/multiplayer/twitch.astro");
const footer = source("../../components/Footer.astro");
const result = source("../../components/stream/StreamResult.svelte");
const icon = source("../../components/ChatVsYouIcon.astro");

describe("the Multiplayer hub", () => {
  it("lists Twitch Mode live, and 1v1 and Last Man Standing coming soon", () => {
    expect(MULTIPLAYER_MODES.map((m) => [t(m.name), m.href])).toEqual([
      ["Twitch Mode", TWITCH_PATH],
      ["1v1", null],
      ["Last Man Standing", null],
    ]);
    expect(t(MULTIPLAYER_MODES[1]!.body)).toBe("Play a friend head to head.");
    expect(t(MULTIPLAYER_MODES[2]!.body)).toBe("Up to 10 players, one mistake and you're out.");
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
    for (const key of ["multiplayer.title", "twitch.title"] as const) {
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
