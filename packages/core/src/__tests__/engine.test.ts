import { describe, expect, it } from "vitest";
import { SEEN_DEPTH, candidates, remember, selectChallenger, valueOf } from "../engine.js";
import { createRng } from "../prng.js";
import { bandFor, percentiles, rankDistance } from "../ramp.js";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";
import type { Player } from "../types.js";

const byId = (id: string) => {
  const p = fixtureDeck.find((x) => x.id === id);
  if (!p) throw new Error(`no fixture ${id}`);
  return p;
};

const ctx = (seen: string[] = []) => ({ deck: fixtureDeck, now: NOW, seen });

describe("candidates", () => {
  it("never returns the anchor", () => {
    const anchor = byId("alpha");
    const pool = candidates(anchor, "caps", { floor: 0, ceiling: null }, ctx());
    expect(pool.map((p) => p.id)).not.toContain("alpha");
  });

  it("excludes ties", () => {
    const tied: Player = {
      id: "twin",
      name: "Twin",
      country: "Testland",
      position: "FW",
      dob: "1980-01-01",
      stats: { caps: 100 },
    };
    const deck = [...fixtureDeck, tied];
    const pool = candidates(
      byId("alpha"),
      "caps",
      { floor: 0, ceiling: null },
      { deck, now: NOW, seen: [] },
    );
    expect(pool.map((p) => p.id)).not.toContain("twin");
  });

  // Distances are measured against the whole deck's spread for the stat.
  const distanceFrom = (anchor: Player, p: Player) =>
    rankDistance(
      percentiles(fixtureDeck, "caps", NOW),
      valueOf(anchor, "caps", NOW)!,
      valueOf(p, "caps", NOW)!,
    );

  it("respects the floor, in rank distance", () => {
    const anchor = byId("alpha");
    const pool = candidates(anchor, "caps", { floor: 0.4, ceiling: null }, ctx());
    expect(pool.length).toBeGreaterThan(0);
    for (const p of pool) expect(distanceFrom(anchor, p)).toBeGreaterThanOrEqual(0.4);
  });

  it("respects the ceiling, in rank distance", () => {
    const anchor = byId("alpha");
    const pool = candidates(anchor, "caps", { floor: 0, ceiling: 0.2 }, ctx());
    expect(pool.length).toBeGreaterThan(0);
    for (const p of pool) expect(distanceFrom(anchor, p)).toBeLessThanOrEqual(0.2);
  });

  it("measures distance on the whole deck, not the pool left after the seen queue", () => {
    const anchor = byId("alpha");
    const band = { floor: 0.4, ceiling: null };
    const all = candidates(anchor, "caps", band, ctx()).map((p) => p.id);
    const seen = fixtureDeck.map((p) => p.id).filter((id) => !all.includes(id) && id !== "alpha");
    const filtered = candidates(anchor, "caps", band, ctx(seen)).map((p) => p.id);
    expect(filtered).toEqual(all);
  });

  it("excludes recently seen players", () => {
    const anchor = byId("alpha");
    const open = { floor: 0, ceiling: null };
    const all = candidates(anchor, "caps", open, ctx()).map((p) => p.id);
    expect(all.length).toBeGreaterThan(1);
    const excluded = all[0]!;
    const filtered = candidates(anchor, "caps", open, ctx([excluded])).map((p) => p.id);
    expect(filtered).not.toContain(excluded);
  });

  it("ignores the seen queue when asked", () => {
    const anchor = byId("alpha");
    const open = { floor: 0, ceiling: null };
    const all = candidates(anchor, "caps", open, ctx()).map((p) => p.id);
    const excluded = all[0]!;
    const forced = candidates(anchor, "caps", open, ctx([excluded]), true).map((p) => p.id);
    expect(forced).toContain(excluded);
  });

  it("excludes players ineligible for the stat", () => {
    const pool = candidates(byId("alpha"), "club_goals", { floor: 0, ceiling: null }, ctx());
    expect(pool.map((p) => p.id)).not.toContain("echo"); // goalkeeper
  });

  it("returns nothing when the anchor itself is ineligible", () => {
    const pool = candidates(byId("echo"), "club_goals", { floor: 0, ceiling: null }, ctx());
    expect(pool).toEqual([]);
  });
});

