/**
 * The player's best streak, kept in `localStorage` on this device: one best
 * per deck and play, under `bt:best:<deck>:<play>` (`bt:best:legends:friendly`,
 * `bt:best:legends:endless-instagram`).
 *
 * Only the number is stored. Storage can be missing, blocked, full or throw
 * on access (private browsing, a locked-down browser, a sandboxed iframe), so
 * every read and write is wrapped: when it fails, the best lasts as long as the
 * page does and the game carries on as if nothing happened.
 */

import type { PlayId } from "./variant";

/** The decks a best is kept for. Only Legends exists. */
export type BestDeck = "legends";

/** The storage key for one deck and play's best: a mode, or an Endless variant. */
export function bestKey(deck: BestDeck, play: PlayId): string {
  return `bt:best:${deck}:${play}`;
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

/**
 * "Clear the squad": the furthest through the squad, and whether it has ever
 * been cleared, under `bt:best:legends:squad:<theme id>` as JSON:
 * `{"best":21,"cleared":false}`. A cleared run's progress can fall short of the
 * squad when the dealer ended it early, so "cleared" is kept on its own.
 */
export interface SquadBest {
  readonly best: number;
  readonly cleared: boolean;
}

const NO_SQUAD_BEST: SquadBest = { best: 0, cleared: false };

/** The squad best stored under `key`; none when there is none or it can't be read. */
export function readSquadBest(storage: StorageAccess, key: string): SquadBest {
  try {
    const raw = storage()?.getItem(key);
    if (raw === null || raw === undefined || raw.length > 64) return NO_SQUAD_BEST;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return NO_SQUAD_BEST;
    const { best, cleared } = value as Record<string, unknown>;
    if (typeof best !== "number" || !Number.isInteger(best) || best < 0 || best > 9999) {
      return NO_SQUAD_BEST;
    }
    if (typeof cleared !== "boolean") return NO_SQUAD_BEST;
    return { best, cleared };
  } catch {
    return NO_SQUAD_BEST;
  }
}

/**
 * Keeps a squad run under `key`, merged with what's there: the further of the
 * two, and cleared if either was. False when storage refused it.
 */
export function saveSquadBest(storage: StorageAccess, key: string, run: SquadBest): boolean {
  if (!Number.isInteger(run.best) || run.best < 0) return false;
  const before = readSquadBest(storage, key);
  const merged: SquadBest = {
    best: Math.max(before.best, run.best),
    cleared: before.cleared || run.cleared,
  };
  try {
    const store = storage();
    if (store === null) return false;
    store.setItem(key, JSON.stringify(merged));
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
