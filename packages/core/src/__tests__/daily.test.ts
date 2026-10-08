import { describe, expect, it } from "vitest";
import {
  DAILY_EPOCH,
  DAILY_QUESTIONS,
  DEV_DAILY_EPOCH,
  assertDailyEpoch,
  dailyContinues,
  dailyEpochMs,
  dailyScore,
  epochMs,
  gameDate,
  gameNoAt,
  gameStartsAt,
  isBonusRound,
  isGame,
  isPerfect,
  nextGameAt,
} from "../daily.js";
import { ICONIC_ROUNDS, MAX_ROUNDS, WHEEL_VIABILITY, roundCap } from "../sequence.js";
import { QUESTION_LIMITS, resumeAllowance, ANSWER_TIMINGS } from "../clock.js";

const EPOCH = Date.UTC(2026, 10, 1); // 2026-11-01

describe("game numbering", () => {
  it("is Game 1 all of launch day, UTC", () => {
    expect(gameNoAt(EPOCH, EPOCH)).toBe(1);
    expect(gameNoAt(EPOCH + 86_400_000 - 1, EPOCH)).toBe(1);
  });

  it("rolls over at 00:00 UTC exactly", () => {
    expect(gameNoAt(EPOCH + 86_400_000, EPOCH)).toBe(2);
    expect(gameNoAt(EPOCH + 11 * 86_400_000 + 1, EPOCH)).toBe(12);
    expect(gameNoAt(EPOCH + 12 * 86_400_000 - 1, EPOCH)).toBe(12);
  });

  it("is below 1 before launch day", () => {
    expect(gameNoAt(EPOCH - 1, EPOCH)).toBe(0);
    expect(gameNoAt(EPOCH - 86_400_001, EPOCH)).toBe(-1);
    expect(isGame(0)).toBe(false);
    expect(isGame(1)).toBe(true);
  });

  it("starts each game at its own midnight, the date its ages are computed from", () => {
    expect(gameStartsAt(12, EPOCH)).toBe(Date.UTC(2026, 10, 12));
    expect(gameDate(1, EPOCH).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("counts down to the next game, and to Game 1 before launch", () => {
    expect(nextGameAt(EPOCH + 5000, EPOCH)).toBe(EPOCH + 86_400_000);
    expect(nextGameAt(EPOCH - 3 * 86_400_000, EPOCH)).toBe(EPOCH);
  });

  it("parses the epoch strictly", () => {
    expect(epochMs("2026-11-01")).toBe(EPOCH);
    expect(() => epochMs("2026-02-30")).toThrow();
    expect(() => epochMs("1 Nov 2026")).toThrow();
  });

  it("runs on the dev epoch while DAILY_EPOCH is unset, and refuses a production build", () => {
    expect(dailyEpochMs(null)).toBe(epochMs(DEV_DAILY_EPOCH));
    expect(() => assertDailyEpoch(null)).toThrow(/DAILY_EPOCH/);
    expect(() => assertDailyEpoch("2026-13-01")).toThrow();
    expect(() => assertDailyEpoch("2026-11-01")).not.toThrow();
    if (DAILY_EPOCH === null) expect(() => assertDailyEpoch()).toThrow();
  });
});

describe("the rules", () => {
  it("carries on through mistakes to question 20", () => {
    for (let round = 1; round < DAILY_QUESTIONS; round++) {
      expect(dailyContinues(round, 0, false)).toBe(true);
      expect(dailyContinues(round, round, true)).toBe(true);
    }
  });

  it("goes into the bonus only after twenty out of twenty", () => {
    expect(dailyContinues(20, 20, true)).toBe(true);
    expect(dailyContinues(20, 19, true)).toBe(false);
    expect(dailyContinues(20, 19, false)).toBe(false);
  });

  it("ends the bonus on the first miss", () => {
    expect(dailyContinues(21, 20, true)).toBe(true);
    expect(dailyContinues(21, 20, false)).toBe(false);
    expect(dailyContinues(37, 20, false)).toBe(false);
  });

  it("scores right answers plus the bonus streak", () => {
    expect(dailyScore(14, 0)).toBe(14);
    expect(dailyScore(20, 5)).toBe(25);
    expect(isPerfect(20)).toBe(true);
    expect(isPerfect(19)).toBe(false);
    expect(isBonusRound(20)).toBe(false);
    expect(isBonusRound(21)).toBe(true);
  });

  it("plays Endless's clock, wheel and cap, with three iconic rounds", () => {
    expect(QUESTION_LIMITS.ranked).toEqual(QUESTION_LIMITS.endless);
    expect(WHEEL_VIABILITY.ranked).toBe("any");
    expect(MAX_ROUNDS.ranked).toBe(roundCap("endless"));
    expect(ICONIC_ROUNDS.ranked).toBe(3);
  });

  it("allows a resumed question its hold, intro and spin, never the title card", () => {
    const t = ANSWER_TIMINGS;
    expect(resumeAllowance(false)).toBe(t.holdMin + t.holdExtra + t.introMin + t.hold);
    expect(resumeAllowance(true)).toBe(
      t.holdMin + t.holdExtra + t.introMin + t.beat + t.spin + t.land,
    );
  });
});
