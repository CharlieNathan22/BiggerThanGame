import { describe, expect, it } from "vitest";
import { SEEN_DEPTH, candidates, remember, selectChallenger, valueOf } from "../engine.js";
import { createRng } from "../prng.js";
import { gap } from "../ramp.js";
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

  it("respects the floor", () => {
    const anchor = byId("alpha");
    const band = { floor: 1, ceiling: null };
    const pool = candidates(anchor, "caps", band, ctx());
    const anchorValue = valueOf(anchor, "caps", NOW)!;
    for (const p of pool) {
      expect(gap(anchorValue, valueOf(p, "caps", NOW)!)).toBeGreaterThanOrEqual(1);
    }
  });

  it("respects the ceiling", () => {
    const anchor = byId("alpha");
    const band = { floor: 0, ceiling: 0.5 };
    const pool = candidates(anchor, "caps", band, ctx());
    const anchorValue = valueOf(anchor, "caps", NOW)!;
    for (const p of pool) {
      expect(gap(anchorValue, valueOf(p, "caps", NOW)!)).toBeLessThanOrEqual(0.5);
    }
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
    // Two players 10x apart on caps. Round 43 wants 30-80%, which is
    // unreachable, so the only possible pair is a relaxed one.
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
