import { describe, expect, it } from "vitest";
import {
  ICONIC_ROUNDS,
  MAX_ANY_ROUND,
  MAX_ROUNDS,
  OPENING_DWELL,
  WHEEL_VIABILITY,
  WIN_ROUNDS,
  buildRun,
  isFinalRound,
  isViable,
  roundAt,
  roundCap,
} from "../sequence.js";
import { STATS, STAT_KEYS } from "../stats.js";
import { SEEN_DEPTH, candidates, valueOf } from "../engine.js";
import { isEligible } from "../eligibility.js";
import { BAND_SCHEDULES, PAIR_RULES, bandFor, gap, meetsValueRule, relaxations } from "../ramp.js";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";
import type { Mode, Player } from "../types.js";

const MODES = Object.keys(ICONIC_ROUNDS) as Mode[];

const run = (seed: string, maxRounds = 40, mode: Mode = "ranked") =>
  buildRun({ deck: fixtureDeck, seed, mode, now: NOW, maxRounds });

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

  it("produces an identical run for the same seed and mode, in every mode", () => {
    for (const mode of MODES) {
      const a = run("same", 30, mode).map((r) => [r.stat, r.anchor.id, r.challenger.id]);
      const b = run("same", 30, mode).map((r) => [r.stat, r.anchor.id, r.challenger.id]);
      expect(a).toEqual(b);
    }
  });

  it("agrees with roundAt for any index", () => {
    const full = run("ranked:7");
    for (const index of [1, 2, 5, 9]) {
      const single = roundAt(
        { deck: fixtureDeck, seed: "ranked:7", mode: "ranked", now: NOW },
        index,
      );
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

  it("draws the opening anchor from the whole iconic pool, not its first member", () => {
    const iconic = fixtureDeck.filter((p) => p.iconic === true).map((p) => p.id);
    const openers = new Set<string>();
    for (let i = 0; i < 60; i++) openers.add(run(`opener-${i}`, 1)[0]!.anchor.id);
    expect(openers.size).toBeGreaterThan(1);
    expect([...openers].sort()).toEqual([...iconic].sort());
  });

  it("never opens on a rare stat", () => {
    for (let i = 0; i < 200; i++) {
      const first = run(`open-${i}`, 1)[0];
      expect(STATS[first!.stat].tier).not.toBe("rare");
    }
  });

  it("opens on every basic and uncommon stat the deck can deal, not a fixed few", () => {
    const opened = new Set<string>();
    for (let i = 0; i < 400; i++) opened.add(run(`spread-${i}`, 1)[0]!.stat);
    for (const key of ["club_goals", "caps", "apps", "ig", "fee", "igoals"]) {
      expect(opened).toContain(key);
    }
  });

  it("never spins the wheel on the opening round", () => {
    expect(run("spin")[0]!.statChanged).toBe(false);
  });

  it("can switch to a rare stat well before round 11 now that every stat is banded", () => {
    let earlyRare = 0;
    for (let i = 0; i < 200; i++) {
      for (const r of run(`rare-${i}`, 10)) {
        if (STATS[r.stat].tier === "rare") earlyRare += 1;
      }
    }
    expect(earlyRare).toBeGreaterThan(0);
  });
});

describe("iconic preference", () => {
  // Forty invented forwards on a geometric ladder, every third one iconic, so
  // most anchors have both iconic and non-iconic opponents at the opening band.
  const ladder: readonly Player[] = Array.from({ length: 40 }, (_, i) => ({
    id: `p${String(i).padStart(2, "0")}`,
    name: `Player ${i}`,
    country: "Testland",
    position: "FW" as const,
    dob: "1980-01-01",
    ...(i % 3 === 0 ? { iconic: true } : {}),
    stats: {
      club_goals: Math.round(3 * 1.19 ** i),
      caps: Math.round(2 * 1.13 ** i) + i,
      apps: 100 + 17 * i,
    },
  }));
  const ladderRun = (seed: string, mode: Mode) =>
    buildRun({ deck: ladder, seed, mode, now: NOW, maxRounds: 20 });
  const seeds = Array.from({ length: 40 }, (_, i) => `iconic-${i}`);

  it("prefers an iconic challenger for exactly the mode's window", () => {
    for (const mode of MODES) {
      const window = ICONIC_ROUNDS[mode];
      let iconicInWindow = 0;
      let plainAfterWindow = 0;
      for (const seed of seeds) {
        for (const r of ladderRun(seed, mode)) {
          if (r.index <= window) {
            // Inside the window a round met outright must have an iconic challenger.
            if (r.relaxation === "none") expect(r.challenger.iconic).toBe(true);
            if (r.challenger.iconic === true) iconicInWindow += 1;
          } else {
            // Past it the preference is off, so it can never be what gave.
            expect(r.relaxation).not.toBe("iconic");
            if (r.relaxation === "none" && r.challenger.iconic !== true) plainAfterWindow += 1;
          }
        }
      }
      expect(iconicInWindow).toBeGreaterThan(0);
      expect(plainAfterWindow).toBeGreaterThan(0);
    }
  });

  it("keeps preferring iconic between a short window's end and a long window's end", () => {
    const [short, long] = [...MODES].sort((a, b) => ICONIC_ROUNDS[a] - ICONIC_ROUNDS[b]);
    const [shortEnd, longEnd] = [ICONIC_ROUNDS[short!], ICONIC_ROUNDS[long!]];
    if (shortEnd === longEnd) return; // every mode shares one window; nothing to compare
    const share = (mode: Mode) => {
      let iconic = 0;
      let total = 0;
      for (const seed of seeds) {
        for (const r of ladderRun(seed, mode)) {
          if (r.index <= shortEnd || r.index > longEnd) continue;
          total += 1;
          if (r.challenger.iconic === true) iconic += 1;
        }
      }
      return iconic / total;
    };
    expect(share(long!)).toBeGreaterThan(share(short!));
  });

  it("deals identical rounds across modes until the shorter window or first band ends", () => {
    // Every schedule opens on the same band, so the modes agree until one
    // stops preferring iconic players or moves on to its second band.
    const shared = Math.min(
      ...MODES.map((m) => ICONIC_ROUNDS[m]),
      ...MODES.map((m) => BAND_SCHEDULES[m][0]!.upTo),
    );
    for (const seed of seeds) {
      const byMode = MODES.map((m) =>
        ladderRun(seed, m)
          .slice(0, shared)
          .map((r) => `${r.stat}:${r.anchor.id}>${r.challenger.id}`),
      );
      for (const other of byMode) expect(other).toEqual(byMode[0]);
    }
  });

  it("changes the run when the mode's window or schedule differs", () => {
    const differs = seeds.some(
      (seed) =>
        JSON.stringify(ladderRun(seed, "friendly").map((r) => r.challenger.id)) !==
        JSON.stringify(ladderRun(seed, "ranked").map((r) => r.challenger.id)),
    );
    expect(differs).toBe(true);
  });
});

describe("a run's length and bands, per mode", () => {
  it("knows Friendly's final question, and that the other modes have none", () => {
    expect(isFinalRound(20, "friendly")).toBe(true);
    expect(isFinalRound(19, "friendly")).toBe(false);
    expect(isFinalRound(20, "endless")).toBe(false);
    expect(isFinalRound(MAX_ROUNDS.ranked, "ranked")).toBe(false);
  });

  it("caps Friendly at its win target, Endless and Daily Ranked at 150", () => {
    expect(WIN_ROUNDS).toEqual({ friendly: 20, endless: null, ranked: null });
    expect(MAX_ROUNDS).toEqual({ friendly: 20, endless: 150, ranked: 150 });
    expect(roundCap("friendly")).toBe(20);
    expect(roundCap("endless")).toBe(150);
    expect(roundCap("ranked")).toBe(150);
    expect(MAX_ANY_ROUND).toBe(150);
  });

  it("never deals Friendly a round past twenty, whatever maxRounds asks for", () => {
    for (let i = 0; i < 20; i++) {
      expect(run(`cap-${i}`, 60, "friendly").length).toBeLessThanOrEqual(20);
      expect(
        buildRun({ deck: fixtureDeck, seed: `cap-${i}`, mode: "friendly", now: NOW }).length,
      ).toBeLessThanOrEqual(20);
    }
    expect(
      roundAt({ deck: fixtureDeck, seed: "cap", mode: "friendly", now: NOW }, 21),
    ).toBeUndefined();
  });

  it("deals Friendly's final stretch at least 10% apart, and never a tie", () => {
    let stretch = 0;
    for (let i = 0; i < 40; i++) {
      for (const r of run(`stretch-${i}`, 20, "friendly")) {
        const a = valueOf(r.anchor, r.stat, NOW)!;
        const b = valueOf(r.challenger, r.stat, NOW)!;
        expect(a).not.toBe(b);
        if (r.index < 18) continue;
        stretch += 1;
        expect(Math.max(a, b)).toBeGreaterThanOrEqual(1.1 * Math.min(a, b));
      }
    }
    expect(stretch).toBeGreaterThan(0);
  });

  it("still lets a shorter maxRounds stop a run early", () => {
    expect(run("short", 3, "friendly")).toHaveLength(3);
  });

  it("deals each mode's rounds from its own schedule", () => {
    for (const mode of MODES) {
      for (let i = 0; i < 30; i++) {
        for (const r of run(`bands-${i}`, 40, mode)) {
          // A round met outright used exactly the band its mode asks for.
          if (r.relaxation === "none" || r.relaxation === "iconic") {
            expect(r.band).toEqual(bandFor(r.stat, r.index, mode));
          }
        }
      }
    }
  });
});

describe("the wheel in a run", () => {
  it("holds the opening stat for exactly two rounds, so the first switch is round 3", () => {
    expect(OPENING_DWELL).toBe(2);
    for (let i = 0; i < 200; i++) {
      for (const mode of MODES) {
        const rounds = run(`hold-${i}`, 3, mode);
        expect(rounds).toHaveLength(3);
        expect(rounds[1]!.stat).toBe(rounds[0]!.stat);
        expect(rounds[1]!.statChanged).toBe(false);
        expect(rounds[2]!.statChanged).toBe(true);
      }
    }
  });

  it("never follows a rare stat with another while a non-rare stat was viable", () => {
    // On the band-only wheel (Friendly's). Rebuild what the wheel saw at each
    // switch: the seen queue is the last SEEN_DEPTH anchors. On this 12-player deck the queue sometimes leaves no
    // non-rare stat dealable, which is the fallback — counted, not failed.
    let withChoice = 0;
    let fallbacks = 0;
    for (let i = 0; i < 200; i++) {
      const rounds = run(`no-rr-${i}`, 20, "friendly");
      for (let j = 1; j < rounds.length; j++) {
        const prev = rounds[j - 1]!;
        const cur = rounds[j]!;
        if (!cur.statChanged || STATS[prev.stat].tier !== "rare") continue;
        const seen = rounds
          .slice(0, j)
          .map((r) => r.anchor.id)
          .reverse()
          .slice(0, SEEN_DEPTH);
        const nonRareViable = STAT_KEYS.some(
          (key) =>
            STATS[key].tier !== "rare" &&
            isEligible(cur.anchor, key, NOW) &&
            candidates(cur.anchor, key, bandFor(key, cur.index, "friendly"), {
              deck: fixtureDeck,
              now: NOW,
              seen,
            }).length > 0,
        );
        if (nonRareViable) {
          withChoice += 1;
          expect(STATS[cur.stat].tier, `${prev.stat} → ${cur.stat}`).not.toBe("rare");
        } else {
          fallbacks += 1;
        }
      }
    }
    expect(withChoice).toBeGreaterThan(0);
    // The fallback exists but must stay the exception.
    expect(fallbacks).toBeLessThan(withChoice);
  });

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
    expect(buildRun({ deck: [], seed: "empty", mode: "ranked", now: NOW })).toEqual([]);
  });

  it("returns no rounds for a single-player deck", () => {
    expect(buildRun({ deck: [fixtureDeck[0]!], seed: "one", mode: "ranked", now: NOW })).toEqual(
      [],
    );
  });

  it("stops rather than looping forever on a tiny deck", () => {
    const tiny = [fixtureDeck[0]!, fixtureDeck[1]!];
    const rounds = buildRun({ deck: tiny, seed: "tiny", mode: "ranked", now: NOW, maxRounds: 50 });
    expect(rounds.length).toBeLessThanOrEqual(50);
  });
});

