import type { AnswerResponse, CardImage, Guess, StartResponse } from "@bt/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api";
import type { GameApi } from "../api";
import { GameController } from "../controller";
import { RECONNECT } from "../machine";
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
let preloaded: (CardImage | undefined)[];

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
    preload: (image) => preloaded.push(image),
  });
  preloaded = [];
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

  it("banks the streak when a refusal can't be fixed by retrying", async () => {
    await startRun();
    await vi.advanceTimersByTimeAsync(TIMINGS.beat + TIMINGS.spin + TIMINGS.land);
    controller.guess("higher");
    api.answers[0]?.reply.reject(new ApiFailure(400, "bad_request"));
    await flush();
    expect(latest.phase).toBe("over");
    expect(latest.end).toBe("network");
    expect(api.answers).toHaveLength(1);
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

/** A guess on round one, after the wheel has landed. */
async function guessRoundOne(): Promise<void> {
  await startRun();
  await vi.advanceTimersByTimeAsync(TIMINGS.beat + TIMINGS.spin + TIMINGS.land);
  controller.guess("higher");
}

describe("a dropped connection", () => {
  const offline = () => new ApiFailure(0, "network");

  it("retries visibly, backing off, and carries on when the connection returns", async () => {
    await guessRoundOne();
    api.answers[0]?.reply.reject(offline());
    await flush();
    expect(latest.phase).toBe("revealing");
    expect(latest.hitch?.kind).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(499);
    expect(api.answers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.answers).toHaveLength(2);
    expect(api.answers[1]).toMatchObject({ runId: "20260926-a", round: 1, guess: "higher" });

    api.answers[1]?.reply.reject(offline());
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.answers).toHaveLength(3);

    api.answers[2]?.reply.resolve(cont(1, round(2)));
    await flush();
    expect(latest.hitch).toBeNull();
    expect(latest.reveal?.correct).toBe(true);
    await vi.advanceTimersByTimeAsync(TIMINGS.settle + TIMINGS.verdict);
    expect(latest.phase).toBe("verdict");
    expect(latest.streak).toBe(1);
  });

  /** Fails every answer the moment it is sent, until the run ends; returns how long that took. */
  async function stayOffline(): Promise<number> {
    const from = Date.now();
    let failed = 0;
    while (latest.phase === "revealing" && Date.now() - from < 30_000) {
      while (failed < api.answers.length) api.answers[failed++]?.reply.reject(offline());
      await vi.advanceTimersByTimeAsync(50);
    }
    return Date.now() - from;
  }

  it("gives up after a few seconds and banks the streak", async () => {
    await guessRoundOne();
    const lasted = await stayOffline();
    expect(latest.phase).toBe("over");
    expect(latest.end).toBe("network");
    expect(latest.hitch).toBeNull();
    // A handful of attempts over a few seconds, not one and not forever.
    expect(api.answers).toHaveLength(5);
    expect(lasted).toBeGreaterThanOrEqual(RECONNECT.giveUpAfter);
    expect(lasted).toBeLessThanOrEqual(RECONNECT.giveUpAfter + 1000);
  });

  it("keeps a streak earned before the drop", async () => {
    await guessRoundOne();
    api.answers[0]?.reply.resolve(cont(1, round(2)));
    await vi.advanceTimersByTimeAsync(TIMINGS.verdict + TIMINGS.next + TIMINGS.hold);
    controller.guess("lower");
    await stayOffline();
    expect(latest.phase).toBe("over");
    expect(latest.streak).toBe(1);
    expect(latest.best).toBe(3);
  });
});

describe("a 429", () => {
  const limited = (seconds?: number) => new ApiFailure(429, "rate_limited", seconds);

  it("slows down for retry-after, then sends the same answer again", async () => {
    await guessRoundOne();
    api.answers[0]?.reply.reject(limited(10));
    await flush();
    expect(latest.phase).toBe("revealing");
    expect(latest.hitch?.kind).toBe("slowDown");

    await vi.advanceTimersByTimeAsync(9999);
    expect(api.answers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.answers).toHaveLength(2);
    expect(api.answers[1]).toMatchObject({ round: 1, guess: "higher" });
    expect(latest.hitch).toBeNull();

    api.answers[1]?.reply.resolve(cont(1, round(2)));
    await flush();
    // The count plays in full from the retry: the verdict comes at the nominal time after it.
    await vi.advanceTimersByTimeAsync(TIMINGS.verdict - 1);
    expect(latest.phase).toBe("revealing");
    await vi.advanceTimersByTimeAsync(1);
    expect(latest.phase).toBe("verdict");
  });

  it("never ends the run, however long the limit lasts", async () => {
    await guessRoundOne();
    for (let i = 0; i < 5; i++) {
      api.answers[i]?.reply.reject(limited(60));
      await flush();
      expect(latest.phase).toBe("revealing");
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(api.answers).toHaveLength(6);
    expect(latest.phase).toBe("revealing");
  });

  it("waits the shortest limit's period when retry-after is missing", async () => {
    await guessRoundOne();
    api.answers[0]?.reply.reject(limited());
    await flush();
    await vi.advanceTimersByTimeAsync(9999);
    expect(api.answers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.answers).toHaveLength(2);
  });

  it("slows down a run start too, then starts", async () => {
    controller.start();
    api.starts[0]?.reject(limited(60));
    await flush();
    expect(latest.phase).toBe("starting");
    expect(latest.hitch?.kind).toBe("slowDown");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.starts).toHaveLength(2);
    api.starts[1]?.resolve({ runId: "20260926-a", round: round(1) });
    await flush();
    expect(latest.phase).toBe("dealing");
  });
});

describe("photo preloading", () => {
  const photo = (id: string): CardImage => ({
    key: `legends/originals/${id}.0123456789abcdef.jpg`,
    width: 800,
    height: 1000,
  });
  const withPhotos = (index: number) => {
    const r = round(index);
    return {
      ...r,
      anchor: { ...r.anchor, image: photo(r.anchor.id) },
      challenger: { ...r.challenger, image: photo(r.challenger.id) },
    };
  };

  it("fetches both of round one's photos as soon as the run starts", async () => {
    controller.start();
    api.starts[0]?.resolve({ runId: "20260926-a", round: withPhotos(1) });
    await flush();
    expect(preloaded).toEqual([photo("p1"), photo("p2")]);
  });

  it("fetches only the new challenger's photo when an answer lands, before the verdict", async () => {
    controller.start();
    api.starts[0]?.resolve({ runId: "20260926-a", round: withPhotos(1) });
    await flush();
    await vi.advanceTimersByTimeAsync(TIMINGS.beat + TIMINGS.spin + TIMINGS.land);
    controller.guess("higher");
    preloaded = [];

    api.answers[0]?.reply.resolve(cont(1, withPhotos(2)));
    await flush();
    expect(latest.phase).toBe("revealing");
    expect(preloaded).toEqual([photo("p3")]);
  });

  it("fetches nothing when the run ends", async () => {
    await guessRoundOne();
    preloaded = [];
    api.answers[0]?.reply.resolve(wrong(1));
    await flush();
    expect(preloaded).toEqual([]);
  });
});

describe.each([0, 200, 800, 3000])("with the response %i ms after the tap", (delay) => {
  it("reaches the verdict after a full count, never before the answer", async () => {
    await guessRoundOne();
    const tappedAt = Date.now();
    await vi.advanceTimersByTimeAsync(delay);
    expect(latest.phase).toBe("revealing");
    api.answers[0]?.reply.resolve(cont(1, round(2)));
    await flush();

    const expected =
      Math.max(TIMINGS.count, delay + TIMINGS.settle) + (TIMINGS.verdict - TIMINGS.count);
    await vi.advanceTimersByTimeAsync(tappedAt + expected - Date.now() - 1);
    expect(latest.phase).toBe("revealing");
    await vi.advanceTimersByTimeAsync(1);
    expect(latest.phase).toBe("verdict");
  });
});
