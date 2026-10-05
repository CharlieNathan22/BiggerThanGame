/**
 * `GET /api/board/endless/:period` (ARCHITECTURE.md §11): the current day's,
 * week's or month's top 50, the total, when it resets and the period
 * before's winner.
 *
 * **Served from the Workers Cache API**, about a minute stale at most. A
 * cached copy is keyed on the period's own key (`2026-09-29`, `2026-W40`…), so
 * a reset is a miss on the new key rather than an hour of yesterday's board. A
 * miss reads D1 and puts the answer back without holding up the response. No
 * KV: its free plan allows 1,000 writes a day, and the board doesn't need to
 * be fresher than this. The player's own entry comes from their submit
 * response and is kept on their device, so they see themselves at once.
 *
 * The previous period's winner comes from its midnight snapshot (cron.ts), or,
 * before the snapshot has been taken, from the scores themselves. A name
 * retired since the snapshot shows as retired.
 *
 * Nothing on the board is hidden or personal: rank, nickname (null once
 * retired), streak, an entry id, whether its streak is tied and, only then,
 * its thinking time, and a flag's country code (never anything finer). No
 * device hash, no shadow flag.
 */

import { periodOf, previousPeriod } from "@bt/core";
import type { BoardPeriod, BoardResponse } from "@bt/core";
import { isNameFlagged, publicBoard, readSnapshot } from "./scores.js";
import type { D1Like } from "./scores.js";

export const BOARD_PATH_PREFIX = "/api/board/endless/";

/** How long a board is served from the cache, seconds. */
export const BOARD_TTL_S = 60;

const PERIODS: readonly BoardPeriod[] = ["day", "week", "month"];

export function parseBoardPeriod(path: string): BoardPeriod | undefined {
  if (!path.startsWith(BOARD_PATH_PREFIX)) return undefined;
  const period = path.slice(BOARD_PATH_PREFIX.length);
  return (PERIODS as readonly string[]).includes(period) ? (period as BoardPeriod) : undefined;
}

/** The board for the period `now` is in, read from D1. */
export async function boardData(
  db: D1Like,
  now: Date,
  period: BoardPeriod,
): Promise<BoardResponse> {
  const current = periodOf(now, period);
  const previous = previousPeriod(current);
  const [board, snapshot] = await Promise.all([
    publicBoard(db, "endless", current),
    readSnapshot(db, "endless", period, previous.key),
  ]);
  const top = snapshot?.entries[0] ?? (await publicBoard(db, "endless", previous, 1)).entries[0];
  let winner: BoardResponse["previous"]["winner"] = null;
  if (top !== undefined) {
    const retired = top.nickname === null || (await isNameFlagged(db, top.id));
    // A retired name keeps its flag. A snapshot from before flags has none.
    winner = {
      nickname: retired ? null : top.nickname,
      streak: top.streak,
      country: top.country ?? null,
    };
  }
  return {
    mode: "endless",
    period,
    key: current.key,
    resetsAt: current.resetsAt,
    total: board.total,
    entries: board.entries,
    previous: { key: previous.key, winner },
  };
}

/** The Workers Cache API, as far as the board uses it; typed structurally for Node tests. */
export interface BoardCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface BoardContext {
  readonly db: D1Like;
  readonly clock: () => Date;
  /** `caches.default`, or none (tests, a platform without it): every read goes to D1. */
  readonly cache?: BoardCache;
  /** Keeps the cache write alive after the response has gone. */
  readonly waitUntil?: (promise: Promise<unknown>) => void;
  /** Told of a cache failure, which is then served from D1. Must not throw. */
  readonly cacheFailed?: (err: unknown) => void;
}

/**
 * The board as a response: from the cache if it has this period's, from D1
 * otherwise, putting it back. D1 failing throws, for the caller's 503.
 */
export async function serveBoard(
  origin: string,
  period: BoardPeriod,
  ctx: BoardContext,
): Promise<Response> {
  const now = ctx.clock();
  const key = new Request(`${origin}${BOARD_PATH_PREFIX}${period}?k=${periodOf(now, period).key}`);
  if (ctx.cache !== undefined) {
    try {
      const hit = await ctx.cache.match(key);
      if (hit !== undefined) return hit;
    } catch (err) {
      ctx.cacheFailed?.(err);
    }
  }

  const body = await boardData(ctx.db, now, period);
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
