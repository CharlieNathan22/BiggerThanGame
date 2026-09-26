import { describe, expect, it } from "vitest";
import { playerSchema, toPlayer } from "../schema.js";

const valid = {
  id: "test-player",
  name: "Test Player",
  country: "Testland",
  position: "FW",
  dob: "1985-06-15",
  stats: { club_goals: 100, caps: 50, apps: 300, igoals: 10 },
};

describe("playerSchema", () => {
  it("accepts a valid player", () => {
    expect(playerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unknown stat key", () => {
    const r = playerSchema.safeParse({
      ...valid,
      stats: { ...valid.stats, club_gaols: 5 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    expect(playerSchema.safeParse({ ...valid, nickname: "Testy" }).success).toBe(false);
  });

  it("rejects a negative stat", () => {
    expect(playerSchema.safeParse({ ...valid, stats: { ...valid.stats, caps: -1 } }).success).toBe(
      false,
    );
  });

  it("accepts a legitimate zero", () => {
    const r = playerSchema.safeParse({ ...valid, stats: { ...valid.stats, igoals: 0, it: 0 } });
    expect(r.success).toBe(true);
  });

  it("rejects a non-integer count", () => {
    expect(
      playerSchema.safeParse({ ...valid, stats: { ...valid.stats, caps: 50.5 } }).success,
    ).toBe(false);
  });

  it("rejects an id with capitals or spaces", () => {
    expect(playerSchema.safeParse({ ...valid, id: "Test Player" }).success).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(playerSchema.safeParse({ ...valid, dob: "15/06/1985" }).success).toBe(false);
  });

  it("rejects an impossible date", () => {
    expect(playerSchema.safeParse({ ...valid, dob: "1985-13-45" }).success).toBe(false);
  });

  it("requires as_of on followers", () => {
    expect(
      playerSchema.safeParse({ ...valid, stats: { ...valid.stats, ig: { value: 10 } } }).success,
    ).toBe(false);
  });

  it("requires a year on a fee", () => {
    expect(
      playerSchema.safeParse({ ...valid, stats: { ...valid.stats, fee: { value: 40 } } }).success,
    ).toBe(false);
  });

  describe("themed-mode fields", () => {
    const ok = (over: Record<string, unknown>) =>
      playerSchema.safeParse({ ...valid, ...over }).success;

    it("are optional", () => {
      const parsed = playerSchema.parse(valid);
      expect(parsed.era).toBeUndefined();
      expect(parsed.main_clubs).toBeUndefined();
      expect(parsed.leagues).toBeUndefined();
    });

    it("accept a decade from 1900s to 2020s", () => {
      for (const era of ["1900s", "1950s", "1990s", "2020s"]) expect(ok({ era })).toBe(true);
    });

    it("reject a malformed or out-of-range era", () => {
      for (const era of ["1990", "90s", "1995s", "1990S", "1890s", "2030s", " 1990s", ""]) {
        expect(ok({ era }), era).toBe(false);
      }
      expect(ok({ era: 1990 })).toBe(false);
    });

    it("accept lists of clubs and leagues", () => {
      expect(ok({ main_clubs: ["Club A", "Club B"], leagues: ["League A"] })).toBe(true);
    });

    it("reject blank names", () => {
      expect(ok({ main_clubs: ["Club A", ""] })).toBe(false);
      expect(ok({ leagues: ["   "] })).toBe(false);
    });

    it("reject repeated names, ignoring case and surrounding space", () => {
      expect(ok({ main_clubs: ["Club A", "Club A"] })).toBe(false);
      expect(ok({ leagues: ["League A", " league a "] })).toBe(false);
    });

    it("reject an empty list", () => {
      expect(ok({ main_clubs: [] })).toBe(false);
      expect(ok({ leagues: [] })).toBe(false);
    });

    it("reject a bare string where a list is expected", () => {
      expect(ok({ main_clubs: "Club A" })).toBe(false);
    });

    it("are carried through to the engine shape", () => {
      const p = toPlayer(
        playerSchema.parse({
          ...valid,
          era: "1990s",
          main_clubs: ["Club A"],
          leagues: ["League A"],
        }),
      );
      expect(p.era).toBe("1990s");
      expect(p.mainClubs).toEqual(["Club A"]);
      expect(p.leagues).toEqual(["League A"]);
      expect(p.stats.clubs).toBeUndefined(); // the list is not the clubs stat
    });

    it("stay absent from the engine shape when omitted", () => {
      const p = toPlayer(playerSchema.parse(valid));
      expect(p).not.toHaveProperty("era");
      expect(p).not.toHaveProperty("mainClubs");
      expect(p).not.toHaveProperty("leagues");
    });
  });

  it("rejects a licence off the allow-list", () => {
    const r = playerSchema.safeParse({
      ...valid,
      image: {
        file: "x.jpg",
        author: "A",
        licence: "fair-use",
        source: "https://example.com/x",
      },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a jurisdiction-ported licence", () => {
    for (const licence of ["CC-BY-3.0-BR", "CC-BY-SA-2.5-ES"]) {
      const r = playerSchema.safeParse({
        ...valid,
        image: {
          file: "x.jpg",
          author: "A Photographer",
          licence,
          source: "https://commons.wikimedia.org/wiki/File:X",
        },
      });
      expect(r.success, licence).toBe(true);
    }
  });

  it("rejects a port of a version that was never ported, with the rule in the message", () => {
    const r = playerSchema.safeParse({
      ...valid,
      image: {
        file: "x.jpg",
        author: "A",
        licence: "CC-BY-4.0-BR",
        source: "https://example.com/x",
      },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain("jurisdiction port");
  });

  it("requires an author on an image", () => {
    const r = playerSchema.safeParse({
      ...valid,
      image: { file: "x.jpg", licence: "CC-BY-4.0", source: "https://example.com/x" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a properly licensed image", () => {
    const r = playerSchema.safeParse({
      ...valid,
      image: {
        file: "x.jpg",
        author: "A Photographer",
        licence: "CC-BY-4.0",
        source: "https://commons.wikimedia.org/wiki/File:X",
      },
    });
    expect(r.success).toBe(true);
  });
});

describe("image focus", () => {
  const withFocus = (focus: unknown) =>
    playerSchema.safeParse({
      ...valid,
      image: {
        file: "x.jpg",
        author: "A Photographer",
        licence: "CC-BY-4.0",
        source: "https://commons.wikimedia.org/wiki/File:X",
        focus,
      },
    }).success;

  it("accepts two whole percentages separated by a space", () => {
    for (const focus of ["50 15", "0 0", "100 100", "7 93"])
      expect(withFocus(focus), focus).toBe(true);
  });

  it("rejects anything else", () => {
    for (const focus of [
      "50",
      "50 15 5",
      "50,15",
      "50  15",
      "50% 15%",
      "50.5 15",
      "101 0",
      "-1 0",
      50,
    ]) {
      expect(withFocus(focus), String(focus)).toBe(false);
    }
  });

  it("is carried to the engine shape as imageFocus, and absent otherwise", () => {
    const image = {
      file: "x.jpg",
      author: "A Photographer",
      licence: "CC-BY-4.0",
      source: "https://commons.wikimedia.org/wiki/File:X",
    };
    expect(
      toPlayer(playerSchema.parse({ ...valid, image: { ...image, focus: "50 15" } })).imageFocus,
    ).toBe("50 15");
    expect(toPlayer(playerSchema.parse({ ...valid, image }))).not.toHaveProperty("imageFocus");
  });
});

describe("toPlayer", () => {
  it("maps as_of to asOf", () => {
    const raw = playerSchema.parse({
      ...valid,
      stats: { ...valid.stats, ig: { value: 12.5, as_of: "2026-09-01" } },
    });
    expect(toPlayer(raw).stats.ig).toEqual({ value: 12.5, asOf: "2026-09-01" });
  });

  it("omits absent stats rather than setting undefined", () => {
    const raw = playerSchema.parse(valid);
    const player = toPlayer(raw);
    expect("ig" in player.stats).toBe(false);
    expect("fee" in player.stats).toBe(false);
  });

  it("preserves a zero", () => {
    const raw = playerSchema.parse({ ...valid, stats: { ...valid.stats, igoals: 0 } });
    expect(toPlayer(raw).stats.igoals).toBe(0);
  });

  it("omits deceased and iconic when absent", () => {
    const player = toPlayer(playerSchema.parse(valid));
    expect("deceased" in player).toBe(false);
    expect("iconic" in player).toBe(false);
  });
});
