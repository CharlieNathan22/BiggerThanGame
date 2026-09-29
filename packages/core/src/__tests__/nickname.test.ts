import { describe, expect, it } from "vitest";
import {
  NICKNAME_ADJECTIVES,
  NICKNAME_LIMITS,
  NICKNAME_NOUNS,
  NICKNAME_NUMBERS,
  NICKNAME_SKIPPED_NUMBERS,
  checkNickname,
  cleanNickname,
  generateNickname,
  looseLetters,
  nicknameSkeleton,
  normaliseNickname,
} from "../nickname.js";
import { createRng } from "../prng.js";

describe("checkNickname", () => {
  it("takes 3–20 characters of Latin letters, digits, space and _ - .", () => {
    expect(checkNickname("SwiftVolley42")).toEqual({ ok: true, nickname: "SwiftVolley42" });
    expect(checkNickname("Zé_Roberto-10.")).toEqual({ ok: true, nickname: "Zé_Roberto-10." });
    expect(checkNickname("Ødegaard fan")).toEqual({ ok: true, nickname: "Ødegaard fan" });
    expect(checkNickname("abc").ok).toBe(true);
    expect(checkNickname("a".repeat(NICKNAME_LIMITS.max)).ok).toBe(true);
  });

  it("trims, collapses spaces and applies NFKC before counting", () => {
    expect(checkNickname("   Big   Sam  ")).toEqual({ ok: true, nickname: "Big Sam" });
    // Full-width letters fold to ASCII.
    expect(checkNickname("ＳａｍＡ")).toEqual({ ok: true, nickname: "SamA" });
    expect(cleanNickname("Pe\u200Bl\u200De")).toBe("Pele");
  });

  it("refuses too short, too long, and names with no letter or digit", () => {
    expect(checkNickname("ab")).toEqual({ ok: false, problem: "short" });
    expect(checkNickname("   ab   ")).toEqual({ ok: false, problem: "short" });
    expect(checkNickname("...")).toEqual({ ok: false, problem: "short" });
    expect(checkNickname("a".repeat(NICKNAME_LIMITS.max + 1))).toEqual({
      ok: false,
      problem: "long",
    });
  });

  it("refuses other scripts as a script problem, and symbols as characters", () => {
    expect(checkNickname("Пеле")).toEqual({ ok: false, problem: "script" });
    expect(checkNickname("ΜέσσιFan")).toEqual({ ok: false, problem: "script" });
    expect(checkNickname("梅西")).toEqual({ ok: false, problem: "script" });
    expect(checkNickname("Goal ⚽")).toEqual({ ok: false, problem: "characters" });
    expect(checkNickname("a@b.com")).toEqual({ ok: false, problem: "characters" });
    expect(checkNickname("<script>")).toEqual({ ok: false, problem: "characters" });
  });
});

describe("the moderation skeleton", () => {
  const loose = (name: string) => looseLetters(nicknameSkeleton(name).whole);

  it("strips zero-width and direction characters", () => {
    expect(loose("a\u200Bd\u200Cm\u200Di\uFEFFn")).toBe("admin");
    expect(loose("ad\u202Emin")).toBe("admin");
  });

  it("folds homoglyphs from other scripts and accents to ASCII", () => {
    // Cyrillic а, о and е in an otherwise Latin word.
    expect(loose("Аdmіn")).toBe("admin");
    expect(loose("mοdеrаtοr")).toBe("moderator");
    expect(loose("Ádmín")).toBe("admin");
    expect(loose("Łøser")).toBe("loser");
  });

  it("folds leetspeak", () => {
    expect(loose("4dm1n")).toBe("admin");
    expect(loose("M0d3r4t0r")).toBe("moderator");
    expect(loose("b1gg3rth4n")).toBe("bigerthan");
  });

  it("keeps repeats as runs, so a check can tell one letter from several", () => {
    const { whole } = nicknameSkeleton("Aaaadmiiin");
    expect(whole).toEqual([
      { letter: "a", count: 4 },
      { letter: "d", count: 1 },
      { letter: "m", count: 1 },
      { letter: "i", count: 3 },
      { letter: "n", count: 1 },
    ]);
    expect(looseLetters(whole)).toBe("admin");
  });

  it("gives each word, split at separators and camel case, with and without end digits", () => {
    const { words, bare, whole } = nicknameSkeleton("SwiftVolley42 big_sam");
    expect(words.map(looseLetters)).toEqual(["swift", "voleya", "big", "sam", "voley"]);
    expect(looseLetters(whole)).toBe("swiftvoleyabigsam");
    expect(looseLetters(bare)).toBe("swiftvoleybigsam");
    expect(nicknameSkeleton("Admin42").words.map(looseLetters)).toContain("admin");
    // Words run together across separators: "Ad Min" reads as "admin".
    expect(looseLetters(nicknameSkeleton("Ad Min").whole)).toBe("admin");
  });

  it("stores the whole skeleton as the normalised name", () => {
    expect(normaliseNickname("SwiftVolley42")).toBe("swiftvoleya");
    expect(normaliseNickname("ＳＷＩＦＴ")).toBe("swift");
  });
});

describe("generateNickname", () => {
  it("is an adjective, a football noun and a 2–3 digit number", () => {
    const rng = createRng("nicknames");
    for (let i = 0; i < 500; i += 1) {
      const name = generateNickname(() => rng.next());
      const match = /^([A-Z][a-z]+)([A-Z][a-z]+)(\d{2,3})$/.exec(name);
      expect(match).not.toBeNull();
      expect(NICKNAME_ADJECTIVES).toContain(match?.[1]);
      expect(NICKNAME_NOUNS).toContain(match?.[2]);
      expect(NICKNAME_SKIPPED_NUMBERS).not.toContain(Number(match?.[3]));
      expect(checkNickname(name)).toEqual({ ok: true, nickname: name });
    }
  });

  it("always fits the length limit, whichever words it picks", () => {
    const longest =
      Math.max(...NICKNAME_ADJECTIVES.map((w) => w.length)) +
      Math.max(...NICKNAME_NOUNS.map((w) => w.length)) +
      3;
    expect(longest).toBeLessThanOrEqual(NICKNAME_LIMITS.max);
  });

  it("covers the ends of its lists", () => {
    expect(generateNickname(() => 0)).toBe(
      `${NICKNAME_ADJECTIVES[0]}${NICKNAME_NOUNS[0]}${NICKNAME_NUMBERS[0]}`,
    );
    expect(generateNickname(() => 0.999999)).toBe(
      `${NICKNAME_ADJECTIVES.at(-1)}${NICKNAME_NOUNS.at(-1)}${NICKNAME_NUMBERS.at(-1)}`,
    );
  });

  it("never uses a skipped number", () => {
    expect(NICKNAME_NUMBERS[0]).toBe(10);
    expect(NICKNAME_NUMBERS.at(-1)).toBe(999);
    for (const n of NICKNAME_SKIPPED_NUMBERS) expect(NICKNAME_NUMBERS).not.toContain(n);
  });
});
