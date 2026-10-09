import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { NAV_LINKS, currentPage, navCurrent } from "../nav";

describe("the title bar's navigation", () => {
  it("is Play, Leaderboards, Multiplayer, How to play and About, in that order", () => {
    expect(NAV_LINKS.map((link) => [t(link.label), link.href])).toEqual([
      ["Play", "/football-higher-or-lower/legends"],
      ["Leaderboards", "/football-higher-or-lower/legends/daily/leaderboard"],
      ["Multiplayer", "/football-higher-or-lower/legends/multiplayer"],
      ["How to play", "/about#how-to-play"],
      ["About", "/about"],
    ]);
  });

  it("marks Play current on the football page and everything under it", () => {
    const play = NAV_LINKS.find((link) => link.label === "nav.play");
    if (play === undefined) throw new Error("no Play link");
    const on = (path: string) => currentPage(play.href, path, play.section);
    expect(on("/football-higher-or-lower/legends")).toBe("page");
    expect(on("/football-higher-or-lower")).toBe("true");
    expect(on("/football-higher-or-lower/legends/friendly")).toBe("true");
    for (const path of ["/", "/about", "/credits", "/404", "/football-higher-or-lower-extra"]) {
      expect(on(path), path).toBeUndefined();
    }
  });

  it("marks Leaderboards, and only Leaderboards, current on either leaderboard page", () => {
    const marks = (path: string) =>
      Object.fromEntries(NAV_LINKS.map((link) => [t(link.label), navCurrent(link, path)]));
    expect(marks("/football-higher-or-lower/legends/daily/leaderboard")).toEqual({
      Play: undefined,
      Leaderboards: "page",
      Multiplayer: undefined,
      "How to play": undefined,
      About: undefined,
    });
    // Endless's board, a page of its own behind the switch, is under Leaderboards too.
    expect(marks("/football-higher-or-lower/legends/endless/leaderboard")).toEqual({
      Play: undefined,
      Leaderboards: "true",
      Multiplayer: undefined,
      "How to play": undefined,
      About: undefined,
    });
    expect(marks("/football-higher-or-lower/legends/daily")).toMatchObject({
      Play: "true",
      Leaderboards: undefined,
    });
    // Elsewhere in the football pages Play is still the current section.
    expect(marks("/football-higher-or-lower/legends/endless")).toEqual({
      Play: "true",
      Leaderboards: undefined,
      Multiplayer: undefined,
      "How to play": undefined,
      About: undefined,
    });
    expect(marks("/football-higher-or-lower/legends")).toMatchObject({ Play: "page" });
    expect(marks("/about")).toMatchObject({ Play: undefined, About: "page" });
  });

  it("marks Multiplayer, and only Multiplayer, current on the hub and Twitch Mode", () => {
    const marks = (path: string) =>
      Object.fromEntries(NAV_LINKS.map((link) => [t(link.label), navCurrent(link, path)]));
    expect(marks("/football-higher-or-lower/legends/multiplayer")).toEqual({
      Play: undefined,
      Leaderboards: undefined,
      Multiplayer: "page",
      "How to play": undefined,
      About: undefined,
    });
    expect(marks("/football-higher-or-lower/legends/multiplayer/twitch")).toEqual({
      Play: undefined,
      Leaderboards: undefined,
      Multiplayer: "true",
      "How to play": undefined,
      About: undefined,
    });
  });
});

describe("currentPage", () => {
  it("marks the link to the page being shown", () => {
    expect(currentPage("/about", "/about")).toBe("page");
    expect(currentPage("/", "/")).toBe("page");
    expect(currentPage("/football-higher-or-lower", "/football-higher-or-lower")).toBe("page");
  });

  it("never marks a link to a section, a parent or another page", () => {
    expect(currentPage("/about#how-to-play", "/about")).toBeUndefined();
    expect(currentPage("/football-higher-or-lower", "/football-higher-or-lower/legends")).toBe(
      undefined,
    );
    expect(currentPage("/", "/about")).toBeUndefined();
    expect(currentPage("/about", undefined)).toBeUndefined();
  });

  it("marks a link as current, not as the page, elsewhere in its section", () => {
    expect(currentPage("/a/b", "/a", "/a")).toBe("true");
    expect(currentPage("/a/b", "/a/b/c", "/a")).toBe("true");
    expect(currentPage("/a/b", "/a/b", "/a")).toBe("page");
    expect(currentPage("/a/b", "/ab", "/a")).toBeUndefined();
    expect(currentPage("/a/b", undefined, "/a")).toBeUndefined();
  });
});
