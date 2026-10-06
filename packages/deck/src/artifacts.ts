/**
 * The compiled artifacts.
 *
 * ARCHITECTURE.md §4, invariant 1: **the client never receives a stat value it
 * has not already been shown. No exceptions.** `assertNoValuesLeak` is the
 * mechanical enforcement of that sentence, and it runs on every build.
 */

import { createHash } from "node:crypto";
import { STATS, STAT_KEYS, eligibleStats, squadThemes } from "@bt/core";
import type { Player, PlayerImage, SquadTheme, StatKey } from "@bt/core";
import { licenceUrl } from "./licences.js";
import { DECK } from "./load.js";
import type { Manifest } from "./manifest.js";
import type { RawPlayer } from "./schema.js";

/** Bundled into the Worker. Everything. */
export interface FullDeck {
  readonly generatedAt: string;
  /** Names the deck's content (`deckVersion`). The Worker tags analytics events with it. */
  readonly version: string;
  readonly players: readonly Player[];
  readonly eligibility: Readonly<Record<string, readonly StatKey[]>>;
}

/** Per stat: ids sorted by value, and the groups that tie. */
export interface Indexes {
  readonly sorted: Readonly<Record<string, readonly string[]>>;
  readonly ties: Readonly<Record<string, readonly (readonly string[])[]>>;
}

export interface Credit {
  readonly playerId: string;
  /** For the credits page, which lists photos by who is in them. */
  readonly name: string;
  readonly author: string;
  /** The licence code as entered, e.g. `CC-BY-SA-2.5-ES`. */
  readonly licence: string;
  /**
   * The exact licence text the photo was released under, including any
   * jurisdiction port. Absent for public domain, which has no licence to link.
   * Worked out here so the credits page renders a link and never builds one.
   */
  readonly licenceUrl?: string;
  readonly source: string;
}

export function buildFullDeck(players: readonly Player[], now: Date): FullDeck {
  const eligibility: Record<string, readonly StatKey[]> = {};
  for (const p of players) eligibility[p.id] = eligibleStats(p, now);
  return { generatedAt: now.toISOString(), version: deckVersion(players), players, eligibility };
}

/**
 * The deck's content version, `<deck>-<players>-<hash>` (`legends-107-3f9c21e0`):
 * the first 8 hex characters of the SHA-256 of the players as bundled. It
 * changes with any figure, flag or player, and never with the build date, so
 * rebuilding an unchanged deck keeps its version. The Worker writes it into
 * every analytics event (ARCHITECTURE.md §19), so real play can be split by the
 * deck it was dealt from. No value can be read back from it.
 */
export function deckVersion(players: readonly Player[]): string {
  const hash = createHash("sha256").update(JSON.stringify(players)).digest("hex").slice(0, 8);
  return `${DECK}-${players.length}-${hash}`;
}

export function buildIndexes(players: readonly Player[], now: Date): Indexes {
  const sorted: Record<string, readonly string[]> = {};
  const ties: Record<string, readonly (readonly string[])[]> = {};

  for (const key of STAT_KEYS) {
    const withValue = players
      .map((p) => ({ id: p.id, value: STATS[key].get(p, now) }))
      .filter((x): x is { id: string; value: number } => x.value !== undefined)
      .sort((a, b) => a.value - b.value || a.id.localeCompare(b.id));

    sorted[key] = withValue.map((x) => x.id);

    const groups: string[][] = [];
    let run: string[] = [];
    for (let i = 0; i < withValue.length; i++) {
      const cur = withValue[i]!;
      const prev = withValue[i - 1];
      if (prev !== undefined && prev.value === cur.value) {
        run.push(cur.id);
      } else {
        if (run.length > 1) groups.push(run);
        run = [cur.id];
      }
    }
    if (run.length > 1) groups.push(run);
    ties[key] = groups;
  }

  return { sorted, ties };
}

export function buildCredits(raws: readonly RawPlayer[]): Credit[] {
  return raws
    .filter((r) => r.image !== undefined)
    .map((r) => {
      const url = licenceUrl(r.image!.licence);
      return {
        playerId: r.id,
        name: r.name,
        author: r.image!.author,
        licence: r.image!.licence,
        ...(url !== undefined ? { licenceUrl: url } : {}),
        source: r.image!.source,
      };
    });
}

/**
 * `themes.json`: the "Clear the squad" themes (themes.ts in @bt/core), for the
 * site's pages — which exist, what they're called, how many players each has.
 * Names and counts only: no player id, no figure. The Worker derives the same
 * list from the deck it bundles.
 */
export function buildThemes(players: readonly Player[]): SquadTheme[] {
  return squadThemes(players).map(({ id, type, name, slug, players: count }) => ({
    id,
    type,
    name,
    slug,
    players: count,
  }));
}

/** Bundled into the Worker: what each card needs to render its photo. */
export type ImageMap = Readonly<Record<string, PlayerImage>>;

/**
 * The manifest cut down to the `PlayerImage` part, for players in the deck.
 * The source hash stays behind — it is sync bookkeeping, not display data.
 */
export function buildImages(players: readonly Player[], manifest: Manifest): ImageMap {
  const images: Record<string, PlayerImage> = {};
  for (const p of players) {
    const entry = manifest.entries[p.id];
    if (entry !== undefined) {
      images[p.id] = { key: entry.key, width: entry.width, height: entry.height };
    }
  }
  return images;
}

/**
 * The leak scanner — mechanical enforcement of ARCHITECTURE.md §4, invariant 1:
 * *the client never receives a stat value it has not already been shown.*
 *
 * There is no longer a `deck.public.json`. Under per-question serving the
 * browser gets its data from the Worker's round response, so there is no
 * build-time artifact carrying player data to police.
 *
 * That does not remove the risk, it moves it. Two surfaces still need checking,
 * and both use this function:
 *
 * 1. **The built site bundle** (Phase 3). If anyone imports `deck.full.json`
 *    into a component, the whole deck ships inside the JavaScript and nothing
 *    looks wrong. Scanning `apps/web/dist` catches that — and unlike scanning
 *    an artifact we generate ourselves, it checks what actually ships.
 * 2. **The round payload** (Phase 5). The endpoint must return the anchor's
 *    value and never the challenger's. That payload is assembled by code edited
 *    repeatedly across three phases, which makes it the likelier regression.
 *
 * Takes text rather than an object deliberately: it must work on a JS bundle as
 * readily as on JSON, and it must not trust any object's shape.
 */

/**
 * Below this, a number is too ambiguous to accuse — a 2 could be an array
 * index, a version, a coordinate. Above it, a match means something.
 */
export const LEAK_SCAN_THRESHOLD = 10;

/**
 * ISO timestamps are stripped before scanning. `2026-09-18T07:38:18Z` contains
 * "18" and "38", which collide with real stat values and would fire on every
 * build.
 */
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g;

export function scanForLeakedValues(
  text: string,
  players: readonly Player[],
  now: Date,
  label = "output",
): string[] {
  const haystack = text.replace(ISO_TIMESTAMP, "");
  const problems: string[] = [];

  for (const player of players) {
    for (const key of STAT_KEYS) {
      const value = STATS[key].get(player, now);
      if (value === undefined || value < LEAK_SCAN_THRESHOLD) continue;
      // Word-boundary match so 400 does not match inside 1400.
      const pattern = new RegExp(`(^|[^0-9.])${value}([^0-9.]|$)`);
      if (pattern.test(haystack)) {
        problems.push(
          `${label} contains ${value}, which is ${player.id}'s ${key} ` +
            `— invariant 1 says no stat value may reach the client`,
        );
      }
    }
  }

  return [...new Set(problems)];
}
