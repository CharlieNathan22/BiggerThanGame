/**
 * Twitch Mode through the controller and the stream API (stream/api.ts),
 * against fakes that behave like the real things — Turnstile's widgets in the
 * setup panel, the server spending each Turnstile token once — as
 * play-again.test.ts does for Endless:
 *
 * - the streamer's pick is locked in and goes only when the window closes,
 *   with chat's count beside it; no pick goes as a timeout;
 * - End voting closes the window early, from 8 seconds, never on 10;
 * - a match plays on through wrong answers to its last question;
 * - Play again, Change questions and Change channel each start a new match on
 *   the same page load, each with a fresh Turnstile token.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fetch } from "../api";
import { GameController } from "../controller";
import type { GameState } from "../machine";
import { createStreamApi } from "../stream/api";
import type { MatchRequest } from "../stream/api";
import { VoteBox } from "../stream/votes";
import { TIMINGS } from "../timing";
import { createHumanCheck } from "../turnstile";
import type { Turnstile, TurnstileOptions } from "../turnstile";
import { round } from "./fixtures";

interface Box {
  isConnected: boolean;
}

function fakeTurnstile() {
  let n = 0;
  const widgets = new Map<string, { box: Box; options: TurnstileOptions }>();
  let issued = 0;
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
      queueMicrotask(() => options.callback(`turnstile-${++issued}`));
    },
  };
  return { api, widgets };
}

/** The Worker, for matches: each Turnstile token once, every answer going on to the last. */
function fakeServer() {
  const spent = new Set<string>();
  const starts: { status: number; body: Record<string, unknown> }[] = [];
  const guesses: Record<string, unknown>[] = [];
  let matches = 0;
  let questions = 10;
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn: Fetch = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (url === "/api/run/start") {
      const token = String(body.turnstileToken);
      if (spent.has(token)) {
        starts.push({ status: 403, body });
        return reply(403, { error: "verification_failed" });
      }
      spent.add(token);
      starts.push({ status: 200, body });
      matches += 1;
      questions = Number(body.questions);
      return reply(200, {
        runId: `match-${matches}`,
        round: round(1, { anchorValue: 50 }),
        token: `t-${matches}-1`,
        questions,
        limit: body.limit,
      });
    }
    if (url === "/api/round/guess") {
      guesses.push(body);
      const at = Number(String(body.token).split("-")[2]);
      // Every challenger has 80 against the anchor's 50: higher is right.
      const reveal = { round: at, value: 80, display: "80", correct: body.guess === "higher" };
      if (at >= questions) return reply(200, { reveal, end: "finished", score: 0 });
      return reply(200, {
        reveal,
        next: round(at + 1, { anchorValue: 50 }),
        token: `t-${matches}-${at + 1}`,
      });
    }
    return reply(404, { error: "not_found" });
  };
  return { fetchFn, starts, guesses };
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
 * The Twitch Mode page: a controller, the setup panel's Turnstile box (in the
 * page while the setup is: idle, starting, and from full time while editing,
 * a new element each time it mounts), and chat's vote box.
 */
