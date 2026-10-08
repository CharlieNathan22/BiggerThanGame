/**
 * What this device keeps for the Endless boards, in `localStorage`
 * (DESIGN.md §13):
 *
 * - `bt:device` — a random id, sent only when the player publishes. The server
 *   stores a keyed hash of it, never the id: it is what "one entry per
 *   device" counts, and it is friction, not identity — clearing storage makes
 *   a new one.
 * - `bt:runs:<deck>:<mode>` — **the local board**: the device's 10 best runs
 *   with their date and score, recorded at the end of every run, published or
 *   not. Needs no network.
 * - `bt:published:<deck>:<mode>` — where the device's published best stood in
 *   each current period, from the submit response, so the board page shows the
 *   player straight away even before the cached board catches up, and the
 *   game-over panel offers Publish only for a run that beats the day's best
 *   (publish.ts `publishOffer`).
 * - `bt:nickname` — the name last published from this device, which the
 *   publish dialog starts with next time. Saved only once a publish has gone
 *   through, so a refused or abandoned name is never kept.
 * - `bt:showCountry` — whether the player last published with "Show my
 *   country flag" ticked (`1`) or not (`0`); ticked when there's nothing kept.
 *   Saved, like the nickname, once a publish has gone through.
 *
 * Storage can be missing, blocked, full or throw (best.ts has the list), so
 * every read and write is wrapped; without it the game carries on and these
 * last as long as the page.
 */

import { checkNickname } from "@bt/core";
import type { BoardPeriod, Mode, RunEnd, SubmitResponse } from "@bt/core";
import type { BestDeck, StorageAccess } from "./best";

export const DEVICE_KEY = "bt:device";

export const NICKNAME_KEY = "bt:nickname";

export const SHOW_COUNTRY_KEY = "bt:showCountry";

/** How many runs the local board keeps. */
export const LOCAL_RUNS = 10;

export function runsKey(deck: BestDeck, mode: Mode): string {
  return `bt:runs:${deck}:${mode}`;
}

