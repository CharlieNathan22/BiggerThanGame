/**
 * "Clear the squad" (DESIGN.md §3): themes from the deck, a run that deals each
 * of a theme's players once, bands that ramp by progress through the squad,
 * and the run's own goldens.
 */

import { describe, expect, it } from "vitest";
import { NOW, fixtureDeck } from "../__fixtures__/deck.js";
import { themedDeck } from "../__fixtures__/themed-deck.js";
import {
  SQUAD_LARGE,
  SQUAD_PAIR_RULES,
  SQUAD_SMALL,
  SQUAD_TINY,
  bandFor,
  bandForRound,
  relaxations,
  squadSchedule,
} from "../ramp.js";
import { buildRun } from "../sequence.js";
import { valueOf } from "../engine.js";
import { STATS, STAT_KEYS } from "../stats.js";
import {
  THEME_MIN_PLAYERS,
  eraTheme,
  inTheme,
  squadThemes,
  themeById,
  themePath,
  themeSlug,
} from "../themes.js";
import {
  ENDLESS_VARIANTS,
  SQUAD_LABELS,
  formatOf,
  hasBoards,
  hasWheel,
  isEndlessVariantId,
  isNamedVariant,
  isSquadCareerStat,
  isSquadVariantId,
  resolveVariant,
  seedDomainOf,
  squadNote,
  squadVariantId,
  statLabel,
} from "../variants.js";
import type { Band, Player, Round, StatKey } from "../types.js";
import type { BandRow } from "../ramp.js";

const DECK = themedDeck();
const NORTHFIELD = "squad:club-northfield" as const;
const SOUTHGATE = "squad:club-southgate" as const;
const LEAGUE = "squad:league-testland-league" as const;

function squadRun(seed: string, variant: `squad:${string}` = NORTHFIELD): Round[] {
  return buildRun({ deck: DECK, seed, mode: "endless", now: NOW, variant });
}

