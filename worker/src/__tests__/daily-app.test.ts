/**
 * Daily Ranked through the HTTP layer (`createApp`): the start and the guess
 * beside Endless's on the same routes, resume, the board and `/me`, the leave
 * beacon and a correction, the data points, and configuration — then the
 * response-shape check over many whole Daily runs: no stored round, hidden
 * figure or player ever reaches a response.
 */

import { describe, expect, it, vi } from "vitest";
import type {
  DailyBoardResponse,
  DailyGuessResponse,
  DailyMineResponse,
  DailyResumeResponse,
  DailyStartResponse,
  RoundPayload,
  RunStartResponse,
} from "@bt/core";
import { scanForLeakedValues } from "@bt/deck";
import {
  DAILY_BOARD_PATH,
  DAILY_MINE_PATH,
  FEEDBACK_PATH,
  GUESS_PATH,
  LEAVE_PATH,
  RESUME_PATH,
  RUN_START_PATH,
  SUBMIT_PATH,
  createApp,
} from "../app.js";
import type { Env } from "../app.js";
import type { DataPoint } from "../analytics.js";
import { readDailyGame } from "../daily-game.js";
import type { DailyGame } from "../daily-game.js";
import type { LogLine } from "../log.js";
import { verifyDailyToken } from "../token.js";
import { sqliteD1 } from "./d1-sqlite.js";
import type { TestD1 } from "./d1-sqlite.js";
import { fakeRuns } from "./endless-helpers.js";
import { DEVICE_A, DEVICE_B, EPOCH, onGame } from "./daily-helpers.js";
import { SAMPLE_DECK, SECRET, correctGuess, fakeImages, uuidFrom } from "./helpers.js";

