import { describe, expect, it } from "vitest";
import { FEEDBACK_LIMITS, SITE_PAGES, isSitePage, textLength } from "../feedback.js";

describe("textLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(textLength("Pelé")).toBe(4);
    expect(textLength("⚽⚽")).toBe(2);
    expect(textLength("𝔾")).toBe(1);
    expect(textLength("")).toBe(0);
  });
});

describe("FEEDBACK_LIMITS", () => {
  it("are the published form limits", () => {
    expect(FEEDBACK_LIMITS).toEqual({ name: 80, note: 1000, token: 2048 });
  });
});

describe("isSitePage", () => {
  it("accepts the site's own pages and nothing else", () => {
    for (const page of SITE_PAGES) expect(isSitePage(page)).toBe(true);
    for (const path of ["", "/about/", "/about.html", "/admin", "about", "https://x.com/"]) {
      expect(isSitePage(path)).toBe(false);
    }
  });
});
