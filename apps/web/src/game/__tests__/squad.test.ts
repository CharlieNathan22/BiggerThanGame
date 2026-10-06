/**
 * "Clear the squad" on the page (DESIGN.md §3): the play a theme makes — its
 * win target and the progress track — the words it scores and shares with,
 * its challenge links, its club goals label and note, and its local best.
 */

import { STAT_KEYS, squadNote, statLabel as coreLabel } from "@bt/core";
import type { Tier } from "@bt/core";
import { describe, expect, it } from "vitest";
import { statLabel, t } from "../../i18n";
import { en } from "../../i18n/en";
import { bestKey, readSquadBest, saveSquadBest } from "../best";
import type { StorageAccess } from "../best";
import { initialState } from "../machine";
import type { GameState, RoundRecord } from "../machine";
import {
  challengeHeading,
  challengeText,
  endingNames,
  gridCells,
  scoreText,
  shareCard,
  shareText,
} from "../share";
import {
  hasBoards,
  modeSubtitle,
  playId,
  playOf,
  playPath,
  spins,
  squadNoteText,
} from "../variant";
import type { Theme } from "../variant";
import {
  announcement,
  isFinalQuestion,
  overCaption,
  progressText,
  scoreFigure,
  titleChip,
  trackSteps,
} from "../view";
import { RUN_ID, link, round } from "./fixtures";

const BARCELONA: Theme = {
  id: "club-barcelona",
  type: "club",
  name: "Barcelona",
  slug: "barcelona",
  players: 35,
};
const VARIANT = "squad:club-barcelona" as const;
const PLAY = playOf("endless", BARCELONA);
const SITE = "https://biggerthangame.com";

const rec = (index: number, tier: Tier = "basic", correct = true): RoundRecord => ({
  index,
  stat: "caps",
  tier,
  correct,
});

function state(overrides: Partial<GameState>): GameState {
  return { ...initialState(0, null, "endless", VARIANT), ...overrides };
}

describe("a theme's play", () => {
  it("is Endless with the squad's questions as its win target", () => {
    expect(PLAY).toEqual({ mode: "endless", target: 34, theme: BARCELONA });
    expect(playOf("endless")).toEqual({ mode: "endless", target: null });
    expect(playOf("friendly")).toEqual({ mode: "friendly", target: 20 });
  });

  it("is named by its variant, keeps its best there, and opens its own page", () => {
    expect(playId("endless", VARIANT)).toBe(VARIANT);
    expect(bestKey("legends", playId("endless", VARIANT))).toBe(
      "bt:best:legends:squad:club-barcelona",
    );
    expect(playPath(VARIANT, BARCELONA)).toBe("/football-higher-or-lower/legends/clubs/barcelona");
    expect(() => playPath(VARIANT)).toThrow();
  });

  it("spins the wheel, has no boards, and heads the start panel with the theme's name", () => {
    expect(spins("endless", VARIANT)).toBe(true);
    expect(hasBoards("endless", VARIANT)).toBe(false);
    expect(modeSubtitle("endless", VARIANT, BARCELONA)).toBe("Barcelona");
  });
});

describe("its progress", () => {
  it('scores out of the squad, "12/34", with a track of 34 steps', () => {
    expect(scoreFigure(12, PLAY)).toBe("12/34");
    const s = state({ phase: "awaiting", round: round(12), history: [rec(1), rec(2)] });
    expect(trackSteps(s, PLAY)).toHaveLength(34);
    expect(progressText(s, PLAY)).toBe("Question 12 of 34");
    expect(titleChip({ streak: 12 }, PLAY)).toBe("");
  });

  it("marks question 34 as the final one", () => {
    expect(isFinalQuestion(state({ phase: "awaiting", round: round(34) }), PLAY)).toBe(true);
    expect(isFinalQuestion(state({ phase: "awaiting", round: round(33) }), PLAY)).toBe(false);
    expect(progressText(state({ phase: "awaiting", round: round(34) }), PLAY)).toBe(
      "Final question — question 34 of 34",
    );
  });

  it("says a cleared squad out loud, and captions a run that wasn't", () => {
    const r = round(34);
    const cleared = state({
      phase: "over",
      round: r,
      streak: 34,
      end: "won",
      reveal: { round: 34, value: 80, display: "80", correct: true },
    });
    expect(announcement(cleared, PLAY)).toContain("Correct. You've cleared the Barcelona squad!");
    expect(overCaption({ streak: 21, end: "wrong" }, PLAY)).toBe("through the squad");
    expect(overCaption({ streak: 34, end: "won" }, PLAY)).toBe("a perfect run");
    expect(overCaption({ streak: 21, end: "wrong" })).toBe("in a row");
  });
});

