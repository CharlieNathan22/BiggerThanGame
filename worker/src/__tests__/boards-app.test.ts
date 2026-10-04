/**
 * Publishing, the boards and the nightly job through the HTTP layer
 * (`createApp`): routing, methods, the submissions limit, configuration,
 * failures and their log lines, and a whole run from start to the board.
 */

import { describe, expect, it, vi } from "vitest";
import type {
  BoardResponse,
  GuessResponse,
  RoundPayload,
  RunStartResponse,
  SubmitResponse,
} from "@bt/core";
import { BOARD_PATH, GUESS_PATH, RUN_START_PATH, SUBMIT_PATH, createApp } from "../app.js";
import type { Env } from "../app.js";
import type { BoardCache } from "../board.js";
import type { LogLine } from "../log.js";
import { RATE_LIMITS } from "../rate-limit.js";
import type { D1Like } from "../scores.js";
import { THINK_FLOOR_MS } from "../shadow.js";
import { sqliteD1 } from "./d1-sqlite.js";
import type { TestD1 } from "./d1-sqlite.js";
import { fakeRuns } from "./endless-helpers.js";
import { SAMPLE_DECK, SECRET, TODAY, correctGuess, uuidFrom, wrongGuess } from "./helpers.js";

const DEVICE = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";

function setup(over: { db?: D1Like; cache?: BoardCache; submits?: boolean } = {}) {
  let now = TODAY.getTime();
  let n = 0;
  const lines: LogLine[] = [];
  const db = over.db ?? sqliteD1();
  const app = createApp({
    deck: SAMPLE_DECK,
    images: {},
    clock: () => new Date(now),
    uuid: () => uuidFrom(++n),
    log: (line) => lines.push(line),
    fetch: async () => new Response(JSON.stringify({ success: true })),
    cache: () => over.cache,
  });
  const allow = { limit: vi.fn(async () => ({ success: true })) };
  const env: Env = {
    ASSETS: { fetch: vi.fn(async () => new Response("site")) },
    RUN_SECRET: SECRET,
    TURNSTILE_SECRET: "turnstile-secret",
    RUN_ANSWERS: allow,
    RUN_STARTS: allow,
    ROUND_FLOOD: allow,
    FEEDBACK_SENDS: allow,
    FEEDBACK_EMAIL: { send: vi.fn(async () => ({})) },
    RUNS: fakeRuns(),
    DB: db,
    RUN_SUBMITS: { limit: vi.fn(async () => ({ success: over.submits ?? true })) },
  };
  const call = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    app.fetch(
      new Request(`https://biggerthangame.com${path}`, {
        method,
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  return {
    app,
    env,
    db,
    lines,
    call,
    wait: (ms: number) => void (now += ms),
  };
}

type Setup = ReturnType<typeof setup>;

/** A run with `right` right answers at a person's pace, then a wrong one; its result token. */
async function playRun(s: Setup, right: number): Promise<string> {
  const started = (await (
    await s.call(RUN_START_PATH, { mode: "endless", turnstileToken: "t" })
  ).json()) as RunStartResponse;
  let round: RoundPayload = started.round;
  let token = started.token;
  for (let i = 1; ; i += 1) {
    s.wait(THINK_FLOOR_MS + 1500 + ((i * 733) % 2500));
    const good = correctGuess(SAMPLE_DECK, started.runId, round);
    const res = (await (
      await s.call(GUESS_PATH, { token, guess: i > right ? wrongGuess(good) : good })
    ).json()) as GuessResponse;
    if (!("next" in res)) return res.result;
    round = res.next;
    token = res.token;
  }
}

const submitBody = (token: string, nickname = "SwiftVolley42") => ({
  token,
  nickname,
  deviceId: DEVICE,
  turnstileToken: "t",
});

describe("POST /api/run/submit", () => {
  it("publishes a run, and the board shows it", async () => {
    const s = setup();
    const result = await playRun(s, 6);
    const res = await s.call(SUBMIT_PATH, submitBody(result));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as SubmitResponse;
    expect(body.periods.day).toMatchObject({ rank: 1, total: 1, best: 6, improved: true });

    const board = (await (await s.call(`${BOARD_PATH}/day`)).json()) as BoardResponse;
    expect(board.entries).toEqual([{ id: body.id, rank: 1, nickname: "SwiftVolley42", streak: 6 }]);
    // One info line for the publish, with no nickname in it.
    const line = s.lines.find((l) => l.event === "run_submit");
    expect(line).toMatchObject({ level: "info", message: "run_submit", score: 6, shadowed: "no" });
    expect(JSON.stringify(s.lines)).not.toContain("SwiftVolley42");
  });

  it("answers the submissions limit with a calm 429 and its retry-after", async () => {
    const s = setup({ submits: false });
    const res = await s.call(SUBMIT_PATH, submitBody("anything"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(RATE_LIMITS.submits.period));
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(s.lines.at(-1)).toMatchObject({
      level: "warn",
      event: "rate_limited",
      reason: "submits",
    });
  });

  it("refuses anything but POST", async () => {
    const res = await setup().call(SUBMIT_PATH, undefined, "GET");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("fails closed without D1, the run store, the limiter or a secret", async () => {
    for (const missing of [
      "DB",
      "RUNS",
      "RUN_SUBMITS",
      "TURNSTILE_SECRET",
      "RUN_SECRET",
    ] as const) {
      const s = setup();
      delete (s.env as unknown as Record<string, unknown>)[missing];
      const res = await s.call(SUBMIT_PATH, submitBody("x"));
      expect(res.status, missing).toBe(500);
      expect(s.lines.at(-1)).toMatchObject({ level: "error", reason: "not_configured" });
      expect(String(s.lines.at(-1)?.cause)).toContain(missing);
    }
  });

  it("answers a calm 503 and logs an error when D1 fails", async () => {
    const real = sqliteD1();
    let broken = false;
    const flaky: D1Like = {
      prepare: (sql) => {
        if (broken) throw new Error("D1_ERROR: storage unavailable");
        return real.prepare(sql);
      },
      batch: (x) => real.batch(x),
    };
    const s = setup({ db: flaky });
    const result = await playRun(s, 3);
    broken = true;
    const res = await s.call(SUBMIT_PATH, submitBody(result));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable", detail: "scores" });
    expect(s.lines.at(-1)).toMatchObject({
      level: "error",
      event: "unavailable",
      reason: "scores",
    });
  });

  it("answers a calm 422 for a blocked name", async () => {
    const s = setup();
    const result = await playRun(s, 3);
    const res = await s.call(SUBMIT_PATH, submitBody(result, "Moderator"));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "nickname_rejected" });
    // The log says why, never the name.
    expect(s.lines.at(-1)).toMatchObject({ level: "warn", reason: "nickname_blocked" });
    expect(JSON.stringify(s.lines)).not.toContain("Moderator");
  });
});

describe("GET /api/board/endless/:period", () => {
  it("serves each period, and 404s anything else", async () => {
    const s = setup();
    for (const period of ["day", "week", "month"]) {
      const res = await s.call(`${BOARD_PATH}/${period}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=60");
      expect(((await res.json()) as BoardResponse).period).toBe(period);
    }
    expect((await s.call(`${BOARD_PATH}/year`)).status).toBe(404);
    expect((await s.call(`${BOARD_PATH}/day/2026-09-18`)).status).toBe(404);
  });

  it("refuses anything but GET", async () => {
    const res = await setup().call(`${BOARD_PATH}/day`, {});
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("serves a cache hit without reading D1", async () => {
    const store = new Map<string, Response>();
    const cache: BoardCache = {
      match: async (req) => store.get(req.url)?.clone(),
      put: async (req, res) => void store.set(req.url, res),
    };
    const db = sqliteD1();
    const s = setup({ db, cache });
    await s.call(`${BOARD_PATH}/day`);
    const before = (db as TestD1).queries;
    expect((await s.call(`${BOARD_PATH}/day`)).status).toBe(200);
    expect((db as TestD1).queries).toBe(before);
  });

  it("logs a cache failure as an error and serves from D1", async () => {
    const cache: BoardCache = {
      match: async () => {
        throw new Error("cache down");
      },
      put: async () => {},
    };
    const s = setup({ cache });
    expect((await s.call(`${BOARD_PATH}/day`)).status).toBe(200);
    expect(s.lines).toContainEqual(
      expect.objectContaining({ level: "error", reason: "board_cache" }),
    );
  });

  it("answers 503 when D1 fails", async () => {
    const s = setup({
      db: {
        prepare: () => {
          throw new Error("D1_ERROR");
        },
        batch: async () => [],
      },
    });
    const res = await s.call(`${BOARD_PATH}/week`);
    expect(res.status).toBe(503);
    expect(s.lines.at(-1)).toMatchObject({ level: "error", reason: "scores" });
  });
});

describe("the scheduled handler", () => {
  it("snapshots yesterday and logs what it did", async () => {
    const s = setup();
    const result = await playRun(s, 4);
    await s.call(SUBMIT_PATH, submitBody(result));
    await s.app.scheduled(
      { scheduledTime: Date.parse("2026-09-20T00:00:00Z"), cron: "0 0 * * *" },
      s.env,
    );
    expect(s.lines.at(-1)).toMatchObject({
      level: "info",
      message: "nightly",
      snapshots: ["day:2026-09-19"],
      pruned: 0,
    });
    const board = (await (await s.call(`${BOARD_PATH}/day`)).json()) as BoardResponse;
    expect(board.previous).toEqual({
      key: "2026-09-18",
      winner: null,
    });
  });

  it("logs an error and throws when D1 fails, so the run shows as failed", async () => {
    const s = setup({
      db: {
        prepare: () => {
          throw new Error("D1_ERROR");
        },
        batch: async () => [],
      },
    });
    await expect(
      s.app.scheduled(
        { scheduledTime: Date.parse("2026-09-20T00:00:00Z"), cron: "0 0 * * *" },
        s.env,
      ),
    ).rejects.toThrow("D1_ERROR");
    expect(s.lines.at(-1)).toMatchObject({ level: "error", reason: "cron" });
  });
});
