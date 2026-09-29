/**
 * The Endless leaderboard page's view logic, pure so it runs under test: the
 * rows to show, with the player's own entry merged in; the countdown to the
 * reset; the previous period's winner. `Leaderboard.svelte` renders it.
 *
 * **The player's own row comes from their device** (device.ts), kept from
 * their submit response. The board is served from a cache up to a minute old,
 * so a player who has just published may not be on it yet — and a shadowed
 * score is never on anyone else's. Either way, when the device has a standing
 * for the period on show and the board doesn't have that entry, it is put in
 * at its rank (if that's in the top 100) or shown under the table, so the
 * player always sees themselves.
 */

import { countdown } from "@bt/core";
import type { BoardEntry, BoardPeriod, BoardResponse } from "@bt/core";
import { t } from "../i18n";
import type { Fetch } from "./api";
import type { Standing } from "./device";
import { count, ordinal } from "./publish";

export const BOARD_ENDPOINT = "/api/board/endless";

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
  /** The player's own entry. */
  readonly mine: boolean;
  /** A stable key for the list. */
  readonly key: string;
}

export interface BoardView {
  readonly rows: readonly BoardRow[];
  /** Devices on the board, the player counted if they aren't in it yet. */
  readonly total: number;
  /** "You: 412th of 3,208", when the player's entry is below the rows. Null otherwise. */
  readonly ownLine: string | null;
}

/** The board as the page shows it, with the player's own standing, if any, merged in. */
export function boardView(board: BoardResponse, own: Standing | undefined): BoardView {
  const plain = (e: BoardEntry): BoardRow => ({
    rank: e.rank,
    nickname: e.nickname,
    streak: e.streak,
    mine: false,
    key: e.id,
  });
  const mineHere = own !== undefined && own.period === board.period && own.key === board.key;
  if (!mineHere) return { rows: board.entries.map(plain), total: board.total, ownLine: null };

  const found = board.entries.some((e) => e.id === own.entryId);
  if (found) {
    return {
      rows: board.entries.map((e) => ({ ...plain(e), mine: e.id === own.entryId })),
      total: board.total,
      ownLine: null,
    };
  }

  const total = Math.max(board.total + 1, own.total);
  const size = Math.max(board.entries.length, 1);
  if (own.rank > size + 1 || own.rank > 100) {
    return {
      rows: board.entries.map(plain),
      total,
      ownLine: t("leaderboard.yourRank", { rank: ordinal(own.rank), total: count(total) }),
    };
  }
  // In at its rank; everyone from there down moves one place, as the player sees it.
  const rows: BoardRow[] = [];
  const mine: BoardRow = {
    rank: own.rank,
    nickname: own.nickname,
    streak: own.streak,
    mine: true,
    key: own.entryId,
  };
  for (const e of board.entries) {
    if (e.rank === own.rank) rows.push(mine);
    rows.push(e.rank >= own.rank ? { ...plain(e), rank: e.rank + 1 } : plain(e));
  }
  if (!rows.includes(mine)) rows.push(mine);
  return { rows: rows.slice(0, 100), total, ownLine: null };
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

/** "SwiftVolley42, 31", "Retired name, 31", or "no one yet". */
export function winnerText(previous: BoardResponse["previous"]): string {
  const { winner } = previous;
  if (winner === null) return t("leaderboard.noWinner");
  return t("leaderboard.winnerLine", {
    name: winner.nickname ?? t("leaderboard.retired"),
    streak: winner.streak,
  });
}

/** "1 player", "3,208 players". */
export function totalText(total: number): string {
  return total === 1
    ? t("leaderboard.total.one")
    : t("leaderboard.total.other", { total: count(total) });
}
