/**
 * 1v1 (duel.ts): a match is dealt by Endless's engine on its pool's variant,
 * by Twitch Mode's match bands, under a seed domain of its own, and carries on
 * past its questions for sudden death in the bands' last row. Its own goldens;
 * every other mode's are in determinism.test.ts, squad.test.ts and
 * stream.test.ts, unchanged.
 */

import { describe, expect, it } from "vitest";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";
import { themedDeck } from "../__fixtures__/themed-deck.js";
import { deadlineWithLimit } from "../clock.js";
import {
  DEFAULT_DUEL_LIMIT,
  DUEL_LENGTHS,
  DUEL_LIMITS,
  SUDDEN_DEATH_MAX,
  buildDuelRun,
  duelDeadline,
  duelQuestions,
  duelSeedDomain,
  isDuelLength,
  isDuelLimit,
  isDuelPool,
  isSuddenDeath,
} from "../duel.js";
import {
  STREAM_INSTAGRAM_SCHEDULE,
  STREAM_SCHEDULE,
  STREAM_SQUAD_SCHEDULE,
  bandForRound,
} from "../ramp.js";
import { buildRun } from "../sequence.js";
import {
  buildStreamRun,
  streamBands,
  streamBandsFor,
  streamQuestions,
  streamSeedDomain,
} from "../stream.js";
import { inTheme, themeById } from "../themes.js";
import { seedDomainOf } from "../variants.js";
import type { Round } from "../types.js";

const THEMED = themedDeck();
const NORTHFIELD = "squad:club-northfield" as const; // 22 players: 21 questions
const SOUTHGATE = "squad:club-southgate" as const; // 15 players: 14 questions
const LEAGUE = "squad:league-testland-league" as const; // 60 players

