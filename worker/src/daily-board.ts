/**
 * Daily Ranked's board (ARCHITECTURE.md §11): `GET /api/board/daily`, today's
 * game's top 50, and `POST /api/board/daily/me`, where this device stands in
 * it.
 *
 * **The board** is served through the Workers Cache API like Endless's, keyed
 * on the game number, so a rollover is a miss on the new game rather than an
 * hour of yesterday's. A minute stale at most; the player who has just
 * finished sees their own result and rank from their own answer. The
 * previous game's winner comes from its snapshot (cron.ts), or from its
 * entries until the snapshot is taken. Before launch day it is Game 0: no
 * entries, and the countdown to Game 1.
 *
 * **`/me`** answers for one device: its run still being played (today's, or
 * yesterday's started before midnight), or today's finished run with its rank
 * as its owner sees it, or nothing. The device id is hashed for the query and
 * never stored or logged. Never cached.
 */

import { BOARD_SIZE, flagCountry, gameNoAt, isGame, nextGameAt } from "@bt/core";
import type { ApiError, DailyBoardEntry, DailyBoardResponse, DailyMineResponse } from "@bt/core";
import { BOARD_TTL_S } from "./board.js";
import type { BoardCache } from "./board.js";
import { dailyBoard, deviceEntry, entryResult, unfinishedEntry } from "./daily-scores.js";
import type { RateDecision } from "./rate-limit.js";
import { isNameFlagged, readSnapshot, saveSnapshot } from "./scores.js";
import type { D1Like } from "./scores.js";
import { hashDevice } from "./submit.js";

export const DAILY_BOARD_PATH = "/api/board/daily";
export const DAILY_MINE_PATH = "/api/board/daily/me";

/** The snapshots' mode and period for a Daily game: its number is the key. */
const SNAPSHOT_MODE = "ranked";
const SNAPSHOT_PERIOD = "day";

/** A game's board, read from D1, as at `now`. */
export async function dailyBoardData(
  db: D1Like,
  now: number,
  epoch: number,
): Promise<DailyBoardResponse> {
  const gameNo = gameNoAt(now, epoch);
  const next = nextGameAt(now, epoch);
  if (!isGame(gameNo)) {
    return { mode: "ranked", gameNo: 0, nextGameAt: next, total: 0, entries: [], previous: null };
  }
  const board = await dailyBoard(db, gameNo);
  let previous: DailyBoardResponse["previous"] = null;
  if (isGame(gameNo - 1)) {
    const snapshot = await readSnapshot<DailyBoardEntry>(
      db,
      SNAPSHOT_MODE,
      SNAPSHOT_PERIOD,
      String(gameNo - 1),
    );
    const top = snapshot?.entries[0] ?? (await dailyBoard(db, gameNo - 1, 1)).entries[0];
    let winner: NonNullable<DailyBoardResponse["previous"]>["winner"] = null;
    if (top !== undefined) {
      const retired = top.nickname === null || (await isEntryNameFlagged(db, top.id));
      winner = {
        nickname: retired ? null : top.nickname,
        score: top.score,
        perfect: top.perfect,
        bonus: top.bonus,
        country: top.country ?? null,
      };
    }
    previous = { gameNo: gameNo - 1, winner };
  }
  return {
    mode: "ranked",
    gameNo,
    nextGameAt: next,
    total: board.total,
    entries: board.entries,
    previous,
  };
}

async function isEntryNameFlagged(db: D1Like, id: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name_flagged FROM daily_entries WHERE id = ?1")
    .bind(id)
    .first<{ name_flagged: number }>();
  // An entry pruned since its snapshot: as Endless's, by its id in the scores.
  return row === null ? isNameFlagged(db, id) : row.name_flagged === 1;
}

