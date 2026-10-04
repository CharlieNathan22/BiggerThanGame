/**
 * Endless on the client: the question's clock and its timeout, the countdown
 * under latency, the Endless API's tokens, the Turnstile check on Start, and
 * the view's clock and title helpers.
 */

import type {
  AnswerResponse,
  GuessResponse,
  RunStartResponse,
  StartResponse,
  TimedGuess,
} from "@bt/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, classifyFailure, createEndlessApi } from "../api";
import type { GameApi } from "../api";
import { GameController } from "../controller";
import { initialState, reduce, settleWindow } from "../machine";
import type { GameEvent, GameState } from "../machine";
import { TIMINGS } from "../timing";
import { HUMAN_CHECK_TIMEOUT_MS, createHumanCheck, loadWhenIdle } from "../turnstile";
import type { Turnstile, TurnstileOptions } from "../turnstile";
import {
  URGENT_MS,
  WARN_MS,
  bankedText,
  challengeNotice,
  clockAnnouncement,
  clockState,
  clockView,
  topClock,
  titleChip,
  verdictLabel,
} from "../view";
import { cont, round, wrong } from "./fixtures";

// ------------------------------------------------------------------ machine

describe("the question's clock", () => {
  const toAwaiting = (mode: "friendly" | "endless", at = 1234): GameState =>
    [
      { type: "start" },
      { type: "started", runId: "r", round: round(1) },
      { type: "titled" },
      { type: "held" },
      { type: "introDone" },
      { type: "dealt", at: at - 100 },
      { type: "spun", at },
    ].reduce<GameState>((s, e) => reduce(s, e as GameEvent), initialState(0, null, mode));

  it("starts in Endless as the question becomes answerable: 15 seconds for question 1", () => {
    expect(toAwaiting("endless").clock).toEqual({ startedAt: 1234, limitMs: 15_000 });
  });

  it("never runs in Friendly", () => {
    expect(toAwaiting("friendly").clock).toBeNull();
  });

  it("stops the moment the player answers: it never runs while the answer is in flight", () => {
    const s = reduce(toAwaiting("endless"), { type: "guess", guess: "higher", at: 5000 });
    expect(s).toMatchObject({ phase: "revealing", clock: null, guess: "higher" });
  });

  it("answers as a timeout when it runs out, so the reveal still plays", () => {
    const s = reduce(toAwaiting("endless"), { type: "timeout", at: 16_234 });
    expect(s).toMatchObject({
      phase: "revealing",
      guess: "timeout",
      clock: null,
      count: { tappedAt: 16_234, arrivedAt: null },
    });
  });

  it("gives later questions 10 seconds, from the deal when the stat holds", () => {
    let s = toAwaiting("endless");
    s = reduce(s, { type: "guess", guess: "higher", at: 2000 });
    s = reduce(s, { type: "answered", response: cont(1, round(2)), at: 2100 });
    s = reduce(s, { type: "settled" });
    s = reduce(s, { type: "advance" });
    expect(s.phase).toBe("dealing");
    expect(s.clock).toBeNull();
    s = reduce(s, { type: "dealt", at: 6000 });
    expect(s).toMatchObject({ phase: "awaiting", clock: { startedAt: 6000, limitMs: 10_000 } });
  });

  it("ignores a timeout that comes after the answer", () => {
    const answered = reduce(toAwaiting("endless"), { type: "guess", guess: "lower", at: 5000 });
    expect(reduce(answered, { type: "timeout", at: 16_234 })).toBe(answered);
  });
});

// --------------------------------------------------------------- controller

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

class FakeApi implements GameApi {
  starts: Deferred<StartResponse>[] = [];
  answers: { guess: TimedGuess; reply: Deferred<AnswerResponse> }[] = [];
  start(): Promise<StartResponse> {
    const d = deferred<StartResponse>();
    this.starts.push(d);
    return d.promise;
  }
  answer(_runId: string, _round: number, guess: TimedGuess): Promise<AnswerResponse> {
    const reply = deferred<AnswerResponse>();
    this.answers.push({ guess, reply });
    return reply.promise;
  }
}

