/**
 * Publishing an Endless run to the leaderboards (`POST /api/run/submit`),
 * from the game-over panel's dialog. Opt-in: nothing is sent unless the
 * player presses Publish.
 *
 * The run is proved by the signed result its last answer came back with, or,
 * for a run banked after the connection dropped, by the latest progress token
 * (`EndlessApi`). The request carries that token, the nickname, this device's
 * random id (device.ts) and a fresh Turnstile token: each is good for one try.
 *
 * Every refusal is calm and says what to do: another name, wait a minute,
 * try again. Where the run landed comes back per period, as its owner sees it,
 * and is kept on the device (device.ts) for the board page.
 */

import { checkNickname } from "@bt/core";
import type {
  BoardPeriod,
  NicknameProblem,
  PeriodRank,
  SubmitRequest,
  SubmitResponse,
} from "@bt/core";
import { LOCALE, t } from "../i18n";
import type { MessageKey } from "../i18n";
import type { Fetch } from "./api";

export const SUBMIT_ENDPOINT = "/api/run/submit";

/** Past a slow publish; the server does a Turnstile check and a few writes. */
export const PUBLISH_TIMEOUT_MS = 15_000;

/** How a publish went. */
export type PublishOutcome =
  | { readonly kind: "published"; readonly response: SubmitResponse }
  /** The name didn't pass: "try another name". */
  | { readonly kind: "rejected" }
  /** More than 30 minutes after the run ended. */
  | { readonly kind: "expired" }
  /** Already on the board (a retry after a lost response, say). */
  | { readonly kind: "already" }
  /** Too many publishes from this connection. */
  | { readonly kind: "slowDown" }
  /** Turnstile said no: a fresh check, then try again. */
  | { readonly kind: "checkFailed" }
  /** No connection, a timeout or a server problem: try again. */
  | { readonly kind: "failed" }
  /** Not a run the board can take (void, unknown): nothing to retry. */
  | { readonly kind: "unpublishable" };

/** Whether trying again, as it stands, could work. */
export function canRetry(outcome: PublishOutcome): boolean {
  return (
    outcome.kind === "rejected" ||
    outcome.kind === "slowDown" ||
    outcome.kind === "checkFailed" ||
    outcome.kind === "failed"
  );
}

export async function publishRun(
  fetchFn: Fetch,
  body: SubmitRequest,
  timeoutMs = PUBLISH_TIMEOUT_MS,
): Promise<PublishOutcome> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchFn(SUBMIT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    if (response.ok) {
      return { kind: "published", response: (await response.json()) as SubmitResponse };
    }
    let detail: unknown;
    let error: unknown;
    try {
      ({ error, detail } = (await response.json()) as { error?: unknown; detail?: unknown });
    } catch {
      // No body worth reading: decided by the status below.
    }
    if (response.status === 422 || error === "nickname_rejected") return { kind: "rejected" };
    if (response.status === 429) return { kind: "slowDown" };
    if (response.status === 403) return { kind: "checkFailed" };
    if (response.status === 409) {
      if (detail === "expired") return { kind: "expired" };
      if (detail === "submitted") return { kind: "already" };
      return { kind: "unpublishable" };
    }
    if (response.status === 400) {
      return typeof detail === "string" && detail.startsWith("nickname_")
        ? { kind: "rejected" }
        : { kind: "unpublishable" };
    }
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** What the dialog says after a publish that didn't go through. */
export function outcomeText(outcome: Exclude<PublishOutcome, { kind: "published" }>): string {
  const key: Record<typeof outcome.kind, MessageKey> = {
    rejected: "publish.rejected",
    expired: "publish.expired",
    already: "publish.already",
    slowDown: "publish.slowDown",
    checkFailed: "publish.checkFailed",
    failed: "publish.failed",
    unpublishable: "publish.unpublishable",
  };
  return t(key[outcome.kind]);
}

/** What's wrong with a nickname as typed, or null when it will do. */
export function nicknameText(raw: string): string | null {
  const check = checkNickname(raw);
  if (check.ok) return null;
  const key: Record<NicknameProblem, MessageKey> = {
    short: "publish.tooShort",
    long: "publish.tooLong",
    characters: "publish.characters",
    script: "publish.rejected",
  };
  return t(key[check.problem]);
}

/** A random number in [0, 1) from the browser's crypto, for the generated nickname. */
export function cryptoRandom(): number {
  return (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 101st, 111th, 412th. */
export function ordinal(n: number): string {
  const lastTwo = n % 100;
  const last = n % 10;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13
      ? "th"
      : last === 1
        ? "st"
        : last === 2
          ? "nd"
          : last === 3
            ? "rd"
            : "th";
  return `${count(n)}${suffix}`;
}

/** 3208 → "3,208". */
export function count(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

/** "today", "this week"… or, for a period that closed before the publish, "yesterday"… */
export function periodWords(period: BoardPeriod, current: boolean): string {
  return t(`period.${period}.${current ? "current" : "previous"}`);
}

/** "412th of 3,208 today". */
export function rankText(period: BoardPeriod, rank: PeriodRank): string {
  return t("publish.rank", {
    rank: ordinal(rank.rank),
    total: count(rank.total),
    when: periodWords(period, rank.current),
  });
}

/** "412th of 3,208 today · 1,030th of 9,877 this week · 2,114th of 20,551 this month". */
export function ranksText(response: SubmitResponse): string {
  return (["day", "week", "month"] as const)
    .map((period) => rankText(period, response.periods[period]))
    .join(` ${t("over.separator")} `);
}
