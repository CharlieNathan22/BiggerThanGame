import { describe, expect, it } from "vitest";
import { WIN_ROUNDS } from "../sequence.js";
import { STREAK_TITLES, challengeOutcome, streakTitle } from "../titles.js";
import type { Mode } from "../types.js";

describe("streak titles, Endless and Ranked", () => {
  it.each([
    [0, undefined],
    [4, undefined],
    [5, "squad"],
    [9, "squad"],
    [10, "starter"],
    [19, "starter"],
    [20, "captain"],
    [29, "captain"],
    [30, "legend"],
    [44, "legend"],
    [45, "goat"],
    [60, "goat"],
  ])("gives a streak of %d the title %s", (streak, id) => {
    expect(streakTitle(streak, "endless")?.id).toBe(id);
    expect(streakTitle(streak, "ranked")?.id).toBe(id);
  });
});

describe("streak titles, Friendly", () => {
  it.each([
    [0, undefined],
    [4, undefined],
    [5, "squad"],
    [9, "squad"],
    [10, "starter"],
    [14, "starter"],
    [15, "captain"],
    [19, "captain"],
    [20, "legend"],
  ])("gives a streak of %d the title %s", (streak, id) => {
    expect(streakTitle(streak, "friendly")?.id).toBe(id);
  });

  it("saves Legend for the win", () => {
    expect(STREAK_TITLES.friendly.at(-1)).toEqual({ id: "legend", min: WIN_ROUNDS.friendly });
  });
});

describe("streak title tables", () => {
  it.each(Object.keys(STREAK_TITLES) as Mode[])(
    "lists %s's titles in ascending order, each once",
    (mode) => {
      const titles = STREAK_TITLES[mode];
      const mins = titles.map((t) => t.min);
      expect([...mins].sort((a, b) => a - b)).toEqual(mins);
      expect(new Set(mins).size).toBe(mins.length);
      expect(new Set(titles.map((t) => t.id)).size).toBe(titles.length);
    },
  );
});

describe("challenge outcome", () => {
  it("beats, matches or falls short", () => {
    expect(challengeOutcome(13, 12)).toBe("beat");
    expect(challengeOutcome(12, 12)).toBe("matched");
    expect(challengeOutcome(3, 12)).toBe("short");
    expect(challengeOutcome(0, 0)).toBe("matched");
  });
});
