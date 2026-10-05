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

import { checkNickname, dayKeyDate, periodOf } from "@bt/core";
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
import type { StorageAccess } from "./best";
import { saveNickname, saveShowCountry } from "./device";
import type { Standing } from "./device";

export const SUBMIT_ENDPOINT = "/api/run/submit";

/** Past a slow publish; the server does a Turnstile check and a few writes. */
export const PUBLISH_TIMEOUT_MS = 15_000;

/**
 * The name the publish dialog starts with: what the player typed and left
 * unpublished earlier this visit (an in-memory draft), else the name last
 * published from this device (`bt:nickname`), else a generated one.
 */
export function startingNickname(
  draft: string | undefined,
  remembered: string | null,
  generate: () => string,
): string {
  return draft ?? remembered ?? generate();
}

/**
 * After a publish attempt: remembers the name only if the run was published,
 * as the server stored it, and the "Show my country flag" choice it went with.
 * A refused name is never remembered.
 */
export function rememberPublished(
  storage: StorageAccess,
  outcome: PublishOutcome,
  showCountry?: boolean,
): void {
  if (outcome.kind !== "published") return;
  saveNickname(storage, outcome.response.nickname);
  if (showCountry !== undefined) saveShowCountry(storage, showCountry);
}

/**
 * The day a run counts on, as its period key (`2026-09-29`): the UTC date in
 * its run id (`YYYYMMDD-<uuid>.<sig>`), as the server ranks it. Null for an
 * id that doesn't carry one.
 */
export function runDay(runId: string): string | null {
  const match = /^(\d{8})-/.exec(runId);
  const date = match === null ? undefined : dayKeyDate(Number(match[1]));
  return date === undefined ? null : periodOf(date, "day").key;
}

/**
 * What the game-over panel offers for a run that scored: Publish, or — when
 * this device has already published a run at least as good on the run's day
 * — the best to beat. A run that can't beat the day's best can't beat the
 * week's or the month's either (they are at least as high), so publishing it
 * would move nothing. An equal score doesn't beat it: the board would keep
 * the earlier run in all but a rare tie on time.
 *
 * `standings` are what this device kept from its last publishes (device.ts);
 * with none for the run's day — the first run of the day, or storage cleared —
 * Publish it is, and the server's answer settles it (`improved`).
 */
export type PublishOffer =
  { readonly kind: "publish" } | { readonly kind: "beat"; readonly best: number };

export function publishOffer(
  score: number,
  runId: string | null,
  standings: readonly Standing[],
): PublishOffer {
  const day = runId === null ? null : runDay(runId);
  const kept = standings.find((s) => s.period === "day" && s.key === day);
  return kept !== undefined && score <= kept.streak
    ? { kind: "beat", best: kept.streak }
    : { kind: "publish" };
}

/** The panel's line in Publish's place: "Your best today is 18 — beat it to move up the leaderboard". */
export function beatText(best: number, current = true): string {
  return t("over.beatBest", { when: periodWords("day", current), best: count(best) });
}

/**
 * What the dialog says once a run is published: "Published." when it moved
 * today's board, or, when the device's earlier run still stands, that the
 * board keeps that one.
 */
export function publishedText(response: SubmitResponse): string {
  const day = response.periods.day;
  return day.improved
    ? t("publish.done")
    : t("publish.kept", { when: periodWords("day", day.current), best: count(day.best) });
}

/** The panel's line after a publish: the day's rank, or the best still to beat. */
export function panelText(response: SubmitResponse): string {
  const day = response.periods.day;
  return day.improved ? rankText("day", day) : beatText(day.best, day.current);
}

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
