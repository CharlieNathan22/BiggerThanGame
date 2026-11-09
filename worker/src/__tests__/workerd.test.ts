/**
 * Endless and Daily Ranked under workerd: the real app and the real,
 * SQLite-backed Durable Object, through wrangler's test harness
 * (worker/test/entry.ts). What the Node tests can only fake: a nonce spent
 * once in real storage, the resend rule, the alarm closing a silent run (and
 * finishing and posting a quiet Daily one into D1), whole runs over HTTP, and
 * the same seed dealing the same run here as in Node. And 1v1's rooms: the
 * real `RoomDO`, a whole match over two real WebSockets with a disconnect and
 * a rejoin, a seat taken over, and the alarm closing a question and a room.
 *
 * Slower than the rest (the Worker is bundled and workerd started once).
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DAILY_QUESTIONS,
  IDLE_FINISH_MS,
  ROOM_IDLE_MS,
  ROOM_QUIET_MS,
  buildDuelRun,
  buildRun,
  buildStreamRun,
  valueOf,
} from "@bt/core";
import type {
  BoardResponse,
  DailyGuessResponse,
  DailyResumeResponse,
  DailyStartResponse,
  Guess,
  GuessResponse,
  RoomClientMessage,
  RoomQuestion,
  RoomSeatResponse,
  RoomServerMessage,
  RoundPayload,
  RunStartResponse,
  StreamGuessResponse,
  StreamStartResponse,
  SubmitResponse,
} from "@bt/core";
import { createTestHarness, unstable_splitSqlQuery } from "wrangler";
import { NOW, fixtureDeck } from "../../../packages/core/src/__fixtures__/deck.js";
import type { StoredRound } from "../daily-game.js";
import { parseRunId } from "../run-id.js";
import { readToken } from "./endless-helpers.js";
import { SECRET } from "./helpers.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const server = createTestHarness({
  root,
  workers: [
    {
      config: {
        name: "biggerthangame-test",
        main: "worker/test/entry.ts",
        compatibility_date: "2026-09-17",
        compatibility_flags: ["nodejs_compat"],
        vars: { RUN_SECRET: SECRET, TURNSTILE_SECRET: "test-turnstile-secret" },
        durable_objects: {
          bindings: [
            { name: "RUNS", class_name: "RunDO" },
            { name: "ROOMS", class_name: "RoomDO" },
          ],
        },
        d1_databases: [{ binding: "DB", database_name: "test", database_id: "test-db" }],
        migrations: [
          { tag: "v1", new_sqlite_classes: ["RunDO"] },
          { tag: "v2", new_sqlite_classes: ["RoomDO"] },
        ],
      },
    },
  ],
});

/** The test Worker's RunDO, with its test-only `alarmAt`. */
interface RunsBinding {
  idFromName(name: string): unknown;
  get(id: unknown): { alarmAt(now: number): Promise<void> };
}

/** The D1 binding, as the test reaches it from Node. */
interface DbBinding {
  prepare(sql: string): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
}

beforeAll(async () => {
  await server.listen();
  // The real migrations, into the harness's local D1.
  const env = (await server.getWorker().getEnv()) as unknown as { DB: DbBinding };
  const dir = join(root, "migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of unstable_splitSqlQuery(readFileSync(join(dir, file), "utf8"))) {
      await env.DB.prepare(statement).run();
    }
  }
}, 120_000);

