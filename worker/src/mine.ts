/**
 * `POST /api/board/endless/me` (ARCHITECTURE.md §11): where this device
 * stands now on today's, this week's and this month's boards, as a pure
 * function of the request.
 *
 * The rank a publish came back with goes out of date as soon as anyone else
 * publishes, so the board page asks here once, on load, when its device has
 * published to a current period. Each answer is the owner's view
 * (scores.ts `ownStanding`): the device's best entry, shadowed runs included,
 * ranked among everyone else's public bests — a shadowed player sees an
 * ordinary rank. Like a board entry, it says whether its streak is tied and,
 * only then, its thinking time, and carries its flag's country code. Per
 * player, so never cached.
 *
 * **Privacy.** The device id is hashed exactly as at submit (submit.ts
 * `hashDevice`) and used for the one query; it is never stored or logged.
 */

import { periodsOf } from "@bt/core";
import type { ApiError, BoardPeriod, MineEntry, MineResponse } from "@bt/core";
import type { RateDecision } from "./rate-limit.js";
import { ownStanding } from "./scores.js";
import type { D1Like } from "./scores.js";
import { hashDevice } from "./submit.js";

export const MINE_PATH = "/api/board/endless/me";

/** Far past `{"deviceId":"<uuid>"}`. */
export const MAX_MINE_BYTES = 256;

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PERIODS: readonly BoardPeriod[] = ["day", "week", "month"];

export interface MineContext {
  readonly db: D1Like;
  readonly secret: string;
  readonly clock: () => Date;
  /** Lookups per IP. */
  readonly limit?: () => Promise<RateDecision>;
}

export type MineResult =
  | { readonly status: 200; readonly body: MineResponse }
  | { readonly status: 400; readonly body: ApiError }
  | { readonly status: 429; readonly body: ApiError; readonly retryAfter: number };

/** `{ deviceId }` and nothing else, the id a v4 uuid. */
export function parseMine(body: unknown): { deviceId: string } | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "deviceId") return undefined;
  const { deviceId } = record;
  return typeof deviceId === "string" && DEVICE_ID.test(deviceId) ? { deviceId } : undefined;
}

/** A D1 failure throws, for the route to answer 503. */
export async function handleMine(body: unknown, ctx: MineContext): Promise<MineResult> {
  const limited = await ctx.limit?.();
  if (limited?.ok === false) {
    return { status: 429, body: { error: "rate_limited" }, retryAfter: limited.retryAfter };
  }
  const req = parseMine(body);
  if (req === undefined) {
    return { status: 400, body: { error: "bad_request", detail: "expected { deviceId }" } };
  }
  const deviceHash = await hashDevice(ctx.secret, req.deviceId);
  const periods = periodsOf(ctx.clock());
  const entries = await Promise.all(
    PERIODS.map(async (period): Promise<MineEntry | null> => {
      const p = periods[period];
      const standing = await ownStanding(ctx.db, "endless", deviceHash, { from: p.from, to: p.to });
      return standing === undefined
        ? null
        : {
            key: p.key,
            entryId: standing.entryId,
            rank: standing.rank,
            total: standing.total,
            streak: standing.streak,
            nickname: standing.nickname,
            tied: standing.tied,
            thinkMs: standing.thinkMs,
            country: standing.country,
          };
    }),
  );
  const [day = null, week = null, month = null] = entries;
  return { status: 200, body: { periods: { day, week, month } } };
}
