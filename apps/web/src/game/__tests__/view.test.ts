import { STAT_KEYS } from "@bt/core";
import type { StatKey } from "@bt/core";
import { describe, expect, it } from "vitest";
import { initialState, reduce } from "../machine";
import type { GameEvent, GameState } from "../machine";
import {
  announcement,
  hitchText,
  initial,
  overCaption,
  qualifierText,
  reelStrip,
  reportHref,
} from "../view";
import { cont, round, wrong } from "./fixtures";

describe("initial", () => {
  it("takes the first character of the name", () => {
    expect(initial("Zinedine Zidane")).toBe("Z");
    expect(initial("  Éder")).toBe("É");
    expect(initial("")).toBe("");
  });
});

describe("qualifierText", () => {
  it("shows the fee's year as it is", () => {
    expect(qualifierText("fee", "2001")).toBe("2001");
  });

  it("dates the follower snapshot", () => {
    expect(qualifierText("ig", "2026-09-17")).toBe("as of 17 Sept 2026");
  });

  it("is empty when there's nothing to qualify", () => {
    expect(qualifierText("caps", undefined)).toBe("");
    expect(qualifierText("fee", "")).toBe("");
  });
});

describe("reelStrip", () => {
  const random = () => 0.5;

  it("ends on the stat it lands on, which appears nowhere else", () => {
    for (const target of STAT_KEYS) {
      const strip = reelStrip(target, STAT_KEYS, random);
      expect(strip).toHaveLength(12);
      expect(strip[strip.length - 1]).toBe(target);
      expect(strip.slice(0, -1)).not.toContain(target);
    }
  });

  it("uses every other stat before repeating one", () => {
    const strip = reelStrip("caps", STAT_KEYS, random).slice(0, -1);
    const others = STAT_KEYS.filter((k) => k !== "caps");
    expect(new Set(strip)).toEqual(new Set<StatKey>(others));
  });

  it("copes with a single stat", () => {
    expect(reelStrip("caps", ["caps"], random)).toEqual(["caps"]);
  });
});

describe("announcement", () => {
  const r1 = round(1, { stat: "caps", anchorValue: 50 });
  const start: GameEvent[] = [
    { type: "start" },
    { type: "started", runId: "20260926-a", round: r1 },
    { type: "dealt" },
    { type: "spun" },
  ];
  const at = (events: GameEvent[]): GameState => events.reduce(reduce, initialState());

  it("asks the question once the stat has landed", () => {
    expect(announcement(at(start.slice(0, 3)))).toBe("");
    expect(announcement(at(start))).toBe("Caps. p1: 50. Is p2 higher or lower?");
  });

  it("gives the challenger's value and the verdict", () => {
    const right = at([
      ...start,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: cont(1, round(2), 80), at: 1 },
      { type: "settled" },
    ]);
    expect(announcement(right)).toBe("p2: 80. Correct. Streak 1.");

    const lost = at([
      ...start,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: wrong(1, 20), at: 1 },
      { type: "settled" },
    ]);
    expect(announcement(lost)).toBe("p2: 20. Wrong. The run is over.");
  });

  it("says nothing while the answer is in flight", () => {
    expect(announcement(at([...start, { type: "guess", guess: "higher", at: 0 }]))).toBe("");
  });
});

describe("overCaption", () => {
  it("reads naturally for one", () => {
    expect(overCaption(1)).toBe("correct, then out");
    expect(overCaption(0)).toBe("in a row");
    expect(overCaption(12)).toBe("in a row");
  });
});

describe("reportHref", () => {
  it("names both players, the stat and both values in the subject", () => {
    const r = {
      ...round(4, { stat: "fee", anchorValue: 77.5 }),
      anchor: { ...round(4).anchor, name: "Zinedine Zidane", value: 77.5, display: "€77.5m" },
      challenger: { ...round(4).challenger, name: "Luís Figo" },
    };
    const href = reportHref("corrections@example.com", r, {
      round: 4,
      value: 62,
      display: "€62m",
      correct: false,
    });
    expect(href.startsWith("mailto:corrections@example.com?subject=")).toBe(true);
    const subject = decodeURIComponent(href.split("?subject=")[1] ?? "");
    expect(subject).toBe(
      "Correction: Zinedine Zidane v Luís Figo, Highest transfer fee (€77.5m v €62m)",
    );
  });
});

describe("hitchText", () => {
  it("says nothing when all is well", () => {
    expect(hitchText(null)).toBe("");
  });

  it("names a reconnect and a slow-down differently", () => {
    const reconnecting = hitchText({ kind: "reconnecting", since: 0, retries: 0 });
    const slowDown = hitchText({ kind: "slowDown", until: 10_000 });
    expect(reconnecting).not.toBe("");
    expect(slowDown).not.toBe("");
    expect(reconnecting).not.toBe(slowDown);
  });
});
