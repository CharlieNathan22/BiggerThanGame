/**
 * Twitch Mode (stream.ts): a match deals Endless's engine on its pool's
 * variant under a seed domain of its own, cut at the match's length; a squad
 * pool ramps by progress through the match. Its own goldens; every other
 * mode's are in determinism.test.ts and squad.test.ts, unchanged.
 */

import { describe, expect, it } from "vitest";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";
import { themedDeck } from "../__fixtures__/themed-deck.js";
import { ANSWER_TIMINGS, NETWORK_GRACE_MS, deadlineFor, deadlineWithLimit } from "../clock.js";
import {
  STREAM_INSTAGRAM_SCHEDULE,
  STREAM_SCHEDULE,
  STREAM_SQUAD_SCHEDULE,
  bandForRound,
} from "../ramp.js";
import { buildRun } from "../sequence.js";
import {
  END_VOTING_AFTER_MS,
  STREAM_LENGTHS,
  STREAM_LIMITS,
  buildStreamRun,
  canEndVoting,
  isStreamLength,
  isStreamLimit,
  isStreamPool,
  streamCap,
  streamBands,
  streamDeadline,
  streamOpening,
  streamQuestions,
  streamSeedDomain,
} from "../stream.js";
import { inTheme, themeById } from "../themes.js";
import { resolveVariant, seedDomainOf } from "../variants.js";
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
  it("accepts only its lengths and limits", () => {
    expect(STREAM_LENGTHS).toEqual([10, 20]);
    expect(STREAM_LIMITS).toEqual([10, 20, 30, 60]);
    for (const n of [10, 20]) expect(isStreamLength(n)).toBe(true);
    for (const n of [0, 5, 15, 21, "10", null]) expect(isStreamLength(n)).toBe(false);
    for (const n of [10, 20, 30, 60]) expect(isStreamLimit(n)).toBe(true);
    for (const n of [0, 5, 15, 45, 61, 120, "30", undefined]) expect(isStreamLimit(n)).toBe(false);
  });

  it("takes any Endless variant as a pool, never Daily", () => {
    for (const pool of ["endless", "endless-instagram", NORTHFIELD]) {
      expect(isStreamPool(pool)).toBe(true);
    }
    for (const pool of ["ranked", "friendly", "daily", "squad:", "Squad:club-x", 7]) {
      expect(isStreamPool(pool)).toBe(false);
    }
  });

  it("caps a squad at its size less one, and other pools at the longest match", () => {
    expect(streamCap("endless", fixtureDeck)).toBe(20);
    expect(streamCap("endless-instagram", fixtureDeck)).toBe(20);
    expect(streamCap(NORTHFIELD, THEMED)).toBe(20);
    expect(streamCap(SOUTHGATE, THEMED)).toBe(14);
    expect(streamCap("squad:club-nowhere", THEMED)).toBeUndefined();
    expect(streamQuestions(SOUTHGATE, 10, THEMED)).toBe(10);
    expect(streamQuestions(SOUTHGATE, 20, THEMED)).toBe(14);
    expect(streamQuestions("endless", 20, fixtureDeck)).toBe(20);
  });

  it("derives seeds under a domain of its own per pool, never another mode's", () => {
    const pools = ["endless", "endless-instagram", NORTHFIELD, LEAGUE] as const;
    const domains = pools.map((p) => streamSeedDomain(p));
    expect(domains).toEqual([
      "stream:endless:",
      "stream:endless-instagram:",
      "stream:squad:club-northfield:",
      "stream:squad:league-testland-league:",
    ]);
    expect(new Set(domains).size).toBe(domains.length);
    for (const d of domains) {
      for (const other of ["endless", "endless-instagram", NORTHFIELD] as const) {
        expect(d).not.toBe(seedDomainOf(other));
      }
      expect(d.startsWith("ranked:") || d.startsWith("friendly:")).toBe(false);
    }
  });

  it("offers End voting from 8 seconds, never on the 10-second limit", () => {
    expect(END_VOTING_AFTER_MS).toBe(8000);
    expect(canEndVoting(10, 9_000)).toBe(false);
    for (const limit of [20, 30, 60] as const) {
      expect(canEndVoting(limit, 7_999)).toBe(false);
      expect(canEndVoting(limit, 8_000)).toBe(true);
    }
  });
});

describe("the deadline", () => {
  it("uses the chosen limit on every question, question one included", () => {
    for (const limit of STREAM_LIMITS) {
      for (const round of [1, 2, 10]) {
        for (const changed of [true, false]) {
          expect(streamDeadline(1000, round, changed, limit, "endless")).toBe(
            deadlineWithLimit(1000, round, changed, limit * 1000, true),
          );
        }
      }
    }
    // Question two on a 60 s match, the stat held: the short hold, then the minute, then the grace.
    const t = ANSWER_TIMINGS;
    expect(streamDeadline(0, 2, false, 60, "endless")).toBe(
      t.verdict + t.next + t.hold + 60_000 + NETWORK_GRACE_MS,
    );
  });

  it("has no spin in Instagram's allowance", () => {
    expect(streamDeadline(0, 3, true, 30, "endless-instagram")).toBe(
      deadlineWithLimit(0, 3, true, 30_000, false),
    );
  });

  it("leaves deadlineFor as it was", () => {
    expect(deadlineFor(0, 1, true, "endless")).toBe(deadlineWithLimit(0, 1, true, 15_000));
    expect(deadlineFor(0, 2, false, "ranked")).toBe(deadlineWithLimit(0, 2, false, 10_000));
    expect(deadlineFor(0, 2, false, "friendly")).toBeNull();
  });
});

