import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { NAV_LINKS, currentPage } from "../nav";

describe("the title bar's navigation", () => {
  it("is Play, How to play and About, in that order", () => {
    expect(NAV_LINKS.map((link) => [t(link.label), link.href])).toEqual([
      ["Play", "/football-higher-or-lower/legends"],
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
