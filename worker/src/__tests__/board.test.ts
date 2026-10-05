import { describe, expect, it } from "vitest";
import type { BoardResponse } from "@bt/core";
import { BOARD_TTL_S, boardData, parseBoardPeriod, serveBoard } from "../board.js";
import type { BoardCache } from "../board.js";
import { runNightly } from "../cron.js";
import { BOARD_SIZE, insertScore } from "../scores.js";
import type { ScoreRow } from "../scores.js";
import { sqliteD1 } from "./d1-sqlite.js";
import type { TestD1 } from "./d1-sqlite.js";

const ORIGIN = "https://biggerthangame.com";
const NOW = new Date("2026-09-29T15:00:00Z");

let n = 0;
async function add(db: TestD1, over: Partial<ScoreRow> & { device: string }): Promise<string> {
  n += 1;
  const { device, ...rest } = over;
  const id = `id-${n}`;
  await insertScore(db, {
    id,
    mode: "endless",
    dayKey: 20260929,
    nickname: `Player${n}`,
    nicknameNormalised: "player",
    streak: 10,
    thinkMs: 60_000,
    country: null,
    deviceHash: device,
    runKey: `run-${n}`,
    createdAt: n,
    shadow: false,
    shadowReason: null,
    ...rest,
  });
  return id;
}

/** A cache in memory, as `caches.default` behaves for these calls. */
function memoryCache(): BoardCache & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  return {
    store,
    match: async (req) => store.get(req.url)?.clone(),
    put: async (req, res) => void store.set(req.url, res),
  };
}

describe("parseBoardPeriod", () => {
  it("takes day, week and month under the board path, and nothing else", () => {
    expect(parseBoardPeriod("/api/board/endless/day")).toBe("day");
    expect(parseBoardPeriod("/api/board/endless/week")).toBe("week");
    expect(parseBoardPeriod("/api/board/endless/month")).toBe("month");
    for (const path of [
      "/api/board/endless/year",
      "/api/board/endless/",
      "/api/board/endless/day/2026-09-28",
      "/api/board/ranked/day",
    ]) {
      expect(parseBoardPeriod(path)).toBeUndefined();
    }
  });
});

describe("boardData", () => {
  it("is the current period's top entries, total and reset", async () => {
    const db = sqliteD1();
    await add(db, { device: "a", streak: 12, nickname: "Alpha" });
    await add(db, { device: "b", streak: 20, nickname: "Bravo" });
    await add(db, { device: "old", streak: 50, dayKey: 20260928 });
    const day = await boardData(db, NOW, "day");
    expect(day).toMatchObject({
      mode: "endless",
      period: "day",
      key: "2026-09-29",
      resetsAt: Date.parse("2026-09-30T00:00:00Z"),
      total: 2,
    });
    expect(day.entries.map((e) => e.nickname)).toEqual(["Bravo", "Alpha"]);
    // The 28th is in this week and this month.
    expect((await boardData(db, NOW, "week")).total).toBe(3);
    expect((await boardData(db, NOW, "month")).entries[0]?.streak).toBe(50);
  });

  it("names the previous period's winner, from the scores before a snapshot exists", async () => {
    const db = sqliteD1();
    await add(db, {
      device: "a",
      streak: 31,
      dayKey: 20260928,
      nickname: "Yesterday",
      country: "BR",
    });
    const day = await boardData(db, NOW, "day");
    expect(day.previous).toEqual({
      key: "2026-09-28",
      winner: { nickname: "Yesterday", streak: 31, country: "BR" },
    });
    expect((await boardData(db, NOW, "week")).previous).toEqual({ key: "2026-W39", winner: null });
  });

  it("prefers the snapshot, and retires a name flagged since it was taken", async () => {
    const db = sqliteD1();
    const id = await add(db, {
      device: "a",
      streak: 31,
      dayKey: 20260928,
      nickname: "Snapped",
      country: "IE",
    });
    await runNightly(db, new Date("2026-09-29T00:00:00Z"));
    // A late publish after the 01:30 snapshot would not change the winner shown.
    await add(db, { device: "b", streak: 99, dayKey: 20260928, nickname: "TooLate" });
    expect((await boardData(db, NOW, "day")).previous.winner).toEqual({
      nickname: "Snapped",
      streak: 31,
      country: "IE",
    });
    db.exec(`UPDATE scores SET name_flagged = 1 WHERE id = '${id}'`);
    // A retired name keeps its flag.
    expect((await boardData(db, NOW, "day")).previous.winner).toEqual({
      nickname: null,
      streak: 31,
      country: "IE",
    });
  });

  it("carries no untied time, device or shadow flag, and no retired name", async () => {
    const db = sqliteD1();
    await add(db, {
      device: "secret-device-hash",
      streak: 5,
      nickname: "Rude",
      thinkMs: 123_457,
    });
    db.exec("UPDATE scores SET name_flagged = 1");
    const text = JSON.stringify(await boardData(db, NOW, "day"));
    for (const hidden of ["secret-device-hash", "123457", "Rude", "shadow", "elapsed"]) {
      expect(text).not.toContain(hidden);
    }
  });
});