function page() {
  const turnstile = fakeTurnstile();
  const server = fakeServer();
  const votes = new VoteBox();
  let settings: MatchRequest = { pool: "endless", questions: 10, limit: 30 };
  let editing = false;
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
  const api = createStreamApi(
    server.fetchFn,
    check,
    () => settings,
    () => {
      votes.close();
      return votes.result();
    },
  );
  const c = new GameController({
    api,
    mode: "stream",
    timings: TIMINGS,
    now: () => Date.now(),
    schedule,
    reducedMotion: () => false,
  });
  let state!: GameState;
  let opened = 0;
  c.subscribe((s) => {
    const panel = s.phase === "idle" || s.phase === "starting" || (s.phase === "over" && editing);
    if (panel && !box.isConnected) box = { isConnected: true };
    if (!panel && box.isConnected) {
      check.release();
      box.isConnected = false;
    }
    if (s.phase === "starting") editing = false;
    // The island opens voting as each question becomes answerable.
    if (s.phase === "awaiting" && s.clock !== null && opened !== s.round?.index) {
      votes.open();
      opened = s.round?.index ?? 0;
    }
    state = s;
  });
  controller = c;
  return {
    c,
    server,
    turnstile,
    votes,
    state: () => state,
    edit: (next: Partial<MatchRequest>) => {
      settings = { ...settings, ...next };
      editing = true;
      // The setup panel mounts again, with its new box.
      box = { isConnected: true };
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

async function until(done: () => boolean, ms = 120_000): Promise<boolean> {
  for (let t = 0; t < ms && !done(); t += 50) await vi.advanceTimersByTimeAsync(50);
  return done();
}

/** Starts a match, then answers every question with `answer`, to full time. */
async function playMatch(
  p: ReturnType<typeof page>,
  answer: (index: number) => "higher" | "lower" | "none" = () => "higher",
): Promise<void> {
  p.c.start();
  await flush();
  while (p.state().phase !== "over") {
    expect(await until(() => p.state().phase === "awaiting" || p.state().phase === "over")).toBe(
      true,
    );
    if (p.state().phase === "over") break;
    const index = p.state().round?.index ?? 0;
    const pick = answer(index);
    if (pick !== "none") p.c.guess(pick);
    // The window runs out on its own: the pick (or a timeout) goes then.
    expect(await until(() => p.state().phase !== "awaiting")).toBe(true);
  }
}

describe("a match through the controller", () => {
  it("sends the locked pick only when the window closes, with chat's count", async () => {
    const p = page();
    p.c.start();
    await flush();
    expect(await until(() => p.state().phase === "awaiting")).toBe(true);
    p.votes.add("1", "lower");
    p.votes.add("2", "lower");
    p.votes.add("3", "higher");
    p.c.guess("higher");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.state()).toMatchObject({ phase: "awaiting", locked: "higher" });
    expect(p.server.guesses).toHaveLength(0);
    // A vote after the window has closed is no vote.
    expect(await until(() => p.server.guesses.length === 1)).toBe(true);
    p.votes.add("4", "higher");
    expect(p.server.guesses[0]).toEqual({
      token: "t-1-1",
      guess: "higher",
      chat: { pick: "lower", voters: 3 },
    });
  });

  it("sends a timeout when the window closes with no pick", async () => {
    const p = page();
    p.c.start();
    await flush();
    expect(await until(() => p.state().phase === "awaiting")).toBe(true);
    expect(await until(() => p.server.guesses.length === 1)).toBe(true);
    expect(p.server.guesses[0]).toMatchObject({
      guess: "timeout",
      chat: { pick: "none", voters: 0 },
    });
  });

  it("closes the window early with End voting, from 8 seconds", async () => {
    const p = page();
    p.c.start();
    await flush();
    expect(await until(() => p.state().phase === "awaiting")).toBe(true);
    p.c.guess("lower");
    await vi.advanceTimersByTimeAsync(7_000);
    p.c.endVoting();
    expect(p.state().phase).toBe("awaiting");
    await vi.advanceTimersByTimeAsync(1_000);
    p.c.endVoting();
    expect(p.state()).toMatchObject({ phase: "revealing", guess: "lower" });
  });

  it("never offers End voting on the 10-second timer", async () => {
    const p = page();
    p.edit({ limit: 10 });
    p.c.start();
    await flush();
    expect(await until(() => p.state().phase === "awaiting")).toBe(true);
    await vi.advanceTimersByTimeAsync(9_000);
    p.c.endVoting();
    expect(p.state().phase).toBe("awaiting");
  });

  it("plays on through wrong answers and timeouts to its last question", async () => {
    const p = page();
    await playMatch(p, (i) => (i % 3 === 0 ? "lower" : i % 3 === 1 ? "higher" : "none"));
    expect(p.state()).toMatchObject({ phase: "over", end: "finished" });
    expect(p.server.guesses).toHaveLength(10);
    expect(p.state().history.map((r) => r.correct)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i + 1) % 3 === 1),
    );
  });
});

describe("Twitch Mode: a new match on the same page", () => {
  it("plays two matches in a row with Play again, each with a fresh Turnstile token", async () => {
    const p = page();
    await playMatch(p);
    await playMatch(p);
    expect(p.state()).toMatchObject({ phase: "over", runId: "match-2", startFailed: false });
    expect(p.server.starts.map((s) => [s.status, s.body.turnstileToken])).toEqual([
      [200, "turnstile-1"],
      [200, "turnstile-2"],
    ]);
    expect(p.turnstile.widgets.size).toBe(0);
  });

  it("starts again from Change questions and Change channel, each with a fresh token", async () => {
    const p = page();
    await playMatch(p);
    // Change questions: a 20-question match on another pool.
    p.edit({ pool: "squad:club-barcelona", questions: 20 });
    await playMatch(p);
    expect(p.server.starts[1]?.body).toMatchObject({
      mode: "stream",
      pool: "squad:club-barcelona",
      questions: 20,
      limit: 30,
    });
    expect(p.server.guesses).toHaveLength(30);
    // Change channel: the same settings, a new match.
    p.edit({});
    await playMatch(p);
    expect(p.server.starts.map((s) => s.status)).toEqual([200, 200, 200]);
    expect(new Set(p.server.starts.map((s) => s.body.turnstileToken)).size).toBe(3);
    expect(p.state()).toMatchObject({ phase: "over", runId: "match-3" });
  });
});
