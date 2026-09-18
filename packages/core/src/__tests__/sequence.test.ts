import { describe, expect, it } from "vitest";
import { buildRun, roundAt } from "../sequence.js";
import { STATS } from "../stats.js";
import { statAllowedAtRound } from "../ramp.js";
import { valueOf } from "../engine.js";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";

const run = (seed: string, maxRounds = 40) =>
  buildRun({ deck: fixtureDeck, seed, now: NOW, maxRounds });

describe("determinism", () => {
  it("produces an identical run for the same seed", () => {
    const a = run("ranked:142");
    const b = run("ranked:142");
    expect(a.map((r) => [r.index, r.stat, r.anchor.id, r.challenger.id])).toEqual(
      b.map((r) => [r.index, r.stat, r.anchor.id, r.challenger.id]),
    );
  });

  it("produces a different run for a different seed", () => {
    const a = run("ranked:142");
    const b = run("ranked:143");
    const sameShape = a.every(
      (r, i) => b[i] && b[i]!.challenger.id === r.challenger.id && b[i]!.stat === r.stat,
    );
    expect(sameShape).toBe(false);
  });

  it("agrees with roundAt for any index", () => {
    const full = run("ranked:7");
    for (const index of [1, 2, 5, 9]) {
      const single = roundAt({ deck: fixtureDeck, seed: "ranked:7", now: NOW }, index);
      expect(single?.challenger.id).toBe(full[index - 1]?.challenger.id);
      expect(single?.stat).toBe(full[index - 1]?.stat);
    }
  });
});

describe("structure", () => {
  it("numbers rounds from one, without gaps", () => {
    const rounds = run("shape");
    rounds.forEach((r, i) => expect(r.index).toBe(i + 1));
  });

  it("chains the challenger into the next anchor", () => {
    const rounds = run("chain");
    for (let i = 1; i < rounds.length; i++) {
      expect(rounds[i]!.anchor.id).toBe(rounds[i - 1]!.challenger.id);
    }
  });

  it("never pairs a player against themselves", () => {
    for (const r of run("self")) {
      expect(r.anchor.id).not.toBe(r.challenger.id);
    }
  });

  it("never deals a tie", () => {
    for (const r of run("ties")) {
      const a = valueOf(r.anchor, r.stat, NOW);
      const b = valueOf(r.challenger, r.stat, NOW);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a).not.toBe(b);
    }
  });

  it("only deals stats both players are eligible for", () => {
    for (const r of run("eligible")) {
      expect(STATS[r.stat].get(r.anchor, NOW)).toBeDefined();
      expect(STATS[r.stat].get(r.challenger, NOW)).toBeDefined();
    }
  });

  it("opens on a curated, recognisable anchor", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const first = run(seed)[0];
      expect(first).toBeDefined();
      expect(first!.anchor.iconic).toBe(true);
    }
  });

  it("opens on an easy, banded stat", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const first = run(seed)[0];
      expect(["club_goals", "ig", "caps"]).toContain(first!.stat);
    }
  });

  it("never spins the wheel on the opening round", () => {
    expect(run("spin")[0]!.statChanged).toBe(false);
  });

  it("never deals a band-exempt stat in the opening rounds", () => {
    for (const seed of ["x", "y", "z", "w"]) {
      for (const r of run(seed)) {
        if (r.index >= 11) break;
        expect(statAllowedAtRound(r.stat, r.index)).toBe(true);
      }
    }
  });
});

describe("the wheel in a run", () => {
  it("holds a stat for at least two rounds before switching", () => {
    for (const seed of ["h1", "h2", "h3", "h4"]) {
      const rounds = run(seed);
      let held = 0;
      for (const r of rounds) {
        if (r.statChanged) {
          expect(held).toBeGreaterThanOrEqual(2);
          held = 1;
        } else {
          held += 1;
        }
      }
    }
  });

  it("does change stat at some point in a long run", () => {
    const rounds = run("switching", 40);
    expect(rounds.some((r) => r.statChanged)).toBe(true);
  });

  it("marks statChanged only when the stat actually changed", () => {
    const rounds = run("marks");
    for (let i = 1; i < rounds.length; i++) {
      const changed = rounds[i]!.stat !== rounds[i - 1]!.stat;
      expect(rounds[i]!.statChanged).toBe(changed);
    }
  });
});

describe("degenerate decks", () => {
  it("returns no rounds for an empty deck", () => {
    expect(buildRun({ deck: [], seed: "empty", now: NOW })).toEqual([]);
  });

  it("returns no rounds for a single-player deck", () => {
    expect(buildRun({ deck: [fixtureDeck[0]!], seed: "one", now: NOW })).toEqual([]);
  });

  it("stops rather than looping forever on a tiny deck", () => {
    const tiny = [fixtureDeck[0]!, fixtureDeck[1]!];
    const rounds = buildRun({ deck: tiny, seed: "tiny", now: NOW, maxRounds: 50 });
    expect(rounds.length).toBeLessThanOrEqual(50);
  });
});