function setup(at = onGame(3)) {
  let now = at;
  let n = 0;
  const lines: LogLine[] = [];
  const points: DataPoint[] = [];
  const sent: string[] = [];
  const db: TestD1 = sqliteD1();
  const app = createApp({
    deck: SAMPLE_DECK,
    images: fakeImages(SAMPLE_DECK),
    clock: () => new Date(now),
    uuid: () => uuidFrom(++n),
    log: (line) => lines.push(line),
    fetch: async () => new Response(JSON.stringify({ success: true })),
    emailMessage: (from, to, raw) => {
      sent.push(raw);
      return { from, to };
    },
    epoch: EPOCH,
  });
  const allow = { limit: vi.fn(async () => ({ success: true })) };
  const env: Env = {
    ASSETS: { fetch: vi.fn(async () => new Response("site")) },
    RUN_SECRET: SECRET,
    TURNSTILE_SECRET: "turnstile-secret",
    FEEDBACK_TO: "owner@example.com",
    RUN_ANSWERS: allow,
    RUN_STARTS: allow,
    ROUND_FLOOD: allow,
    FEEDBACK_SENDS: allow,
    RUN_SUBMITS: allow,
    BOARD_LOOKUPS: allow,
    FEEDBACK_EMAIL: { send: vi.fn(async () => ({})) },
    GAME_EVENTS: { writeDataPoint: (p) => points.push(p) },
    RUNS: fakeRuns(),
    DB: db,
  };
  return {
    app,
    env,
    db,
    lines,
    points,
    wait: (ms: number) => (now += ms),
    set: (ms: number) => (now = ms),
    fetch: (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
      app.fetch(
        new Request(`https://biggerthangame.com${path}`, {
          method,
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
        env,
      ),
  };
}

const start = (nickname = "SwiftVolley42", deviceId = DEVICE_A) => ({
  mode: "ranked",
  nickname,
  showCountry: true,
  deviceId,
  turnstileToken: "t",
});

function right(game: DailyGame, round: number): "higher" | "lower" {
  const r = game.rounds[round - 1]!;
  return r.challenger.value > r.anchor.value ? "higher" : "lower";
}

describe("the Daily endpoints", () => {
  it("start a Daily run and take its guesses on the shared routes", async () => {
    const s = setup();
    const res = await s.fetch(RUN_START_PATH, start());
    expect(res.status).toBe(200);
    const started = (await res.json()) as DailyStartResponse;
    expect(started.gameNo).toBe(3);
    const game = (await readDailyGame(s.db, 3, EPOCH))!;
    s.wait(5000);
    const answered = await s.fetch(GUESS_PATH, { token: started.token, guess: right(game, 1) });
    expect(answered.status).toBe(200);
    expect(((await answered.json()) as DailyGuessResponse).reveal.correct).toBe(true);
  });

  it("leave Endless's start and guess as they were", async () => {
    const s = setup();
    const res = await s.fetch(RUN_START_PATH, { mode: "endless", turnstileToken: "t" });
    expect(res.status).toBe(200);
    const started = (await res.json()) as RunStartResponse;
    const guess = correctGuess(SAMPLE_DECK, started.runId, started.round);
    expect((await s.fetch(GUESS_PATH, { token: started.token, guess })).status).toBe(200);
  });

  it("answer a taken name and a second start the same day with 409s", async () => {
    const s = setup();
    expect((await s.fetch(RUN_START_PATH, start("TakenName", DEVICE_A))).status).toBe(200);
    const taken = await s.fetch(RUN_START_PATH, start("TakenName", DEVICE_B));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "conflict", detail: "name_taken" });
    const again = await s.fetch(RUN_START_PATH, start("Another", DEVICE_A));
    expect(await again.json()).toEqual({ error: "conflict", detail: "already_played" });
  });

  it("resume, and serve the board and /me", async () => {
    const s = setup();
    const started = (await (await s.fetch(RUN_START_PATH, start())).json()) as DailyStartResponse;
    s.wait(2000);
    const resumed = (await (
      await s.fetch(RESUME_PATH, { deviceId: DEVICE_A })
    ).json()) as DailyResumeResponse;
    expect(resumed).toMatchObject({ state: "playing", runId: started.runId });

    const me = (await (
      await s.fetch(DAILY_MINE_PATH, { deviceId: DEVICE_A })
    ).json()) as DailyMineResponse;
    expect(me).toMatchObject({ state: "playing", gameNo: 3, nickname: "SwiftVolley42" });

    const board = await s.fetch(DAILY_BOARD_PATH);
    expect(board.status).toBe(200);
    expect(board.headers.get("cache-control")).toBe("public, max-age=60");
    const body = (await board.json()) as DailyBoardResponse;
    expect(body).toMatchObject({ mode: "ranked", gameNo: 3, total: 0, entries: [] });
  });

  it("refuse the wrong methods", async () => {
    const s = setup();
    expect((await s.fetch(RESUME_PATH, undefined, "GET")).status).toBe(405);
    expect((await s.fetch(DAILY_MINE_PATH, undefined, "GET")).status).toBe(405);
    expect((await s.fetch(DAILY_BOARD_PATH, {}, "POST")).status).toBe(405);
  });

  it("fail closed without D1", async () => {
    const s = setup();
    delete (s.env as { DB?: unknown }).DB;
    expect((await s.fetch(RUN_START_PATH, start())).status).toBe(500);
    expect((await s.fetch(RESUME_PATH, { deviceId: DEVICE_A })).status).toBe(500);
  });

  it("record the start, answers and end as ranked, with the game number", async () => {
    const s = setup();
    const started = (await (await s.fetch(RUN_START_PATH, start())).json()) as DailyStartResponse;
    const game = (await readDailyGame(s.db, 3, EPOCH))!;
    let token = started.token;
    for (let r = 1; r <= 20; r++) {
      s.wait(5000 + ((r * 733) % 1900));
      const res = (await (
        await s.fetch(GUESS_PATH, { token, guess: r === 3 ? "timeout" : right(game, r) })
      ).json()) as DailyGuessResponse;
      if ("token" in res) token = res.token;
    }
    const starts = s.points.filter((p) => p.blobs[0] === "start");
    expect(starts[0]!.blobs[1]).toBe("ranked");
    expect(starts[0]!.doubles).toEqual([3, 0]);
    const end = s.points.find((p) => p.blobs[0] === "end")!;
    expect(end.blobs[5]).toBe("finished");
    expect(end.doubles).toEqual([19, 3, 19, 0]);
    expect(s.points.some((p) => p.blobs[0] === "submit")).toBe(true);
    const runStart = s.lines.find((l) => l.event === "run_start")!;
    expect(runStart).toMatchObject({ mode: "ranked", gameNo: 3, repeatFromConnection: 0 });
  });

  it("take the leave beacon and a correction for a Daily run", async () => {
    const s = setup();
    const started = (await (await s.fetch(RUN_START_PATH, start())).json()) as DailyStartResponse;
    const leave = await s.fetch(LEAVE_PATH, {
      mode: "ranked",
      runId: started.runId,
      round: 1,
      phase: "question",
      trigger: "hidden",
    });
    expect(leave.status).toBe(204);
    const line = s.lines.find((l) => l.event === "run_leave")!;
    expect(line).toMatchObject({ mode: "ranked", gameNo: 3, round: 1 });
    const correction = await s.fetch(FEEDBACK_PATH, {
      kind: "correction",
      mode: "ranked",
      runId: started.runId,
      round: 1,
      turnstileToken: "t",
    });
    expect(correction.status).toBe(200);
  });

  it("never publish a Daily run through the Endless submit", async () => {
    const s = setup();
    const started = (await (await s.fetch(RUN_START_PATH, start())).json()) as DailyStartResponse;
    const res = await s.fetch(SUBMIT_PATH, {
      token: started.token,
      nickname: "Someone",
      deviceId: DEVICE_A,
      turnstileToken: "t",
      showCountry: true,
    });
    expect(res.status).toBe(400);
  });
});

// ------------------------------------------------------------ response shape

const CARD_KEYS = ["country", "id", "image", "name", "position"];
const ANCHOR_KEYS = [...CARD_KEYS, "display", "qualifier", "value"];
const ROUND_KEYS = ["anchor", "challenger", "index", "stat", "upcoming"];
const REVEAL_KEYS = ["correct", "display", "qualifier", "round", "value"];
const RESULT_KEYS = [
  "bonus",
  "correct",
  "end",
  "gameNo",
  "nickname",
  "rank",
  "results",
  "score",
  "total",
];
const SHOWN_FIELDS = new Set([
  "value",
  "display",
  "qualifier",
  "index",
  "round",
  "width",
  "height",
  "key",
  "runId",
  "focus",
  "token",
  "gameNo",
  "score",
  "correct",
  "bonus",
  "rank",
  "total",
  "remainingMs",
  "nextGameAt",
  "thinkMs",
  // The player's own nickname ("Player10").
  "nickname",
]);
/** Where a number may appear in a Daily response. */
const NUMERIC_PATHS = [
  /^gameNo$/,
  // The board's own: the countdown, the total, the previous game's winner.
  /^(nextGameAt|total)$/,
  /^previous\.gameNo$/,
  /^previous\.winner\.(score|bonus)$/,
  /^remainingMs$/,
  /^(round|next)\.index$/,
  /^(round|next)\.anchor\.value$/,
  /^(round|next)\.(anchor|challenger)\.image\.(width|height)$/,
  /^(round|next)\.upcoming\.(width|height)$/,
  /^reveal\.(round|value)$/,
  /^result\.(gameNo|score|correct|bonus|rank|total)$/,
];

function numericLeaves(value: unknown, path = ""): { path: string }[] {
  if (typeof value === "number") return [{ path }];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([k, v]) =>
    numericLeaves(v, path === "" ? k : `${path}.${k}`),
  );
}

function allKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
}

function checkRound(round: RoundPayload, game: DailyGame): void {
  for (const k of Object.keys(round)) expect(ROUND_KEYS).toContain(k);
  for (const k of Object.keys(round.anchor)) expect(ANCHOR_KEYS).toContain(k);
  for (const k of Object.keys(round.challenger)) expect(CARD_KEYS).toContain(k);
  const stored = game.rounds[round.index - 1]!;
  expect(round.anchor.value).toBe(stored.anchor.value);
  expect(round.challenger).not.toHaveProperty("value");
  expect(round.challenger).not.toHaveProperty("display");
}

async function checkResponse(response: object, game: DailyGame, now: Date): Promise<void> {
  const keys = allKeys(response);
  for (const forbidden of [
    "stats",
    "dob",
    "band",
    "relaxation",
    "distance",
    "statChangedAt",
    "rounds",
  ]) {
    expect(keys).not.toContain(forbidden);
  }
  for (const leaf of numericLeaves(response)) {
    expect(
      NUMERIC_PATHS.some((p) => p.test(leaf.path)),
      `number at ${leaf.path}`,
    ).toBe(true);
  }
  const stripped = JSON.stringify(response, (k, v: unknown) => (SHOWN_FIELDS.has(k) ? null : v));
  expect(scanForLeakedValues(stripped, SAMPLE_DECK, now, "daily response")).toEqual([]);
  // No stored round's challenger figure anywhere it hasn't been revealed.
  if ("round" in response) checkRound((response as { round: RoundPayload }).round, game);
  if ("next" in response) checkRound((response as { next: RoundPayload }).next, game);
  if ("reveal" in response) {
    for (const k of Object.keys((response as { reveal: object }).reveal))
      expect(REVEAL_KEYS).toContain(k);
  }
  if ("result" in response) {
    for (const k of Object.keys((response as { result: object }).result))
      expect(RESULT_KEYS).toContain(k);
  }
  if ("token" in response) {
    const payload = await verifyDailyToken(SECRET, (response as { token: string }).token);
    expect(payload).toBeDefined();
    const stored = game.rounds[payload!.round - 1]!;
    expect(JSON.stringify(payload)).not.toContain(`"challengerValue"`);
    expect(payload!.anchorValue).toBe(stored.anchor.value);
  }
}