afterAll(async () => {
  await server.close();
});

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await server.fetch(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function start(): Promise<RunStartResponse> {
  const res = await post<RunStartResponse>("/api/run/start", {
    mode: "endless",
    turnstileToken: "test",
  });
  expect(res.status).toBe(200);
  return res.body;
}

/** The right answer, from the test's own copy of the fixture deck. */
function right(runId: string, round: RoundPayload): Guess {
  const now = parseRunId(runId)!.date;
  const challenger = fixtureDeck.find((p) => p.id === round.challenger.id)!;
  return valueOf(challenger, round.stat.key, now)! > round.anchor.value ? "higher" : "lower";
}

const other = (g: Guess): Guess => (g === "higher" ? "lower" : "higher");

describe("under workerd", () => {
  it("deals the same Endless run from the same seed as Node", async () => {
    const node = buildRun({
      deck: fixtureDeck,
      seed: "endless:1",
      mode: "endless",
      now: NOW,
      maxRounds: 25,
    })
      .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
      .join("|");
    const res = await server.fetch("http://localhost/test/fingerprint?seed=endless:1&mode=endless");
    expect(await res.text()).toBe(node);
  });

  it("deals the same Instagram Endless run from the same seed as Node", async () => {
    const node = buildRun({
      deck: fixtureDeck,
      seed: "endless:instagram:1",
      mode: "endless",
      now: NOW,
      maxRounds: 25,
      variant: "endless-instagram",
    })
      .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
      .join("|");
    expect(node.split("|").every((r) => r.split(":")[1] === "ig")).toBe(true);
    const res = await server.fetch(
      "http://localhost/test/fingerprint?seed=endless:instagram:1&mode=endless&variant=endless-instagram",
    );
    expect(await res.text()).toBe(node);
  });

  it("plays a whole run over HTTP: right answers, then a wrong one ends it", async () => {
    const started = await start();
    let token = started.token;
    let round = started.round;
    for (let i = 0; i < 4; i++) {
      const res = await post<GuessResponse>("/api/round/guess", {
        token,
        guess: right(started.runId, round),
      });
      expect(res.status).toBe(200);
      if (!("next" in res.body)) throw new Error("expected the run to go on");
      expect(res.body.reveal.correct).toBe(true);
      token = res.body.token;
      round = res.body.next;
    }
    const end = await post<GuessResponse>("/api/round/guess", {
      token,
      guess: other(right(started.runId, round)),
    });
    expect(end.status).toBe(200);
    expect(end.body).toMatchObject({ end: "wrong", challenge: { score: 4 } });
  }, 60_000);

  it("spends a nonce once in the Durable Object: the other answer is 409 and the run is void", async () => {
    const started = await start();
    const pick = right(started.runId, started.round);
    const first = await post<GuessResponse>("/api/round/guess", {
      token: started.token,
      guess: pick,
    });
    expect(first.status).toBe(200);
    const replay = await post("/api/round/guess", { token: started.token, guess: other(pick) });
    expect(replay).toEqual({ status: 409, body: { error: "conflict", detail: "spent" } });
    if (!("token" in first.body)) throw new Error("expected a next token");
    const after = await post("/api/round/guess", { token: first.body.token, guess: "higher" });
    expect(after).toEqual({ status: 409, body: { error: "conflict", detail: "void" } });
  }, 60_000);

  it("answers a resend of the latest step identically, and refuses it once the next token is used", async () => {
    const started = await start();
    const pick = right(started.runId, started.round);
    const first = await post<GuessResponse>("/api/round/guess", {
      token: started.token,
      guess: pick,
    });
    const again = await post<GuessResponse>("/api/round/guess", {
      token: started.token,
      guess: pick,
    });
    expect(again).toEqual(first);
    if (!("token" in first.body) || !("next" in first.body))
      throw new Error("expected a next token");
    await post("/api/round/guess", {
      token: first.body.token,
      guess: right(started.runId, first.body.next),
    });
    const late = await post("/api/round/guess", { token: started.token, guess: pick });
    expect(late.status).toBe(409);
  }, 60_000);

  it("closes a silent run as disconnected, keeps its streak and refuses a late guess", async () => {
    const started = await start();
    const pick = right(started.runId, started.round);
    const first = await post<GuessResponse>("/api/round/guess", {
      token: started.token,
      guess: pick,
    });
    if (!("token" in first.body) || !("next" in first.body))
      throw new Error("expected a next token");

    const key = parseRunId(started.runId)!.body;
    const worker = server.getWorker();
    const env = (await worker.getEnv()) as unknown as { RUNS: RunsBinding };
    const stub = env.RUNS.get(env.RUNS.idFromName(key));
    await stub.alarmAt(readToken(first.body.token).deadline + 6000);

    const late = await post("/api/round/guess", {
      token: first.body.token,
      guess: right(started.runId, first.body.next),
    });
    expect(late).toEqual({ status: 409, body: { error: "conflict", detail: "over" } });

    const sql = await worker.getDurableObjectStorage("RUNS", { name: key });
    const rows = (await sql.exec("SELECT data FROM run")) as { data: string }[];
    expect(JSON.parse(rows[0]!.data)).toMatchObject({
      status: "ended",
      end: "disconnected",
      streak: 1,
    });
    const answers = (await sql.exec("SELECT round, ms FROM answers")) as { round: number }[];
    expect(answers.map((a) => a.round)).toEqual([1]);
  }, 60_000);
});

describe("publishing under workerd", () => {
  it("publishes a finished run into D1, serves the board, and snapshots it at midnight", async () => {
    const started = await start();
    let token = started.token;
    let round = started.round;
    for (let i = 0; i < 3; i++) {
      const res = await post<GuessResponse>("/api/round/guess", {
        token,
        guess: right(started.runId, round),
      });
      if (!("next" in res.body)) throw new Error("expected the run to go on");
      token = res.body.token;
      round = res.body.next;
    }
    const end = await post<GuessResponse>("/api/round/guess", {
      token,
      guess: other(right(started.runId, round)),
    });
    if (!("result" in end.body)) throw new Error("expected the run to end");

    const body = {
      token: end.body.result,
      nickname: "Workerd Winger",
      deviceId: "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
      turnstileToken: "test",
      showCountry: true,
    };
    const published = await post<SubmitResponse>("/api/run/submit", body);
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ streak: 3, periods: { day: { rank: 1 } } });
    // Once only: the Durable Object now says it was published.
    expect(await post("/api/run/submit", body)).toEqual({
      status: 409,
      body: { error: "conflict", detail: "submitted" },
    });

    const board = await server.fetch("http://localhost/api/board/endless/day");
    expect(board.status).toBe(200);
    const day = (await board.json()) as BoardResponse;
    expect(day.entries).toContainEqual({
      id: published.body.id,
      rank: expect.any(Number),
      nickname: "Workerd Winger",
      streak: 3,
      tied: false,
      thinkMs: null,
      // workerd's local request.cf has a country: stored as the flag's code.
      country: expect.stringMatching(/^[A-Z]{2}$/),
    });

    // The run's day closes at the next midnight; the cron snapshots it.
    const runDay = parseRunId(started.runId)!.date;
    const midnight = new Date(runDay.getTime() + 86_400_000);
    const result = await server
      .getWorker()
      .scheduled({ cron: "0 0 * * *", scheduledTime: midnight });
    expect(result.outcome).toBe("ok");
    const env = (await server.getWorker().getEnv()) as unknown as { DB: DbBinding };
    const snaps = await env.DB.prepare(
      "SELECT period, period_key, total FROM board_snapshots",
    ).all<{ period: string; period_key: string; total: number }>();
    expect(snaps.results).toContainEqual({
      period: "day",
      period_key: runDay.toISOString().slice(0, 10),
      total: expect.any(Number),
    });
  }, 60_000);
});

