/**
 * The player's best streak, kept in `localStorage` on this device: one best
 * per deck and mode, under `bt:best:<deck>:<mode>` (`bt:best:legends:friendly`).
 *
 * Only the number is stored. Storage can be missing, blocked, full or throw
 * on access (private browsing, a locked-down browser, a sandboxed iframe), so
 * every read and write is wrapped: when it fails, the best lasts as long as the
 * page does and the game carries on as if nothing happened.
 */

import type { Mode } from "@bt/core";

/** The decks a best is kept for. Only Legends exists. */
export type BestDeck = "legends";

/** The storage key for one deck and mode's best. */
export function bestKey(deck: BestDeck, mode: Mode): string {
  return `bt:best:${deck}:${mode}`;
}

/** How the island reaches storage. Returns null, or throws, when there is none. */
export type StorageAccess = () => Pick<Storage, "getItem" | "setItem"> | null;

/** The best stored under `key`, or 0 when there is none or it can't be read. */
export function readBest(storage: StorageAccess, key: string): number {
  try {
    const raw = storage()?.getItem(key);
    if (raw === null || raw === undefined || !/^\d{1,4}$/.test(raw)) return 0;
    return Number(raw);
  } catch {
    return 0;
  }
}

/** Stores `best` under `key`. Returns false when storage refused it; the caller carries on. */
export function saveBest(storage: StorageAccess, key: string, best: number): boolean {
  if (!Number.isInteger(best) || best < 0) return false;
  try {
    const store = storage();
    if (store === null) return false;
    store.setItem(key, String(best));
    return true;
  } catch {
    return false;
  }
}

/** `localStorage`, where reading the property itself may throw. */
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
