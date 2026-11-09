/**
 * Making, joining and looking at a 1v1 room, as pure functions of the request
 * (ARCHITECTURE.md §8, "1v1 rooms"): `POST /api/room/create`,
 * `POST /api/room/join` and `POST /api/room/peek`. Playing happens over the
 * room's WebSocket (room-do.ts); these three only get a player a seat.
 *
 * - **Create** makes a room for the host's settings and answers with its code
 *   and the host's seat token. The pool, length and limit are held to what a
 *   match can have (`DUEL_LIMITS`: the three limits, nothing else); the length
 *   is capped by the pool as a Twitch Mode match's is.
 * - **Join** takes the free seat in a lobby, under a name that differs from
 *   the host's. A full room, a taken name and a room that has gone are `409`,
 *   each with its code.
 * - **Peek** says what an invite link opens on: a lobby to join (and whose),
 *   a full room, or none.
 *
 * Create and join each cost a run start against the caller's IP and a
 * Turnstile pass, in that order and before the room is touched, so codes can't
 * be guessed at speed; peek costs a start. Names get the leaderboards' checks:
 * the form (`checkNickname`), then the blocklist (moderation.ts).
 *
 * The seat token (token.ts) is signed for the room's own key, not its code:
 * it is no use in any other room.
 */

import {
  checkNickname,
  duelQuestions,
  isDuelLength,
  isDuelLimit,
  isDuelPool,
  isRoomCode,
  resolveVariant,
  roomCodeFrom,
} from "@bt/core";
import type {
  ApiError,
  DuelLength,
  DuelLimit,
  DuelPool,
  Player,
  RoomJoinRefusal,
  RoomJoinRequest,
  RoomPeekRequest,
  RoomPeekResponse,
  RoomSeatResponse,
  RoomSettings,
} from "@bt/core";
import { moderate } from "./moderation.js";
import type { RateDecision } from "./rate-limit.js";
import type { RoomEvent } from "./room-analytics.js";
import { mintKey } from "./room-host.js";
import type { RoomMeta, RoomToMake } from "./room-host.js";
import { signRoomToken } from "./token.js";
import type { TurnstileOutcome } from "./turnstile.js";

/** A join as the room's Durable Object answers it: the seat, and what its token needs. */
export type RoomJoined =
  | {
      readonly ok: true;
      readonly seat: number;
      readonly key: string;
      readonly settings: RoomSettings;
    }
  | { readonly ok: false; readonly reason: RoomJoinRefusal };

/** The room's Durable Object, as the handlers use it (room-do.ts; a memory room in tests). */
export interface RoomStub {
  /** False when a room already holds this code. */
  create(room: RoomToMake): Promise<boolean>;
  join(player: { readonly id: string; readonly name: string }, now: number): Promise<RoomJoined>;
  peek(now: number): Promise<RoomPeekResponse>;
}

export interface RoomContext {
  readonly deck: readonly Player[];
  readonly secret: string;
  readonly clock: () => Date;
  readonly uuid: () => string;
  /** `n` random bytes, for the room's code. */
  readonly randomBytes: (n: number) => Uint8Array;
  readonly verifyTurnstile: (token: string) => Promise<TurnstileOutcome>;
  /** The Durable Object for the room with this code. */
  readonly rooms: (code: string) => RoomStub;
  /** Counted per IP: a room made, a join tried and a peek each cost a run start. */
  readonly limits?: { start(): Promise<RateDecision> };
  /** The blocklist; moderation.ts's by default. */
  readonly moderate?: (nickname: string) => boolean;
  /** Must not throw; app.ts's recorder swallows its own failures. */
  readonly record?: (event: RoomEvent) => void;
  readonly country?: string;
  readonly deckVersion?: string;
}

export type RoomResult =
  | { readonly status: 200; readonly body: RoomSeatResponse | RoomPeekResponse }
  | { readonly status: 400 | 403 | 409 | 422 | 502 | 503; readonly body: ApiError }
  | {
      readonly status: 429;
      readonly body: ApiError;
      readonly retryAfter: number;
      readonly limit: "starts";
    };

