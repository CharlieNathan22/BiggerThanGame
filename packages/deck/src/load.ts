/**
 * Reading the deck off disk.
 *
 * The real deck lives in a private submodule at `data/players/`. A small public
 * sample lives at `sample/players/` so the repo runs standalone — cloned
 * without access to the private repo, `pnpm dev` still works.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { playerSchema, toPlayer } from "./schema.js";
import type { RawPlayer } from "./schema.js";
import type { Player } from "@bt/core";

/**
 * The private deck is used only once it holds this many schema-valid players.
 * Below it, dev and CI fall back to the 24-player sample rather than switching
 * to a deck of three the moment real entry starts. Production builds refuse
 * the fallback (`--require-private`) so invented players can't go live.
 */
export const MIN_PRIVATE_DECK = 30;

export interface LoadedDeck {
  readonly raws: readonly RawPlayer[];
  readonly players: readonly Player[];
  /** Which directory the deck came from, for the build log. */
  readonly source: "data" | "sample";
  /** Problems in the deck that was used. Any at all fails the build. */
  readonly problems: readonly string[];
  /** Schema-valid players in the private deck, whichever deck was used. */
  readonly privateCount: number;
  /**
   * Problems in the private deck when it was passed over for the sample. They
   * don't fail the build — the deck isn't in use — but they're printed, so
   * mistakes in half-entered data don't hide behind the fallback.
   */
  readonly privateProblems: readonly string[];
}

/**
 * Local staging folder for source photographs, matching whichever deck loaded.
 *
 * Gitignored — originals go to R2, never into git. Only `images:sync` reads
 * this; the ordinary build never touches it.
 */
export function imagesDirFor(root: string, source: "data" | "sample"): string {
  return join(root, source, "originals");
}

/** The committed image manifest, which lives with the deck it describes. */
export function manifestPathFor(root: string, source: "data" | "sample"): string {
  return join(root, source, "images.json");
}

/** Image files in a directory, for the orphan check. Empty if it does not exist. */
export function imageFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
    .sort();
}

function yamlFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort(); // sorted so the build is reproducible regardless of filesystem order
}

/**
 * Prefers the private deck once it holds `MIN_PRIVATE_DECK` valid players;
 * falls back to the sample until then.
 *
 * Deliberately not configurable by env var: a build that silently reads a
 * different deck depending on the environment is a build you cannot reason
 * about. The source is reported so the log always says which one ran. The one
 * switch is `--require-private` on the build, which only ever makes it stricter.
 */
export function loadDeck(root: string): LoadedDeck {
  const privateDeck = readPlayers(join(root, "data", "players"));
  const privateCount = privateDeck.raws.length;

  if (privateCount >= MIN_PRIVATE_DECK) {
    return { ...privateDeck, source: "data", privateCount, privateProblems: [] };
  }

  const sample = readPlayers(join(root, "sample", "players"));
  return {
    ...sample,
    source: "sample",
    privateCount,
    privateProblems: privateDeck.problems,
  };
}

/**
 * The deck `images:sync` works on: the private deck as soon as it has any
 * player files at all, ignoring `MIN_PRIVATE_DECK`. Photos are entered
 * alongside the first real players, long before there are thirty of them, and
 * syncing the sample in the meantime would upload nothing useful. Falls back to
 * the sample only when the private deck is empty.
 *
 * Broken files still count as "has players": their problems come back in
 * `problems`, so sync stops and asks for them to be fixed rather than quietly
 * switching to the sample.
 */
export function loadDeckForSync(root: string): LoadedDeck {
  const dataDir = join(root, "data", "players");
  if (yamlFilesIn(dataDir).length > 0) {
    const privateDeck = readPlayers(dataDir);
    return {
      ...privateDeck,
      source: "data",
      privateCount: privateDeck.raws.length,
      privateProblems: [],
    };
  }
  return {
    ...readPlayers(join(root, "sample", "players")),
    source: "sample",
    privateCount: 0,
    privateProblems: [],
  };
}

/** Why the sample was used, for the build log. Undefined when it wasn't. */
export function fallbackNotice(deck: LoadedDeck): string | undefined {
  if (deck.source !== "sample") return undefined;
  return `using sample deck — private deck has ${deck.privateCount} of ${MIN_PRIVATE_DECK} players needed`;
}

function readPlayers(dir: string): Pick<LoadedDeck, "raws" | "players" | "problems"> {
  const files = yamlFilesIn(dir);
  const raws: RawPlayer[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const path = join(dir, file);
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(path, "utf8"));
    } catch (err) {
      problems.push(`${file}: not valid YAML — ${(err as Error).message}`);
      continue;
    }

    const result = playerSchema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        problems.push(`${file}: ${where}: ${issue.message}`);
      }
      continue;
    }
    raws.push(result.data);
  }

  return { raws, players: raws.map(toPlayer), problems };
}
