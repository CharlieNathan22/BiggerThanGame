/**
 * Run ids: `YYYYMMDD-<uuid>.<sig>`, the date in UTC.
 *
 * **Per mode.** Friendly signs `"run:" + body`, as it always has; Endless
 * signs `"run:endless:" + body`, Instagram Endless
 * `"run:endless:instagram:" + body`, and each "Clear the squad" theme
 * `"run:squad:<theme id>:" + body`. An id is only ever verified against the
 * mode it is used in, so an Endless id can't be played as Friendly or as
 * another Endless variant, and a Friendly id minted before Endless existed
 * still verifies.
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
 * **Replay ids, retired.** Friendly's challenge links used to replay someone
 * else's run under a replay id, `YYYYMMDD-<uuid>~<uuid>.<sig>`: the original
 * run's body, then a fresh uuid of the friend's own. Challenge links have moved
 * to Endless, where they set a score to beat on a fresh run, so no replay id is
 * minted any more. The form is still recognised (`replay`), so one arriving
 * from before the change is refused by name rather than as malformed.
 *
 * The seed derives from the origin alone (seed.ts). The signature is itself a
 * function of the body and the secret, so it adds nothing to the seed, and
 * leaving it out means the sequence doesn't depend on how the signature is
 * encoded or truncated.
 */

import { isSquadVariantId, resolveVariant } from "@bt/core";
import type { EndlessVariantId, NamedVariant, Player, StaticVariantId } from "@bt/core";
import { hmacSha256, timingSafeEqual, toBase64Url } from "./hmac.js";

/**
 * The kinds of run with run ids: Friendly, and each Endless variant (variants.ts
 * in @bt/core), general Endless being `endless`. Ranked will number its games
 * instead.
 */
export type RunMode = "friendly" | EndlessVariantId;

/**
 * What each kind's run-id signature covers, before the body. Each Endless
 * variant signs under its own, so a run id only ever verifies as the variant it
 * was minted for.
 */
const RUN_PREFIX: Readonly<Record<"friendly" | StaticVariantId, string>> = {
  friendly: "run:",
  endless: "run:endless:",
  "endless-instagram": "run:endless:instagram:",
};

/** A "Clear the squad" theme signs under `run:squad:<theme id>:`. */
function runPrefix(mode: RunMode): string {
  return isSquadVariantId(mode) ? `run:${mode}:` : RUN_PREFIX[mode];
}

/** The kind of run a request names: its mode, and for Endless its variant if any. */
export function runModeOf(mode: "friendly" | "endless", variant?: NamedVariant): RunMode {
  return mode === "friendly" ? "friendly" : (variant ?? "endless");
}

/** What `buildRun` needs to deal a run of this kind: its mode, and its Endless variant. */
export function dealOptions(
  kind: RunMode,
):
  { readonly mode: "friendly" } | { readonly mode: "endless"; readonly variant: EndlessVariantId } {
  return kind === "friendly" ? { mode: "friendly" } : { mode: "endless", variant: kind };
}

/**
 * Whether `deck` can deal runs of this kind: always, but for a "Clear the
 * squad" theme the deck no longer has (its run ids still verify, since the
 * signature names the theme, not the deck).
 */
export function canDeal(kind: RunMode, deck: readonly Player[]): boolean {
  return kind === "friendly" || resolveVariant(kind, deck) !== undefined;
}

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

/** A fresh, signed run id of `mode` for today (UTC). */
export async function mintRunId(
  now: Date,
  uuid: string,
  secret: string,
  mode: RunMode = "friendly",
): Promise<string> {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return signRunBody(secret, `${y}${m}${d}-${uuid}`, mode);
}

/** `body` with this server's signature for `mode`: a run id it will answer there. */
export async function signRunBody(
  secret: string,
  body: string,
  mode: RunMode = "friendly",
): Promise<string> {
  return `${body}.${await signature(secret, body, mode)}`;
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

/**
 * The run id's parts if this server signed it for `mode`; undefined if not, if
 * it was signed for another mode, or if malformed.
 */
export async function verifyRunId(
  runId: string,
  secret: string,
  mode: RunMode = "friendly",
): Promise<RunId | undefined> {
  const parsed = parseRunId(runId);
  if (parsed === undefined) return undefined;
  const given = runId.slice(parsed.body.length + 1);
  return timingSafeEqual(given, await signature(secret, parsed.body, mode)) ? parsed : undefined;
}

/** True when a fresh run's date is within the tolerance of today (UTC). */
export function isRunDateCurrent(date: Date, clock: Date): boolean {
  const age = ageInDays(date, clock);
  return Math.abs(age) <= RUN_DATE_TOLERANCE_DAYS;
}

/**
 * True when a challenge link naming a run of this date may still be taken up:
 * up to `CHALLENGE_DAYS` old, and never further ahead than a fresh run may be.
 */
export function isChallengeDateCurrent(date: Date, clock: Date): boolean {
  const age = ageInDays(date, clock);
  return age >= -RUN_DATE_TOLERANCE_DAYS && age <= CHALLENGE_DAYS;
}

/**
 * Whether a request about this run is still taken: within the ±1-day rule, and
 * never a replay id — those were retired with Friendly's challenge links.
 */
export function isRunAnswerable(run: RunId, clock: Date): boolean {
  return !run.replay && isRunDateCurrent(run.date, clock);
}

/** Whole days from the run's date to the server's UTC date; negative if ahead. */
function ageInDays(date: Date, clock: Date): number {
  const today = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
  return Math.round((today - date.getTime()) / DAY_MS);
}

async function signature(secret: string, body: string, mode: RunMode): Promise<string> {
  const mac = await hmacSha256(secret, `${runPrefix(mode)}${body}`);
  return toBase64Url(mac.subarray(0, SIGNATURE_BYTES));
}
