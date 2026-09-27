import { SITE_PAGES, isSitePage } from "@bt/core";
import { describe, expect, it } from "vitest";
import {
  FOOTBALL_PATH,
  FRIENDLY_PATH,
  HOME_PATH,
  LEGENDS_PATH,
  isLegendsPath,
  servedPath,
} from "../paths";

describe("the site's paths", () => {
  it("are all pages the Worker accepts a problem report from", () => {
    for (const path of [HOME_PATH, FOOTBALL_PATH, LEGENDS_PATH, FRIENDLY_PATH]) {
      expect(isSitePage(path), path).toBe(true);
    }
  });

  it("have no trailing slash, apart from the homepage", () => {
    for (const path of SITE_PAGES.filter((p) => p !== HOME_PATH)) {
      expect(path.endsWith("/"), path).toBe(false);
    }
  });
});

describe("servedPath", () => {
  it("reads a built file as the path it is served at", () => {
    expect(servedPath("/index.html")).toBe("/");
    expect(servedPath("/about.html")).toBe("/about");
    expect(servedPath("/football-higher-or-lower/legends/friendly.html")).toBe(FRIENDLY_PATH);
  });

  it("leaves a served path as it is", () => {
    expect(servedPath("/")).toBe("/");
    expect(servedPath("")).toBe("/");
    expect(servedPath(FOOTBALL_PATH)).toBe(FOOTBALL_PATH);
  });
});

describe("isLegendsPath", () => {
  it("is the Legends page and everything under it", () => {
    expect(isLegendsPath(LEGENDS_PATH)).toBe(true);
    expect(isLegendsPath(FRIENDLY_PATH)).toBe(true);
  });

  it("is nothing else, the football hub included", () => {
    for (const path of [HOME_PATH, FOOTBALL_PATH, "/about", "/credits", "/404", "/legends"]) {
      expect(isLegendsPath(path), path).toBe(false);
    }
    expect(isLegendsPath(`${LEGENDS_PATH}-extra`)).toBe(false);
  });
});
