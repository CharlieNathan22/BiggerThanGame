import { describe, expect, it } from "vitest";
import {
  advanceDelay,
  dealDelay,
  initialState,
  reduce,
  settleWindow,
  shouldSpin,
  spinDelay,
  verdictAt,
} from "../machine";
import type { GameEvent, GameState } from "../machine";
import { TIMINGS } from "../timing";
import { cont, exhausted, round, wrong } from "./fixtures";

function run(events: readonly GameEvent[], from: GameState = initialState()): GameState {
  return events.reduce(reduce, from);
}

const r1 = round(1, { stat: "caps" });
const r2 = round(2, { stat: "caps" });
const r3 = round(3, { stat: "ig", statChanged: true });

/** Start a run and get to the first question. */
const toAwaiting: GameEvent[] = [
  { type: "start" },
  { type: "started", runId: "20260926-x", round: r1 },
  { type: "dealt" },
  { type: "spun" },
];

describe("reduce — the happy path", () => {
  it("walks idle → starting → dealing → spinning → awaiting on round one", () => {
    const phases: string[] = [];
    let s = initialState();
    phases.push(s.phase);
    for (const e of toAwaiting) {
      s = reduce(s, e);
      phases.push(s.phase);
    }
    expect(phases).toEqual(["idle", "starting", "dealing", "spinning", "awaiting"]);
    expect(s.runId).toBe("20260926-x");
  });

  it("keeps the plaque blank until round one's wheel lands", () => {
    const dealing = run(toAwaiting.slice(0, 2));
    expect(dealing.plaque).toBeNull();
    expect(run(toAwaiting.slice(0, 3)).plaque).toBeNull();
    expect(run(toAwaiting).plaque).toEqual(r1.stat);
  });

  it("walks awaiting → revealing → verdict → dealing on a right answer", () => {
    let s = run(toAwaiting);
    s = reduce(s, { type: "guess", guess: "higher", at: 1000 });
    expect(s.phase).toBe("revealing");
    expect(s.count).toEqual({ tappedAt: 1000, arrivedAt: null });
    expect(s.reveal).toBeNull();

    s = reduce(s, { type: "answered", response: cont(1, r2), at: 1100 });
    expect(s.phase).toBe("revealing");
    expect(s.count).toEqual({ tappedAt: 1000, arrivedAt: 1100 });
    expect(s.reveal?.correct).toBe(true);
    expect(s.streak).toBe(0);

    s = reduce(s, { type: "settled" });
    expect(s.phase).toBe("verdict");
    expect(s.streak).toBe(1);
    expect(s.best).toBe(1);

    s = reduce(s, { type: "advance" });
    expect(s.phase).toBe("dealing");
    expect(s.round).toBe(r2);
    expect(s.guess).toBeNull();
    expect(s.reveal).toBeNull();
    expect(s.count).toBeNull();
    expect(s.next).toBeNull();
  });

  it("skips the wheel when the stat holds, and shows the stat at once", () => {
    let s = run([...toAwaiting, ...answerRight(1, r2)]);
    expect(s.phase).toBe("dealing");
    expect(s.plaque).toEqual(r2.stat);
    s = reduce(s, { type: "dealt" });
    expect(s.phase).toBe("awaiting");
  });

  it("keeps the old stat on the plaque until a switch's wheel lands", () => {
    let s = run([...toAwaiting, ...answerRight(1, r2), { type: "dealt" }, ...answerRight(2, r3)]);
    expect(s.phase).toBe("dealing");
    expect(s.plaque?.key).toBe("caps");
    s = reduce(s, { type: "dealt" });
    expect(s.phase).toBe("spinning");
    expect(s.plaque?.key).toBe("caps");
    s = reduce(s, { type: "spun" });
    expect(s.plaque?.key).toBe("ig");
  });

  it("ends the run on a wrong answer, after the verdict", () => {
    let s = run(toAwaiting);
    s = run(
      [
        { type: "guess", guess: "lower", at: 0 },
        { type: "answered", response: wrong(1), at: 50 },
        { type: "settled" },
      ],
      s,
    );
    expect(s.phase).toBe("verdict");
    expect(s.streak).toBe(0);
    expect(s.end).toBe("wrong");
    s = reduce(s, { type: "advance" });
    expect(s.phase).toBe("over");
    expect(s.end).toBe("wrong");
  });

  it("ends a run the deck can't continue, keeping the last point", () => {
    const s = run([
      ...toAwaiting,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: exhausted(1), at: 50 },
      { type: "settled" },
      { type: "advance" },
    ]);
    expect(s.phase).toBe("over");
    expect(s.end).toBe("deck-exhausted");
    expect(s.streak).toBe(1);
  });
});

