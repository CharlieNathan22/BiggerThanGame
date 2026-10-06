/**
 * The build pipeline.
 *
 * Load → validate → emit artifacts → write reports. Fails loudly and exits
 * non-zero on any problem, because a build that warns and carries on is a build
 * that ships bad data.
 *
 * See ARCHITECTURE.md §6.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_MIN_PLAYERS } from "@bt/core";

import {
  buildCredits,
  buildFullDeck,
  buildImages,
  buildIndexes,
  buildThemes,
} from "./artifacts.js";
import { checkManifest, loadManifest } from "./manifest.js";
import { DECK, MIN_PRIVATE_DECK, fallbackNotice, loadDeck, manifestPathFor } from "./load.js";
import type { LoadedDeck } from "./load.js";
import {
  INSTAGRAM_CLOSENESS_AT,
  PLAYER_MODELS,
  SIM_MODES,
  calibratedModel,
  closestPairsText,
  describePoints,
  parseCalibration,
  simulate,
  simulationReport,
} from "./simulate.js";
import type { PlayerModel } from "./simulate.js";
import { simulateSquads, squadPairsText, squadSection } from "./simulate-squad.js";
import { formatProblems, formatStaleInstagram, staleInstagram, validateDeck } from "./validate.js";
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
  /** Plays the simulated runs. Defaults to `fan`. */
  readonly model?: PlayerModel;
  /**
   * Fail rather than fall back to the sample. Production builds pass this
   * (`--require-private`) so invented players can never go live.
   */
  readonly requirePrivate?: boolean;
}

/** The simulation flags, parsed: a model and a run count, or a message saying what's wrong. */
export type SimArgs =
  { readonly model: PlayerModel; readonly runs?: number } | { readonly error: string };

/**
 * `--model fan|rank`, `--calibration <file.json>` and `--runs <n>`. A
 * calibration file replaces the fan model's points, so it can't be combined
 * with `--model`. `read` loads the file; tests pass their own.
 */
export function parseSimArgs(argv: readonly string[], read: (path: string) => string): SimArgs {
  const value = (flag: string): string | undefined | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    return v === undefined || v.startsWith("--") ? null : v;
  };
  const modelName = value("--model");
  const calibration = value("--calibration");
  const runsText = value("--runs");
  if (modelName === null) return { error: "--model needs a name: fan or rank" };
  if (calibration === null) return { error: "--calibration needs a file" };
  if (runsText === null) return { error: "--runs needs a number" };
  if (modelName !== undefined && calibration !== undefined) {
    return { error: "--calibration replaces the fan model's points; drop --model" };
  }

  let runs: number | undefined;
  if (runsText !== undefined) {
    runs = Number(runsText);
    if (!Number.isInteger(runs) || runs < 1) return { error: `--runs: ${runsText} is not a count` };
  }

  if (calibration !== undefined) {
    try {
      const points = parseCalibration(JSON.parse(read(calibration)));
      const model = calibratedModel(
        "calibrated",
        `accurate ${describePoints(points)} (rank distance, from ${basename(calibration)}), ` +
          "linear in between and flat beyond the first and last points",
        points,
      );
      return runs === undefined ? { model } : { model, runs };
    } catch (e) {
      return { error: `--calibration ${calibration}: ${(e as Error).message}` };
    }
  }

  const model = PLAYER_MODELS[modelName ?? "fan"];
  if (model === undefined) {
    return {
      error: `--model: no model "${modelName}"; choose ${Object.keys(PLAYER_MODELS).join(" or ")}`,
    };
  }
  return runs === undefined ? { model } : { model, runs };
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
  console.log(`  ${loaded.players.length} players from ${loaded.source}/${DECK}/`);

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

  // Follower counts drift: a warning when any is due its monthly refresh, never a failure.
  const stale = formatStaleInstagram(staleInstagram(loaded.players, now));
  if (stale.length > 0) {
    console.warn(`deck: warning — ${stale[0]}`);
    for (const line of stale.slice(1)) console.warn(line);
  }

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
  // The "Clear the squad" themes: names and counts only, for the site's pages.
  const themes = buildThemes(loaded.players);
  write(join(outDir, "themes.json"), JSON.stringify(themes));
  console.log(
    themes.length === 0
      ? `  no themes (none has ${THEME_MIN_PLAYERS} players)`
      : `  ${themes.length} theme(s): ${themes.map((t) => `${t.name} ${t.players}`).join(", ")}`,
  );

  console.log("deck: viability report");
  write(join(packageRoot, "viability.md"), viabilityReport(loaded.players, now));

  if (opts.skipSimulation === true) {
    console.log("deck: simulation skipped");
  } else {
    const runs = opts.simulationRuns ?? 20_000;
    const model = opts.model ?? PLAYER_MODELS.fan!;
    // Friendly and Endless are also scored by every other model, on the same
    // runs, for the report's comparison tables. Scoring is cheap; dealing the
    // rounds is not.
    const compare = Object.values(PLAYER_MODELS).filter((m) => m.id !== model.id);
    console.log(
      `deck: simulating ${runs.toLocaleString("en-GB")} runs per mode, model ${model.id}`,
    );
    const started = Date.now();
    const results = SIM_MODES.map((mode) =>
      simulate({
        deck: loaded.players,
        now,
        mode,
        runs,
        model,
        ...(mode === "friendly" || mode === "endless" ? { compare } : {}),
      }),
    );
    const instagram = simulate({
      deck: loaded.players,
      now,
      mode: "endless",
      variant: "endless-instagram",
      runs,
      model,
      compare,
      closenessAt: INSTAGRAM_CLOSENESS_AT,
    });
    const squads = simulateSquads({ deck: loaded.players, now, runs, model });
    console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s`);
    write(
      join(packageRoot, "simulation.md"),
      [
        simulationReport(results, loaded.players.length, now, instagram),
        ...squadSection(squads),
      ].join("\n"),
    );
    // Names beside figures: for the terminal only, never the committed report.
    console.log("deck: Instagram Endless, the closest pairs dealt");
    for (const line of closestPairsText(instagram)) console.log(line);
    if (squads.length > 0) {
      console.log("deck: Clear the squad, the closest pairs in each theme's last questions");
      for (const line of squadPairsText(squads)) console.log(line);
    }
  }

  console.log("deck: done");
  return 0;
}

// Only run when invoked directly, so tests can import the module freely.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const sim = parseSimArgs(process.argv.slice(2), (path) => readFileSync(path, "utf8"));
  if ("error" in sim) {
    console.error(`deck: ${sim.error}`);
    process.exitCode = 1;
  } else {
    process.exitCode = runBuild({
      ...(process.argv.includes("--no-sim") ? { skipSimulation: true } : {}),
      ...(process.argv.includes("--require-private") ? { requirePrivate: true } : {}),
      model: sim.model,
      ...(sim.runs !== undefined ? { simulationRuns: sim.runs } : {}),
    });
  }
}
