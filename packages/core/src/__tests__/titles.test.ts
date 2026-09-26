import { describe, expect, it } from "vitest";
import { STREAK_TITLES, challengeOutcome, streakTitle } from "../titles.js";

describe("streak titles", () => {
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
    expect(streakTitle(streak)?.id).toBe(id);
  });

  it("lists the titles in ascending order, each once", () => {
    const mins = STREAK_TITLES.map((t) => t.min);
    expect([...mins].sort((a, b) => a - b)).toEqual(mins);
    expect(new Set(mins).size).toBe(mins.length);
    expect(new Set(STREAK_TITLES.map((t) => t.id)).size).toBe(STREAK_TITLES.length);
  });
});

describe("challenge outcome", () => {
  it("beats, matches or falls short", () => {
    expect(challengeOutcome(13, 12)).toBe("beat");
    expect(challengeOutcome(12, 12)).toBe("matched");
    expect(challengeOutcome(3, 12)).toBe("short");
    expect(challengeOutcome(0, 0)).toBe("matched");
  });
});
