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

export interface LoadedDeck {
  readonly raws: readonly RawPlayer[];
  readonly players: readonly Player[];
  /** Which directory the deck came from, for the build log. */
  readonly source: "data" | "sample";
  readonly problems: readonly string[];
}

function yamlFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort(); // sorted so the build is reproducible regardless of filesystem order
}

/**
 * Prefers the private deck, falls back to the sample.
 *
 * Deliberately not configurable by env var: a build that silently reads a
 * different deck depending on the environment is a build you cannot reason
 * about. The source is reported so the log always says which one ran.
 */
export function loadDeck(root: string): LoadedDeck {
  const dataDir = join(root, "data", "players");
  const sampleDir = join(root, "sample", "players");

  const useData = yamlFilesIn(dataDir).length > 0;
  const dir = useData ? dataDir : sampleDir;
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

  return {
    raws,
    players: raws.map(toPlayer),
    source: useData ? "data" : "sample",
    problems,
  };
}