export function publishedKey(deck: BestDeck, mode: Mode): string {
  return `bt:published:${deck}:${mode}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The id kept when storage refuses it: one for the whole visit. */
let visitId: string | null = null;

/**
 * This device's id: the stored one, or a new one stored now. `mint` makes a
 * v4 uuid (`crypto.randomUUID` in the browser).
 */
export function deviceId(storage: StorageAccess, mint: () => string): string {
  try {
    const stored = storage()?.getItem(DEVICE_KEY);
    if (stored !== null && stored !== undefined && UUID.test(stored)) return stored;
  } catch {
    // Unreadable: fall through to a new one.
  }
  const id = visitId ?? mint();
  visitId = id;
  try {
    storage()?.setItem(DEVICE_KEY, id);
  } catch {
    // Kept for this visit only.
  }
  return id;
}

/** This device's id if it has one already, without minting one; null otherwise. */
export function storedDeviceId(storage: StorageAccess): string | null {
  try {
    const stored = storage()?.getItem(DEVICE_KEY);
    if (stored !== null && stored !== undefined && UUID.test(stored)) return stored;
  } catch {
    // Unreadable: as if there were none.
  }
  return visitId;
}

/** One run on the local board. */
export interface LocalRun {
  readonly score: number;
  /** When it ended, `YYYY-MM-DD` in the player's own time. */
  readonly date: string;
  readonly end: RunEnd | "network";
}

const ENDS = ["wrong", "deck-exhausted", "won", "timeout", "disconnected", "network"];

function isLocalRun(value: unknown): value is LocalRun {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.score === "number" &&
    Number.isInteger(r.score) &&
    r.score >= 0 &&
    r.score <= 1000 &&
    typeof r.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    typeof r.end === "string" &&
    ENDS.includes(r.end)
  );
}

/** Best first; equal scores, the earlier first. */
function byScore(a: LocalRun, b: LocalRun): number {
  return b.score - a.score || a.date.localeCompare(b.date);
}

/** The local board, best first; empty when there's none or it can't be read. */
export function readRuns(storage: StorageAccess, key: string): LocalRun[] {
  try {
    const raw = storage()?.getItem(key);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isLocalRun).sort(byScore).slice(0, LOCAL_RUNS)
      : [];
  } catch {
    return [];
  }
}

/** Adds a finished run to `runs`, keeping the best `LOCAL_RUNS`. */
export function withRun(runs: readonly LocalRun[], run: LocalRun): LocalRun[] {
  return [...runs, run].sort(byScore).slice(0, LOCAL_RUNS);
}

/**
 * Records a finished run on the local board and returns the board. A run of 0
 * is recorded too: it's still a run played. When storage refuses, the board
 * returned still has it, for this page.
 */
export function recordRun(storage: StorageAccess, key: string, run: LocalRun): LocalRun[] {
  const runs = withRun(readRuns(storage, key), run);
  try {
    storage()?.setItem(key, JSON.stringify(runs));
  } catch {
    // This page's copy is all there is.
  }
  return runs;
}

/** Where the device's published best stood in one period, when it was published. */
export interface Standing {
  readonly period: BoardPeriod;
  /** The period's key: `2026-09-29`, `2026-W40`, `2026-09`. */
  readonly key: string;
  readonly entryId: string;
  readonly nickname: string;
  readonly streak: number;
  readonly rank: number;
  readonly total: number;
  readonly resetsAt: number;
}

function isStanding(value: unknown): value is Standing {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    (s.period === "day" || s.period === "week" || s.period === "month") &&
    typeof s.key === "string" &&
    typeof s.entryId === "string" &&
    typeof s.nickname === "string" &&
    typeof s.streak === "number" &&
    typeof s.rank === "number" &&
    typeof s.total === "number" &&
    typeof s.resetsAt === "number"
  );
}

/** Every standing kept, oldest periods dropped once they've reset. */
export function readStandings(storage: StorageAccess, key: string, now: number): Standing[] {
  try {
    const raw = storage()?.getItem(key);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStanding).filter((s) => s.resetsAt > now) : [];
  } catch {
    return [];
  }
}

/** The standings a submit response gives, one per period it is current in. */
export function standingsOf(response: SubmitResponse): Standing[] {
  return (["day", "week", "month"] as const).map((period) => {
    const p = response.periods[period];
    return {
      period,
      key: p.key,
      entryId: p.entryId,
      // The period's best may be an earlier run under another name: saveStandings
      // keeps the name it already has for that entry.
      nickname: response.nickname,
      streak: p.best,
      rank: p.rank,
      total: p.total,
      resetsAt: p.resetsAt,
    };
  });
}

/**
 * Keeps the new standings, replacing any for the same periods: after every
 * publish, whether or not it moved the boards, so the game-over panel knows the
 * best to beat next time. An entry already kept keeps the name it was
 * published under.
 */
export function saveStandings(
  storage: StorageAccess,
  key: string,
  standings: readonly Standing[],
  now: number,
): void {
  const before = readStandings(storage, key, now);
  const same = (a: Standing, b: Standing) => a.period === b.period && a.key === b.key;
  const kept = before.filter((old) => !standings.some((s) => same(s, old)));
  const fresh = standings.map((s) => {
    const old = before.find((o) => same(o, s) && o.entryId === s.entryId);
    return old === undefined ? s : { ...s, nickname: old.nickname };
  });
  try {
    storage()?.setItem(key, JSON.stringify([...kept, ...fresh]));
  } catch {
    // The board page will just not know until the cache catches up.
  }
}

/**
 * The nickname last published from this device, or null when there's none,
 * storage can't be read, or the stored value no longer passes the rules (they
 * may have changed since): the dialog then generates one.
 */
export function readNickname(storage: StorageAccess): string | null {
  try {
    const raw = storage()?.getItem(NICKNAME_KEY);
    if (typeof raw !== "string") return null;
    const check = checkNickname(raw);
    return check.ok && check.nickname === raw ? raw : null;
  } catch {
    return null;
  }
}

/** Keeps the name a run was just published under. False when storage refused it. */
export function saveNickname(storage: StorageAccess, nickname: string): boolean {
  const check = checkNickname(nickname);
  if (!check.ok) return false;
  try {
    const store = storage();
    if (store === null) return false;
    store.setItem(NICKNAME_KEY, check.nickname);
    return true;
  } catch {
    return false;
  }
}

/** Whether to show the country flag when publishing: the last choice, ticked by default. */
export function readShowCountry(storage: StorageAccess): boolean {
  try {
    return storage()?.getItem(SHOW_COUNTRY_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Keeps the flag choice a run was just published with. */
export function saveShowCountry(storage: StorageAccess, show: boolean): void {
  try {
    storage()?.setItem(SHOW_COUNTRY_KEY, show ? "1" : "0");
  } catch {
    // Ticked again next time.
  }
}