/** Turnstile's own ceiling on a token's length. */
const MAX_TURNSTILE_CHARS = 2048;

/** The longest pool id a request may name: `squad:` and a theme id (variants.ts). */
const MAX_POOL_CHARS = 90;

/** Far past a real nickname: the form is checked by `checkNickname`. */
const MAX_NAME_CHARS = 64;

/** How many codes a create tries before giving up: a collision is already a rarity. */
const CODE_ATTEMPTS = 5;

// ----------------------------------------------------------------- create

export async function handleRoomCreate(body: unknown, ctx: RoomContext): Promise<RoomResult> {
  const limited = await ctx.limits?.start();
  if (limited?.ok === false) return rateLimited(limited.retryAfter);

  const parsed = parseCreate(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const req = parsed.value;
  // A squad names a theme, which only the deck can vouch for.
  const questions = duelQuestions(req.pool, req.questions, ctx.deck);
  if (questions === undefined || resolveVariant(req.pool, ctx.deck) === undefined) {
    return badRequest("pool names no theme in this deck");
  }

  const name = nameOf(req.name, ctx);
  if (!name.ok) return name.result;

  const verdict = await ctx.verifyTurnstile(req.turnstileToken);
  if (verdict === "fail") return { status: 403, body: { error: "verification_failed" } };
  if (verdict === "error") {
    return { status: 502, body: { error: "unavailable", detail: "turnstile" } };
  }

  const now = ctx.clock().getTime();
  const settings: RoomSettings = { mode: "duel", pool: req.pool, questions, limit: req.limit };
  const meta: RoomMeta = {
    country: ctx.country ?? "XX",
    deckVersion: ctx.deckVersion ?? "unknown",
  };
  const key = mintKey(now, ctx.uuid());
  const player = ctx.uuid();
  let code: string | undefined;
  for (let attempt = 0; attempt < CODE_ATTEMPTS && code === undefined; attempt++) {
    const candidate = roomCodeFrom(ctx.randomBytes(16));
    if (candidate === undefined) continue;
    const made = await ctx.rooms(candidate).create({
      now,
      key,
      code: candidate,
      settings,
      host: { id: player, name: name.nickname },
      meta,
    });
    if (made) code = candidate;
  }
  if (code === undefined) return { status: 503, body: { error: "unavailable", detail: "codes" } };

  const token = await signRoomToken(ctx.secret, { v: 1, room: key, seat: 0, player });
  ctx.record?.({ type: "room", room: key, settings });
  const response: RoomSeatResponse = { code, token, settings, name: name.nickname };
  return { status: 200, body: response };
}

// ------------------------------------------------------------------- join

export async function handleRoomJoin(body: unknown, ctx: RoomContext): Promise<RoomResult> {
  const limited = await ctx.limits?.start();
  if (limited?.ok === false) return rateLimited(limited.retryAfter);

  const parsed = parseJoin(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const req = parsed.value;

  const name = nameOf(req.name, ctx);
  if (!name.ok) return name.result;

  const verdict = await ctx.verifyTurnstile(req.turnstileToken);
  if (verdict === "fail") return { status: 403, body: { error: "verification_failed" } };
  if (verdict === "error") {
    return { status: 502, body: { error: "unavailable", detail: "turnstile" } };
  }

  const player = ctx.uuid();
  const joined = await ctx
    .rooms(req.code)
    .join({ id: player, name: name.nickname }, ctx.clock().getTime());
  if (!joined.ok) return { status: 409, body: { error: "conflict", detail: joined.reason } };

  const token = await signRoomToken(ctx.secret, {
    v: 1,
    room: joined.key,
    seat: joined.seat,
    player,
  });
  const response: RoomSeatResponse = {
    code: req.code,
    token,
    settings: joined.settings,
    name: name.nickname,
  };
  return { status: 200, body: response };
}

// ------------------------------------------------------------------- peek

export async function handleRoomPeek(body: unknown, ctx: RoomContext): Promise<RoomResult> {
  const limited = await ctx.limits?.start();
  if (limited?.ok === false) return rateLimited(limited.retryAfter);

  const parsed = parsePeek(body);
  if (!parsed.ok) return badRequest(parsed.detail);
  const response: RoomPeekResponse = await ctx.rooms(parsed.value.code).peek(ctx.clock().getTime());
  return { status: 200, body: response };
}

// --------------------------------------------------------------- helpers

/** The name, by the leaderboards' rules: its form, then the blocklist. */
function nameOf(
  raw: string,
  ctx: RoomContext,
): { ok: true; nickname: string } | { ok: false; result: RoomResult } {
  const name = checkNickname(raw);
  if (!name.ok) {
    // A name in another script gets the same calm "try another" as a blocked one.
    return {
      ok: false,
      result: name.problem === "script" ? rejectedName() : badRequest(`nickname_${name.problem}`),
    };
  }
  if (!(ctx.moderate ?? moderate)(name.nickname)) return { ok: false, result: rejectedName() };
  return { ok: true, nickname: name.nickname };
}

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

function keysOf(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

function same(sorted: readonly string[], expected: readonly string[]): boolean {
  return sorted.length === expected.length && sorted.every((k, i) => k === expected[i]);
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= MAX_TURNSTILE_CHARS;
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_NAME_CHARS;
}

interface CreateRequest {
  readonly pool: DuelPool;
  readonly questions: DuelLength;
  readonly limit: DuelLimit;
  readonly name: string;
  readonly turnstileToken: string;
}

export function parseCreate(body: unknown): Parsed<CreateRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  if (!same(keysOf(record), ["limit", "name", "pool", "questions", "turnstileToken"])) {
    return { ok: false, detail: "expected { pool, questions, limit, name, turnstileToken }" };
  }
  const { pool, questions, limit, name, turnstileToken } = record;
  if (typeof pool !== "string" || pool.length > MAX_POOL_CHARS || !isDuelPool(pool)) {
    return {
      ok: false,
      detail: 'pool must be "endless", "endless-instagram" or "squad:<theme>"',
    };
  }
  if (!isDuelLength(questions)) return { ok: false, detail: "questions must be 10 or 20" };
  if (!isDuelLimit(limit)) return { ok: false, detail: "limit must be 10, 20 or 30" };
  if (!isName(name)) return { ok: false, detail: "name must be a nickname" };
  if (!isToken(turnstileToken)) {
    return { ok: false, detail: "turnstileToken must be a Turnstile token" };
  }
  return { ok: true, value: { pool, questions, limit, name, turnstileToken } };
}

export function parseJoin(body: unknown): Parsed<RoomJoinRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  if (!same(keysOf(record), ["code", "name", "turnstileToken"])) {
    return { ok: false, detail: "expected { code, name, turnstileToken }" };
  }
  const { code, name, turnstileToken } = record;
  if (!isRoomCode(code)) return { ok: false, detail: "code must be a room code" };
  if (!isName(name)) return { ok: false, detail: "name must be a nickname" };
  if (!isToken(turnstileToken)) {
    return { ok: false, detail: "turnstileToken must be a Turnstile token" };
  }
  return { ok: true, value: { code, name, turnstileToken } };
}

export function parsePeek(body: unknown): Parsed<RoomPeekRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  if (!same(keysOf(record), ["code"])) return { ok: false, detail: "expected { code }" };
  const { code } = record;
  if (!isRoomCode(code)) return { ok: false, detail: "code must be a room code" };
  return { ok: true, value: { code } };
}

function badRequest(detail: string): RoomResult {
  return { status: 400, body: { error: "bad_request", detail } };
}

function rejectedName(): RoomResult {
  return { status: 422, body: { error: "nickname_rejected" } };
}

function rateLimited(retryAfter: number): RoomResult {
  return { status: 429, body: { error: "rate_limited" }, retryAfter, limit: "starts" };
}