describe("the controller's clock, in Endless", () => {
  let api: FakeApi;
  let controller: GameController;
  let latest: GameState;
  let log: { at: number; state: GameState }[];

  beforeEach(() => {
    vi.useFakeTimers();
    api = new FakeApi();
    log = [];
    controller = new GameController({
      api,
      mode: "endless",
      timings: TIMINGS,
      now: () => Date.now(),
      schedule: (fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      reducedMotion: () => false,
    });
    controller.subscribe((s) => {
      latest = s;
      log.push({ at: Date.now(), state: s });
    });
  });

  afterEach(() => {
    controller.destroy();
    vi.useRealTimers();
  });

  const flush = () => vi.advanceTimersByTimeAsync(0);

  /** To round one's question: title, hold, cards, beat and spin. */
  async function toQuestion(): Promise<void> {
    controller.start();
    api.starts[0]?.resolve({ runId: "20260926-a", round: round(1) });
    await flush();
    await vi.advanceTimersByTimeAsync(
      TIMINGS.title +
        TIMINGS.holdMin +
        TIMINGS.introMin +
        TIMINGS.beat +
        TIMINGS.spin +
        TIMINGS.land,
    );
    expect(latest.phase).toBe("awaiting");
  }

  it("sends a timeout when question 1's 15 seconds run out, and not a moment before", async () => {
    await toQuestion();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(api.answers).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.answers).toEqual([expect.objectContaining({ guess: "timeout" })]);
    expect(latest).toMatchObject({ phase: "revealing", guess: "timeout" });
  });

  it("never times out an answered question", async () => {
    await toQuestion();
    await vi.advanceTimersByTimeAsync(9000);
    controller.guess("higher");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.answers.map((a) => a.guess)).toEqual(["higher"]);
  });

  it("plays the reveal of a timeout like any other, and ends the run", async () => {
    await toQuestion();
    await vi.advanceTimersByTimeAsync(15_000);
    api.answers[0]?.reply.resolve({ ...wrong(1), end: "timeout" });
    await vi.advanceTimersByTimeAsync(TIMINGS.count + TIMINGS.over + 1000);
    expect(latest).toMatchObject({ phase: "over", end: "timeout" });
    expect(verdictLabel({ ...latest, phase: "verdict" })).toBe("Time's up");
  });

  it.each([0, 200, 800, 3000])(
    "with the answer %i ms in flight: the count holds, then counts up, and the clock stays stopped",
    async (delay) => {
      await toQuestion();
      await vi.advanceTimersByTimeAsync(2000);
      controller.guess("higher");
      const tappedAt = Date.now();
      await vi.advanceTimersByTimeAsync(delay);
      // In flight: no clock, and the number holds at zero (no settle window yet).
      expect(latest.phase).toBe("revealing");
      expect(latest.clock).toBeNull();
      expect(latest.count?.arrivedAt).toBeNull();
      expect(settleWindow(latest.count!, TIMINGS, false)).toBeNull();

      api.answers[0]?.reply.resolve(cont(1, round(2)));
      await flush();
      const arrivedAt = Date.now();
      const window = settleWindow(latest.count!, TIMINGS, false)!;
      // Counts from the arrival, for at least the settle time: never a snap.
      expect(window.start).toBe(arrivedAt);
      expect(window.end - window.start).toBeGreaterThanOrEqual(TIMINGS.settle);
      expect(window.end).toBeGreaterThanOrEqual(tappedAt + TIMINGS.count);

      // The next question's clock starts only once it can be answered.
      await vi.advanceTimersByTimeAsync(20_000);
      const clocked = log.filter((l) => l.state.clock !== null && l.state.round?.index === 2);
      expect(clocked[0]?.state.phase).toBe("awaiting");
      expect(clocked[0]?.state.clock?.limitMs).toBe(10_000);
      expect(clocked[0]!.at).toBeGreaterThan(arrivedAt);
      // Nothing between the tap and that question had a clock running.
      const between = log.filter((l) => l.at >= tappedAt && l.at < clocked[0]!.at);
      expect(between.every((l) => l.state.clock === null)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------- the API

describe("the Endless API", () => {
  const RESULT = "result-token";
  const startBody: RunStartResponse = { runId: "r", round: round(1), token: "t1" };
  const next: GuessResponse = { ...cont(1, round(2)), token: "t2" };
  const end: GuessResponse = {
    reveal: { round: 2, value: 1, display: "1", correct: false },
    end: "wrong",
    challenge: { runId: "r", score: 1, sig: "s" },
    result: RESULT,
  };

  function server(...replies: unknown[]) {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      const reply = replies.shift();
      if (reply instanceof Response) return reply;
      return new Response(JSON.stringify(reply), { status: 200 });
    });
    return { sent, fetchFn };
  }

  it("starts with the Turnstile token, and sends back each token the server issued", async () => {
    const { sent, fetchFn } = server(startBody, next, end);
    const api = createEndlessApi(fetchFn, async () => "turnstile-ok");
    const started = await api.start({ runId: "x", score: 12, sig: "y" });
    expect(started).toEqual({ runId: "r", round: round(1) });
    expect(sent[0]).toEqual({
      url: "/api/run/start",
      body: {
        mode: "endless",
        turnstileToken: "turnstile-ok",
        challenge: { runId: "x", score: 12, sig: "y" },
      },
    });
    const first = await api.answer("r", 1, "higher");
    expect(first).toEqual(cont(1, round(2)));
    expect(sent[1]).toEqual({ url: "/api/round/guess", body: { token: "t1", guess: "higher" } });
    expect(api.latestToken()).toBe("t2");
    // Mid-run, a dropped connection would publish the run with its latest token.
    expect(api.publishToken()).toBe("t2");
    const last = await api.answer("r", 2, "timeout");
    expect(sent[2]?.body).toEqual({ token: "t2", guess: "timeout" });
    expect(last).toEqual({ reveal: end.reveal, end: "wrong", challenge: end.challenge });
    expect(api.resultToken()).toBe(RESULT);
    // Once it has ended, with its signed result.
    expect(api.publishToken()).toBe(RESULT);
  });

  it("keeps the token for a retry until a response lands", async () => {
    const { sent, fetchFn } = server(startBody, new Response("{}", { status: 503 }), next);
    const api = createEndlessApi(fetchFn, async () => "ok");
    await api.start();
    await expect(api.answer("r", 1, "higher")).rejects.toBeInstanceOf(ApiFailure);
    await api.answer("r", 1, "higher");
    expect(sent.slice(1).map((s) => s.body.token)).toEqual(["t1", "t1"]);
  });

  it("never writes a token to storage", async () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    const { fetchFn } = server(startBody, next);
    const api = createEndlessApi(fetchFn, async () => "ok");
    await api.start();
    await api.answer("r", 1, "higher");
    expect(storage.setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("calls a failed or refused Turnstile check a verification failure: try Start again", async () => {
    const api = createEndlessApi(server().fetchFn, async () => {
      throw new Error("blocked");
    });
    const err = await api.start().catch((e: unknown) => e);
    expect(classifyFailure(err)).toEqual({ kind: "verification" });
    const refused = new ApiFailure(403, "verification_failed");
    expect(classifyFailure(refused)).toEqual({ kind: "verification" });
  });

  it("banks the run on a spent or out-of-order token (409)", () => {
    expect(classifyFailure(new ApiFailure(409, "conflict"))).toEqual({ kind: "fatal" });
  });

  it("puts a failed check on the start panel as a calm retry", () => {
    let s = reduce(initialState(0, null, "endless"), { type: "start" });
    s = reduce(s, { type: "startFailed", failure: { kind: "verification" }, at: 0 });
    expect(s).toMatchObject({ phase: "idle", startFailed: true, checkFailed: true });
  });
});

// ---------------------------------------------------------------- Turnstile

describe("Turnstile on the Endless page", () => {
  it("loads when the page is idle, where the browser can say so", () => {
    const load = vi.fn(async () => undefined);
    let idle: (() => void) | undefined;
    loadWhenIdle(
      {
        requestIdleCallback: (cb) => (idle = cb),
        addEventListener: vi.fn(),
        document: { readyState: "loading" },
        setTimeout: vi.fn(),
      },
      load,
    );
    expect(load).not.toHaveBeenCalled();
    idle?.();
    expect(load).toHaveBeenCalledOnce();
  });

  it("falls back to the load event, or runs at once if the page has loaded", () => {
    const load = vi.fn(async () => undefined);
    const listeners: (() => void)[] = [];
    loadWhenIdle(
      {
        addEventListener: (_type, fn) => listeners.push(fn),
        document: { readyState: "interactive" },
        setTimeout: vi.fn(),
      },
      load,
    );
    expect(load).not.toHaveBeenCalled();
    listeners[0]?.();
    expect(load).toHaveBeenCalledOnce();

    const later = vi.fn(async () => undefined);
    loadWhenIdle(
      {
        addEventListener: vi.fn(),
        document: { readyState: "complete" },
        setTimeout: (fn) => fn(),
      },
      later,
    );
    expect(later).toHaveBeenCalledOnce();
  });

  function fakeTurnstile() {
    const rendered: TurnstileOptions[] = [];
    const calls: string[] = [];
    const api: Turnstile = {
      render: (_box, options) => {
        rendered.push(options);
        return "w1";
      },
      reset: (id) => void calls.push(`reset ${id}`),
      remove: () => {},
      execute: (id) => void calls.push(`execute ${id}`),
    };
    return { api, rendered, calls };
  }

  it("renders once, invisibly unless it needs the player, and executes on each Start", async () => {
    const t = fakeTurnstile();
    const box = {} as HTMLElement;
    const check = createHumanCheck(
      async () => t.api,
      () => box,
      "site-key",
      () => () => {},
    );
    const first = check();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.rendered).toHaveLength(1);
    expect(t.rendered[0]).toMatchObject({
      sitekey: "site-key",
      appearance: "interaction-only",
      execution: "execute",
    });
    t.rendered[0]!.callback("token-1");
    await expect(first).resolves.toBe("token-1");

    const second = check();
    await Promise.resolve();
    await Promise.resolve();
    t.rendered[0]!.callback("token-2");
    await expect(second).resolves.toBe("token-2");
    expect(t.rendered).toHaveLength(1);
    expect(t.calls).toEqual(["execute w1", "reset w1", "execute w1"]);
  });

  it("rejects when the check errors, or takes too long", async () => {
    const t = fakeTurnstile();
    let timeout: (() => void) | undefined;
    const check = createHumanCheck(
      async () => t.api,
      () => ({}) as HTMLElement,
      "k",
      (fn, ms) => {
        expect(ms).toBe(HUMAN_CHECK_TIMEOUT_MS);
        timeout = fn;
        return () => {};
      },
    );
    const failing = check();
    await Promise.resolve();
    await Promise.resolve();
    t.rendered[0]!["error-callback"]!();
    await expect(failing).rejects.toThrow();

    const slow = check();
    await Promise.resolve();
    await Promise.resolve();
    timeout?.();
    await expect(slow).rejects.toThrow(/timed out/);
  });
});

// --------------------------------------------------------------------- view

describe("the clock's state", () => {
  it("is calm above five seconds, warning from five, urgent from three", () => {
    expect(clockState(5001)).toEqual({ seconds: 6, level: "calm" });
    expect(clockState(WARN_MS)).toEqual({ seconds: 5, level: "warning" });
    expect(clockState(3001)).toEqual({ seconds: 4, level: "warning" });
    expect(clockState(URGENT_MS)).toEqual({ seconds: 3, level: "urgent" });
    expect(clockState(1)).toEqual({ seconds: 1, level: "urgent" });
    expect(clockState(0)).toEqual({ seconds: 0, level: "urgent" });
  });

  it("shows whole seconds rounded up, reaching 0 exactly as time runs out", () => {
    expect(clockState(10_000).seconds).toBe(10);
    expect(clockState(9_999).seconds).toBe(10);
    expect(clockState(9_000).seconds).toBe(9);
    expect(clockState(8_999).seconds).toBe(9);
    expect(clockState(0.5).seconds).toBe(1);
    expect(clockState(-40).seconds).toBe(0);
  });
});

describe("the plaque's line", () => {
  const clock = { startedAt: 1000, limitMs: 10_000 };

  it("drains smoothly, in the clock's colours", () => {
    expect(clockView(clock, 1000)).toEqual({
      remainingMs: 10_000,
      seconds: 10,
      fraction: 1,
      level: "calm",
    });
    expect(clockView(clock, 1000 + 5_000)).toMatchObject({ seconds: 5, level: "warning" });
    expect(clockView(clock, 1000 + 7_000)).toMatchObject({ seconds: 3, level: "urgent" });
    expect(clockView(clock, 1000 + 7_500)).toMatchObject({ fraction: 0.25, seconds: 3 });
    expect(clockView(clock, 99_999)).toMatchObject({ remainingMs: 0, seconds: 0, fraction: 0 });
  });

  it("never reads more than the limit, even for a frame drawn before it started", () => {
    expect(clockView(clock, 0)).toMatchObject({ remainingMs: 10_000, seconds: 10, fraction: 1 });
  });

  it("steps down a whole second at a time with reduced motion", () => {
    expect(clockView(clock, 1000 + 7_500, true).fraction).toBe(0.3);
    expect(clockView(clock, 1000 + 7_001, true).fraction).toBe(0.3);
    expect(clockView(clock, 1000 + 7_000, true).fraction).toBe(0.3);
    expect(clockView(clock, 1000 + 8_000, true).fraction).toBe(0.2);
  });
});

describe("the big clock at the top", () => {
  /** Endless to round one's question, its clock started at 1000. */
  const toQuestion = (): GameState =>
    [
      { type: "start" },
      { type: "started", runId: "r", round: round(1) },
      { type: "titled" },
      { type: "held" },
      { type: "introDone" },
      { type: "dealt", at: 900 },
      { type: "spun", at: 1000 },
    ].reduce<GameState>((s, e) => reduce(s, e as GameEvent), initialState(0, null, "endless"));

  it("waits at 15 while round one is dealt, then counts down from 15", () => {
    let s = initialState(0, null, "endless");
    s = reduce(s, { type: "start" });
    expect(topClock(s, 0)).toBeNull();
    s = reduce(s, { type: "started", runId: "r", round: round(1) });
    expect(topClock(s, 0)).toBeNull(); // the title card
    s = reduce(reduce(reduce(s, { type: "titled" }), { type: "held" }), { type: "introDone" });
    expect(topClock(s, 0)).toEqual({ seconds: 15, level: "calm", running: false, frozen: false });

    const q = toQuestion();
    expect(topClock(q, 1000)).toEqual({ seconds: 15, level: "calm", running: true, frozen: false });
    expect(topClock(q, 1000 + 10_000)).toMatchObject({ seconds: 5, level: "warning" });
    expect(topClock(q, 1000 + 12_000)).toMatchObject({ seconds: 3, level: "urgent" });
    expect(topClock(q, 1000 + 15_000)).toMatchObject({
      seconds: 0,
      level: "urgent",
      running: true,
    });
  });

  it("freezes on the second the player answered at, through the reveal and the deal", () => {
    let s = reduce(toQuestion(), { type: "guess", guess: "higher", at: 1000 + 11_200 });
    const frozen = { seconds: 4, level: "warning", running: false, frozen: true };
    expect(topClock(s, 1000 + 11_200)).toEqual(frozen);
    // Time passing changes nothing.
    expect(topClock(s, 1000 + 60_000)).toEqual(frozen);
    s = reduce(s, { type: "answered", response: cont(1, round(2)), at: 13_000 });
    s = reduce(s, { type: "settled" });
    expect(topClock(s, 99_000)).toEqual(frozen);
    s = reduce(s, { type: "advance" });
    expect(s.phase).toBe("dealing");
    expect(topClock(s, 99_000)).toEqual(frozen);
    // The next question can be answered: it starts again from its limit.
    s = reduce(s, { type: "dealt", at: 20_000 });
    expect(topClock(s, 20_000)).toEqual({
      seconds: 10,
      level: "calm",
      running: true,
      frozen: false,
    });
  });

  it("freezes on 0, urgent, at a timeout", () => {
    const s = reduce(toQuestion(), { type: "timeout", at: 1000 + 15_000 });
    expect(s.stopped).toEqual({ remainingMs: 0, limitMs: 15_000 });
    expect(topClock(s, 50_000)).toEqual({
      seconds: 0,
      level: "urgent",
      running: false,
      frozen: true,
    });
  });

  it("is gone once the run is over, and in Friendly", () => {
    const over = reduce(
      reduce(reduce(toQuestion(), { type: "guess", guess: "lower", at: 2000 }), {
        type: "answered",
        response: wrong(1),
        at: 2100,
      }),
      { type: "settled" },
    );
    expect(topClock(reduce(over, { type: "advance" }), 3000)).toBeNull();
    const friendly = [
      { type: "start" },
      { type: "started", runId: "r", round: round(1) },
      { type: "titled" },
      { type: "held" },
      { type: "introDone" },
      { type: "dealt", at: 900 },
      { type: "spun", at: 1000 },
    ].reduce<GameState>((s, e) => reduce(s, e as GameEvent), initialState(0, null, "friendly"));
    expect(topClock(friendly, 1000)).toBeNull();
  });

  it("starts a new run clean, with nothing frozen from the last", () => {
    const s = reduce(toQuestion(), { type: "timeout", at: 16_000 });
    expect(reduce({ ...s, phase: "over" }, { type: "start" }).stopped).toBeNull();
  });

  it("tells screen readers twice — five seconds, then three — never a count", () => {
    const q = toQuestion();
    const says = (at: number) => clockAnnouncement(topClock(q, at));
    expect(says(1000 + 9_999)).toBe("");
    expect(says(1000 + 10_000)).toBe("5 seconds left");
    expect(says(1000 + 11_999)).toBe("5 seconds left");
    expect(says(1000 + 12_000)).toBe("3 seconds left");
    expect(says(1000 + 14_999)).toBe("3 seconds left");
    expect(says(1000 + 15_000)).toBe("");
    // Frozen or waiting: nothing to say.
    const answered = reduce(q, { type: "guess", guess: "higher", at: 1000 + 13_000 });
    expect(clockAnnouncement(topClock(answered, 1000 + 13_000))).toBe("");
    expect(clockAnnouncement(null)).toBe("");
  });
});

describe("Endless's words", () => {
  it("shows the streak title so far in the chip, in Endless only", () => {
    expect(titleChip({ streak: 4 }, "endless")).toBe("");
    expect(titleChip({ streak: 17 }, "endless")).toBe("Fan favourite");
    expect(titleChip({ streak: 17 }, "friendly")).toBe("");
  });

  it("says a dropped connection's streak is saved", () => {
    expect(bankedText({ end: "network", streak: 7 }, "endless")).toBe(
      "Connection lost — your streak of 7 is saved.",
    );
    expect(bankedText({ end: "wrong", streak: 7 }, "endless")).toBe("");
  });

  it("notes an old Friendly challenge link on the start panel, and nowhere else", () => {
    const idle = initialState(0, { status: "retired" }, "friendly");
    expect(challengeNotice(idle)).toBe("This challenge link has expired — play Friendly.");
    expect(challengeNotice({ ...idle, phase: "dealing", round: round(1) })).toBe("");
  });
});