describe("Daily Ranked under workerd", () => {
  const device = (n: number) => `${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

  async function dailyStart(n: number): Promise<DailyStartResponse> {
    const res = await post<DailyStartResponse>("/api/run/start", {
      mode: "ranked",
      nickname: `Workerd Daily ${n}`,
      showCountry: false,
      deviceId: device(n),
      turnstileToken: "test",
    });
    expect(res.status).toBe(200);
    return res.body;
  }

  async function stored(gameNo: number): Promise<StoredRound[]> {
    const env = (await server.getWorker().getEnv()) as unknown as { DB: DbBinding };
    const row = await env.DB.prepare(
      `SELECT rounds FROM daily_games WHERE game_no = ${gameNo}`,
    ).all<{
      rounds: string;
    }>();
    return JSON.parse(row.results[0]!.rounds) as StoredRound[];
  }

  const rightOf = (r: StoredRound): Guess =>
    r.challenger.value > r.anchor.value ? "higher" : "lower";

  it("deals the same Daily game from the same seed as Node", async () => {
    const node = buildRun({
      deck: fixtureDeck,
      seed: "ranked:1",
      mode: "ranked",
      now: NOW,
      maxRounds: 25,
    })
      .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
      .join("|");
    const res = await server.fetch("http://localhost/test/fingerprint?seed=ranked:1&mode=ranked");
    expect(await res.text()).toBe(node);
  });

  it("plays a whole Daily run over HTTP, mistakes and all, and posts it", async () => {
    const started = await dailyStart(1);
    const rounds = await stored(started.gameNo);
    let token = started.token;
    let last: DailyGuessResponse | undefined;
    for (let r = 1; r <= DAILY_QUESTIONS; r++) {
      const round = rounds[r - 1]!;
      const res = await post<DailyGuessResponse>("/api/round/guess", {
        token,
        guess: r % 4 === 0 ? other(rightOf(round)) : rightOf(round),
      });
      expect(res.status).toBe(200);
      last = res.body;
      if ("token" in res.body) token = res.body.token;
    }
    expect(last).toMatchObject({ end: "finished", result: { correct: 15, score: 15, rank: 1 } });
  }, 60_000);

  it("resumes on the same device, and finishes and posts a run left quiet", async () => {
    const started = await dailyStart(2);
    const resumed = await post<DailyResumeResponse>("/api/run/resume", { deviceId: device(2) });
    expect(resumed.body).toMatchObject({ state: "playing", runId: started.runId });
    const elsewhere = await post<DailyResumeResponse>("/api/run/resume", { deviceId: device(9) });
    expect(elsewhere.body).toEqual({ state: "none" });

    const key = parseRunId(started.runId)!.body;
    const worker = server.getWorker();
    const env = (await worker.getEnv()) as unknown as { RUNS: RunsBinding; DB: DbBinding };
    const stub = env.RUNS.get(env.RUNS.idFromName(key));
    await stub.alarmAt(Date.now() + IDLE_FINISH_MS + 1000);

    const row = await env.DB.prepare(
      `SELECT end_reason, score, finished_at FROM daily_entries WHERE run_key = '${key}'`,
    ).all<{ end_reason: string; score: number; finished_at: number | null }>();
    expect(row.results[0]).toMatchObject({ end_reason: "abandoned", score: 0 });
    expect(row.results[0]!.finished_at).not.toBeNull();
    const after = await post<DailyResumeResponse>("/api/run/resume", { deviceId: device(2) });
    expect(after.body).toMatchObject({ state: "finished", result: { end: "abandoned" } });
  }, 60_000);
});

describe("a Twitch Mode match under workerd", () => {
  it("deals the same match from the same seed as Node", async () => {
    const node = buildStreamRun({
      deck: fixtureDeck,
      seed: "stream:endless:1",
      now: NOW,
      pool: "endless",
      questions: 20,
    })
      .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
      .join("|");
    const res = await server.fetch(
      "http://localhost/test/fingerprint?seed=stream:endless:1&variant=endless&questions=20",
    );
    expect(await res.text()).toBe(node);
  });

  it("plays a whole match over HTTP: misses carry on, a conflict is refused without voiding", async () => {
    const res = await post<StreamStartResponse>("/api/run/start", {
      mode: "stream",
      pool: "endless",
      questions: 10,
      limit: 30,
      turnstileToken: "test",
    });
    expect(res.status).toBe(200);
    const started = res.body;
    expect([started.questions, started.limit]).toEqual([10, 30]);
    let token: string | undefined = started.token;
    let round = started.round;
    let answered = 0;
    let previous: { token: string; guess: Guess } | undefined;
    let last: StreamGuessResponse | undefined;
    while (token !== undefined) {
      const pick = right(started.runId, round);
      // Every third question missed; the match goes on regardless.
      const guess = round.index % 3 === 0 ? other(pick) : pick;
      const answer: { status: number; body: StreamGuessResponse } = await post<StreamGuessResponse>(
        "/api/round/guess",
        {
          token,
          guess,
          chat: { pick: "higher", voters: 12 },
        },
      );
      expect(answer.status).toBe(200);
      answered += 1;
      // After question 2, replay question 1's token with the other pick: refused, nothing voided.
      if (round.index === 2 && previous !== undefined) {
        const replay = await post("/api/round/guess", {
          token: previous.token,
          guess: other(previous.guess),
        });
        expect(replay).toEqual({ status: 409, body: { error: "conflict", detail: "spent" } });
      }
      previous = { token, guess };
      last = answer.body;
      if ("token" in answer.body) {
        token = answer.body.token;
        round = answer.body.next;
      } else token = undefined;
    }
    expect(answered).toBe(10);
    expect(last).toMatchObject({ end: "finished", score: 7 });
  }, 60_000);
});

describe("a 1v1 room under workerd", () => {
  /** The test Worker's RoomDO, with its test-only `alarmAt` and `alarmDue`. */
  interface RoomsBinding {
    idFromName(name: string): unknown;
    get(id: unknown): {
      alarmAt(now: number): Promise<void>;
      alarmDue(): Promise<number | null>;
    };
  }

  /** Where the harness is listening: a real socket needs a real address. */
  let base: URL;

  /** One player's real WebSocket: what it has been sent, and a way to wait for the next of a kind. */
  class Seat {
    readonly messages: RoomServerMessage[] = [];
    readonly raw: string[] = [];
    closed: { code: number; reason: string } | undefined;
    private cursor = 0;
    private readonly ws: WebSocket;

    constructor(code: string) {
      const url = new URL(`/api/room/ws?code=${code}`, base);
      url.protocol = "ws:";
      this.ws = new WebSocket(url);
      this.ws.addEventListener("message", (event) => {
        const data = String(event.data);
        this.raw.push(data);
        if (data !== "pong") this.messages.push(JSON.parse(data) as RoomServerMessage);
      });
      this.ws.addEventListener("close", (event) => {
        this.closed = { code: event.code, reason: event.reason };
      });
    }

    opened(): Promise<void> {
      return new Promise((done, failed) => {
        this.ws.addEventListener("open", () => done(), { once: true });
        this.ws.addEventListener("error", () => failed(new Error("socket failed")), {
          once: true,
        });
      });
    }

    send(message: RoomClientMessage | string): void {
      this.ws.send(typeof message === "string" ? message : JSON.stringify(message));
    }

    /** The next message of type `t` not yet taken, waiting for it if it hasn't come. */
    async next<T extends RoomServerMessage["t"]>(
      t: T,
    ): Promise<Extract<RoomServerMessage, { t: T }>> {
      const until = Date.now() + 10_000;
      for (;;) {
        for (; this.cursor < this.messages.length; this.cursor++) {
          const message = this.messages[this.cursor]!;
          if (message.t === t) {
            this.cursor += 1;
            return message as Extract<RoomServerMessage, { t: T }>;
          }
        }
        if (Date.now() > until) {
          throw new Error(`no "${t}" came: ${JSON.stringify(this.messages.slice(-4))}`);
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    async gone(): Promise<{ code: number; reason: string }> {
      const until = Date.now() + 10_000;
      while (this.closed === undefined) {
        if (Date.now() > until) throw new Error("the socket never closed");
        await new Promise((r) => setTimeout(r, 10));
      }
      return this.closed;
    }

    close(): void {
      this.ws.close();
    }
  }

  beforeAll(async () => {
    base = (await server.listen()).url;
  });

  async function seated(code: string, token: string): Promise<Seat> {
    const seat = new Seat(code);
    await seat.opened();
    seat.send({ v: 1, t: "hello", token });
    return seat;
  }

  async function room(
    questions: 10 | 20 = 10,
  ): Promise<{ code: string; tokens: [string, string] }> {
    const made = await post<RoomSeatResponse>("/api/room/create", {
      pool: "endless",
      questions,
      limit: 30,
      name: "Ada",
      turnstileToken: "test",
    });
    expect(made.status).toBe(200);
    const joined = await post<RoomSeatResponse>("/api/room/join", {
      code: made.body.code,
      name: "Sam",
      turnstileToken: "test",
    });
    expect(joined.status).toBe(200);
    return { code: made.body.code, tokens: [made.body.token, joined.body.token] };
  }

  /** The right answer, from the test's own copy of the fixture deck, as at today (the match's day). */
  function rightPick(question: RoomQuestion): Guess {
    const today = new Date();
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const { round } = question;
    const challenger = fixtureDeck.find((p) => p.id === round.challenger.id)!;
    return valueOf(challenger, round.stat.key, day)! > round.anchor.value ? "higher" : "lower";
  }

  async function alarmAt(code: string, now: number): Promise<void> {
    const env = (await server.getWorker().getEnv()) as unknown as { ROOMS: RoomsBinding };
    await env.ROOMS.get(env.ROOMS.idFromName(code)).alarmAt(now);
  }

  async function alarmDue(code: string): Promise<number | null> {
    const env = (await server.getWorker().getEnv()) as unknown as { ROOMS: RoomsBinding };
    return env.ROOMS.get(env.ROOMS.idFromName(code)).alarmDue();
  }

  it("deals the same match and sudden death from the same seed as Node", async () => {
    const node = buildDuelRun({
      deck: fixtureDeck,
      seed: "duel:endless:1",
      now: NOW,
      pool: "endless",
      questions: 10,
    })
      .map((r) => `${r.index}:${r.stat}:${r.anchor.id}>${r.challenger.id}`)
      .join("|");
    expect(node.split("|")).toHaveLength(20);
    const res = await server.fetch(
      "http://localhost/test/fingerprint?seed=duel:endless:1&variant=endless&questions=10&duel=1",
    );
    expect(await res.text()).toBe(node);
  });

  it("plays a whole match over two real WebSockets, through a disconnect and a rejoin", async () => {
    const { code, tokens } = await room();
    expect((await post("/api/room/peek", { code })).body).toEqual({ state: "full" });
    const host = await seated(code, tokens[0]);
    let guest = await seated(code, tokens[1]);
    expect((await host.next("welcome")).you).toBe(0);
    const welcome = await guest.next("welcome");
    expect(welcome.you).toBe(1);
    expect(welcome.room).toMatchObject({
      code,
      phase: "lobby",
      settings: { mode: "duel", pool: "endless", questions: 10, limit: 30 },
    });

    // The heartbeat is answered, and never read as a message.
    guest.send("ping");
    host.send({ v: 1, t: "ready", ready: true });
    guest.send({ v: 1, t: "ready", ready: true });
    // The guest can't start it.
    guest.send({ v: 1, t: "start" });
    expect((await guest.next("error")).code).toBe("not_host");
    host.send({ v: 1, t: "start" });

    let forHost = (await host.next("question")).question;
    let forGuest = (await guest.next("question")).question;
    expect(guest.raw).toContain("pong");
    let hostScore = 0;
    let guestScore = 0;
    let end: Extract<RoomServerMessage, { t: "reveal" }>["end"];
    while (end === undefined) {
      // The same question for both, at the same moment.
      expect(forGuest).toEqual(forHost);
      const index = forHost.round.index;
      const pick = rightPick(forHost);

      if (index === 4) {
        // The guest's connection drops mid-match; the host is told, with the time left.
        guest.close();
        let away = await host.next("players");
        while (away.players[1]?.connected !== false) away = await host.next("players");
        expect(away.players[1]!.rejoinInMs).toBeGreaterThan(25_000);
        // Back with the same token, on a new socket: the same seat, the same question.
        guest = await seated(code, tokens[1]);
        const back = await guest.next("welcome");
        expect(back.you).toBe(1);
        expect(back.room.phase).toBe("playing");
        expect(back.room.question?.round).toEqual(forHost.round);
        expect(back.room.match).toMatchObject({ no: 1, scores: [hostScore, guestScore] });
      }

      host.send({ v: 1, t: "answer", q: index, pick });
      if (index === 6) {
        // The guest never answers this one: the alarm closes it at its deadline.
        expect((await guest.next("locked")).seat).toBe(0);
        await alarmAt(code, Date.now() + 60_000);
      } else {
        // The guest gets every third question wrong.
        guest.send({ v: 1, t: "answer", q: index, pick: index % 3 === 0 ? other(pick) : pick });
      }
      const hostReveal = await host.next("reveal");
      const guestReveal = await guest.next("reveal");
      const guestRight = index !== 6 && index % 3 !== 0;
      hostScore += 1;
      if (guestRight) guestScore += 1;
      expect(hostReveal.reveal.round).toBe(index);
      expect(hostReveal.reveal.correct).toBe(true);
      expect(guestReveal.reveal.correct).toBe(guestRight);
      expect(guestReveal.reveal.value).toBe(hostReveal.reveal.value);
      expect(hostReveal.scores).toEqual([hostScore, guestScore]);
      expect(hostReveal.picks[1]).toBe(index === 6 ? null : guestRight ? pick : other(pick));
      end = hostReveal.end;
      if (hostReveal.next !== undefined) {
        forHost = hostReveal.next;
        forGuest = guestReveal.next!;
      }
    }
    // Ten for the host; the guest missed questions 3, 6 (never answered) and 9.
    expect([hostScore, guestScore]).toEqual([10, 7]);
    expect(end.result).toMatchObject({ winner: 0, reason: "finished", scores: [10, 7] });
    expect(end.series).toEqual({ wins: [1, 0], draws: 0 });

    // A second answer to the last question, after full time: refused.
    host.send({ v: 1, t: "answer", q: 10, pick: "higher" });
    expect((await host.next("error")).code).toBe("out_of_turn");

    // Both ask for a rematch: a new match in the same room.
    guest.send({ v: 1, t: "rematch" });
    expect((await host.next("rematch")).seats).toEqual([1]);
    host.send({ v: 1, t: "rematch" });
    expect((await guest.next("question")).question).toMatchObject({ match: 2 });

    // The guest leaves it: a forfeit, the host wins, and the guest's socket is closed.
    guest.send({ v: 1, t: "leave" });
    const full = await host.next("fulltime");
    expect(full.result).toMatchObject({ winner: 0, reason: "forfeit", left: 1 });
    expect(full.series).toEqual({ wins: [2, 0], draws: 0 });
    expect((await guest.next("closed")).reason).toBe("left");
    expect((await guest.gone()).code).toBe(4000);
    host.close();
  }, 60_000);

  it("takes over a seat with a newer socket, and refuses a forged or foreign token", async () => {
    const { code, tokens } = await room();
    const elsewhere = await room();
    const first = await seated(code, tokens[0]);
    await first.next("welcome");

    const second = await seated(code, tokens[0]);
    expect((await second.next("welcome")).you).toBe(0);
    expect((await first.next("closed")).reason).toBe("replaced");
    expect((await first.gone()).code).toBe(4001);

    for (const token of [elsewhere.tokens[0], `${tokens[0]}x`, "nonsense"]) {
      const stranger = await seated(code, token);
      expect((await stranger.next("error")).code).toBe("bad_token");
      expect((await stranger.gone()).code).toBe(4002);
    }
    // Speaking before `hello` is no better.
    const rude = new Seat(code);
    await rude.opened();
    rude.send({ v: 1, t: "start" });
    expect((await rude.next("error")).code).toBe("bad_token");
    await rude.gone();
    // The seat's own socket is untouched by any of it.
    second.send({ v: 1, t: "ready", ready: true });
    let players = await second.next("players");
    while (players.players[0]?.ready !== true) players = await second.next("players");
    expect(players.players[0]).toMatchObject({ seat: 0, name: "Ada", connected: true });
    second.close();
  }, 60_000);

  it("tells a socket there is no such room, and refuses what isn't a room code", async () => {
    const seat = new Seat("ZZZZZZ");
    await seat.opened();
    expect((await seat.next("closed")).reason).toBe("unknown");
    expect((await seat.gone()).code).toBe(4000);

    const bad = await server.fetch("http://localhost/api/room/ws?code=nope", {
      headers: { upgrade: "websocket" },
    });
    expect(bad.status).toBe(400);
    const plain = await server.fetch("http://localhost/api/room/ws?code=K7QM2X");
    expect(plain.status).toBe(400);
    const foreign = await server.fetch("http://localhost/api/room/ws?code=K7QM2X", {
      headers: { upgrade: "websocket", origin: "https://elsewhere.example" },
    });
    expect(foreign.status).toBe(403);
  }, 60_000);

  it("keeps a room while its host is connected, and expires it fifteen minutes after they go", async () => {
    const { code, tokens } = await room();
    const host = await seated(code, tokens[0]);
    await host.next("welcome");
    // The alarm, as at an hour on: the host is there, so the room is too.
    await alarmAt(code, Date.now() + 60 * 60_000);
    expect((await post("/api/room/peek", { code })).body).toEqual({ state: "full" });
    host.send({ v: 1, t: "ready", ready: true });
    let players = await host.next("players");
    while (players.players[0]?.ready !== true) players = await host.next("players");
    expect(players.players[0]).toMatchObject({ seat: 0, connected: true });
    // The host goes. Once the room has seen it, fifteen minutes on it is gone.
    host.close();
    let state = "open";
    for (let tries = 0; tries < 50 && state !== "closed"; tries++) {
      await new Promise((done) => setTimeout(done, 100));
      await alarmAt(code, Date.now() + ROOM_IDLE_MS + 5000);
      state = ((await post("/api/room/peek", { code })).body as { state: string }).state;
    }
    expect(state).toBe("closed");
    const join = await post("/api/room/join", { code, name: "Kit", turnstileToken: "test" });
    expect(join).toEqual({ status: 409, body: { error: "conflict", detail: "closed" } });
  }, 60_000);

  it("looks for quiet sockets a minute on, and nothing the room is busy with puts that off", async () => {
    const { code, tokens } = await room();
    const host = await seated(code, tokens[0]);
    await host.next("welcome");
    // Nothing of the room's own is due for hours: the alarm is the sweep, within the minute.
    const due = await alarmDue(code);
    expect(due).not.toBeNull();
    expect(due! - Date.now()).toBeGreaterThan(30_000);
    expect(due! - Date.now()).toBeLessThanOrEqual(60_000);

    // Another socket arriving, and messages a few hundred milliseconds apart: each sets
    // the alarm again, and none of them moves the sweep.
    const guest = await seated(code, tokens[1]);
    await guest.next("welcome");
    for (const ready of [true, false, true]) {
      await new Promise((done) => setTimeout(done, 400));
      host.send({ v: 1, t: "ready", ready });
      let players = await host.next("players");
      while (players.players[0]?.ready !== ready) players = await host.next("players");
      expect(await alarmDue(code)).toBe(due);
    }

    // An alarm sweeps, and the minute starts again from there.
    await alarmAt(code, Date.now());
    const next = await alarmDue(code);
    expect(next).toBeGreaterThan(due!);
    expect(next! - Date.now()).toBeLessThanOrEqual(60_000);
    host.close();
    guest.close();
  }, 60_000);

  it("closes a room on a connected host after two hours with nothing done, and keeps nothing", async () => {
    const { code, tokens } = await room();
    const host = await seated(code, tokens[0]);
    await host.next("welcome");
    // Just short of the two hours the room is there, connected host and all.
    await alarmAt(code, Date.now() + ROOM_QUIET_MS - 60_000);
    expect((await post("/api/room/peek", { code })).body).toEqual({ state: "full" });
    // Past them, from its alarm: the host is told, as anyone in a closed room is, and hung up on.
    await alarmAt(code, Date.now() + ROOM_QUIET_MS + 1000);
    expect((await host.next("closed")).reason).toBe("expired");
    expect((await host.gone()).code).toBe(4000);
    expect((await post("/api/room/peek", { code })).body).toEqual({ state: "closed" });
    const join = await post("/api/room/join", { code, name: "Kit", turnstileToken: "test" });
    expect(join).toEqual({ status: 409, body: { error: "conflict", detail: "closed" } });
    // Its token opens nothing now.
    const late = await seated(code, tokens[0]);
    expect((await late.next("closed")).reason).toBe("unknown");
  }, 60_000);

  it("says a third player the room is full, and a taken name is taken", async () => {
    const made = await post<RoomSeatResponse>("/api/room/create", {
      pool: "endless",
      questions: 10,
      limit: 10,
      name: "Ada",
      turnstileToken: "test",
    });
    const { code } = made.body;
    expect((await post("/api/room/peek", { code })).body).toMatchObject({
      state: "open",
      host: "Ada",
    });
    const same = await post("/api/room/join", { code, name: "ADA", turnstileToken: "test" });
    expect(same).toEqual({ status: 409, body: { error: "conflict", detail: "name_taken" } });
    expect(
      (await post("/api/room/join", { code, name: "Sam", turnstileToken: "test" })).status,
    ).toBe(200);
    const third = await post("/api/room/join", { code, name: "Kit", turnstileToken: "test" });
    expect(third).toEqual({ status: 409, body: { error: "conflict", detail: "full" } });
  }, 60_000);
});
