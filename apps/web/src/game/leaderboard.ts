/**
 * The Endless leaderboard page's view logic, pure so it runs under test: the
 * board's rows as the server ranked them, ten to a page; where the player
 * stands; the countdown to the reset; the previous period's winner.
 * `Leaderboard.svelte` renders it.
 *
 * **Every rank is the server's.** A row shows the rank field it came with,
 * never its place in the list, and nothing is ever inserted into the list.
 *
 * **The player's own position is live.** A publish's answer goes out of date
 * as soon as anyone else publishes, so the page asks `POST
 * /api/board/endless/me` once as it loads — only when this device has
 * published to a current period (device.ts `bt:published`) — and pins that
 * above the table whenever the player's own row isn't on the page on show:
 * on another page of the top 50 (with a jump to it), or below it. If the
 * lookup fails, the rank the publish came back with is shown instead, marked
 * "when published", never as if it were current.
 */

import { countdown } from "@bt/core";
import type {
  BoardEntry,
  BoardPeriod,
  BoardResponse,
  DailyBoardEntry,
  DailyBoardResponse,
  DailyMineResponse,
  MineEntry,
  MineResponse,
} from "@bt/core";
import { t } from "../i18n";
import type { Fetch } from "./api";
import type { Standing } from "./device";
import { count, ordinal } from "./publish";

export const BOARD_ENDPOINT = "/api/board/endless";
export const MINE_ENDPOINT = "/api/board/endless/me";