describe("the board's size", () => {
  it("is the top 50, with everyone in the total", async () => {
    const db = sqliteD1();
    for (let i = 0; i < 60; i += 1) await add(db, { device: `d${i}`, streak: i + 1 });
    const day = await boardData(db, NOW, "day");
    expect(day.entries).toHaveLength(BOARD_SIZE);
    expect(day.entries.map((e) => e.rank)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(day.entries[0]?.streak).toBe(60);
    expect(day.entries.at(-1)?.streak).toBe(11);
    expect(day.total).toBe(60);
  });
});

describe("serveBoard", () => {
  it("serves a hit from the cache without touching D1", async () => {
    const db = sqliteD1();
    await add(db, { device: "a", streak: 7 });
    const cache = memoryCache();
    const ctx = { db, clock: () => NOW, cache };
    const first = await serveBoard(ORIGIN, "day", ctx);
    expect(first.headers.get("cache-control")).toBe(`public, max-age=${BOARD_TTL_S}`);
    expect(cache.store.size).toBe(1);
    const queries = db.queries;
    await add(db, { device: "b", streak: 9 });
    const afterWrite = db.queries;
    const second = await serveBoard(ORIGIN, "day", ctx);
    expect(db.queries).toBe(afterWrite);
    expect(queries).toBeLessThan(afterWrite);
    // Still the board as it was cached: a minute stale at most.
    expect(((await second.json()) as BoardResponse).total).toBe(1);
  });

  it("misses when the period turns over, since the key is the period's", async () => {
    const db = sqliteD1();
    const cache = memoryCache();
    let now = new Date("2026-09-29T23:59:30Z");
    const ctx = { db, clock: () => now, cache };
    await serveBoard(ORIGIN, "day", ctx);
    now = new Date("2026-09-30T00:00:10Z");
    const res = await serveBoard(ORIGIN, "day", ctx);
    expect(((await res.json()) as BoardResponse).key).toBe("2026-09-30");
    expect([...cache.store.keys()]).toEqual([
      `${ORIGIN}/api/board/endless/day?k=2026-09-29`,
      `${ORIGIN}/api/board/endless/day?k=2026-09-30`,
    ]);
  });

  it("serves from D1 when the cache fails, and says so", async () => {
    const db = sqliteD1();
    await add(db, { device: "a", streak: 7 });
    const failures: unknown[] = [];
    const broken: BoardCache = {
      match: async () => {
        throw new Error("cache down");
      },
      put: async () => {
        throw new Error("cache down");
      },
    };
    const res = await serveBoard(ORIGIN, "day", {
      db,
      clock: () => NOW,
      cache: broken,
      cacheFailed: (err) => failures.push(err),
    });
    expect(((await res.json()) as BoardResponse).total).toBe(1);
    expect(failures).toHaveLength(2);
  });

  it("hands the cache write to waitUntil", async () => {
    const db = sqliteD1();
    const cache = memoryCache();
    const waited: Promise<unknown>[] = [];
    await serveBoard(ORIGIN, "week", {
      db,
      clock: () => NOW,
      cache,
      waitUntil: (p) => waited.push(p),
    });
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    expect(cache.store.size).toBe(1);
  });
});
