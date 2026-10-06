import { describe, expect, it } from "vitest";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";
import { createRng } from "../prng.js";
import { INSTAGRAM_SCHEDULE, bandFor, bandForRound, gap } from "../ramp.js";
import { MAX_ROUNDS, buildRun } from "../sequence.js";
import { STAT_KEYS } from "../stats.js";
import {
  DEFAULT_VARIANT,
  ENDLESS_VARIANTS,
  hasWheel,
  isEndlessVariantId,
  isNamedVariant,
  variantDeck,
  variantOf,
} from "../variants.js";
import type { Player, Position, Round } from "../types.js";

/**
 * A bigger invented deck for long runs: 120 players, about nine in ten with a
 * follower count spread over four orders of magnitude, a few without one, and
 * every eighth iconic. Seeded, so it is the same deck every time.
 */
function syntheticDeck(): Player[] {
  const rng = createRng("variants:deck");
  const positions: Position[] = ["GK", "DF", "MF", "FW"];
  const used = new Set<number>();
  return Array.from({ length: 120 }, (_, i) => {
    let ig: number | undefined;
    if (rng.next() < 0.9) {
      // 0.05m to 500m, kept to two decimals and unique, as real figures are.
      do ig = Math.round(Math.exp(Math.log(0.05) + rng.next() * Math.log(10_000)) * 100) / 100;
      while (used.has(ig));
      used.add(ig);
    }
    return {
      id: `p${i}`,
      name: `Player ${i}`,
      country: "Testland",
      position: positions[i % 4]!,
      dob: `19${60 + (i % 30)}-01-01`,
      iconic: i % 8 === 0,
      stats: {
        caps: 10 + i,
        apps: 300 + i * 3,
        ...(ig !== undefined ? { ig: { value: ig, asOf: "2026-09-01" } } : {}),
      },
    };
  });
}

const BIG = syntheticDeck();
const INSTAGRAM = ENDLESS_VARIANTS["endless-instagram"];

function instagramRun(seed: string, deck: readonly Player[] = BIG, maxRounds = 60): Round[] {
  return buildRun({
    deck,
    seed,
    mode: "endless",
    now: NOW,
    maxRounds,
    variant: "endless-instagram",
  });
}

