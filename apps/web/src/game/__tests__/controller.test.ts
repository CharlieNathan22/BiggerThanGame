import type { AnswerResponse, Guess, StartResponse } from "@bt/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApi } from "../api";
import { GameController } from "../controller";
import type { GameState, Phase } from "../machine";
import { TIMINGS } from "../timing";
import { cont, round, wrong } from "./fixtures";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** An API whose every call waits until the test settles it. */
class FakeApi implements GameApi {
  starts: Deferred<StartResponse>[] = [];
  answers: { runId: string; round: number; guess: Guess; reply: Deferred<AnswerResponse> }[] = [];

  start(): Promise<StartResponse> {
    const d = deferred<StartResponse>();
    this.starts.push(d);
    return d.promise;
  }

  answer(runId: string, round: number, guess: Guess): Promise<AnswerResponse> {
    const reply = deferred<AnswerResponse>();
    this.answers.push({ runId, round, guess, reply });
    return reply.promise;
  }
}

let api: FakeApi;
let reduced: boolean;
let controller: GameController;
let phases: Phase[];
let latest: GameState;

beforeEach(() => {
  vi.useFakeTimers();
  api = new FakeApi();
  reduced = false;
  controller = new GameController({
    api,
    timings: TIMINGS,
    now: () => Date.now(),
    schedule: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    reducedMotion: () => reduced,
    best: 3,
  });
  phases = [];
  controller.subscribe((s) => {
    latest = s;
    if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
  });
});

afterEach(() => {
  controller.destroy();
  vi.useRealTimers();
});

/** Let resolved promises run their callbacks. */
const flush = () => vi.advanceTimersByTimeAsync(0);

async function startRun(): Promise<void> {
  controller.start();
  api.starts[0]?.resolve({ runId: "20260926-a", round: round(1) });
  await flush();
}

describe("GameController", () => {
  it("reports the state immediately on subscribe", () => {
    expect(latest.phase).toBe("idle");
    expect(latest.best).toBe(3);
  });

  it("plays a round end to end with the nominal timings", async () => {
    await startRun();
    expect(latest.phase).toBe("dealing");

    await vi.advanceTimersByTimeAsync(TIMINGS.beat);
    expect(latest.phase).toBe("spinning");
    await vi.advanceTimersByTimeAsync(TIMINGS.spin + TIMINGS.land);
    expect(latest.phase).toBe("awaiting");

    // Friendly has no clock: the question waits as long as the player does.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(latest.phase).toBe("awaiting");

    controller.guess("higher");
    expect(latest.phase).toBe("revealing");
    expect(api.answers).toHaveLength(1);
    expect(api.answers[0]).toMatchObject({ runId: "20260926-a", round: 1, guess: "higher" });

    await vi.advanceTimersByTimeAsync(50);
    api.answers[0]?.reply.resolve(cont(1, round(2)));
    await flush();
    expect(latest.reveal?.correct).toBe(true);

    // Verdict at the nominal time after the tap.
    await vi.advanceTimersByTimeAsync(TIMINGS.verdict - 50 - 1);
    expect(latest.phase).toBe("revealing");
    await vi.advanceTimersByTimeAsync(1);
    expect(latest.phase).toBe("verdict");
    expect(latest.streak).toBe(1);

    await vi.advanceTimersByTimeAsync(TIMINGS.next);
    expect(latest.phase).toBe("dealing");
    expect(latest.round?.index).toBe(2);

    // Round two keeps the stat: no wheel, just the hold.
    await vi.advanceTimersByTimeAsync(TIMINGS.hold);
    expect(latest.phase).toBe("awaiting");

    expect(phases).toEqual([
      "idle",
      "starting",
      "dealing",
      "spinning",
      "awaiting",
      "revealing",
      "verdict",
      "dealing",
      "awaiting",
    ]);
  });

  it("holds the reveal while the response is slow, then still counts before the verdict", async () => {
    await startRun();
    await vi.advanceTimersByTimeAsync(TIMINGS.beat + TIMINGS.spin + TIMINGS.land);
    controller.guess("lower");

    // Three seconds with no response: still revealing, never a verdict.
    await vi.advanceTimersByTimeAsync(3000);
    expect(latest.phase).toBe("revealing");
    expect(latest.reveal).toBeNull();

    api.answers[0]?.reply.resolve(wrong(1));
    await flush();
    const settleThenVerdict = TIMINGS.settle + (TIMINGS.verdict - TIMINGS.count);
    await vi.advanceTimersByTimeAsync(settleThenVerdict - 1);
    expect(latest.phase).toBe("revealing");
    await vi.advanceTimersByTimeAsync(1);
    expect(latest.phase).toBe("verdict");

    await vi.advanceTimersByTimeAsync(TIMINGS.over);
    expect(latest.phase).toBe("over");
    expect(latest.end).toBe("wrong");
  });

  it("skips the spin with reduced motion", async () => {
    reduced = true;
    await startRun();
    await vi.advanceTimersByTimeAsync(TIMINGS.beat);
    // A zero-delay timer runs on the next tick, which fake timers count as 1ms.
    await vi.advanceTimersByTimeAsync(1);
    expect(latest.phase).toBe("awaiting");
    expect(phases).toEqual(["idle", "starting", "dealing", "spinning", "awaiting"]);
  });

  it("returns to the start panel when the run can't start", async () => {
    controller.start();
    api.starts[0]?.reject(new Error("offline"));
    await flush();
    expect(latest.phase).toBe("idle");
    expect(latest.startFailed).toBe(true);
  });

  it("banks the streak when an answer fails", async () => {
    await startRun();
    await vi.advanceTimersByTimeAsync(TIMINGS.beat + TIMINGS.spin + TIMINGS.land);
    controller.guess("higher");
    api.answers[0]?.reply.reject(new Error("offline"));
    await flush();
    expect(latest.phase).toBe("over");
    expect(latest.end).toBe("network");
  });

  it("sends one answer however many times the player taps", async () => {
    await startRun();
    await vi.advanceTimersByTimeAsync(TIMINGS.beat + TIMINGS.spin + TIMINGS.land);
    controller.guess("higher");
    controller.guess("lower");
    controller.guess("higher");
    expect(api.answers).toHaveLength(1);
  });

  it("ignores a guess before the question is up", async () => {
    await startRun();
    controller.guess("higher");
    expect(api.answers).toHaveLength(0);
    expect(latest.phase).toBe("dealing");
  });

  it("ignores a response that arrives after the island is gone", async () => {
    await startRun();
    await vi.advanceTimersByTimeAsync(TIMINGS.beat + TIMINGS.spin + TIMINGS.land);
    controller.guess("higher");
    const before = latest;
    controller.destroy();
    api.answers[0]?.reply.resolve(cont(1, round(2)));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.state).toBe(before);
  });

  it("plays again from game over with a fresh run", async () => {
    await startRun();
    await vi.advanceTimersByTimeAsync(TIMINGS.beat + TIMINGS.spin + TIMINGS.land);
    controller.guess("higher");
    api.answers[0]?.reply.resolve(wrong(1));
    await vi.advanceTimersByTimeAsync(TIMINGS.verdict + TIMINGS.over);
    expect(latest.phase).toBe("over");

    controller.start();
    expect(latest.phase).toBe("starting");
    expect(api.starts).toHaveLength(2);
    api.starts[1]?.resolve({ runId: "20260926-b", round: round(1) });
    await flush();
    expect(latest.runId).toBe("20260926-b");
    expect(latest.history).toEqual([]);
  });
});