describe("the pools", () => {
  it("deal by their own bands: a friendly opening, then hard all the way through the match", () => {
    for (const [pool, rows] of [
      ["endless", STREAM_SCHEDULE],
      ["endless-instagram", STREAM_INSTAGRAM_SCHEDULE],
      [NORTHFIELD, STREAM_SQUAD_SCHEDULE],
    ] as const) {
      for (const questions of [10, 14, 20]) {
        const bands = streamBands(pool, questions);
        const open = streamOpening(questions);
        expect(bands).toMatchObject({ questions, pairRules: null });
        expect(bands.volatileFloor).toBe(pool !== "endless-instagram");
        // The opening's questions are friendly; the next is the schedule's first hard row.
        for (let q = 1; q <= open; q++) {
          expect(bandForRound(q, "endless", bands).floor).toBe(0.45);
          expect(bandForRound(q, "endless", bands).ceiling).toBeNull();
        }
        expect(bandForRound(open + 1, "endless", bands)).toEqual(rows[0]!.band);
        // The last question is the schedule's last row.
        expect(bandForRound(questions, "endless", bands)).toEqual(rows.at(-1)!.band);
      }
    }
    expect([10, 13, 14, 15, 20].map(streamOpening)).toEqual([2, 2, 2, 3, 3]);
  });

  it("never get easier after the opening", () => {
    for (const rows of [STREAM_SCHEDULE, STREAM_SQUAD_SCHEDULE, STREAM_INSTAGRAM_SCHEDULE]) {
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]!.band.floor).toBeLessThanOrEqual(rows[i - 1]!.band.floor);
        expect(rows[i]!.band.ceiling!).toBeLessThanOrEqual(rows[i - 1]!.band.ceiling!);
      }
    }
  });

  it("deal All legends from the whole deck, under the match's seed", () => {
    const seed = `${streamSeedDomain("endless")}20260917-a`;
    for (const questions of STREAM_LENGTHS) {
      const match = buildStreamRun({
        deck: fixtureDeck,
        seed,
        now: NOW,
        pool: "endless",
        questions,
      });
      expect(match.length).toBeLessThanOrEqual(questions);
      expect(match.length).toBeGreaterThan(0);
    }
  });

  it("Instagram deals only players with a figure, on followers every question", () => {
    for (let i = 0; i < 20; i++) {
      const match = buildStreamRun({
        deck: fixtureDeck,
        seed: `stream:endless-instagram:${i}`,
        now: NOW,
        pool: "endless-instagram",
        questions: 20,
      });
      expect(match.length).toBeGreaterThan(0);
      for (const r of match) {
        expect(r.stat).toBe("ig");
        expect(r.anchor.stats.ig).toBeDefined();
        expect(r.challenger.stats.ig).toBeDefined();
      }
    }
  });

  it("a squad deals only its theme's players, and never one twice", () => {
    const theme = themeById(THEMED, "club-northfield")!;
    for (const questions of [10, 20]) {
      for (let i = 0; i < 25; i++) {
        const match = buildStreamRun({
          deck: THEMED,
          seed: `stream:${NORTHFIELD}:${i}`,
          now: NOW,
          pool: NORTHFIELD,
          questions,
        });
        expect(match).toHaveLength(questions);
        const ids = dealt(match);
        expect(new Set(ids).size).toBe(ids.length);
        for (const r of match) {
          expect(inTheme(r.anchor, theme)).toBe(true);
          expect(inTheme(r.challenger, theme)).toBe(true);
        }
      }
    }
  });

  it("a squad's length is capped by its size", () => {
    const questions = streamQuestions(SOUTHGATE, 20, THEMED)!;
    const match = buildStreamRun({
      deck: THEMED,
      seed: "stream:squad:club-southgate:1",
      now: NOW,
      pool: SOUTHGATE,
      questions,
    });
    expect(match.length).toBeLessThanOrEqual(14);
  });

  it("a squad ramps by progress through the match, not the squad", () => {
    const variant = resolveVariant(LEAGUE, THEMED)!;
    const bands = streamBands(LEAGUE, 10);
    // Question 10 of a 10-question match is the end of the schedule...
    expect(bandForRound(10, "endless", bands)).toEqual(STREAM_SQUAD_SCHEDULE.at(-1)!.band);
    // ...where on the league's own 59 questions it would still be in its first row.
    expect(bandForRound(10, "endless", variant)).toEqual(variant.schedule[0]!.band);
    const match = buildStreamRun({
      deck: THEMED,
      seed: "stream:squad:league-testland-league:1",
      now: NOW,
      pool: LEAGUE,
      questions: 10,
    });
    const plain = buildRun({
      deck: THEMED,
      seed: "stream:squad:league-testland-league:1",
      now: NOW,
      mode: "endless",
      variant: LEAGUE,
      maxRounds: 10,
    });
    expect(fingerprint(match)).not.toBe(fingerprint(plain));
  });

  it("changes nothing for a run without `bands`", () => {
    const a = buildRun({
      deck: THEMED,
      seed: "squad:7",
      now: NOW,
      mode: "endless",
      variant: NORTHFIELD,
    });
    // A match's override on the same theme first, so a memo keyed on the theme alone would show.
    buildStreamRun({ deck: THEMED, seed: "squad:7", now: NOW, pool: NORTHFIELD, questions: 10 });
    const b = buildRun({
      deck: THEMED,
      seed: "squad:7",
      now: NOW,
      mode: "endless",
      variant: NORTHFIELD,
    });
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it("refuses bands without a match's questions", () => {
    const { schedule, pairRules, volatileFloor } = streamBands("endless", 10);
    const bands = { schedule, pairRules, volatileFloor };
    expect(() =>
      buildRun({
        deck: fixtureDeck,
        seed: "x",
        now: NOW,
        mode: "endless",
        variant: "endless",
        bands,
      }),
    ).toThrow();
  });

  it("is a pure function of the seed, the pool and the length", () => {
    const opts = {
      deck: THEMED,
      seed: "stream:squad:club-northfield:x",
      now: NOW,
      pool: NORTHFIELD,
      questions: 20,
    };
    expect(fingerprint(buildStreamRun(opts))).toBe(fingerprint(buildStreamRun(opts)));
  });
});

