/**
 * Friendly run ids: `YYYYMMDD-<uuid>.<sig>`, the date in UTC.
 *
 * The body, `YYYYMMDD-<uuid>`, names the run. The date does two jobs. It fixes
 * `now` for the whole run — age is computed from it, so a run straddling
 * midnight on someone's birthday can't change a value between rounds — and it
 * bounds which runs the server will answer, so a caller can't pick an
 * arbitrary reference date.
 *
 * The signature proves the server minted the id: a truncated, unpadded
 * base64url HMAC-SHA256 of `"run:" + body` under `RUN_SECRET`. It is what lets
 * the answer rate limit key on the run (rate-limit.ts) — a caller can't invent
 * a fresh run id per request to dodge it — and what M5's challenge links rely
 * on. Unsigned, tampered and malformed ids are all refused.
 *
 * The seed derives from the body alone (seed.ts). The signature is itself a
 * function of the body and the secret, so it adds nothing to the seed, and
 * leaving it out means the sequence doesn't depend on how the signature is
 * encoded or truncated.
 */

import { hmacSha256, timingSafeEqual, toBase64Url } from "./hmac.js";

/** 128 bits of the HMAC: far beyond guessing, and 22 characters in a link. */
const SIGNATURE_BYTES = 16;
const SIGNATURE_CHARS = Math.ceil((SIGNATURE_BYTES * 4) / 3);

const RUN_ID = new RegExp(
  "^((\\d{4})(\\d{2})(\\d{2})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})" +
    `\\.([A-Za-z0-9_-]{${SIGNATURE_CHARS}})$`,
);

/** How far a run's date may sit from the server's current UTC date. */
export const RUN_DATE_TOLERANCE_DAYS = 1;

const DAY_MS = 86_400_000;

export interface RunId {
  /** `YYYYMMDD-<uuid>`: what the seed and the answer rate limit use. */
  readonly body: string;
  /** The run's reference date — its day at 00:00 UTC. */
  readonly date: Date;
}

/** A fresh, signed run id for today (UTC). */
export async function mintRunId(now: Date, uuid: string, secret: string): Promise<string> {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const body = `${y}${m}${d}-${uuid}`;
  return `${body}.${await signature(secret, body)}`;
}

/**
 * The run id's parts when it is well formed and names a real date; undefined
 * otherwise. Says nothing about the signature — see `verifyRunId`.
 */
export function parseRunId(runId: string): RunId | undefined {
  const match = RUN_ID.exec(runId);
  if (match === null) return undefined;
  const [, body, y, m, d] = match;
  if (body === undefined) return undefined;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Date.UTC rolls 2026-02-31 over to March; a real date round-trips exactly.
  if (date.getUTCDate() !== Number(d) || date.getUTCMonth() !== Number(m) - 1) return undefined;
  return { body, date };
}

/** The run id's parts if this server signed it; undefined if not, or if malformed. */
export async function verifyRunId(runId: string, secret: string): Promise<RunId | undefined> {
  const parsed = parseRunId(runId);
  if (parsed === undefined) return undefined;
  const given = runId.slice(parsed.body.length + 1);
  return timingSafeEqual(given, await signature(secret, parsed.body)) ? parsed : undefined;
}

/** True when the run's date is within the tolerance of today (UTC). */
export function isRunDateCurrent(date: Date, clock: Date): boolean {
  const today = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
  return Math.abs(date.getTime() - today) <= RUN_DATE_TOLERANCE_DAYS * DAY_MS;
}

async function signature(secret: string, body: string): Promise<string> {
  const mac = await hmacSha256(secret, `run:${body}`);
  return toBase64Url(mac.subarray(0, SIGNATURE_BYTES));
}
