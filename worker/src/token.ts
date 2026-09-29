/**
 * Progress tokens and result tokens (ARCHITECTURE.md §8).
 *
 *   token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(RUN_SECRET, prefix + payloadB64))
 *
 * **Signed, never encrypted.** Assume the client reads every byte: a progress
 * token carries only what is already on screen — the round, the streak, the two
 * players' ids, the stat and the anchor's figure — plus the server's timing and
 * a nonce. The challenger's figure is never in it. The HMAC is over the encoded
 * payload under its own prefix (`"token:"`, `"result:"`), so no other use of
 * `RUN_SECRET` can produce a valid token, and one kind can't pass for the other.
 * Verification compares in constant time and parses strictly: a payload with a
 * missing, extra or mistyped field is not a token.
 *
 * What stops a token being used twice is not here: the run's Durable Object
 * spends each nonce once (run-ledger.ts).
 */

import { STAT_KEYS } from "@bt/core";
import type { RunEnd, StatKey } from "@bt/core";
import { hmacSha256, timingSafeEqual, toBase64Url } from "./hmac.js";

/** Far past a real token (about 450 characters); anything longer isn't one. */
export const MAX_TOKEN_CHARS = 1024;

/** One question of an Endless run, as the server issued it. */
export interface ProgressPayload {
  readonly v: 1;
  /** The signed Endless run id. */
  readonly runId: string;
  readonly mode: "endless";
  /** The round this token answers, 1-based. */
  readonly round: number;
  /** Rounds answered correctly before this one. */
  readonly streak: number;
  readonly anchorId: string;
  readonly challengerId: string;
  readonly stat: StatKey;
  /** Already on screen. */
  readonly anchorValue: number;
  /** When the server issued the token, ms since the epoch: the clock's start. */
  readonly issuedAt: number;
  /** When the server stops taking an answer (`deadlineFor`, @bt/core). */
  readonly deadline: number;
  /** Spent once, by the run's Durable Object. */
  readonly nonce: string;
}

/**
 * A finished run, for publishing it later (part 2): the run, its score, how it
 * ended, the day it started and the answer time the server measured in total.
 */
export interface ResultPayload {
  readonly v: 1;
  readonly runId: string;
  readonly mode: "endless";
  readonly score: number;
  readonly end: RunEnd;
  /** The run's start date, `YYYY-MM-DD` (UTC). */
  readonly startedOn: string;
  /** Sum of the server-measured answer times, token issue to guess received, ms. */
  readonly elapsedMs: number;
  /** When the run ended, ms since the epoch. */
  readonly endedAt: number;
}

const PROGRESS_PREFIX = "token:";
const RESULT_PREFIX = "result:";

export function signToken(secret: string, payload: ProgressPayload): Promise<string> {
  return sign(secret, PROGRESS_PREFIX, progressFields(payload));
}

export async function verifyToken(
  secret: string,
  token: string,
): Promise<ProgressPayload | undefined> {
  const json = await verify(secret, PROGRESS_PREFIX, token);
  return json === undefined ? undefined : parseProgress(json);
}

export function signResult(secret: string, payload: ResultPayload): Promise<string> {
  return sign(secret, RESULT_PREFIX, resultFields(payload));
}

export async function verifyResult(
  secret: string,
  token: string,
): Promise<ResultPayload | undefined> {
  const json = await verify(secret, RESULT_PREFIX, token);
  return json === undefined ? undefined : parseResult(json);
}

// ---------------------------------------------------------------- internals

/** Copied field by field, in a fixed order, so a token is byte-identical for one payload. */
function progressFields(p: ProgressPayload): ProgressPayload {
  return {
    v: 1,
    runId: p.runId,
    mode: p.mode,
    round: p.round,
    streak: p.streak,
    anchorId: p.anchorId,
    challengerId: p.challengerId,
    stat: p.stat,
    anchorValue: p.anchorValue,
    issuedAt: p.issuedAt,
    deadline: p.deadline,
    nonce: p.nonce,
  };
}

function resultFields(p: ResultPayload): ResultPayload {
  return {
    v: 1,
    runId: p.runId,
    mode: p.mode,
    score: p.score,
    end: p.end,
    startedOn: p.startedOn,
    elapsedMs: p.elapsedMs,
    endedAt: p.endedAt,
  };
}

async function sign(secret: string, prefix: string, payload: object): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const mac = await hmacSha256(secret, `${prefix}${body}`);
  return `${body}.${toBase64Url(mac)}`;
}

/** The payload's JSON if the token is well formed and signed under `prefix`. */
async function verify(secret: string, prefix: string, token: string): Promise<unknown> {
  if (token.length > MAX_TOKEN_CHARS) return undefined;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (match === null) return undefined;
  const [, body, sig] = match;
  if (body === undefined || sig === undefined) return undefined;
  const expected = toBase64Url(await hmacSha256(secret, `${prefix}${body}`));
  if (!timingSafeEqual(sig, expected)) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return undefined;
  }
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const PROGRESS_KEYS = [
  "anchorId",
  "anchorValue",
  "challengerId",
  "deadline",
  "issuedAt",
  "mode",
  "nonce",
  "round",
  "runId",
  "stat",
  "streak",
  "v",
];

const RESULT_KEYS = ["elapsedMs", "end", "endedAt", "mode", "runId", "score", "startedOn", "v"];

const RUN_ENDS: readonly RunEnd[] = ["wrong", "deck-exhausted", "won", "timeout", "disconnected"];

function record(json: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined;
  const r = json as Record<string, unknown>;
  const own = Object.keys(r).sort();
  if (own.length !== keys.length || own.some((k, i) => k !== keys[i])) return undefined;
  return r.v === 1 ? r : undefined;
}

const isString = (v: unknown, max = 128): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function parseProgress(json: unknown): ProgressPayload | undefined {
  const r = record(json, PROGRESS_KEYS);
  if (r === undefined) return undefined;
  const { runId, mode, round, streak, anchorId, challengerId, stat, anchorValue } = r;
  const { issuedAt, deadline, nonce } = r;
  if (!isString(runId) || mode !== "endless") return undefined;
  if (!isCount(round) || round < 1 || !isCount(streak) || streak !== round - 1) return undefined;
  if (!isString(anchorId) || !isString(challengerId)) return undefined;
  if (typeof stat !== "string" || !(STAT_KEYS as readonly string[]).includes(stat)) {
    return undefined;
  }
  if (typeof anchorValue !== "number" || !Number.isFinite(anchorValue)) return undefined;
  if (!isTime(issuedAt) || !isTime(deadline) || deadline < issuedAt || !isString(nonce)) {
    return undefined;
  }
  return {
    v: 1,
    runId,
    mode,
    round,
    streak,
    anchorId,
    challengerId,
    stat: stat as StatKey,
    anchorValue,
    issuedAt,
    deadline,
    nonce,
  };
}

function parseResult(json: unknown): ResultPayload | undefined {
  const r = record(json, RESULT_KEYS);
  if (r === undefined) return undefined;
  const { runId, mode, score, end, startedOn, elapsedMs, endedAt } = r;
  if (!isString(runId) || mode !== "endless" || !isCount(score)) return undefined;
  if (typeof end !== "string" || !(RUN_ENDS as readonly string[]).includes(end)) return undefined;
  if (typeof startedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startedOn)) return undefined;
  if (!isTime(elapsedMs) || !isTime(endedAt)) return undefined;
  return { v: 1, runId, mode, score, end: end as RunEnd, startedOn, elapsedMs, endedAt };
}