describe("stream goldens", () => {
  // Golden values: if one changes, the match dealer changed. Update deliberately.
  it("All legends, 20 questions", () => {
    const match = buildStreamRun({
      deck: fixtureDeck,
      seed: "stream:endless:1",
      now: NOW,
      pool: "endless",
      questions: 20,
    });
    expect(fingerprint(match)).toMatchInlineSnapshot(
      `"1:club_goals:hotel>juliet|2:club_goals:juliet>bravo|3:clubs:bravo>echo|4:clubs:echo>charlie|5:clubs:charlie>delta|6:clubs:delta>alpha|7:clubs:alpha>golf|8:fee:golf>india|9:fee:india>foxtrot|10:fee:foxtrot>lima|11:fee:lima>kilo|12:fee:kilo>alpha|13:club_goals:alpha>kilo|14:club_goals:kilo>alpha|15:caps:alpha>lima|16:caps:lima>alpha|17:caps:alpha>kilo|18:caps:kilo>delta|19:caps:delta>kilo|20:it:kilo>alpha"`,
    );
  });

  it("Instagram, 10 questions", () => {
    const match = buildStreamRun({
      deck: fixtureDeck,
      seed: "stream:endless-instagram:1",
      now: NOW,
      pool: "endless-instagram",
      questions: 10,
    });
    expect(fingerprint(match)).toMatchInlineSnapshot(
      `"1:ig:bravo>india|2:ig:india>alpha|3:ig:alpha>hotel|4:ig:hotel>kilo|5:ig:kilo>echo|6:ig:echo>delta|7:ig:delta>lima|8:ig:lima>charlie|9:ig:charlie>juliet|10:ig:juliet>foxtrot"`,
    );
  });

  it("a club, 20 questions", () => {
    const match = buildStreamRun({
      deck: THEMED,
      seed: "stream:squad:club-northfield:1",
      now: NOW,
      pool: NORTHFIELD,
      questions: 20,
    });
    expect(fingerprint(match)).toMatchInlineSnapshot(
      `"1:ig:p5>p14|2:ig:p14>p20|3:caps:p20>p0|4:caps:p0>p1|5:caps:p1>p2|6:caps:p2>p17|7:caps:p17>p13|8:club_goals:p13>p6|9:club_goals:p6>p3|10:apps:p3>p21|11:caps:p21>p8|12:caps:p8>p15|13:caps:p15>p16|14:caps:p16>p10|15:club_goals:p10>p19|16:caps:p19>p9|17:caps:p9>p7|18:caps:p7>p11|19:caps:p11>p4|20:caps:p4>p12"`,
    );
  });

  it("a league, 10 questions", () => {
    const match = buildStreamRun({
      deck: THEMED,
      seed: "stream:squad:league-testland-league:1",
      now: NOW,
      pool: LEAGUE,
      questions: 10,
    });
    expect(fingerprint(match)).toMatchInlineSnapshot(
      `"1:apps:p0>p20|2:apps:p20>p30|3:age:p30>p29|4:club_goals:p29>p51|5:club_goals:p51>p5|6:apps:p5>p54|7:apps:p54>p15|8:caps:p15>p41|9:caps:p41>p21|10:caps:p21>p8"`,
    );
  });
});