/** A board, or null when it couldn't be had: no connection, a timeout, a server problem. */
export async function fetchBoard(
  fetchFn: Fetch,
  period: BoardPeriod,
  timeoutMs = 10_000,
): Promise<BoardResponse | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${BOARD_ENDPOINT}/${period}`, {
      method: "GET",
      signal: abort.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as BoardResponse;
    return body.period === period && Array.isArray(body.entries) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface BoardRow {
  readonly rank: number;
  /** Null when the name has been retired. */
  readonly nickname: string | null;
  readonly streak: number;
  /** Another entry in the period has the same streak: show the time that orders them. */
  readonly tied: boolean;
  /** Thinking time, ms; null unless tied. */
  readonly thinkMs: number | null;
  /** The flag's country code, or null for no flag. */
  readonly country: string | null;
  /** The player's own entry. */
  readonly mine: boolean;
  /** A stable key for the list. */
  readonly key: string;
  /** Daily Ranked: a perfect twenty, its score marked with a star. */
  readonly perfect?: boolean;
  /** Daily Ranked: the score as a screen reader hears it ("25: twenty out of twenty and 5 bonus"). */
  readonly spoken?: string;
}

/** Where the player's own best entry stands in the period on show. */
export interface OwnPosition {
  readonly entryId: string;
  readonly rank: number;
  /** Devices on the board, the player's counted. */
  readonly total: number;
  readonly streak: number;
  /** Null when the name has been retired. */
  readonly nickname: string | null;
  /** As on a row; the stored publish (`live` false) knows neither, so shows neither. */
  readonly tied: boolean;
  readonly thinkMs: number | null;
  readonly country: string | null;
  /** Live from the server, or the rank the player's own publish came back with. */
  readonly live: boolean;
  /** Daily Ranked, as on a row. */
  readonly perfect?: boolean;
  readonly spoken?: string;
}

export interface BoardView {
  /** The top `BOARD_SIZE`, exactly as the server ranked them. */
  readonly rows: readonly BoardRow[];
  /** Devices on the board. */
  readonly total: number;
  /** The player's own position, and its place in `rows` (null when it isn't in them). */
  readonly own: (OwnPosition & { readonly index: number | null }) | null;
}

/** The board as the page shows it: the server's rows, the player's own marked. */
export function boardView(board: BoardResponse, own: OwnPosition | null): BoardView {
  const rows = board.entries.map((e: BoardEntry) => ({
    rank: e.rank,
    nickname: e.nickname,
    streak: e.streak,
    tied: e.tied === true,
    thinkMs: e.tied === true && typeof e.thinkMs === "number" ? e.thinkMs : null,
    country: typeof e.country === "string" ? e.country : null,
    mine: own !== null && e.id === own.entryId,
    key: e.id,
  }));
  const at = own === null ? -1 : rows.findIndex((r) => r.mine);
  return {
    rows,
    total: board.total,
    own: own === null ? null : { ...own, index: at === -1 ? null : at },
  };
}

// ------------------------------------------------------------ the player's own

/** The live lookup: not needed (nothing published), on its way, answered, or failed. */
export type MineState =
  | { readonly status: "none" }
  | { readonly status: "loading" }
  | { readonly status: "ok"; readonly response: MineResponse }
  | { readonly status: "failed" };

function isMineEntry(value: unknown): value is MineEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.key === "string" &&
    typeof e.entryId === "string" &&
    typeof e.rank === "number" &&
    typeof e.total === "number" &&
    typeof e.streak === "number" &&
    (typeof e.nickname === "string" || e.nickname === null) &&
    typeof e.tied === "boolean" &&
    (typeof e.thinkMs === "number" || e.thinkMs === null) &&
    (typeof e.country === "string" || e.country === null)
  );
}

/** This device's live standing, or null when it couldn't be had. */
export async function fetchMine(
  fetchFn: Fetch,
  deviceId: string,
  timeoutMs = 10_000,
): Promise<MineResponse | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchFn(MINE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
      signal: abort.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { periods?: unknown };
    const periods = body.periods;
    if (typeof periods !== "object" || periods === null) return null;
    const each = periods as Record<string, unknown>;
    const ok = (["day", "week", "month"] as const).every(
      (p) => each[p] === null || isMineEntry(each[p]),
    );
    return ok ? (body as MineResponse) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks for the live standing once, and only when this device has published to
 * a current period (`standings`, as device.ts reads them: the reset ones are
 * gone). Otherwise there is nothing to ask about, and nothing is sent.
 */
export async function loadMine(
  fetchFn: Fetch,
  standings: readonly Standing[],
  deviceId: () => string,
): Promise<MineState> {
  if (standings.length === 0) return { status: "none" };
  const response = await fetchMine(fetchFn, deviceId());
  return response === null ? { status: "failed" } : { status: "ok", response };
}

/**
 * The player's position on the board on show (`period`, its key `key`): live
 * when the lookup answered, the stored publish's when it failed, none when
 * there's nothing to show or it's still on its way.
 */
export function ownPosition(
  period: BoardPeriod,
  key: string,
  mine: MineState,
  standings: readonly Standing[],
): OwnPosition | null {
  if (mine.status === "ok") {
    const e = mine.response.periods[period];
    return e === null || e.key !== key
      ? null
      : {
          entryId: e.entryId,
          rank: e.rank,
          total: e.total,
          streak: e.streak,
          nickname: e.nickname,
          tied: e.tied,
          thinkMs: e.tied ? e.thinkMs : null,
          country: e.country,
          live: true,
        };
  }
  if (mine.status !== "failed") return null;
  const s = standings.find((x) => x.period === period && x.key === key);
  return s === undefined
    ? null
    : {
        entryId: s.entryId,
        rank: s.rank,
        total: s.total,
        streak: s.streak,
        nickname: s.nickname,
        tied: false,
        thinkMs: null,
        country: null,
        live: false,
      };
}

// ------------------------------------------------------------ pages

/** Rows to a page: the top 50 is five pages. */
export const PAGE_SIZE = 10;

/** How many pages `rows` rows make: at least one, so an empty board still has a page. */
export function pageCount(rows: number): number {
  return Math.max(1, Math.ceil(rows / PAGE_SIZE));
}

/** A page index kept within the board's pages. */
export function clampPage(page: number, rows: number): number {
  return Math.min(Math.max(0, Math.floor(page)), pageCount(rows) - 1);
}

/** The rows on page `page` (from 0). */
export function pageRows<T>(rows: readonly T[], page: number): T[] {
  const p = clampPage(page, rows.length);
  return rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
}

/** The page a row at `index` is on. */
export function pageOf(index: number): number {
  return Math.floor(index / PAGE_SIZE);
}

/** Which board, and which page of it, is on show. A new tab starts on its first page. */
export interface Paging {
  readonly period: BoardPeriod;
  readonly page: number;
}

export function selectPeriod(period: BoardPeriod): Paging {
  return { period, page: 0 };
}

export function goToPage(paging: Paging, page: number, rows: number): Paging {
  return { ...paging, page: clampPage(page, rows) };
}

/**
 * The player's own row, pinned above rank 1, when it isn't on the page on
 * show: on another page of the top 50 (then it jumps there: `page`), or below
 * the top 50 (`page` null). Null when it's on this page, or when the player
 * hasn't published to this period.
 */
export interface Pinned extends OwnPosition {
  /** The page holding the player's row, or null when it isn't in the top 50 on show. */
  readonly page: number | null;
}

export function pinnedRow(view: BoardView, page: number): Pinned | null {
  const { own } = view;
  if (own === null) return null;
  const onPage = own.index === null ? null : pageOf(own.index);
  if (onPage === clampPage(page, view.rows.length)) return null;
  return {
    entryId: own.entryId,
    rank: own.rank,
    total: own.total,
    streak: own.streak,
    nickname: own.nickname,
    tied: own.tied,
    thinkMs: own.thinkMs,
    country: own.country,
    live: own.live,
    ...(own.perfect !== undefined ? { perfect: own.perfect } : {}),
    ...(own.spoken !== undefined ? { spoken: own.spoken } : {}),
    page: onPage,
  };
}

/** "1–10 of 50": the rows on show. Empty for an empty board. */
export function rangeText(page: number, rows: number): string {
  if (rows === 0) return "";
  const p = clampPage(page, rows);
  return t("leaderboard.range", {
    from: count(p * PAGE_SIZE + 1),
    to: count(Math.min((p + 1) * PAGE_SIZE, rows)),
    total: count(rows),
  });
}

/** "Page 2 of 5", for screen readers as the page changes. */
export function pageText(page: number, rows: number): string {
  return t("leaderboard.page", {
    page: clampPage(page, rows) + 1,
    pages: pageCount(rows),
  });
}

/**
 * Under the pinned row: "151st of 193", or, from the stored publish when the
 * live lookup failed, "1st of 1 when published"; and where its page is, if
 * it's in the top 50.
 */
export function pinnedText(pinned: Pinned): string {
  const place = t(pinned.live ? "leaderboard.pinnedPlace" : "leaderboard.pinnedThen", {
    rank: ordinal(pinned.rank),
    total: count(pinned.total),
  });
  return pinned.page === null
    ? place
    : t("leaderboard.pinnedJump", { place, page: pinned.page + 1 });
}

/** "5 hours 12 minutes", "3 days 4 hours", "12 minutes": the two largest parts. */
export function countdownText(resetsAt: number, now: number): string {
  const { days, hours, minutes } = countdown(resetsAt, now);
  const part = (n: number, unit: "days" | "hours" | "minutes"): string =>
    t(`time.${unit}.${n === 1 ? "one" : "other"}`, { n });
  const parts =
    days > 0
      ? [part(days, "days"), ...(hours > 0 ? [part(hours, "hours")] : [])]
      : hours > 0
        ? [part(hours, "hours"), ...(minutes > 0 ? [part(minutes, "minutes")] : [])]
        : [part(Math.max(minutes, 1), "minutes")];
  return parts.length === 2
    ? t("time.join", { a: parts[0] ?? "", b: parts[1] ?? "" })
    : (parts[0] ?? "");
}

/** A run of the winner line's text; the name and the streak are in gold. */
export interface Segment {
  readonly text: string;
  readonly gold: boolean;
  /** The winner's name, which their flag goes before. */
  readonly name?: true;
}

/** The winner line: its parts, and the winner's flag's country code. */
export interface WinnerLine {
  readonly parts: readonly Segment[];
  readonly country: string | null;
}

/**
 * "HardyOffside889 got a 23 streak yesterday" ("last week", "last month"):
 * the previous period's winner as one line, in parts so the name and the
 * number can be gold. "Retired name" for a retired one; null when the period
 * had no winner, and the page shows nothing.
 */
export function winnerLine(
  previous: BoardResponse["previous"],
  period: BoardPeriod,
): WinnerLine | null {
  const { winner } = previous;
  if (winner === null) return null;
  const values: Record<string, Segment> = {
    name: { text: winner.nickname ?? t("leaderboard.retired"), gold: true, name: true },
    streak: { text: count(winner.streak), gold: true },
    when: { text: t(`period.${period}.previous`), gold: false },
  };
  const parts: Segment[] = [];
  const push = (part: Segment): void => {
    if (part.text === "") return;
    const last = parts.at(-1);
    if (last !== undefined && !last.gold && !part.gold) {
      parts[parts.length - 1] = { text: last.text + part.text, gold: false };
    } else parts.push(part);
  };
  // The template's own words, its placeholders filled in their colours.
  for (const piece of t("leaderboard.winnerLine").split(/(\{\w+\})/)) {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    const value = name === undefined ? undefined : values[name];
    push(value ?? { text: piece, gold: false });
  }
  return { parts, country: typeof winner.country === "string" ? winner.country : null };
}

/** "1 player", "3,208 players". */
export function totalText(total: number): string {
  return total === 1
    ? t("leaderboard.total.one")
    : t("leaderboard.total.other", { total: count(total) });
}

// ------------------------------------------------------------ Daily Ranked

/** A Daily score as a row shows it: the number, the perfect run's star, the words. */
function dailyScore(e: Pick<DailyBoardEntry, "score" | "perfect" | "bonus">): {
  perfect: boolean;
  spoken: string;
} {
  return {
    perfect: e.perfect === true,
    spoken:
      e.perfect === true
        ? t("daily.perfectSpoken", { score: e.score, bonus: e.bonus })
        : String(e.score),
  };
}

/**
 * Where this device stands in today's game, from `/me`: its finished run's
 * row as its owner sees it, or null (nothing finished today, or no answer).
 */
export function dailyOwnPosition(mine: DailyMineResponse | null): OwnPosition | null {
  if (mine === null || mine.state !== "finished") return null;
  const e = mine.standing;
  return {
    entryId: e.id,
    rank: e.rank,
    total: mine.result.total ?? e.rank,
    streak: e.score,
    nickname: e.nickname,
    tied: e.tied,
    thinkMs: e.tied ? e.thinkMs : null,
    country: e.country,
    live: true,
    ...dailyScore(e),
  };
}

/** Today's Daily board as the page shows it: the server's rows, the player's own marked. */
export function dailyBoardView(board: DailyBoardResponse, own: OwnPosition | null): BoardView {
  const rows: BoardRow[] = board.entries.map((e) => ({
    rank: e.rank,
    nickname: e.nickname,
    streak: e.score,
    tied: e.tied === true,
    thinkMs: e.tied === true && typeof e.thinkMs === "number" ? e.thinkMs : null,
    country: typeof e.country === "string" ? e.country : null,
    mine: own !== null && e.id === own.entryId,
    key: e.id,
    ...dailyScore(e),
  }));
  const at = own === null ? -1 : rows.findIndex((r) => r.mine);
  return {
    rows,
    total: board.total,
    own: own === null ? null : { ...own, index: at === -1 ? null : at },
  };
}

/**
 * "BraveFreekick35 got 23 in Game 11": the previous game's winner in parts,
 * the name and score in gold; null before Game 2, or when nobody finished it.
 */
export function dailyWinnerLine(previous: DailyBoardResponse["previous"]): WinnerLine | null {
  if (previous === null || previous.winner === null) return null;
  const { winner } = previous;
  const values: Record<string, Segment> = {
    name: { text: winner.nickname ?? t("leaderboard.retired"), gold: true, name: true },
    score: { text: count(winner.score), gold: true },
    game: { text: t("daily.game", { game: previous.gameNo }), gold: false },
  };
  const parts: Segment[] = [];
  for (const piece of t("dailyBoard.winnerLine").split(/(\{\w+\})/)) {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    const value = name === undefined ? undefined : values[name];
    const part = value ?? { text: piece, gold: false };
    if (part.text === "") continue;
    const last = parts.at(-1);
    if (last !== undefined && !last.gold && !part.gold) {
      parts[parts.length - 1] = { text: last.text + part.text, gold: false };
    } else parts.push(part);
  }
  return { parts, country: typeof winner.country === "string" ? winner.country : null };
}