describe("reduce — round history", () => {
  it("records every answered round with its stat and tier, and nothing else", () => {
    const s = run([
      ...toAwaiting,
      ...answerRight(1, r2),
      { type: "dealt" },
      ...answerRight(2, r3),
      { type: "dealt" },
      { type: "spun" },
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: wrong(3), at: 10 },
      { type: "settled" },
      { type: "advance" },
    ]);
    expect(s.history).toEqual([
      { index: 1, stat: "caps", tier: "basic", correct: true },
      { index: 2, stat: "caps", tier: "basic", correct: true },
      { index: 3, stat: "ig", tier: "basic", correct: false },
    ]);
    for (const record of s.history) {
      expect(Object.keys(record).sort()).toEqual(["correct", "index", "stat", "tier"]);
    }
  });

  it("does not record a round whose answer never arrived", () => {
    const s = run([
      ...toAwaiting,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answerFailed" },
    ]);
    expect(s.phase).toBe("over");
    expect(s.end).toBe("network");
    expect(s.history).toEqual([]);
  });

  it("starts a fresh history, streak and run id on play again, keeping the best", () => {
    const ended = run([
      ...toAwaiting,
      ...answerRight(1, r2),
      { type: "dealt" },
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: wrong(2), at: 10 },
      { type: "settled" },
      { type: "advance" },
    ]);
    expect(ended.best).toBe(1);
    const again = reduce(ended, { type: "start" });
    expect(again.phase).toBe("starting");
    expect(again.history).toEqual([]);
    expect(again.streak).toBe(0);
    expect(again.runId).toBeNull();
    expect(again.round).toBeNull();
    expect(again.best).toBe(1);
    expect(again.bestBefore).toBe(1);
  });
});

describe("reduce — best", () => {
  it("starts from the best it is given", () => {
    expect(initialState(7).best).toBe(7);
  });

  it("only rises past the previous best", () => {
    const s = run([...toAwaiting, ...answerRight(1, r2)], initialState(5));
    expect(s.streak).toBe(1);
    expect(s.best).toBe(5);
    expect(s.bestBefore).toBe(5);
  });
});

describe("reduce — events out of turn", () => {
  it("ignores a guess outside awaiting", () => {
    const dealing = run(toAwaiting.slice(0, 2));
    expect(reduce(dealing, { type: "guess", guess: "higher", at: 0 })).toBe(dealing);
  });

  it("ignores a second tap while the first is being revealed", () => {
    const revealing = run([...toAwaiting, { type: "guess", guess: "higher", at: 0 }]);
    expect(reduce(revealing, { type: "guess", guess: "lower", at: 5 })).toBe(revealing);
  });

  it("ignores start mid-run", () => {
    const awaiting = run(toAwaiting);
    expect(reduce(awaiting, { type: "start" })).toBe(awaiting);
  });

  it("ignores settle before the answer arrives", () => {
    const revealing = run([...toAwaiting, { type: "guess", guess: "higher", at: 0 }]);
    expect(reduce(revealing, { type: "settled" })).toBe(revealing);
  });

  it("ignores a second answer for the same round", () => {
    const answered = run([
      ...toAwaiting,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: cont(1, r2), at: 10 },
    ]);
    expect(reduce(answered, { type: "answered", response: wrong(1), at: 20 })).toBe(answered);
  });

  it("banks the streak if the server reveals a different round", () => {
    const s = run([
      ...toAwaiting,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: cont(4, r2), at: 10 },
    ]);
    expect(s.phase).toBe("over");
    expect(s.end).toBe("network");
  });

  it("goes back to idle, saying so, when the run can't start", () => {
    const s = run([{ type: "start" }, { type: "startFailed" }]);
    expect(s.phase).toBe("idle");
    expect(s.startFailed).toBe(true);
    expect(reduce(s, { type: "start" }).startFailed).toBe(false);
  });
});