function fingerprint(rounds: readonly Round[]): string {
  return rounds.map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`).join("|");
}

describe("the variant registry", () => {
  it("has general Endless with no pool, the wheel and boards, and Instagram Endless without", () => {
    const general = ENDLESS_VARIANTS.endless;
    expect(general).toMatchObject({ pool: null, stat: null, boards: true, format: "endless" });
    expect(general.seedDomain).toBe("endless:");
    expect(INSTAGRAM).toMatchObject({ stat: "ig", boards: false, format: "endless" });
    expect(INSTAGRAM.seedDomain).toBe("endless:instagram:");
    expect(INSTAGRAM.pairRules).toBeNull();
    expect(INSTAGRAM.volatileFloor).toBe(false);
  });

  it("never shares a seed domain, so two variants' runs can't collide", () => {
    const domains = Object.values(ENDLESS_VARIANTS).map((v) => v.seedDomain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("reads ids and names", () => {
    expect(DEFAULT_VARIANT).toBe("endless");
    expect(isEndlessVariantId("endless-instagram")).toBe(true);
    expect(isEndlessVariantId("instagram")).toBe(false);
    expect(isEndlessVariantId("toString")).toBe(false);
    expect(isNamedVariant("endless-instagram")).toBe(true);
    expect(isNamedVariant("endless")).toBe(false);
    expect(variantOf(undefined)).toBe("endless");
    expect(variantOf("endless-instagram")).toBe("endless-instagram");
    expect(hasWheel("endless")).toBe(true);
    expect(hasWheel("endless-instagram")).toBe(false);
  });

  it("filters the pool once per deck, and leaves a pool-less variant's deck as it is", () => {
    expect(variantDeck(BIG, ENDLESS_VARIANTS.endless)).toBe(BIG);
    const pool = variantDeck(BIG, INSTAGRAM);
    expect(variantDeck(BIG, INSTAGRAM)).toBe(pool);
    expect(pool.length).toBe(BIG.filter((p) => p.stats.ig !== undefined).length);
    expect(pool.length).toBeLessThan(BIG.length);
  });
});

describe("general Endless as a variant", () => {
  it("bands every stat at every round exactly as the mode does", () => {
    for (const stat of STAT_KEYS) {
      for (let round = 1; round <= 60; round++) {
        expect(bandFor(stat, round, "endless", ENDLESS_VARIANTS.endless)).toEqual(
          bandFor(stat, round, "endless"),
        );
      }
    }
  });

  it("deals exactly the runs Endless deals without naming it", () => {
    for (let i = 0; i < 40; i++) {
      for (const deck of [fixtureDeck, BIG]) {
        const opts = {
          deck,
          seed: `general:${i}`,
          mode: "endless",
          now: NOW,
          maxRounds: 40,
        } as const;
        expect(fingerprint(buildRun({ ...opts, variant: "endless" }))).toBe(
          fingerprint(buildRun(opts)),
        );
      }
    }
  });

  it("is refused outside Endless", () => {
    expect(() =>
      buildRun({ deck: fixtureDeck, seed: "x", mode: "friendly", now: NOW, variant: "endless" }),
    ).toThrow();
  });
});

describe("Instagram Endless", () => {
  const SEEDS = Array.from({ length: 300 }, (_, i) => `instagram:${i}`);
  const runs = SEEDS.map((seed) => instagramRun(seed));

  it("asks Instagram followers on every question, with no stat change", () => {
    for (const rounds of runs) {
      expect(rounds.length).toBeGreaterThan(0);
      for (const r of rounds) {
        expect(r.stat).toBe("ig");
        expect(r.statChanged).toBe(false);
      }
    }
  });

  it("never deals a player without an Instagram figure", () => {
    for (const rounds of runs) {
      for (const r of rounds) {
        expect(r.anchor.stats.ig).toBeDefined();
        expect(r.challenger.stats.ig).toBeDefined();
      }
    }
  });

  it("holds every round's closeness floor and never deals a tie, relaxed rounds included", () => {
    let relaxed = 0;
    for (const rounds of runs) {
      for (const r of rounds) {
        const a = r.anchor.stats.ig!.value;
        const b = r.challenger.stats.ig!.value;
        expect(a).not.toBe(b);
        const floor = bandForRound(r.index, "endless", INSTAGRAM).strictMinRatio!;
        expect(gap(a, b)).toBeGreaterThanOrEqual(floor - 1e-9);
        // The band dealt keeps the floor, whatever else gave.
        expect(r.band.strictMinRatio).toBe(floor);
        expect(r.band.minRatio).toBeUndefined();
        if (r.relaxation === "band" || r.relaxation === "seen") relaxed += 1;
      }
    }
    // The floor is under test after relaxation, not only in easy rounds.
    expect(relaxed).toBeGreaterThan(0);
  });

  it("deals within the scheduled rank band when it doesn't relax", () => {
    for (const rounds of runs) {
      for (const r of rounds) {
        if (r.relaxation !== "none" && r.relaxation !== "iconic") continue;
        const scheduled = bandForRound(r.index, "endless", INSTAGRAM);
        expect(r.band).toEqual(scheduled);
      }
    }
  });

  it("tightens its floor from 2× to 1.25×, never loosening", () => {
    const floors = INSTAGRAM_SCHEDULE.map((row) => row.band.strictMinRatio!);
    expect(floors[0]).toBe(1);
    expect(floors.at(-1)).toBe(0.25);
    for (let i = 1; i < floors.length; i++) expect(floors[i]!).toBeLessThanOrEqual(floors[i - 1]!);
  });

  it("opens on iconic players and prefers them for five rounds", () => {
    for (const rounds of runs) {
      expect(rounds[0]!.anchor.iconic).toBe(true);
    }
    const early = runs.flatMap((rounds) => rounds.slice(0, 5));
    const iconic = early.filter((r) => r.challenger.iconic === true).length;
    expect(iconic / early.length).toBeGreaterThan(0.5);
  });

  it("deals on the small fixture deck too, within the same rules", () => {
    for (let i = 0; i < 100; i++) {
      for (const r of instagramRun(`fixture:${i}`, fixtureDeck, 40)) {
        expect(r.stat).toBe("ig");
        const floor = bandForRound(r.index, "endless", INSTAGRAM).strictMinRatio!;
        expect(gap(r.anchor.stats.ig!.value, r.challenger.stats.ig!.value)).toBeGreaterThanOrEqual(
          floor - 1e-9,
        );
      }
    }
  });

  it("is a different run from general Endless on the same seed", () => {
    const opts = { deck: BIG, seed: "same", mode: "endless", now: NOW, maxRounds: 20 } as const;
    expect(fingerprint(instagramRun("same", BIG, 20))).not.toBe(fingerprint(buildRun(opts)));
  });

  it("can deal to Endless's cap", () => {
    const long = instagramRun("cap", BIG, MAX_ROUNDS.endless);
    expect(long.length).toBe(MAX_ROUNDS.endless);
  });
});
