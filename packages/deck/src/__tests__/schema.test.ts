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