describe("selectChallenger", () => {
  it("is deterministic for a given seed", () => {
    const a = selectChallenger(byId("alpha"), "caps", 1, ctx(), createRng("x"));
    const b = selectChallenger(byId("alpha"), "caps", 1, ctx(), createRng("x"));
    expect(a?.challenger.id).toBe(b?.challenger.id);
  });

  it("marks a relaxed match when the band could not be met", () => {
    // Two players: they sit at opposite ends of the deck, a rank distance of
    // 1. Round 43 wants 0.02–0.12, which is unreachable, so the only possible
    // pair is a relaxed one.
    const near: Player = {
      id: "near",
      name: "Near",
      country: "T",
      position: "FW",
      dob: "1990-01-01",
      stats: { caps: 10 },
    };
    const far: Player = {
      id: "far",
      name: "Far",
      country: "T",
      position: "FW",
      dob: "1990-01-01",
      stats: { caps: 100 },
    };
    const match = selectChallenger(
      near,
      "caps",
      43,
      { deck: [near, far], now: NOW, seen: [] },
      createRng("relax"),
    );
    expect(match).toBeDefined();
    expect(match!.challenger.id).toBe("far");
    expect(match!.relaxation).not.toBe("none");
  });

  it("does not flag relaxation when the band was met", () => {
    const match = selectChallenger(byId("alpha"), "caps", 1, ctx(), createRng("ok"));
    expect(match).toBeDefined();
    expect(match!.relaxation).toBe("none");
  });

  it("still deals when everyone has been seen", () => {
    const seen = fixtureDeck.map((p) => p.id);
    const match = selectChallenger(
      byId("alpha"),
      "caps",
      1,
      { deck: fixtureDeck, now: NOW, seen },
      createRng("all-seen"),
    );
    expect(match).toBeDefined();
  });

  it("returns undefined when the deck cannot produce an opponent", () => {
    const lonely: Player = {
      id: "lonely",
      name: "Lonely",
      country: "Nowhere",
      position: "FW",
      dob: "1990-01-01",
      stats: { caps: 10 },
    };
    const match = selectChallenger(
      lonely,
      "caps",
      1,
      { deck: [lonely], now: NOW, seen: [] },
      createRng("lonely"),
    );
    expect(match).toBeUndefined();
  });
});

describe("selectChallenger with the iconic preference", () => {
  const forward = (id: string, caps: number, iconic = false): Player => ({
    id,
    name: id,
    country: "T",
    position: "FW",
    dob: "1990-01-01",
    ...(iconic ? { iconic: true } : {}),
    stats: { caps },
  });

  /**
   * Eleven forwards on 10, 20 … 110 caps, so percentiles run 0, 0.1 … 1. From
   * the anchor on 10, round one's 0.45 floor admits 60 caps and up (0.5+);
   * 20 to 50 caps are too close.
   */
  const ladder = (iconicCaps: readonly number[] = []): Player[] =>
    Array.from({ length: 11 }, (_, i) => (i + 1) * 10).map((caps) =>
      forward(caps === 10 ? "anchor" : `p${caps}`, caps, iconicCaps.includes(caps)),
    );
  const inBand = (id: string | undefined) => id !== undefined && Number(id.slice(1)) >= 60;

  const seeds = Array.from({ length: 30 }, (_, i) => `pref-${i}`);
  const pick = (
    deck: Player[],
    preferIconic: boolean,
    seed: string,
    seen: string[] = [],
    round = 1,
  ) =>
    selectChallenger(
      deck[0]!,
      "caps",
      round,
      { deck, now: NOW, seen },
      createRng(seed),
      preferIconic,
    );

  it("chooses an iconic challenger whenever one is valid", () => {
    const deck = ladder([100]);
    for (const seed of seeds) {
      const match = pick(deck, true, seed);
      expect(match?.challenger.id).toBe("p100");
      expect(match?.relaxation).toBe("none");
    }
  });

  it("chooses from the whole deck when the preference is off", () => {
    const deck = ladder([100]);
    const chosen = new Set(seeds.map((seed) => pick(deck, false, seed)?.challenger.id));
    expect(chosen.size).toBeGreaterThan(1);
    for (const id of chosen) expect(inBand(id)).toBe(true);
    for (const seed of seeds) expect(pick(deck, false, seed)?.relaxation).toBe("none");
  });

  it("falls back to the whole deck rather than widening the band", () => {
    // The only iconic opponent is on 20 caps: reachable only by relaxing the floor.
    const deck = ladder([20]);
    for (const seed of seeds) {
      const match = pick(deck, true, seed);
      expect(inBand(match?.challenger.id)).toBe(true);
      expect(match?.relaxation).toBe("iconic");
      expect(match?.band).toEqual(bandFor("caps", 1));
    }
  });

  it("falls back rather than dealing a recently seen iconic player", () => {
    const deck = ladder([100]);
    for (const seed of seeds) {
      const match = pick(deck, true, seed, ["p100"]);
      expect(match?.challenger.id).not.toBe("p100");
      expect(match?.relaxation).toBe("iconic");
    }
  });

  it("falls back rather than dealing a tied iconic player", () => {
    const deck = [...ladder(), forward("icon", 10, true)];
    for (const seed of seeds) {
      expect(pick(deck, true, seed)?.challenger.id).not.toBe("icon");
    }
  });

  it("reports the band, not the preference, when the band also had to widen", () => {
    // Three players are at least half the deck apart; round 43 wants 0.02–0.12.
    const deck = [forward("anchor", 10), forward("plain", 20), forward("icon", 30, true)];
    const match = pick(deck, true, "both", [], 43);
    expect(match?.relaxation).toBe("band");
  });

  it("never reports the preference when it was not asked for", () => {
    const deck = ladder([20]);
    for (const seed of seeds) expect(pick(deck, false, seed)?.relaxation).toBe("none");
  });
});

describe("remember", () => {
  it("puts the newest id first", () => {
    expect(remember(["a", "b"], "c")[0]).toBe("c");
  });

  it("caps the queue at SEEN_DEPTH", () => {
    let seen: string[] = [];
    for (let i = 0; i < 40; i++) seen = remember(seen, `p${i}`);
    expect(seen).toHaveLength(SEEN_DEPTH);
  });

  it("does not duplicate an id already present", () => {
    const seen = remember(["a", "b", "c"], "b");
    expect(seen.filter((x) => x === "b")).toHaveLength(1);
    expect(seen[0]).toBe("b");
  });
});
