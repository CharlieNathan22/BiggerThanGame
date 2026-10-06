import { describe, expect, it } from "vitest";
import {
  ANSWER_TIMINGS,
  NETWORK_GRACE_MS,
  QUESTION_LIMITS,
  answerAllowance,
  deadlineFor,
  questionLimit,
} from "../clock.js";
import { CHALLENGES } from "../modes.js";

describe("question limits", () => {
  it("give Endless and Ranked 15 seconds for question 1 and 10 after; Friendly none", () => {
    expect(QUESTION_LIMITS).toEqual({
      friendly: null,
      endless: { first: 15_000, rest: 10_000 },
      ranked: { first: 15_000, rest: 10_000 },
    });
    expect(questionLimit("endless", 1)).toBe(15_000);
    expect(questionLimit("endless", 2)).toBe(10_000);
    expect(questionLimit("endless", 90)).toBe(10_000);
    expect(questionLimit("friendly", 1)).toBeNull();
  });

  it("allow 3 seconds for the network", () => {
    expect(NETWORK_GRACE_MS).toBe(3000);
  });
});

describe("the animation allowance", () => {
  const t = ANSWER_TIMINGS;

  it("covers round one's title card, longest photo hold, the cards coming in and the spin", () => {
    expect(answerAllowance(1, false)).toBe(
      t.title + t.holdMin + t.holdExtra + t.introMin + t.beat + t.spin + t.land,
    );
    // Round one always spins, whatever statChanged says.
    expect(answerAllowance(1, true)).toBe(answerAllowance(1, false));
  });

  it("covers a later round's reveal, the gap to the next deal, and the spin on a stat change", () => {
    expect(answerAllowance(5, true)).toBe(t.verdict + t.next + t.beat + t.spin + t.land);
    expect(answerAllowance(5, false)).toBe(t.verdict + t.next + t.hold);
    expect(answerAllowance(5, true) - answerAllowance(5, false)).toBe(
      t.beat + t.spin + t.land - t.hold,
    );
  });
});

describe("deadlineFor", () => {
  const issued = 1_000_000;

  it("is the allowance, question 1's 15 seconds and the grace after issue", () => {
    expect(deadlineFor(issued, 1, false, "endless")).toBe(issued + 9340 + 15_000 + 3000);
  });

  it("gives a later round 10 seconds, plus the wheel's time when the stat changes", () => {
    expect(deadlineFor(issued, 2, false, "endless")).toBe(issued + 4280 + 10_000 + 3000);
    expect(deadlineFor(issued, 2, true, "endless")).toBe(issued + 6480 + 10_000 + 3000);
  });

  it("is null in Friendly, which has no clock", () => {
    expect(deadlineFor(issued, 1, false, "friendly")).toBeNull();
  });

  it("has no spin allowance in a variant without the wheel (Instagram Endless)", () => {
    const t = ANSWER_TIMINGS;
    // Round one: the title card, holds and cards, then the short hold, not the spin.
    expect(answerAllowance(1, false, false)).toBe(
      t.title + t.holdMin + t.holdExtra + t.introMin + t.hold,
    );
    expect(deadlineFor(issued, 1, false, "endless", false)).toBe(issued + 7140 + 15_000 + 3000);
    // After question 1 it never includes the spin, whatever statChanged says.
    for (const round of [2, 3, 10, 40, 150]) {
      for (const changed of [false, true]) {
        expect(answerAllowance(round, changed, false)).toBe(t.verdict + t.next + t.hold);
        expect(deadlineFor(issued, round, changed, "endless", false)).toBe(
          issued + 4280 + 10_000 + 3000,
        );
      }
    }
  });
});

describe("mode switches", () => {
  it("offer challenge links in Endless only", () => {
    expect(CHALLENGES).toEqual({ friendly: false, endless: true, ranked: false });
  });
});