describe("its share", () => {
  const history = [rec(1), rec(2, "uncommon"), rec(3, "rare", false)];

  it('reads "21/34 through the Barcelona squad", or "I cleared the Barcelona squad 🏆"', () => {
    expect(scoreText(21, PLAY, "wrong")).toBe("21/34 through the Barcelona squad");
    expect(scoreText(34, PLAY, "won")).toBe("I cleared the Barcelona squad 🏆");
    const text = shareText(2, history, "wrong", "biggerthangame.com", PLAY, null, VARIANT);
    expect(text.split("\n")).toEqual([
      "Bigger Than — Football Legends",
      "2/34 through the Barcelona squad",
      "🟨🟦❌",
      "Ended on: International caps",
      "biggerthangame.com",
    ]);
    const won = shareText(34, [rec(1)], "won", "biggerthangame.com", PLAY, null, VARIANT);
    expect(won.split("\n")[1]).toBe("I cleared the Barcelona squad 🏆");
  });

  it("stops the grid at the miss rather than padding it to the squad, and names no players", () => {
    expect(gridCells(history, PLAY)).toHaveLength(3);
    expect(gridCells(history, "friendly")).toHaveLength(20);
    expect(endingNames({ round: round(3), reveal: null }, PLAY)).toBeNull();
  });

  it('challenges with "Beat 21/34" on the theme\'s own page, "Match 34/34" for a clear', () => {
    expect(challengeHeading(21, PLAY)).toBe("Beat 21/34");
    expect(challengeHeading(34, PLAY)).toBe("Match 34/34");
    const text = challengeText(link(21), SITE, PLAY, VARIANT)!;
    expect(text).toContain("Beat 21/34");
    expect(text).toContain(`${SITE}/football-higher-or-lower/legends/clubs/barcelona?challenge=`);
    expect(text).toContain(RUN_ID);
  });

  it("puts the squad's score and the squad's label on the share image", () => {
    const s = state({
      phase: "over",
      streak: 2,
      end: "wrong",
      history: [rec(1), { index: 2, stat: "club_goals", tier: "basic", correct: false }],
    });
    const image = shareCard(s, "biggerthangame.com", PLAY);
    expect(image.score).toBe("2/34");
    expect(image.ended?.stat).toBe("Total career club goals");
  });
});

describe("the club goals label", () => {
  it("matches core's, stat by stat, in a squad and out of one", () => {
    for (const key of STAT_KEYS) {
      expect(statLabel(key, VARIANT)).toBe(coreLabel(key, VARIANT));
      expect(statLabel(key)).toBe(coreLabel(key));
      expect(statLabel(key, "endless-instagram")).toBe(coreLabel(key, "endless-instagram"));
    }
    expect(statLabel("club_goals", VARIANT)).toBe("Total career club goals");
  });

  it("comes with a note under the plaque that matches core's, for club goals only", () => {
    const themes: Theme[] = [
      BARCELONA,
      { id: "league-la-liga", type: "league", name: "La Liga", slug: "la-liga", players: 69 },
      { id: "era-2000s", type: "era", name: "2000s", slug: "2000s", players: 51 },
    ];
    for (const theme of themes) {
      expect(squadNoteText("club_goals", theme)).toBe(squadNote("club_goals", theme));
      expect(squadNoteText("caps", theme)).toBe("");
    }
    expect(squadNoteText("club_goals", BARCELONA)).toBe("Whole career, not just Barcelona");
  });
});

describe("its local best", () => {
  function memory(initial: Record<string, string> = {}): {
    access: StorageAccess;
    store: Record<string, string>;
  } {
    const store = { ...initial };
    return {
      store,
      access: () => ({
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => void (store[key] = value),
      }),
    };
  }
  const KEY = "bt:best:legends:squad:club-barcelona";

  it("keeps the furthest run, and whether the squad was ever cleared", () => {
    const { access, store } = memory();
    expect(readSquadBest(access, KEY)).toEqual({ best: 0, cleared: false });
    expect(saveSquadBest(access, KEY, { best: 12, cleared: false })).toBe(true);
    expect(store[KEY]).toBe('{"best":12,"cleared":false}');
    saveSquadBest(access, KEY, { best: 9, cleared: false });
    expect(readSquadBest(access, KEY)).toEqual({ best: 12, cleared: false });
    saveSquadBest(access, KEY, { best: 34, cleared: true });
    saveSquadBest(access, KEY, { best: 3, cleared: false });
    expect(readSquadBest(access, KEY)).toEqual({ best: 34, cleared: true });
  });

  it("keeps each theme's apart", () => {
    const { access } = memory();
    saveSquadBest(access, KEY, { best: 12, cleared: false });
    expect(readSquadBest(access, "bt:best:legends:squad:club-chelsea")).toEqual({
      best: 0,
      cleared: false,
    });
  });

  it("ignores anything under the key it can't read, and carries on without storage", () => {
    for (const raw of ["12", "", "{", "null", '{"best":-1,"cleared":false}', '{"best":3}']) {
      expect(readSquadBest(memory({ [KEY]: raw }).access, KEY)).toEqual({
        best: 0,
        cleared: false,
      });
    }
    const blocked: StorageAccess = () => {
      throw new Error("SecurityError");
    };
    expect(readSquadBest(blocked, KEY)).toEqual({ best: 0, cleared: false });
    expect(saveSquadBest(blocked, KEY, { best: 5, cleared: false })).toBe(false);
    expect(saveSquadBest(() => null, KEY, { best: 5, cleared: false })).toBe(false);
  });
});

describe("a squad's words", () => {
  it('ask "Can you clear the whole squad and win?" under the theme\'s name', () => {
    expect(t("squad.count.club", { players: 35, name: "Barcelona" })).toBe(
      "35 Barcelona legends. Can you clear the whole squad and win?",
    );
    expect(t("squad.count.league", { players: 69, name: "La Liga" })).toBe(
      "69 La Liga legends. Can you clear the whole squad and win?",
    );
    expect(t("squad.count.era", { players: 29, name: "1990s" })).toBe(
      "29 legends of the 1990s. Can you clear the whole squad and win?",
    );
  });

  it("use no em dash (hyphens are fine)", () => {
    const squadKeys = Object.keys(en).filter((key) =>
      /^(squad\.|themes?\.|share\.squad|live\.squad|over\.squad|over\.caption\.squad|stat\.squad\.)/.test(
        key,
      ),
    );
    expect(squadKeys.length).toBeGreaterThan(15);
    for (const key of squadKeys) {
      expect(en[key as keyof typeof en], key).not.toContain("—");
    }
  });
});
