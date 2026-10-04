/**
 * Play again, and every other new run on one page load, against fakes that
 * behave like the real things:
 *
 * - Turnstile's widgets live in an element. The start panel holding that
 *   element unmounts while a run is played and mounts afresh for the next
 *   start, and a widget whose element has gone can't be reset or executed
 *   ("Cannot find Widget"). Each execution issues a new token.
 * - The server spends a Turnstile token once (Siteverify): a reused one is a
 *   403.
 *
 * The bug this holds: after a run, Play again reset the old widget, whose
 * element had gone with the old start panel, so every later start failed with
 * "We couldn't check your connection" until the page was reloaded.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi, createEndlessApi } from "../api";
import type { Fetch } from "../api";
import { GameController } from "../controller";
import type { GameMode, GameState } from "../machine";
import { TIMINGS } from "../timing";
import { createHumanCheck } from "../turnstile";
import type { Turnstile, TurnstileOptions } from "../turnstile";
import { round } from "./fixtures";

interface Box {
  isConnected: boolean;
}

/** Turnstile as it behaves in the browser, as far as the run start uses it. */
function fakeTurnstile() {
  let n = 0;
  const widgets = new Map<string, { box: Box; options: TurnstileOptions }>();
  const issued: string[] = [];
  let failNext = false;
  const live = (id: string) => {
    const w = widgets.get(id);
    if (w === undefined || !w.box.isConnected) throw new Error(`Cannot find Widget ${id}`);
    return w;
  };
  const api: Turnstile = {
    render: (box, options) => {
      if (!(box as unknown as Box).isConnected) throw new Error("container not in the page");
      const id = `w${++n}`;
      widgets.set(id, { box: box as unknown as Box, options });
      return id;
    },
    reset: (id) => void live(id),
    remove: (id) => void widgets.delete(id),
    execute: (id) => {
      const { options } = live(id);
      queueMicrotask(() => {
        if (failNext) {
          failNext = false;
          options["error-callback"]?.();
          return;
        }
        const token = `turnstile-${issued.length + 1}`;
        issued.push(token);
        options.callback(token);
      });
    },
  };
  return {
    api,
    widgets,
    issued,
    failOnce: () => void (failNext = true),
  };
}

/** The Worker's start and guess, refusing a Turnstile token it has seen before. */
function fakeServer() {
  const spent = new Set<string>();
  const starts: { status: number; turnstileToken: string }[] = [];
  let runs = 0;
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn: Fetch = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (url === "/api/run/start") {
      const turnstileToken = String(body.turnstileToken);
      if (spent.has(turnstileToken)) {
        starts.push({ status: 403, turnstileToken });
        return reply(403, { error: "verification_failed" });
      }
      spent.add(turnstileToken);
      starts.push({ status: 200, turnstileToken });
      runs += 1;
      return reply(200, { runId: `run-${runs}`, round: round(1), token: `progress-${runs}` });
    }
    if (url === "/api/round/guess") {
      return reply(200, {
        reveal: { round: 1, value: 20, display: "20", correct: false },
        end: "wrong",
        challenge: { runId: `run-${runs}`, score: 0, sig: "s" },
        result: `result-${runs}`,
      });
    }
    if (url === "/api/round/next") {
      if (body.runId === undefined) {
        runs += 1;
        return reply(200, { runId: `friendly-${runs}`, round: round(1) });
      }
      return reply(200, {
        reveal: { round: 1, value: 20, display: "20", correct: false },
        end: "wrong",
      });
    }
    return reply(404, { error: "not_found" });
  };
  return { fetchFn, starts };
}

let controller: GameController | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  controller?.destroy();
  controller = null;
  vi.useRealTimers();
});

/**
 * The game page: a controller, and the start panel's Turnstile box, which is
 * in the page only while the start panel is (idle and starting), and a new
 * element each time it mounts — as Game.svelte renders it.
 */
function page(mode: GameMode, { release = true } = {}) {
  const turnstile = fakeTurnstile();
  const server = fakeServer();
  let box: Box = { isConnected: true };
  const schedule = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  };
  const check = createHumanCheck(
    async () => turnstile.api,
    () => box as unknown as HTMLElement,
    "site-key",
    schedule,
  );
  const api =
    mode === "endless" ? createEndlessApi(server.fetchFn, check) : createApi(server.fetchFn);
  const c = new GameController({
    api,
    mode,
    timings: TIMINGS,
    now: () => Date.now(),
    schedule,
    reducedMotion: () => false,
  });
  let state!: GameState;
  c.subscribe((s) => {
    const panel = s.phase === "idle" || s.phase === "starting";
    if (panel && !box.isConnected) box = { isConnected: true };
    if (!panel && box.isConnected) {
      // Game.svelte releases the widget as the panel unmounts ({@attach}).
      if (release) check.release();
      box.isConnected = false;
    }
    state = s;
  });
  controller = c;
  return { c, turnstile, server, state: () => state };
}

