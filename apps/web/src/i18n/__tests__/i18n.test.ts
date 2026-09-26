import { STATS, STAT_KEYS } from "@bt/core";
import { describe, expect, it } from "vitest";
import { en } from "../en";
import { formatDate, interpolate, statLabel, t } from "../index";

describe("t", () => {
  it("looks up a key", () => {
    expect(t("pick.higher")).toBe("Higher");
  });

  it("fills placeholders", () => {
    expect(t("over.best", { best: 12 })).toBe("Best 12");
  });

  it("leaves a placeholder with no value visible rather than blank", () => {
    expect(t("over.best")).toBe("Best {best}");
  });
});

describe("interpolate", () => {
  it("replaces every occurrence and ignores unused params", () => {
    expect(interpolate("{a} and {a}, {b}", { a: 1, c: 3 })).toBe("1 and 1, {b}");
  });

  it("does not re-read a value as a template", () => {
    expect(interpolate("{a}", { a: "{b}", b: "x" })).toBe("{b}");
  });
});

describe("stat labels", () => {
  it("match the labels the server sends", () => {
    for (const key of STAT_KEYS) expect(statLabel(key)).toBe(STATS[key].label);
  });
});

describe("en", () => {
  it("has no empty strings", () => {
    for (const [key, value] of Object.entries(en)) expect(value.trim(), key).not.toBe("");
  });
});

describe("formatDate", () => {
  it("formats an ISO date for the locale, in UTC", () => {
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
  });

  it("returns anything unparseable as given", () => {
    expect(formatDate("soon")).toBe("soon");
  });
});
