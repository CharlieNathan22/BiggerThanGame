/**
 * What 1v1 remembers between visits, so making a room takes one press: the
 * pool, the length and the timer, under `bt:duel:*` in the browser. Every
 * read and write is wrapped: with storage blocked they last the visit and
 * the game plays the same. The name is the site's own (`bt:nickname`).
 *
 * The pools are Twitch Mode's (stream/settings.ts `poolOptions`), the same
 * list from the same themes, and `?pool=<theme slug>` (or `all`,
 * `instagram`) preselects one as it does there.
 */

import { DEFAULT_DUEL_LENGTH, DEFAULT_DUEL_LIMIT, isDuelLength, isDuelLimit } from "@bt/core";
import type { DuelLength, DuelLimit, DuelPool } from "@bt/core";
import type { StorageAccess } from "../best";
import type { PoolOption } from "../stream/settings";

export const DUEL_KEYS = {
  pool: "bt:duel:pool",
  length: "bt:duel:length",
  timer: "bt:duel:timer",
} as const;

export interface DuelSetup {
  readonly pool: DuelPool;
  readonly length: DuelLength;
  readonly limit: DuelLimit;
}

function read(storage: StorageAccess, key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** What was remembered, held to what's on offer now: a pool the deck no longer has falls back to All legends. */
export function readDuelSetup(storage: StorageAccess, options: readonly PoolOption[]): DuelSetup {
  const pool = read(storage, DUEL_KEYS.pool);
  const length = Number(read(storage, DUEL_KEYS.length));
  const limit = Number(read(storage, DUEL_KEYS.timer));
  return {
    pool: options.find((o) => o.pool === pool)?.pool ?? "endless",
    length: isDuelLength(length) ? length : DEFAULT_DUEL_LENGTH,
    limit: isDuelLimit(limit) ? limit : DEFAULT_DUEL_LIMIT,
  };
}

/** Keeps one setting; false when storage refused it. */
export function saveDuelSetting(
  storage: StorageAccess,
  key: (typeof DUEL_KEYS)[keyof typeof DUEL_KEYS],
  value: string | number,
): boolean {
  try {
    const store = storage();
    if (store === null) return false;
    store.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}