describe("Endless", () => {
  const endless = (seed: string, maxRounds = 40) =>
    buildRun({ deck: fixtureDeck, seed, mode: "endless", now: NOW, maxRounds });
  const rules = PAIR_RULES.endless!;

  it("plays rounds 1–5 by Friendly's rules: the same bands and the same iconic window", () => {
    expect(ICONIC_ROUNDS.endless).toBe(ICONIC_ROUNDS.friendly);
    for (let r = 1; r <= ICONIC_ROUNDS.endless; r++) {
      for (const key of STAT_KEYS) {
        expect(bandFor(key, r, "endless")).toEqual(bandFor(key, r, "friendly"));
      }
    }
  });

  it("deals every pair from round 16 by its stat's rule, relaxed or not", () => {
    let late = 0;
    for (let i = 0; i < 60; i++) {
      for (const round of endless(`rules-${i}`)) {
        if (round.index < rules.from) continue;
        late += 1;
        const a = valueOf(round.anchor, round.stat, NOW)!;
        const b = valueOf(round.challenger, round.stat, NOW)!;
        expect(a).not.toBe(b);
        const rule = rules.narrow[round.stat];
        if (rule !== undefined) {
          expect(meetsValueRule(a, b, rule)).toBe(true);
          expect(round.band.valueRule).toEqual(rule);
        } else {
          // At least 10% apart, whatever step of the ladder the pair came from.
          expect(gap(a, b)).toBeGreaterThanOrEqual(rules.wideMinRatio - 1e-9);
          expect(round.band.strictMinRatio).toBe(rules.wideMinRatio);
        }
      }
    }
    expect(late).toBeGreaterThan(0);
  });

  it("lets the wheel switch to any stat it can deal at all, not only within the band", () => {
    const ctx = { deck: fixtureDeck, now: NOW, seen: [] };
    let wider = 0;
    for (let round = 2; round <= 40; round++) {
      for (const anchor of fixtureDeck) {
        for (const key of STAT_KEYS) {
          const band = bandFor(key, round, "endless");
          const loosest = relaxations(band, "fine").at(-1)!;
          const dealable =
            isEligible(anchor, key, NOW) && candidates(anchor, key, loosest, ctx, true).length > 0;
          expect(isViable(anchor, key, round, "endless", ctx)).toBe(dealable);
          if (dealable && candidates(anchor, key, band, ctx).length === 0) wider += 1;
        }
      }
    }
    // Some stats have nothing in the band yet can still be dealt: Endless takes them.
    expect(wider).toBeGreaterThan(0);
  });

  it("can deal every stat in every round from 2", () => {
    const ctx = { deck: fixtureDeck, now: NOW, seen: [] };
    for (let round = 2; round <= 150; round++) {
      for (const key of STAT_KEYS) {
        const somewhere = fixtureDeck.some((anchor) =>
          isViable(anchor, key, round, "endless", ctx),
        );
        expect(somewhere, `${key} at round ${round}`).toBe(true);
      }
    }
  });

  it("keeps Friendly on the band-only wheel; Daily Ranked has Endless's", () => {
    expect(WHEEL_VIABILITY).toEqual({ friendly: "band", endless: "any", ranked: "any" });
  });

  it("runs past round 20 and up to its cap", () => {
    const rounds = endless("long", 150);
    expect(rounds.length).toBeGreaterThan(20);
    expect(rounds.length).toBeLessThanOrEqual(150);
    rounds.forEach((r, i) => expect(r.index).toBe(i + 1));
  });
});
