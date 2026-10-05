/**
 * The leaderboards' flags: the vendored circle-flags SVGs and the codes the
 * server will keep (@bt/core `FLAG_COUNTRIES`) are the same set, and "Show my
 * country flag" is remembered like the nickname.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FLAG_COUNTRIES, flagCountry } from "@bt/core";
import type { SubmitResponse } from "@bt/core";
import type { StorageAccess } from "../best";
import { SHOW_COUNTRY_KEY, readShowCountry, saveShowCountry } from "../device";
import { countryName, flagSrc } from "../flags";
import { rememberPublished } from "../publish";

const FLAGS = fileURLToPath(new URL("../../../public/flags/", import.meta.url));
const files = readdirSync(FLAGS);

describe("the vendored flags", () => {
  it("have a file for every code the server keeps, and no other country", () => {
    const countries = files
      .filter((f) => /^[a-z]{2}\.svg$/.test(f))
      .map((f) => f.slice(0, 2).toUpperCase())
      .sort();
    expect(countries).toEqual([...FLAG_COUNTRIES].sort());
    for (const code of FLAG_COUNTRIES)
      expect(files).toContain(flagSrc(code).slice("/flags/".length));
  });

  it("have England, Scotland, Wales and Northern Ireland, and the licence", () => {
    for (const nation of ["gb-eng", "gb-sct", "gb-wls", "gb-nir"]) {
      expect(files).toContain(`${nation}.svg`);
    }
    expect(files).toContain("LICENSE.md");
  });

  it("give no flag for unknown, Tor or anything else", () => {
    expect(flagCountry("GB")).toBe("GB");
    expect(flagCountry("gb")).toBe("GB");
    for (const code of ["XX", "T1", "ZZ", "GBR", "", null, undefined, 44]) {
      expect(flagCountry(code), String(code)).toBeNull();
    }
    expect(files).not.toContain("xx.svg");
  });

  it("are named by their country for screen readers", () => {
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("BR")).toBe("Brazil");
    expect(flagSrc("GB")).toBe("/flags/gb.svg");
  });
});

describe("remembering the flag choice", () => {
  function memory() {
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    return { data, access: (() => store) as StorageAccess };
  }
  const blocked: StorageAccess = () => {
    throw new DOMException("denied", "SecurityError");
  };
  const published = (): { kind: "published"; response: SubmitResponse } => {
    const period = {
      key: "k",
      current: true,
      rank: 1,
      total: 1,
      resetsAt: 0,
      entryId: "e",
      best: 5,
      improved: true,
    };
    return {
      kind: "published",
      response: {
        id: "e",
        nickname: "Tidy Winger",
        streak: 5,
        periods: { day: period, week: period, month: period },
      },
    };
  };

  it("is ticked the first time, and with storage blocked", () => {
    expect(readShowCountry(memory().access)).toBe(true);
    expect(readShowCountry(blocked)).toBe(true);
    expect(() => saveShowCountry(blocked, false)).not.toThrow();
  });

  it("keeps an unticked box once a run is published with it, and only then", () => {
    const { access, data } = memory();
    rememberPublished(access, { kind: "rejected" }, false);
    expect(readShowCountry(access)).toBe(true);
    rememberPublished(access, published(), false);
    expect(data.get(SHOW_COUNTRY_KEY)).toBe("0");
    expect(readShowCountry(access)).toBe(false);
    rememberPublished(access, published(), true);
    expect(readShowCountry(access)).toBe(true);
  });
});