/** Snapshots game `gameNo`'s public top 50, replacing an earlier snapshot of it. */
export async function snapshotDailyGame(db: D1Like, gameNo: number, now: number): Promise<void> {
  const board = await dailyBoard(db, gameNo, BOARD_SIZE);
  await saveSnapshot<DailyBoardEntry>(db, SNAPSHOT_MODE, SNAPSHOT_PERIOD, String(gameNo), {
    takenAt: now,
    total: board.total,
    entries: board.entries,
  });
}

export interface DailyBoardContext {
  readonly db: D1Like;
  readonly clock: () => Date;
  readonly epoch: number;
  readonly cache?: BoardCache;
  readonly waitUntil?: (promise: Promise<unknown>) => void;
  readonly cacheFailed?: (err: unknown) => void;
}

/** The board as a response: from the cache if it has this game's, from D1 otherwise. */
export async function serveDailyBoard(origin: string, ctx: DailyBoardContext): Promise<Response> {
  const now = ctx.clock().getTime();
  const key = new Request(`${origin}${DAILY_BOARD_PATH}?g=${gameNoAt(now, ctx.epoch)}`);
  if (ctx.cache !== undefined) {
    try {
      const hit = await ctx.cache.match(key);
      if (hit !== undefined) return hit;
    } catch (err) {
      ctx.cacheFailed?.(err);
    }
  }
  const body = await dailyBoardData(ctx.db, now, ctx.epoch);
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${BOARD_TTL_S}`,
    },
  });
  if (ctx.cache !== undefined) {
    const put = ctx.cache
      .put(key, response.clone())
      .catch((err: unknown) => ctx.cacheFailed?.(err));
    if (ctx.waitUntil !== undefined) ctx.waitUntil(put);
    else await put;
  }
  return response;
}

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface DailyMineContext {
  readonly db: D1Like;
  readonly secret: string;
  readonly clock: () => Date;
  readonly epoch: number;
  readonly limit?: () => Promise<RateDecision>;
  /** The request's country (Cloudflare's), for the flag the start panel shows. */
  readonly country?: string;
}

export type DailyMineResult =
  | { readonly status: 200; readonly body: DailyMineResponse }
  | { readonly status: 400; readonly body: ApiError }
  | { readonly status: 429; readonly body: ApiError; readonly retryAfter: number };

/** A D1 failure throws, for the route to answer 503. */
export async function handleDailyMine(
  body: unknown,
  ctx: DailyMineContext,
): Promise<DailyMineResult> {
  const limited = await ctx.limit?.();
  if (limited?.ok === false) {
    return { status: 429, body: { error: "rate_limited" }, retryAfter: limited.retryAfter };
  }
  const deviceId = parseDeviceOnly(body);
  if (deviceId === undefined) {
    return { status: 400, body: { error: "bad_request", detail: "expected { deviceId }" } };
  }
  const now = ctx.clock().getTime();
  const gameNo = gameNoAt(now, ctx.epoch);
  const next = nextGameAt(now, ctx.epoch);
  const country = flagCountry(ctx.country);
  if (!isGame(gameNo)) {
    return { status: 200, body: { gameNo: 0, nextGameAt: next, country, state: "none" } };
  }
  const deviceHash = await hashDevice(ctx.secret, deviceId);
  const open = await unfinishedEntry(ctx.db, deviceHash, gameNo);
  if (open !== undefined) {
    return {
      status: 200,
      body: {
        gameNo: open.game_no,
        nextGameAt: next,
        country,
        state: "playing",
        nickname: open.nickname,
      },
    };
  }
  const entry = await deviceEntry(ctx.db, deviceHash, gameNo);
  if (entry === undefined || entry.finished_at === null) {
    return { status: 200, body: { gameNo, nextGameAt: next, country, state: "none" } };
  }
  const { result, standing } = await entryResult(ctx.db, entry);
  return {
    status: 200,
    body: { gameNo, nextGameAt: next, country, state: "finished", result, standing },
  };
}

function parseDeviceOnly(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "deviceId") return undefined;
  const { deviceId } = record;
  return typeof deviceId === "string" && DEVICE_ID.test(deviceId) ? deviceId : undefined;
}