function fingerprint(rounds: readonly Round[]): string {
  return rounds.map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`).join("|");
}

/** Everyone a run deals: the opening anchor, then each challenger. */
function dealt(rounds: readonly Round[]): string[] {
  return rounds.length === 0 ? [] : [rounds[0]!.anchor.id, ...rounds.map((r) => r.challenger.id)];
}

describe("themes from the deck", () => {
  it("lists only themes with at least THEME_MIN_PLAYERS, clubs then leagues then eras", () => {
    expect(THEME_MIN_PLAYERS).toBe(10);
    expect(squadThemes(DECK).map((t) => `${t.id}:${t.players}`)).toEqual([
      "club-northfield:22",
      "club-southgate:15",
      "league-testland-league:60",
      "league-otherland-league:14",
      "era-2000s:30",
      "era-1990s:18",
      "era-classic-era:12",
    ]);
  });

  it("puts the 1980s and every decade before in one Classic Era, and each later decade in its own", () => {
    for (const era of ["1980s", "1970s", "1960s", "1950s"])
      expect(eraTheme(era)).toBe("Classic Era");
    for (const era of ["1990s", "2000s", "2010s"]) expect(eraTheme(era)).toBe(era);
    const classic = themeById(DECK, "era-classic-era")!;
    expect(classic).toMatchObject({ type: "era", name: "Classic Era", slug: "classic-era" });
    expect(themePath(classic)).toBe("/football-higher-or-lower/legends/eras/classic-era");
    expect(DECK.filter((p) => inTheme(p, classic)).map((p) => p.era)).toEqual(
      expect.arrayContaining(["1980s", "1970s"]),
    );
    expect(themeById(DECK, "era-1980s")).toBeUndefined();
  });

  it("counts a player in every club they're listed at, loans included, once each", () => {
    const loaned = DECK.filter((p) => p.mainClubs?.length === 2);
    expect(loaned).toHaveLength(4);
    const doubled: Player = { ...DECK[0]!, mainClubs: ["Northfield", "Northfield"] };
    const deck = [doubled, ...DECK.slice(1)];
    expect(themeById(deck, "club-northfield")?.players).toBe(22);
  });

  it("matches what the deck says, theme by theme", () => {
    for (const theme of squadThemes(DECK)) {
      expect(DECK.filter((p) => inTheme(p, theme))).toHaveLength(theme.players);
    }
  });

  it("gives stable, readable slugs and paths", () => {
    expect(themeSlug("Real Madrid")).toBe("real-madrid");
    expect(themeSlug("AC Milan")).toBe("ac-milan");
    expect(themeSlug("Premier League")).toBe("premier-league");
    expect(themeSlug("Ligue 1")).toBe("ligue-1");
    expect(themeSlug("2000s")).toBe("2000s");
    expect(themeSlug("Atlético Madrid")).toBe("atletico-madrid");
    expect(themeSlug("Paris Saint-Germain")).toBe("paris-saint-germain");
    expect(themePath({ type: "club", slug: "real-madrid" })).toBe(
      "/football-higher-or-lower/legends/clubs/real-madrid",
    );
    expect(themePath({ type: "league", slug: "la-liga" })).toBe(
      "/football-higher-or-lower/legends/leagues/la-liga",
    );
    expect(themePath({ type: "era", slug: "2000s" })).toBe(
      "/football-higher-or-lower/legends/eras/2000s",
    );
  });

  it("has none in the fixture deck, which is too small", () => {
    expect(squadThemes(fixtureDeck)).toEqual([]);
  });
});

describe("the squad variant", () => {
  it("is known by its id's shape, and resolved only against a deck that has the theme", () => {
    expect(isSquadVariantId(NORTHFIELD)).toBe(true);
    expect(isEndlessVariantId(NORTHFIELD)).toBe(true);
    expect(isNamedVariant(NORTHFIELD)).toBe(true);
    for (const bad of ["squad:", "squad:Club", "squad:a--b", "squad:-a", "squad:a b", "squad"]) {
      expect(isSquadVariantId(bad)).toBe(false);
    }
    expect(isSquadVariantId(`squad:${"a".repeat(80)}`)).toBe(false);
    expect(resolveVariant("squad:club-eastholm", DECK)).toBeUndefined();
    expect(resolveVariant(NORTHFIELD, fixtureDeck)).toBeUndefined();
    expect(resolveVariant("endless", DECK)).toBe(ENDLESS_VARIANTS.endless);
  });

  it("deals the whole squad, every stat, with no boards and its own seed domain", () => {
    const squad = resolveVariant(NORTHFIELD, DECK)!;
    expect(squad).toMatchObject({
      id: NORTHFIELD,
      stat: null,
      format: "squad",
      boards: false,
      volatileFloor: true,
      iconicRounds: 3,
      questions: 21,
      seedDomain: "squad:club-northfield:",
    });
    expect(squad.pairRules).toBe(SQUAD_PAIR_RULES);
    expect(resolveVariant(NORTHFIELD, DECK)).toBe(squad);
    expect(formatOf(NORTHFIELD)).toBe("squad");
    expect(hasWheel(NORTHFIELD)).toBe(true);
    expect(hasBoards(NORTHFIELD)).toBe(false);
    expect(hasBoards("endless")).toBe(true);
    expect(hasBoards("endless-instagram")).toBe(false);
  });

  it("separates every theme's seeds from each other and from the other variants'", () => {
    const domains = [
      ...squadThemes(DECK).map((t) => seedDomainOf(squadVariantId(t))),
      seedDomainOf("endless"),
      seedDomainOf("endless-instagram"),
    ];
    expect(new Set(domains).size).toBe(domains.length);
    expect(fingerprint(squadRun("same", NORTHFIELD))).not.toBe(
      fingerprint(squadRun("same", SOUTHGATE)),
    );
  });
});

describe("a squad run", () => {
  it("never deals a player twice, and only the theme's players, over many seeds", () => {
    for (const variant of [NORTHFIELD, SOUTHGATE, LEAGUE, "squad:era-1990s"] as const) {
      const squad = resolveVariant(variant, DECK)!;
      for (let i = 0; i < 125; i++) {
        const rounds = squadRun(`unique:${i}`, variant);
        const ids = dealt(rounds);
        expect(new Set(ids).size).toBe(ids.length);
        expect(rounds.length).toBeLessThanOrEqual(squad.questions!);
        for (const round of rounds) {
          expect(squad.pool!(round.anchor)).toBe(true);
          expect(squad.pool!(round.challenger)).toBe(true);
        }
      }
    }
  });

  it("deals every player when it can: squad size − 1 questions", () => {
    for (let i = 0; i < 50; i++) {
      const rounds = squadRun(`full:${i}`, SOUTHGATE);
      expect(rounds).toHaveLength(14);
      expect(rounds.at(-1)!.index).toBe(14);
    }
  });

  it("ends early, as cleared, when the players left can't be dealt under any stat", () => {
    // A 23rd Northfield player who can't be asked anything: no figures, and no age.
    const ghost: Player = {
      id: "ghost",
      name: "Ghost",
      country: "Testland",
      position: "DF",
      dob: "1950-01-01",
      deceased: true,
      mainClubs: ["Northfield"],
      stats: {},
    };
    const deck = [...DECK, ghost];
    const squad = resolveVariant(NORTHFIELD, deck)!;
    expect(squad.questions).toBe(22);
    for (let i = 0; i < 30; i++) {
      const rounds = buildRun({
        deck,
        seed: `ghost:${i}`,
        mode: "endless",
        now: NOW,
        variant: NORTHFIELD,
      });
      expect(rounds).toHaveLength(21);
      expect(dealt(rounds)).not.toContain("ghost");
    }
  });

  it("prefers iconic challengers for its first three questions", () => {
    let iconic = 0;
    let total = 0;
    for (let i = 0; i < 100; i++) {
      for (const round of squadRun(`iconic:${i}`).slice(0, 3)) {
        total += 1;
        if (round.challenger.iconic === true) iconic += 1;
      }
    }
    expect(iconic / total).toBeGreaterThan(0.6);
  });

  it("is a pure function of seed and theme", () => {
    expect(fingerprint(squadRun("again"))).toBe(fingerprint(squadRun("again")));
  });

  it("refuses a theme the deck doesn't have, and a variant outside Endless", () => {
    expect(() =>
      buildRun({
        deck: DECK,
        seed: "x",
        mode: "endless",
        now: NOW,
        variant: "squad:club-eastholm",
      }),
    ).toThrow(/no theme/);
    expect(() =>
      buildRun({ deck: DECK, seed: "x", mode: "friendly", now: NOW, variant: NORTHFIELD }),
    ).toThrow(/outside Endless/);
  });
});

describe("squad difficulty", () => {
  const ceiling = (band: Band) => band.ceiling ?? 1;

  it("never gets easier as progress rises, for every squad size", () => {
    for (const rows of [SQUAD_TINY, SQUAD_SMALL, SQUAD_LARGE]) {
      expect(rows.map((r) => r.upTo)).toEqual(SQUAD_SMALL.map((r) => r.upTo));
    }
    for (let size = 10; size <= 80; size++) {
      const schedule = squadSchedule(size);
      for (let i = 1; i < schedule.length; i++) {
        expect(schedule[i]!.band.floor).toBeLessThanOrEqual(schedule[i - 1]!.band.floor);
        expect(ceiling(schedule[i]!.band)).toBeLessThanOrEqual(ceiling(schedule[i - 1]!.band));
      }
    }
  });

  it("is never easier for a smaller squad at the same point in it", () => {
    for (let size = 10; size < 80; size++) {
      const smaller = squadSchedule(size);
      const bigger = squadSchedule(size + 1);
      for (let i = 0; i < smaller.length; i++) {
        expect(smaller[i]!.band.floor).toBeLessThanOrEqual(bigger[i]!.band.floor + 1e-12);
        expect(ceiling(smaller[i]!.band)).toBeLessThanOrEqual(ceiling(bigger[i]!.band) + 1e-12);
      }
    }
    // Each endpoint at its own size, and clamped beyond the ends.
    const near = (got: readonly BandRow[], want: readonly BandRow[]) =>
      got.forEach((row, i) => {
        expect(row.band.floor).toBeCloseTo(want[i]!.band.floor, 12);
        expect(ceiling(row.band)).toBeCloseTo(ceiling(want[i]!.band), 12);
      });
    near(squadSchedule(10), SQUAD_TINY);
    near(squadSchedule(8), SQUAD_TINY);
    near(squadSchedule(15), SQUAD_SMALL);
    near(squadSchedule(69), SQUAD_LARGE);
    near(squadSchedule(90), SQUAD_LARGE);
  });

  it("ramps by progress, not round: a round's band depends on its share of the squad", () => {
    const north = resolveVariant(NORTHFIELD, DECK)!; // 21 questions
    const league = resolveVariant(LEAGUE, DECK)!; // 59 questions
    // Round 10 is past halfway through Northfield, under a fifth of the league.
    expect(bandForRound(10, "endless", north)).toBe(north.schedule[2]!.band);
    expect(bandForRound(10, "endless", league)).toBe(league.schedule[0]!.band);
    // The last question is in the last row, either way.
    expect(bandForRound(21, "endless", north)).toBe(north.schedule.at(-1)!.band);
    expect(bandForRound(59, "endless", league)).toBe(league.schedule.at(-1)!.band);
  });

  it("never gets easier from one round to the next on any stat, the late ratio floor included", () => {
    for (const variant of [NORTHFIELD, LEAGUE]) {
      const squad = resolveVariant(variant, DECK)!;
      for (const stat of STAT_KEYS) {
        let previous = bandFor(stat, 1, "endless", squad);
        for (let round = 2; round <= squad.questions!; round++) {
          const band = bandFor(stat, round, "endless", squad);
          expect(band.floor).toBeLessThanOrEqual(previous.floor);
          expect(ceiling(band)).toBeLessThanOrEqual(ceiling(previous));
          expect(band.strictMinRatio ?? 0).toBeGreaterThanOrEqual(previous.strictMinRatio ?? 0);
          expect(band.valueRule).toBeUndefined();
          previous = band;
        }
      }
    }
  });
});

describe("followers in a squad", () => {
  it("keep Endless's 2× floor, which gives way only at the ladder's last step", () => {
    const squad = resolveVariant(NORTHFIELD, DECK)!;
    for (let round = 1; round <= squad.questions!; round++) {
      const steps = relaxations(bandFor("ig", round, "endless", squad), "fine");
      expect(steps.slice(0, -1).every((step) => step.minRatio === 1)).toBe(true);
      expect(steps.at(-1)!.minRatio).toBeUndefined();
    }
  });

  it("try every other stat before the floor gives way", () => {
    // Fifteen at a club whose follower counts all sit within 2× of each other, and whose caps
    // all differ: a run must ask caps (or switch away) rather than pair two close counts.
    const tight: Player[] = Array.from({ length: 15 }, (_, i) => ({
      id: `t${i}`,
      name: `Tight ${i}`,
      country: "Testland",
      position: "MF",
      dob: "1950-01-01",
      deceased: true,
      iconic: i < 5,
      mainClubs: ["Tightfield"],
      stats: { caps: Math.round(20 * 1.2 ** i), ig: { value: 10 + i * 0.5, asOf: "2026-09-01" } },
    }));
    const deck = [...tight, ...DECK];
    let ig = 0;
    for (let i = 0; i < 200; i++) {
      const rounds = buildRun({
        deck,
        seed: `tight:${i}`,
        mode: "endless",
        now: NOW,
        variant: "squad:club-tightfield",
      });
      expect(rounds).toHaveLength(14);
      for (const round of rounds) {
        if (round.stat === "ig") ig += 1;
        expect(round.stat).toBe("caps");
      }
    }
    expect(ig).toBe(0);
  });

  it("never deal a tie, in any squad, at any step", () => {
    for (const variant of [NORTHFIELD, SOUTHGATE, LEAGUE, "squad:era-1990s"] as const) {
      for (let i = 0; i < 150; i++) {
        for (const round of squadRun(`tie:${i}`, variant)) {
          const a = valueOf(round.anchor, round.stat, NOW);
          const b = valueOf(round.challenger, round.stat, NOW);
          expect(a).not.toBe(b);
        }
      }
    }
  });
});

describe("the career stats' labels", () => {
  /** The stats a squad could read as its own club's, league's or era's, and their squad labels. */
  const CAREER: Partial<Record<StatKey, string>> = {
    club_goals: "Total career club goals",
    apps: "All club appearances",
    ct: "Career club trophies",
    fee: "Career-high transfer fee",
  };

  it("are exactly club goals, club appearances, club trophies and the highest fee", () => {
    expect(SQUAD_LABELS).toEqual(CAREER);
    for (const key of STAT_KEYS) expect(isSquadCareerStat(key), key).toBe(key in CAREER);
  });

  it.each(STAT_KEYS)("%s: reads as the whole career in squad modes only", (key) => {
    const squad = CAREER[key] ?? STATS[key].label;
    expect(statLabel(key, NORTHFIELD)).toBe(squad);
    expect(statLabel(key, LEAGUE)).toBe(squad);
    expect(statLabel(key, "squad:era-2000s")).toBe(squad);
    expect(statLabel(key)).toBe(STATS[key].label);
    expect(statLabel(key, "endless")).toBe(STATS[key].label);
    expect(statLabel(key, "endless-instagram")).toBe(STATS[key].label);
  });

  it.each(STAT_KEYS)("%s: has a note saying what it counts if it is a career stat", (key) => {
    const career = key in CAREER;
    const note = (theme: Parameters<typeof squadNote>[1]) => squadNote(key, theme);
    expect(note({ type: "club", name: "Barcelona" })).toBe(
      career ? "Whole career, not just Barcelona" : undefined,
    );
    expect(note({ type: "league", name: "La Liga" })).toBe(
      career ? "Whole career, every league" : undefined,
    );
    expect(note({ type: "era", name: "2000s" })).toBe(
      career ? "Whole career, not just the 2000s" : undefined,
    );
    expect(note(undefined)).toBeUndefined();
  });
});

describe("squad goldens", () => {
  // Golden values: if one changes, the squad dealer changed. Update deliberately.
  it("Northfield", () => {
    expect(fingerprint(squadRun("squad:1"))).toMatchInlineSnapshot(
      `"1:ig:p5>p4|2:ig:p4>p10|3:club_goals:p10>p15|4:club_goals:p15>p19|5:club_goals:p19>p17|6:club_goals:p17>p7|7:club_goals:p7>p2|8:it:p2>p12|9:it:p12>p8|10:caps:p8>p20|11:caps:p20>p21|12:age:p21>p16|13:age:p16>p11|14:age:p11>p6|15:apps:p6>p14|16:ct:p14>p3|17:caps:p3>p18|18:caps:p18>p9|19:caps:p9>p13|20:caps:p13>p1|21:clubs:p1>p0"`,
    );
  });

  it("the Testland League, first 25 questions", () => {
    expect(fingerprint(squadRun("squad:2", LEAGUE).slice(0, 25))).toMatchInlineSnapshot(
      `"1:caps:p35>p10|2:caps:p10>p0|3:age:p0>p55|4:age:p55>p2|5:age:p2>p24|6:apps:p24>p48|7:apps:p48>p51|8:club_goals:p51>p57|9:club_goals:p57>p19|10:apps:p19>p46|11:apps:p46>p30|12:apps:p30>p22|13:apps:p22>p32|14:apps:p32>p47|15:ct:p47>p16|16:ct:p16>p18|17:ct:p18>p3|18:ct:p3>p34|19:ct:p34>p56|20:caps:p56>p53|21:caps:p53>p41|22:caps:p41>p11|23:caps:p11>p26|24:clubs:p26>p50|25:clubs:p50>p6"`,
    );
  });
});