/** Lets the fakes' promises and microtasks run. */
const flush = () => vi.advanceTimersByTimeAsync(0);

/** Advances the clock a little at a time until `done`, or gives up. */
async function until(done: () => boolean, ms = 30_000): Promise<boolean> {
  for (let t = 0; t < ms && !done(); t += 50) await vi.advanceTimersByTimeAsync(50);
  return done();
}

/** Start (or Play again), then answer round one wrong, to the game-over panel. */
async function playRun(p: ReturnType<typeof page>): Promise<void> {
  p.c.start();
  await flush();
  expect(await until(() => p.state().phase === "awaiting"), `phase ${p.state().phase}`).toBe(true);
  p.c.guess("lower");
  expect(await until(() => p.state().phase === "over")).toBe(true);
}

describe("Endless: a new run on the same page", () => {
  it("starts again with Play again, with a fresh Turnstile token", async () => {
    const p = page("endless");
    await playRun(p);
    await playRun(p);
    expect(p.state()).toMatchObject({ phase: "over", startFailed: false, runId: "run-2" });
    expect(p.server.starts).toEqual([
      { status: 200, turnstileToken: "turnstile-1" },
      { status: 200, turnstileToken: "turnstile-2" },
    ]);
  });

  it("plays three runs in a row, each its own token, clean of the last", async () => {
    const p = page("endless");
    for (let i = 1; i <= 3; i += 1) {
      await playRun(p);
      expect(p.state()).toMatchObject({ phase: "over", runId: `run-${i}`, end: "wrong" });
      expect(p.state().history).toHaveLength(1);
    }
    const tokens = p.server.starts.map((s) => s.turnstileToken);
    expect(new Set(tokens).size).toBe(3);
    expect(p.server.starts.every((s) => s.status === 200)).toBe(true);
    // Each panel's widget went with it: none left behind.
    expect(p.turnstile.widgets.size).toBe(0);
  });

  it("still renders afresh if the panel's element went before the widget was released", async () => {
    const p = page("endless", { release: false });
    for (let i = 1; i <= 3; i += 1) await playRun(p);
    expect(p.server.starts.map((s) => s.status)).toEqual([200, 200, 200]);
    expect(new Set(p.server.starts.map((s) => s.turnstileToken)).size).toBe(3);
  });

  it("recovers from a failed Turnstile check when Start is pressed again", async () => {
    const p = page("endless");
    p.turnstile.failOnce();
    p.c.start();
    await flush();
    expect(await until(() => p.state().phase === "idle")).toBe(true);
    expect(p.state()).toMatchObject({ startFailed: true, checkFailed: true });
    expect(p.server.starts).toHaveLength(0);

    await playRun(p);
    expect(p.state()).toMatchObject({ phase: "over", startFailed: false });
    expect(p.server.starts).toEqual([{ status: 200, turnstileToken: "turnstile-1" }]);
  });

  it("recovers on Play again after a failed check, too", async () => {
    const p = page("endless");
    await playRun(p);
    p.turnstile.failOnce();
    p.c.start();
    await flush();
    expect(await until(() => p.state().phase === "idle")).toBe(true);
    expect(p.state().checkFailed).toBe(true);
    await playRun(p);
    expect(p.state()).toMatchObject({ phase: "over", runId: "run-2" });
  });

  it("would fail as it did before, if the old widget were reset in place", () => {
    // The fake behaves like the browser: the first panel's widget is gone with it.
    const t = fakeTurnstile();
    const first = { isConnected: true };
    const id = t.api.render(first as unknown as HTMLElement, {
      sitekey: "k",
      callback: () => {},
    });
    first.isConnected = false;
    expect(() => t.api.reset(id ?? "")).toThrow(/Cannot find Widget/);
  });
});

describe("Friendly: Play again", () => {
  it("still starts a new run, with no Turnstile", async () => {
    const p = page("friendly");
    await playRun(p);
    await playRun(p);
    expect(p.state()).toMatchObject({ phase: "over", runId: "friendly-2", startFailed: false });
    expect(p.turnstile.issued).toHaveLength(0);
  });
});
