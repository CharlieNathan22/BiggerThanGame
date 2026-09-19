/**
 * The build pipeline.
 *
 * Load → validate → emit artifacts → write reports. Fails loudly and exits
 * non-zero on any problem, because a build that warns and carries on is a build
 * that ships bad data.
 *
 * See ARCHITECTURE.md §6.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCredits, buildFullDeck, buildImages, buildIndexes } from "./artifacts.js";
import { checkManifest, loadManifest } from "./manifest.js";
import { MIN_PRIVATE_DECK, fallbackNotice, loadDeck, manifestPathFor } from "./load.js";
import type { LoadedDeck } from "./load.js";
import { simulate, simulationReport } from "./simulate.js";
import { formatProblems, validateDeck } from "./validate.js";
import { viabilityReport } from "./viability.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "..", "..");

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
  console.log(`  wrote ${path.replace(`${repoRoot}/`, "")}`);
}

export interface BuildOptions {
  /** Reference date. Fixed per build so artifacts are reproducible. */
  readonly now?: Date;
  /** Skip the simulation, which is the slow part. */
  readonly skipSimulation?: boolean;
  readonly simulationRuns?: number;
  /**
   * Fail rather than fall back to the sample. Production builds pass this
   * (`--require-private`) so invented players can never go live.
   */
  readonly requirePrivate?: boolean;
}

/** The `--require-private` refusal, or undefined when the build may proceed. */
export function requirePrivateError(deck: LoadedDeck, requirePrivate: boolean): string | undefined {
  if (!requirePrivate || deck.source === "data") return undefined;
  return (
    `--require-private: the private deck has ${deck.privateCount} of ${MIN_PRIVATE_DECK} ` +
    `valid players needed, and production never builds on the sample`
  );
}

export function runBuild(opts: BuildOptions = {}): number {
  const now = opts.now ?? new Date();

  console.log("deck: loading");
  const loaded = loadDeck(packageRoot);
  console.log(`  ${loaded.players.length} players from ${loaded.source}/`);

  const notice = fallbackNotice(loaded);
  if (notice !== undefined) console.log(`  ${notice}`);
  if (loaded.privateProblems.length > 0) {
    console.warn("  private deck problems (not fatal while the sample is in use):");
    for (const p of loaded.privateProblems) console.warn(`    ${p}`);
  }

  const refusal = requirePrivateError(loaded, opts.requirePrivate === true);
  if (refusal !== undefined) {
    console.error(`\ndeck: ${refusal}\n`);
    return 1;
  }

  if (loaded.problems.length > 0) {
    console.error("\ndeck: schema errors\n");
    for (const p of loaded.problems) console.error(`  ${p}`);
    console.error("");
    return 1;
  }

  console.log("deck: validating");
  // Image *files* are not checked here — the build is offline and never sees
  // them. What it checks is that the committed manifest and the deck agree.
  const manifest = loadManifest(manifestPathFor(packageRoot, loaded.source));
  const problems = [
    ...validateDeck(loaded.raws, loaded.players, now),
    ...checkManifest(loaded.raws, manifest),
  ];
  if (problems.length > 0) {
    console.error(`\ndeck: ${problems.length} validation error(s)\n`);
    console.error(formatProblems(problems));
    console.error("");
    return 1;
  }
  console.log("  ok");

  const imageCount = Object.keys(manifest.entries).length;
  console.log(`  ${imageCount} player(s) with synced images`);

  console.log("deck: emitting artifacts");
  const outDir = join(packageRoot, "dist");
  const full = buildFullDeck(loaded.players, now);
  const indexes = buildIndexes(loaded.players, now);
  const credits = buildCredits(loaded.raws);
  const images = buildImages(loaded.players, manifest);

  // No client-bound artifact is emitted: under per-question serving the browser
  // gets its data from the Worker, so there is nothing here to leak. The leak
  // scanner now runs against the built site bundle (Phase 3) and the round
  // payload (Phase 5) — see artifacts.ts.
  write(join(outDir, "deck.full.json"), JSON.stringify(full));
  write(join(outDir, "indexes.json"), JSON.stringify(indexes));
  write(join(outDir, "credits.json"), JSON.stringify(credits));
  write(join(outDir, "images.json"), JSON.stringify(images));

  console.log("deck: viability report");
  write(join(packageRoot, "viability.md"), viabilityReport(loaded.players, now));

  if (opts.skipSimulation === true) {
    console.log("deck: simulation skipped");
  } else {
    const runs = opts.simulationRuns ?? 10_000;
    console.log(`deck: simulating ${runs.toLocaleString("en-GB")} runs`);
    const started = Date.now();
    const result = simulate({ deck: loaded.players, now, runs });
    console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s`);
    write(join(packageRoot, "simulation.md"), simulationReport(result, loaded.players.length, now));
  }

  console.log("deck: done");
  return 0;
}

// Only run when invoked directly, so tests can import the module freely.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = runBuild({
    ...(process.argv.includes("--no-sim") ? { skipSimulation: true } : {}),
    ...(process.argv.includes("--require-private") ? { requirePrivate: true } : {}),
  });
}
