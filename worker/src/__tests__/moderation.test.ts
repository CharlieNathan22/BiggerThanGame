/**
 * Nickname moderation. The mechanics are tested on a small list of made-up
 * and mild terms (`createModerator`), so this public file needs no slurs; the
 * shipped, hashed list is tested on impersonation terms, which aren't secret,
 * and against every name the generator can make.
 */

import { describe, expect, it } from "vitest";
import {
  NICKNAME_ADJECTIVES,
  NICKNAME_NOUNS,
  NICKNAME_NUMBERS,
  generateNickname,
  looseLetters,
  nicknameSkeleton,
} from "@bt/core";
import type { Run, Skeleton } from "@bt/core";
import { BLOCKLIST } from "../blocklist-data.js";
import { blockedTerm, createModerator, moderate, termHash } from "../moderation.js";

/** Runs one after another, a run meeting its own letter merged (as the skeleton joins words). */
function join(...parts: (readonly Run[])[]): Run[] {
  const out: Run[] = [];
  for (const run of parts.flat()) {
    const last = out.at(-1);
    if (last?.letter === run.letter)
      out[out.length - 1] = { ...run, count: last.count + run.count };
    else out.push(run);
  }
  return out;
}

const check = createModerator([
  blockedTerm("any", "zorblax"),
  blockedTerm("any", "frogg"),
  blockedTerm("any", "cunt"),
  blockedTerm("word", "admin"),
  blockedTerm("word", "moo"),
]);

describe("the moderator's mechanics", () => {
  it("finds an anywhere term inside a name, whatever surrounds it", () => {
    expect(check("zorblax")).toBe(false);
    expect(check("xXzorblaxXx")).toBe(false);
    expect(check("big_zorblax_99")).toBe(false);
    expect(check("SwiftVolley42")).toBe(true);
  });

  it("finds a word term only as a word or the whole name", () => {
    expect(check("admin")).toBe(false);
    expect(check("The Admin")).toBe(false);
    expect(check("SuperAdmin")).toBe(false); // camel case splits the words
    expect(check("Admin42")).toBe(false); // end digits come off
    expect(check("Ad Min")).toBe(false); // words run together
    expect(check("badminton")).toBe(true);
    expect(check("Smooth")).toBe(true);
  });

  it("folds zero-width characters, homoglyphs and leetspeak before looking", () => {
    expect(check("zor\u200Bblax")).toBe(false);
    expect(check("z0rbl4x")).toBe(false);
    expect(check("zοrblаx")).toBe(false); // Greek ο, Cyrillic а
    expect(check("4dm1n")).toBe(false);
    expect(check("ádmín")).toBe(false);
  });

  it("matches repeated letters, but needs a term's own double letters", () => {
    expect(check("zooorrrblaaax")).toBe(false);
    expect(check("frogg")).toBe(false);
    expect(check("frooggg")).toBe(false);
    // One g is a different word from the term's two.
    expect(check("frog")).toBe(true);
    expect(check("Frogman")).toBe(true);
    expect(check("mooo")).toBe(false);
    expect(check("mo")).toBe(true);
  });

  it("lets innocent words through when the term lies wholly inside them", () => {
    expect(check("Scunthorpe fan")).toBe(true);
    expect(check("Scunthorpe cunt")).toBe(false);
  });

  it("hashes are stable, salted and 52-bit", () => {
    expect(termHash("zorblax")).toBe(termHash("zorblax"));
    expect(termHash("zorblax")).not.toBe(termHash("zorblaxx"));
    expect(Number.parseInt(termHash("zorblax"), 36)).toBeLessThan(2 ** 52);
  });
});

describe("the shipped blocklist", () => {
  it("holds hashes only, never a plain term", () => {
    expect(BLOCKLIST.length).toBeGreaterThan(50);
    for (const term of BLOCKLIST) {
      expect(Object.keys(term).sort()).toEqual(
        term.runs === undefined ? ["hash", "length", "tier"] : ["hash", "length", "runs", "tier"],
      );
      expect(term.hash).toMatch(/^[0-9a-z]{6,11}$/);
    }
  });

  it("refuses impersonation", () => {
    for (const name of [
      "admin",
      "Admin42",
      "4dm1n",
      "Site Admin",
      "Moderator",
      "m0d3r4t0r",
      "The Mod",
      "official",
      "Staff",
      "BiggerThan",
      "BiggerThanGame",
      "biggerthan_official",
      "B1gg3rTh4n",
    ]) {
      expect(moderate(name), name).toBe(false);
    }
  });

  it("passes ordinary football names", () => {
    for (const name of [
      "Scunthorpe fan",
      "SuperEaglesNigeria",
      "Niger Tornadoes",
      "Dickson10",
      "badminton",
      "Pass and move",
      "Cocktail",
      "Hancock",
      "Therapist",
      "Wankdorf 54",
      "Slutsky",
      "Grape",
      "Sussex",
      "Shittu",
    ]) {
      expect(moderate(name), name).toBe(true);
    }
  });

  it("never blocks a name the generator can make", () => {
    // Every adjective, noun and number, checked as the skeleton the name
    // would have, built from its parts (the same, as the sample check below
    // holds, but without parsing 1.5 million strings). Numbers that fold to
    // the same letters are one case.
    const runs = (text: string) => nicknameSkeleton(text).whole;
    const numbers = new Map<string, readonly Run[]>();
    for (const n of NICKNAME_NUMBERS) {
      const folded = runs(String(n));
      numbers.set(folded.map((r) => `${r.letter}${r.count}`).join(""), folded);
    }
    const parsed = new Map<string, readonly Run[]>();
    const cached = (word: string): readonly Run[] => {
      let r = parsed.get(word);
      if (r === undefined) parsed.set(word, (r = runs(word)));
      return r;
    };
    const skeletonOf = (adjective: string, noun: string, number: readonly Run[]): Skeleton => {
      const a = cached(adjective);
      const b = cached(noun);
      const tail = join(b, number);
      return { whole: join(a, tail), bare: join(a, b), words: [a, tail, b] };
    };

    for (const name of ["SwiftVolley42", "LoyalWall999", "CoolBoot10", "IronChip505"]) {
      const [, adjective = "", noun = "", n = ""] = /^([A-Z][a-z]+)([A-Z][a-z]+)(\d+)$/.exec(name)!;
      const built = skeletonOf(adjective, noun, runs(n));
      const real = nicknameSkeleton(name);
      expect(built.whole).toEqual(real.whole);
      expect(built.bare).toEqual(real.bare);
      expect(new Set(built.words.map(looseLetters))).toEqual(new Set(real.words.map(looseLetters)));
    }

    const blocked: string[] = [];
    for (const adjective of NICKNAME_ADJECTIVES) {
      for (const noun of NICKNAME_NOUNS) {
        for (const [key, number] of numbers) {
          if (!moderate.skeleton(skeletonOf(adjective, noun, number))) {
            blocked.push(`${adjective}${noun}(${key})`);
          }
        }
      }
    }
    expect(blocked).toEqual([]);
    expect(moderate(generateNickname(() => 0.5))).toBe(true);
  }, 30_000);
});
