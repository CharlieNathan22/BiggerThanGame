import { describe, expect, it } from "vitest";
import {
  RECONNECT,
  advanceDelay,
  dealDelay,
  initialState,
  newCards,
  reconnectDelay,
  reduce,
  retryDelay,
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
      { type: "answerFailed", failure: { kind: "fatal" }, at: 5 },
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
    const s = run([
      { type: "start" },
      { type: "startFailed", failure: { kind: "network" }, at: 0 },
    ]);
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
    const late = 1000 + TIMINGS.count + 2000;
    const count = { tappedAt: 1000, arrivedAt: late };
    const window = settleWindow(count, TIMINGS, false);
    expect(window).toEqual({ start: late, end: late + TIMINGS.settle });
    expect(verdictAt(count, TIMINGS, false)).toBe(
      late + TIMINGS.settle + (TIMINGS.verdict - TIMINGS.count),
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
    const late = TIMINGS.verdict + 1000;
    expect(verdictAt({ tappedAt: 0, arrivedAt: late }, TIMINGS, true)).toBe(late);
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

describe("reduce — hitches", () => {
  const network = { kind: "network" } as const;
  const tapped = (at = 0): GameState =>
    run([...toAwaiting, { type: "guess", guess: "higher", at }]);
  const midRun = (): GameState =>
    run(
      [
        { type: "answered", response: cont(1, r2), at: 10 },
        { type: "settled" },
        { type: "advance" },
        { type: "dealt" },
        { type: "guess", guess: "lower", at: 3000 },
      ],
      tapped(),
    );

  it("waits out a 429 on an answer, keeping the round, the streak and the tap", () => {
    const before = midRun();
    const s = reduce(before, {
      type: "answerFailed",
      failure: { kind: "rateLimited", retryAfterMs: 10_000 },
      at: 3100,
    });
    expect(s.phase).toBe("revealing");
    expect(s.hitch).toEqual({ kind: "slowDown", until: 13_100 });
    expect(s.streak).toBe(1);
    expect(s.round).toBe(before.round);
    expect(s.guess).toBe("lower");
  });

  it("never ends the run on a 429, however many come", () => {
    let s = midRun();
    for (let i = 0; i < 20; i++) {
      s = reduce(s, {
        type: "answerFailed",
        failure: { kind: "rateLimited", retryAfterMs: 60_000 },
        at: 4000 + i * 60_000,
      });
      expect(s.phase).toBe("revealing");
      s = reduce(s, { type: "retry", at: 64_000 + i * 60_000 });
      expect(s.hitch).toBeNull();
    }
  });

  it("restarts the count from the retry after a slow-down, so the reveal plays in full", () => {
    const limited = reduce(tapped(0), {
      type: "answerFailed",
      failure: { kind: "rateLimited", retryAfterMs: 10_000 },
      at: 50,
    });
    const retried = reduce(limited, { type: "retry", at: 10_050 });
    expect(retried.count).toEqual({ tappedAt: 10_050, arrivedAt: null });
    const answered = reduce(retried, { type: "answered", response: cont(1, r2), at: 10_100 });
    expect(verdictAt(answered.count!, TIMINGS, false)).toBe(10_050 + TIMINGS.verdict);
  });

  it("retries a dropped connection, counting the spell from its first failure", () => {
    let s = reduce(tapped(0), { type: "answerFailed", failure: network, at: 100 });
    expect(s.phase).toBe("revealing");
    expect(s.hitch).toEqual({ kind: "reconnecting", since: 100, retries: 0 });
    s = reduce(s, { type: "retry", at: 600 });
    expect(s.hitch).toEqual({ kind: "reconnecting", since: 100, retries: 1 });
    s = reduce(s, { type: "answerFailed", failure: network, at: 650 });
    expect(s.hitch).toEqual({ kind: "reconnecting", since: 100, retries: 1 });
  });

  it("banks the streak once the connection has been gone for the whole window", () => {
    let s = reduce(midRun(), { type: "answerFailed", failure: network, at: 3100 });
    s = reduce(s, { type: "retry", at: 3600 });
    s = reduce(s, {
      type: "answerFailed",
      failure: network,
      at: 3100 + RECONNECT.giveUpAfter - 1,
    });
    expect(s.phase).toBe("revealing");
    s = reduce(s, { type: "retry", at: 3100 + RECONNECT.giveUpAfter });
    s = reduce(s, { type: "answerFailed", failure: network, at: 3100 + RECONNECT.giveUpAfter });
    expect(s.phase).toBe("over");
    expect(s.end).toBe("network");
    expect(s.streak).toBe(1);
    expect(s.hitch).toBeNull();
  });

  it("clears the hitch when the answer finally lands", () => {
    let s = reduce(tapped(0), { type: "answerFailed", failure: network, at: 100 });
    s = reduce(s, { type: "retry", at: 600 });
    s = reduce(s, { type: "answered", response: cont(1, r2), at: 700 });
    expect(s.hitch).toBeNull();
    expect(s.reveal?.correct).toBe(true);
  });

  it("ends at once on a refusal retrying can't fix", () => {
    const s = reduce(midRun(), { type: "answerFailed", failure: { kind: "fatal" }, at: 3100 });
    expect(s.phase).toBe("over");
    expect(s.end).toBe("network");
    expect(s.streak).toBe(1);
  });

  it("waits out a 429 on a run start, then starts again", () => {
    let s = run([{ type: "start" }]);
    s = reduce(s, {
      type: "startFailed",
      failure: { kind: "rateLimited", retryAfterMs: 60_000 },
      at: 5,
    });
    expect(s.phase).toBe("starting");
    expect(s.hitch).toEqual({ kind: "slowDown", until: 60_005 });
    expect(s.startFailed).toBe(false);
    s = reduce(s, { type: "retry", at: 60_005 });
    expect(s.phase).toBe("starting");
    expect(s.hitch).toBeNull();
  });

  it("ignores a retry with nothing waiting", () => {
    const s = tapped(0);
    expect(reduce(s, { type: "retry", at: 1 })).toBe(s);
  });
});

describe("retry timing", () => {
  it("backs off from half a second to two", () => {
    expect([0, 1, 2, 3, 4].map(reconnectDelay)).toEqual([500, 1000, 2000, 2000, 2000]);
  });

  it("waits to the end of a slow-down, or the next reconnect step", () => {
    const base = initialState();
    expect(retryDelay(base, 0)).toBeNull();
    expect(retryDelay({ ...base, hitch: { kind: "slowDown", until: 9000 } }, 4000)).toBe(5000);
    expect(retryDelay({ ...base, hitch: { kind: "slowDown", until: 9000 } }, 9500)).toBe(0);
    expect(
      retryDelay({ ...base, hitch: { kind: "reconnecting", since: 0, retries: 1 } }, 700),
    ).toBe(1000);
  });

  it("gives up within a few seconds of a drop", () => {
    // 0.5 + 1 + 2 + 2 s of waiting covers the window, so the last retry
    // lands no later than five and a half seconds in.
    let waited = 0;
    let retries = 0;
    while (waited < RECONNECT.giveUpAfter) waited += reconnectDelay(retries++);
    expect(waited).toBeLessThanOrEqual(6000);
  });
});

describe("newCards", () => {
  it("is both cards on round one, and only the challenger after", () => {
    expect(newCards(r1).map((c) => c.id)).toEqual([r1.anchor.id, r1.challenger.id]);
    expect(newCards(r2).map((c) => c.id)).toEqual([r2.challenger.id]);
  });
});
