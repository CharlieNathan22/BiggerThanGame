import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { NAV_LINKS, currentPage } from "../nav";

describe("the title bar's navigation", () => {
  it("is Play, How to play and About, in that order", () => {
    expect(NAV_LINKS.map((link) => [t(link.label), link.href])).toEqual([
      ["Play", "/football-higher-or-lower"],
      ["How to play", "/about#how-to-play"],
      ["About", "/about"],
    ]);
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
});
