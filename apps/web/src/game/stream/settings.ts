/**
 * What Twitch Mode remembers between visits, so starting again takes one
 * click: the channel, the pool, the length and the timer, under `bt:stream:*`
 * in the browser. Every read and write is wrapped: with storage blocked they
 * last the visit and the game plays the same.
 *
 * `?pool=<theme slug>` (or `all`, `instagram`) preselects a pool, over what
 * was remembered.
 */

import {
  DEFAULT_STREAM_LENGTH,
  DEFAULT_STREAM_LIMIT,
  STREAM_LENGTHS,
  isStreamLength,
  isStreamLimit,
  squadQuestions,
  squadVariantId,
} from "@bt/core";
import type { StreamLength, StreamLimit, StreamPool } from "@bt/core";
import type { StorageAccess } from "../best";
import type { Theme } from "../variant";

export const STREAM_KEYS = {
  channel: "bt:stream:channel",
  pool: "bt:stream:pool",
  length: "bt:stream:length",
  timer: "bt:stream:timer",
} as const;

export interface StreamSetup {
  /** The normalised channel last connected, or "". */
  readonly channel: string;
  readonly pool: StreamPool;
  readonly length: StreamLength;
  readonly limit: StreamLimit;
}

/** A pool the picker offers: All legends, Instagram, or a theme's squad. */
export interface PoolOption {
  readonly pool: StreamPool;
  readonly kind: "all" | "instagram" | Theme["type"];
  /** For a squad: its theme. */
  readonly theme?: Theme;
  /** The most questions a match on it can have, when that's under the longest match. */
  readonly cap: number | null;
}

/**
 * Every pool on offer, in the picker's order: All legends, Instagram, then the
 * themes as given, but only those that can make a full match of the shortest
 * length (10 questions): a squad of 10 players has 9, so it isn't offered. The
 * server still deals any squad; this is the picker's choice alone.
 */
export function poolOptions(themes: readonly Theme[]): PoolOption[] {
  const shortest = STREAM_LENGTHS[0];
  return [
    { pool: "endless", kind: "all", cap: null },
    { pool: "endless-instagram", kind: "instagram", cap: null },
    ...themes
      .filter((theme) => squadQuestions(theme.players) >= shortest)
      .map((theme): PoolOption => ({
        pool: squadVariantId(theme),
        kind: theme.type,
        theme,
        cap: squadQuestions(theme.players) < 20 ? squadQuestions(theme.players) : null,
      })),
  ];
}

/** The pool `?pool=` names: a theme's slug, or `all` or `instagram`. Null for anything else. */
export function poolFromQuery(search: string, options: readonly PoolOption[]): StreamPool | null {
  const wanted = new URLSearchParams(search).get("pool")?.trim().toLowerCase();
  if (wanted === undefined || wanted === "") return null;
  if (wanted === "all") return "endless";
  if (wanted === "instagram") return "endless-instagram";
  return options.find((o) => o.theme?.slug === wanted)?.pool ?? null;
}

function read(storage: StorageAccess, key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** What was remembered, held to what's on offer now: a pool the deck no longer has falls back to All legends. */
export function readSetup(storage: StorageAccess, options: readonly PoolOption[]): StreamSetup {
  const pool = read(storage, STREAM_KEYS.pool);
  const length = Number(read(storage, STREAM_KEYS.length));
  const limit = Number(read(storage, STREAM_KEYS.timer));
  return {
    channel: (read(storage, STREAM_KEYS.channel) ?? "").slice(0, 25),
    pool: options.find((o) => o.pool === pool)?.pool ?? "endless",
    length: isStreamLength(length) ? length : DEFAULT_STREAM_LENGTH,
    limit: isStreamLimit(limit) ? limit : DEFAULT_STREAM_LIMIT,
  };
}

/** Keeps one setting; false when storage refused it. */
export function saveSetting(
  storage: StorageAccess,
  key: (typeof STREAM_KEYS)[keyof typeof STREAM_KEYS],
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