describe("shouldSpin", () => {
  it("spins on round one, even when the payload says the stat didn't change", () => {
    expect(shouldSpin(round(1, { statChanged: false }))).toBe(true);
  });

  it("spins later only when the stat changes", () => {
    expect(shouldSpin(round(2, { statChanged: false }))).toBe(false);
    expect(shouldSpin(round(3, { statChanged: true }))).toBe(true);
  });
});

describe("timings", () => {
  it("pauses a beat before a spin, and a shorter hold without one", () => {
    expect(dealDelay(r1, TIMINGS)).toBe(TIMINGS.beat);
    expect(dealDelay(r2, TIMINGS)).toBe(TIMINGS.hold);
  });

  it("lands the wheel at once with reduced motion", () => {
    expect(spinDelay(TIMINGS, false)).toBe(TIMINGS.spin + TIMINGS.land);
    expect(spinDelay(TIMINGS, true)).toBe(0);
  });

  it("settles an on-time answer exactly when the plain count-up would", () => {
    const count = { tappedAt: 1000, arrivedAt: 1060 };
    expect(settleWindow(count, TIMINGS, false)).toEqual({ start: 1060, end: 1000 + TIMINGS.count });
    expect(verdictAt(count, TIMINGS, false)).toBe(1000 + TIMINGS.verdict);
  });

  it("still counts for the settle time when the answer is late — never a snap", () => {
    const count = { tappedAt: 1000, arrivedAt: 4000 };
    const window = settleWindow(count, TIMINGS, false);
    expect(window).toEqual({ start: 4000, end: 4000 + TIMINGS.settle });
    expect(verdictAt(count, TIMINGS, false)).toBe(
      4000 + TIMINGS.settle + (TIMINGS.verdict - TIMINGS.count),
    );
  });

  it("has no window before the answer arrives", () => {
    expect(settleWindow({ tappedAt: 0, arrivedAt: null }, TIMINGS, false)).toBeNull();
    expect(() => verdictAt({ tappedAt: 0, arrivedAt: null }, TIMINGS, false)).toThrow();
  });

  it("with reduced motion, shows the value on arrival and the verdict at the usual time", () => {
    expect(settleWindow({ tappedAt: 0, arrivedAt: 90 }, TIMINGS, true)).toEqual({
      start: 90,
      end: 90,
    });
    expect(verdictAt({ tappedAt: 0, arrivedAt: 90 }, TIMINGS, true)).toBe(TIMINGS.verdict);
    expect(verdictAt({ tappedAt: 0, arrivedAt: 3000 }, TIMINGS, true)).toBe(3000);
  });

  it("deals the next round sooner than it shows the game-over panel", () => {
    const right = run([...toAwaiting, ...answerRight(1, r2).slice(0, 3)]);
    expect(right.phase).toBe("verdict");
    expect(advanceDelay(right, TIMINGS)).toBe(TIMINGS.next);
    const lost = run([
      ...toAwaiting,
      { type: "guess", guess: "higher", at: 0 },
      { type: "answered", response: wrong(1), at: 0 },
      { type: "settled" },
    ]);
    expect(advanceDelay(lost, TIMINGS)).toBe(TIMINGS.over);
  });
});

/** Answer round `index` correctly and deal `next`. */
function answerRight(index: number, next: ReturnType<typeof round>): GameEvent[] {
  return [
    { type: "guess", guess: "higher", at: 0 },
    { type: "answered", response: cont(index, next), at: 10 },
    { type: "settled" },
    { type: "advance" },
  ];
}