function fingerprint(rounds: readonly Round[]): string {
  return rounds.map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`).join("|");
}

/** Everyone a match deals: the opening anchor, then each challenger. */
function dealt(rounds: readonly Round[]): string[] {
  return rounds.length === 0 ? [] : [rounds[0]!.anchor.id, ...rounds.map((r) => r.challenger.id)];
}

describe("settings", () => {
  it("accepts only its lengths and its three limits", () => {
    expect(DUEL_LENGTHS).toEqual([10, 20]);
    expect(DUEL_LIMITS).toEqual([10, 20, 30]);
    expect(DEFAULT_DUEL_LIMIT).toBe(20);
    for (const n of [10, 20]) expect(isDuelLength(n)).toBe(true);
    for (const n of [0, 5, 15, 21, "10", null]) expect(isDuelLength(n)).toBe(false);
    for (const n of [10, 20, 30]) expect(isDuelLimit(n)).toBe(true);
    // Twitch Mode's minute is not a 1v1 limit.
    for (const n of [0, 5, 15, 45, 60, "20", undefined]) expect(isDuelLimit(n)).toBe(false);
  });

  it("takes any Endless variant as a pool, never Daily", () => {
    for (const pool of ["endless", "endless-instagram", NORTHFIELD]) {
      expect(isDuelPool(pool)).toBe(true);
    }
    for (const pool of ["ranked", "friendly", "daily", "squad:", 7]) {
      expect(isDuelPool(pool)).toBe(false);
    }
  });

  it("caps a squad as Twitch Mode does", () => {
    for (const [pool, deck] of [
      ["endless", fixtureDeck],
      [NORTHFIELD, THEMED],
      [SOUTHGATE, THEMED],
      ["squad:club-nowhere", THEMED],
    ] as const) {
      for (const length of DUEL_LENGTHS) {
        expect(duelQuestions(pool, length, deck)).toBe(streamQuestions(pool, length, deck));
      }
    }
    expect(duelQuestions(SOUTHGATE, 20, THEMED)).toBe(14);
    expect(duelQuestions("squad:club-nowhere", 10, THEMED)).toBeUndefined();
  });

  it("derives seeds under a domain of its own per pool, never another mode's", () => {
    const pools = ["endless", "endless-instagram", NORTHFIELD, LEAGUE] as const;
    const domains = pools.map((p) => duelSeedDomain(p));
    expect(domains).toEqual([
      "duel:endless:",
      "duel:endless-instagram:",
      "duel:squad:club-northfield:",
      "duel:squad:league-testland-league:",
    ]);
    expect(new Set(domains).size).toBe(domains.length);
    for (const [i, d] of domains.entries()) {
      expect(d).not.toBe(streamSeedDomain(pools[i]!));
      for (const other of pools) expect(d).not.toBe(seedDomainOf(other));
      expect(d.startsWith("ranked:") || d.startsWith("friendly:")).toBe(false);
    }
  });

  it("puts the room's limit on every question, question one included", () => {
    for (const limit of DUEL_LIMITS) {
      for (const round of [1, 2, 10, 25]) {
        for (const changed of [true, false]) {
          expect(duelDeadline(1000, round, changed, limit, "endless")).toBe(
            deadlineWithLimit(1000, round, changed, limit * 1000, true),
          );
        }
      }
    }
    // Instagram has no wheel, so no spin in its allowance.
    expect(duelDeadline(0, 3, true, 20, "endless-instagram")).toBe(
      deadlineWithLimit(0, 3, true, 20_000, false),
    );
  });

  it("knows a sudden-death question", () => {
    expect(isSuddenDeath(10, 10)).toBe(false);
    expect(isSuddenDeath(11, 10)).toBe(true);
    expect(isSuddenDeath(20, 20)).toBe(false);
  });
});

describe("the deal", () => {
  it("is the same for both players: a pure function of the seed, the pool and the length", () => {
    for (const [pool, deck] of [
      ["endless", fixtureDeck],
      ["endless-instagram", fixtureDeck],
      [NORTHFIELD, THEMED],
    ] as const) {
      const opts = { deck, seed: `${duelSeedDomain(pool)}m1`, now: NOW, pool, questions: 10 };
      const host = buildDuelRun(opts);
      const guest = buildDuelRun(opts);
      expect(host.length).toBeGreaterThan(0);
      expect(fingerprint(guest)).toBe(fingerprint(host));
      // Another match in the same room is another seed, and another deal.
      const rematch = buildDuelRun({ ...opts, seed: `${duelSeedDomain(pool)}m2` });
      expect(fingerprint(rematch)).not.toBe(fingerprint(host));
    }
  });

  it("uses Twitch Mode's match bands themselves, not a copy", () => {
    // The same seed and pool deal the same questions as a Twitch Mode match would:
    // only the seed's domain tells the two modes apart.
    for (const [pool, deck] of [
      ["endless", fixtureDeck],
      ["endless-instagram", fixtureDeck],
      [NORTHFIELD, THEMED],
      [LEAGUE, THEMED],
    ] as const) {
      for (const questions of DUEL_LENGTHS) {
        const seed = `shared:${pool}:${questions}`;
        const stream = buildStreamRun({ deck, seed, now: NOW, pool, questions });
        const duel = buildDuelRun({ deck, seed, now: NOW, pool, questions });
        expect(fingerprint(duel.slice(0, stream.length))).toBe(fingerprint(stream));
        expect(streamBandsFor(pool, questions)).toBe(streamBandsFor(pool, questions));
      }
    }
  });

  it("carries on past the match for sudden death, in the bands' hardest row", () => {
    for (const [pool, rows] of [
      ["endless", STREAM_SCHEDULE],
      ["endless-instagram", STREAM_INSTAGRAM_SCHEDULE],
      [LEAGUE, STREAM_SQUAD_SCHEDULE],
    ] as const) {
      for (const questions of DUEL_LENGTHS) {
        const bands = streamBands(pool, questions);
        for (let extra = 1; extra <= SUDDEN_DEATH_MAX; extra++) {
          expect(bandForRound(questions + extra, "endless", bands)).toEqual(rows.at(-1)!.band);
        }
      }
    }
    const match = buildDuelRun({
      deck: THEMED,
      seed: "duel:squad:league-testland-league:sd",
      now: NOW,
      pool: LEAGUE,
      questions: 20,
    });
    // 60 players: the match and all its sudden death, nobody twice.
    expect(match).toHaveLength(20 + SUDDEN_DEATH_MAX);
    expect(match.map((r) => r.index)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const ids = dealt(match);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("deals the match's own questions the same whether or not sudden death follows", () => {
    const opts = { deck: THEMED, seed: "duel:x", now: NOW, pool: NORTHFIELD, questions: 10 };
    const whole = buildDuelRun(opts);
    const cut = buildDuelRun({ ...opts, maxRounds: 10 });
    expect(cut).toHaveLength(10);
    expect(fingerprint(whole.slice(0, 10))).toBe(fingerprint(cut));
    // One round ahead, as the server deals for the next photo.
    expect(fingerprint(buildDuelRun({ ...opts, maxRounds: 4 }))).toBe(
      fingerprint(whole.slice(0, 4)),
    );
  });

  it("Instagram deals only players with a figure, on followers every question", () => {
    for (let i = 0; i < 20; i++) {
      const match = buildDuelRun({
        deck: fixtureDeck,
        seed: `duel:endless-instagram:${i}`,
        now: NOW,
        pool: "endless-instagram",
        questions: 10,
      });
      expect(match.length).toBeGreaterThan(0);
      for (const r of match) {
        expect(r.stat).toBe("ig");
        expect(r.anchor.stats.ig).toBeDefined();
        expect(r.challenger.stats.ig).toBeDefined();
      }
    }
  });

  it("a squad deals only its theme's players, and never one twice, sudden death included", () => {
    const theme = themeById(THEMED, "club-northfield")!;
    for (const questions of DUEL_LENGTHS) {
      for (let i = 0; i < 25; i++) {
        const match = buildDuelRun({
          deck: THEMED,
          seed: `duel:${NORTHFIELD}:${i}`,
          now: NOW,
          pool: NORTHFIELD,
          questions,
        });
        // 22 players: at most 21 questions, however many the match and its sudden death ask for.
        expect(match.length).toBeGreaterThanOrEqual(questions);
        expect(match.length).toBeLessThanOrEqual(21);
        const ids = dealt(match);
        expect(new Set(ids).size).toBe(ids.length);
        for (const r of match) {
          expect(inTheme(r.anchor, theme)).toBe(true);
          expect(inTheme(r.challenger, theme)).toBe(true);
        }
      }
    }
  });

  it("a small squad's sudden death ends when the squad does", () => {
    const questions = duelQuestions(SOUTHGATE, 20, THEMED)!;
    expect(questions).toBe(14);
    const match = buildDuelRun({
      deck: THEMED,
      seed: "duel:squad:club-southgate:1",
      now: NOW,
      pool: SOUTHGATE,
      questions,
    });
    // 15 players: 14 questions, and none left for sudden death.
    expect(match.length).toBeLessThanOrEqual(14);
  });

  it("never deals past the match and its sudden death", () => {
    for (const questions of DUEL_LENGTHS) {
      const match = buildDuelRun({
        deck: fixtureDeck,
        seed: "duel:endless:long",
        now: NOW,
        pool: "endless",
        questions,
        maxRounds: 99,
      });
      expect(match).toHaveLength(questions + SUDDEN_DEATH_MAX);
    }
  });

  it("changes nothing for a run without `extraRounds`", () => {
    const plain = (): string =>
      fingerprint(
        buildRun({ deck: THEMED, seed: "squad:7", now: NOW, mode: "endless", variant: NORTHFIELD }),
      );
    const stream = (): string =>
      fingerprint(
        buildStreamRun({
          deck: THEMED,
          seed: "stream:7",
          now: NOW,
          pool: NORTHFIELD,
          questions: 10,
        }),
      );
    const before = [plain(), stream()];
    // A duel on the same theme and length first, so a memo it disturbed would show.
    buildDuelRun({ deck: THEMED, seed: "squad:7", now: NOW, pool: NORTHFIELD, questions: 10 });
    expect([plain(), stream()]).toEqual(before);
    // A Twitch Mode match still stops at its length.
    expect(
      buildStreamRun({ deck: fixtureDeck, seed: "s", now: NOW, pool: "endless", questions: 10 }),
    ).toHaveLength(10);
  });
});

describe("duel goldens", () => {
  // Golden values: if one changes, the 1v1 dealer changed. Update deliberately.
  it("All legends, 10 questions and sudden death", () => {
    const match = buildDuelRun({
      deck: fixtureDeck,
      seed: "duel:endless:1",
      now: NOW,
      pool: "endless",
      questions: 10,
    });
    expect(fingerprint(match)).toMatchInlineSnapshot(
      `"1:igoals:alpha>golf|2:igoals:golf>kilo|3:age:kilo>charlie|4:age:charlie>echo|5:age:echo>delta|6:age:delta>juliet|7:age:juliet>foxtrot|8:club_goals:foxtrot>india|9:club_goals:india>hotel|10:it:hotel>lima|11:it:lima>bravo|12:apps:bravo>golf|13:apps:golf>bravo|14:apps:bravo>golf|15:apps:golf>bravo|16:apps:bravo>golf|17:club_goals:golf>foxtrot|18:club_goals:foxtrot>golf|19:club_goals:golf>foxtrot|20:club_goals:foxtrot>india"`,
    );
  });

  it("Instagram, 10 questions", () => {
    const match = buildDuelRun({
      deck: fixtureDeck,
      seed: "duel:endless-instagram:1",
      now: NOW,
      pool: "endless-instagram",
      questions: 10,
      maxRounds: 10,
    });
    expect(fingerprint(match)).toMatchInlineSnapshot(
      `"1:ig:bravo>foxtrot|2:ig:foxtrot>hotel|3:ig:hotel>alpha|4:ig:alpha>kilo|5:ig:kilo>echo|6:ig:echo>delta|7:ig:delta>lima|8:ig:lima>india|9:ig:india>juliet|10:ig:juliet>charlie"`,
    );
  });

  it("a club, 20 questions", () => {
    const match = buildDuelRun({
      deck: THEMED,
      seed: "duel:squad:club-northfield:1",
      now: NOW,
      pool: NORTHFIELD,
      questions: 20,
    });
    expect(fingerprint(match)).toMatchInlineSnapshot(
      `"1:caps:p5>p0|2:caps:p0>p20|3:ig:p20>p13|4:apps:p13>p16|5:apps:p16>p9|6:apps:p9>p17|7:apps:p17>p18|8:apps:p18>p12|9:it:p12>p8|10:caps:p8>p21|11:apps:p21>p3|12:apps:p3>p11|13:caps:p11>p4|14:caps:p4>p14|15:caps:p14>p10|16:caps:p10>p15|17:it:p15>p1|18:caps:p1>p2|19:apps:p2>p19|20:apps:p19>p7|21:apps:p7>p6"`,
    );
  });

  it("a league, 10 questions and sudden death", () => {
    const match = buildDuelRun({
      deck: THEMED,
      seed: "duel:squad:league-testland-league:1",
      now: NOW,
      pool: LEAGUE,
      questions: 10,
    });
    expect(fingerprint(match)).toMatchInlineSnapshot(
      `"1:apps:p10>p30|2:apps:p30>p25|3:club_goals:p25>p19|4:apps:p19>p2|5:apps:p2>p52|6:apps:p52>p51|7:apps:p51>p0|8:caps:p0>p17|9:apps:p17>p18|10:caps:p18>p39|11:caps:p39>p23|12:apps:p23>p47|13:caps:p47>p11|14:caps:p11>p4|15:caps:p4>p31|16:apps:p31>p48|17:apps:p48>p45|18:caps:p45>p58|19:caps:p58>p43|20:caps:p43>p6"`,
    );
  });
});