describe("Daily responses", () => {
  it("never carry a hidden value, a stored round or a player, across many whole runs and resumes", async () => {
    let checked = 0;
    for (let i = 0; i < 12; i++) {
      const s = setup(onGame(1 + (i % 4)));
      const device = `0000000${i % 10}-1111-4111-8111-111111111111`;
      const res = await s.fetch(RUN_START_PATH, start(`Player${i}`, device));
      const started = (await res.json()) as DailyStartResponse;
      const game = (await readDailyGame(s.db, started.gameNo, EPOCH))!;
      const now = new Date(EPOCH + (started.gameNo - 1) * 86_400_000);
      await checkResponse(started, game, now);
      let token: string | undefined = started.token;
      let round = 1;
      while (token !== undefined) {
        s.wait(4500 + ((round * 977) % 2500));
        // Every few questions, a refresh.
        if (round % 6 === i % 6) {
          const resumed = (await (
            await s.fetch(RESUME_PATH, { deviceId: device })
          ).json()) as DailyResumeResponse;
          await checkResponse(resumed, game, now);
          if (resumed.state !== "playing") break;
          token = resumed.token;
          round = resumed.round.index;
        }
        const guess =
          (round + i) % 7 === 0 ? "timeout" : round <= 20 + (i % 3) ? right(game, round) : "lower";
        const answered = (await (
          await s.fetch(GUESS_PATH, { token, guess })
        ).json()) as DailyGuessResponse;
        await checkResponse(answered, game, now);
        checked += 1;
        token = "token" in answered ? answered.token : undefined;
        round += 1;
      }
      const board = (await (await s.fetch(DAILY_BOARD_PATH)).json()) as DailyBoardResponse;
      await checkResponse(board, game, now);
      const me = (await (
        await s.fetch(DAILY_MINE_PATH, { deviceId: device })
      ).json()) as DailyMineResponse;
      expect(JSON.stringify(me)).not.toContain("device");
    }
    expect(checked).toBeGreaterThan(200);
  }, 120_000);
});
