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
 * a fresh run id per request to dodge it. Unsigned, tampered and malformed ids
 * are all refused.
 *
 * **Replays.** A challenge link (challenge.ts) replays someone else's run. The
 * server mints the friend a replay id, `YYYYMMDD-<uuid>~<uuid>.<sig>`: the
 * original run's body, then a fresh uuid of the friend's own. The original
 * body (`origin`) gives the seed and the date, so the replay deals exactly the
 * same rounds; the whole body is the rate-limit key, so everyone replaying one
 * shared link gets their own answer allowance instead of sharing one run's.
 * The two forms can't be confused — only a replay body contains `~` — so both
 * are signed the same way.
 *
 * The seed derives from the origin alone (seed.ts). The signature is itself a
 * function of the body and the secret, so it adds nothing to the seed, and
 * leaving it out means the sequence doesn't depend on how the signature is
 * encoded or truncated.
 */

import { hmacSha256, timingSafeEqual, toBase64Url } from "./hmac.js";

/** 128 bits of the HMAC: far beyond guessing, and 22 characters in a link. */
export const SIGNATURE_BYTES = 16;
const SIGNATURE_CHARS = Math.ceil((SIGNATURE_BYTES * 4) / 3);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RUN_ID = new RegExp(
  `^(((\\d{4})(\\d{2})(\\d{2})-${UUID})(?:~${UUID})?)` + `\\.([A-Za-z0-9_-]{${SIGNATURE_CHARS}})$`,
);

/** How far a fresh run's date may sit from the server's current UTC date. */
export const RUN_DATE_TOLERANCE_DAYS = 1;

/**
 * How long a challenge link stays playable, counted from the challenged run's
 * own date. Past it, the link opens a fresh run with a note instead.
 */
export const CHALLENGE_DAYS = 10;

const DAY_MS = 86_400_000;

export interface RunId {
  /**
   * Everything before the signature: `YYYYMMDD-<uuid>`, or for a replay
   * `YYYYMMDD-<uuid>~<uuid>`. The answer rate limit keys on this.
   */
  readonly body: string;
  /**
   * The run being played, `YYYYMMDD-<uuid>`: the body itself for a fresh run,
   * the challenged run's body for a replay. The seed and challenge links use it.
   */
  readonly origin: string;
  /** The run's reference date — the origin's day at 00:00 UTC. */
  readonly date: Date;
  /** A replay of someone's run, minted from a challenge link. */
  readonly replay: boolean;
}

/** A fresh, signed run id for today (UTC). */
export async function mintRunId(now: Date, uuid: string, secret: string): Promise<string> {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return signRunBody(secret, `${y}${m}${d}-${uuid}`);
}

/** A replay id for `run`: its origin and date, with a fresh uuid of its own. */
export async function mintReplayId(run: RunId, uuid: string, secret: string): Promise<string> {
  return signRunBody(secret, `${run.origin}~${uuid}`);
}

/** `body` with this server's signature: a run id it will answer. */
export async function signRunBody(secret: string, body: string): Promise<string> {
  return `${body}.${await signature(secret, body)}`;
}

/**
 * The run id's parts when it is well formed and names a real date; undefined
 * otherwise. Says nothing about the signature — see `verifyRunId`.
 */
export function parseRunId(runId: string): RunId | undefined {
  const match = RUN_ID.exec(runId);
  if (match === null) return undefined;
  const [, body, origin, y, m, d] = match;
  if (body === undefined || origin === undefined) return undefined;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Date.UTC rolls 2026-02-31 over to March; a real date round-trips exactly.
  if (date.getUTCDate() !== Number(d) || date.getUTCMonth() !== Number(m) - 1) return undefined;
  return { body, origin, date, replay: body !== origin };
}

/** The run id's parts if this server signed it; undefined if not, or if malformed. */
export async function verifyRunId(runId: string, secret: string): Promise<RunId | undefined> {
  const parsed = parseRunId(runId);
  if (parsed === undefined) return undefined;
  const given = runId.slice(parsed.body.length + 1);
  return timingSafeEqual(given, await signature(secret, parsed.body)) ? parsed : undefined;
}

/** True when a fresh run's date is within the tolerance of today (UTC). */
export function isRunDateCurrent(date: Date, clock: Date): boolean {
  const age = ageInDays(date, clock);
  return Math.abs(age) <= RUN_DATE_TOLERANCE_DAYS;
}

/**
 * True when a challenge link for a run of this date may still start a replay:
 * up to `CHALLENGE_DAYS` old, and never further ahead than a fresh run may be.
 */
export function isChallengeDateCurrent(date: Date, clock: Date): boolean {
  const age = ageInDays(date, clock);
  return age >= -RUN_DATE_TOLERANCE_DAYS && age <= CHALLENGE_DAYS;
}

/**
 * Whether an answer on this run is still taken. A fresh run keeps the ±1-day
 * rule. A replay is taken for the challenge window plus that same day's grace,
 * so a replay started just before the link expires can be finished.
 */
export function isRunAnswerable(run: RunId, clock: Date): boolean {
  if (!run.replay) return isRunDateCurrent(run.date, clock);
  const age = ageInDays(run.date, clock);
  return age >= -RUN_DATE_TOLERANCE_DAYS && age <= CHALLENGE_DAYS + RUN_DATE_TOLERANCE_DAYS;
}

/** Whole days from the run's date to the server's UTC date; negative if ahead. */
function ageInDays(date: Date, clock: Date): number {
  const today = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
  return Math.round((today - date.getTime()) / DAY_MS);
}

async function signature(secret: string, body: string): Promise<string> {
  const mac = await hmacSha256(secret, `run:${body}`);
  return toBase64Url(mac.subarray(0, SIGNATURE_BYTES));
}
