/**
 * `pnpm deck:import` entry point.
 *
 * Regenerates `data/legends/players/*.yaml` from the CSVs beside it. Run it
 * after editing `players.csv`, `image-log.csv` or `focus.csv`, then run
 * `pnpm images:sync` if any photos changed.
 *
 *   pnpm deck:import            write the player files and print the report
 *   pnpm deck:import --dry-run  print the report, write nothing
 *   pnpm deck:import --prune    also delete player files no CSV row generates
 *
 * The whole plan is worked out before anything touches the disk, and each
 * file is written to a temporary name and renamed into place, so a failure
 * never leaves a half-written player. Exits non-zero if any row was skipped.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deckDirFor } from "./load.js";
import { planImport } from "./import.js";
import type { ImportPlan } from "./import.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface ImportOptions {
  /** Reference date for the deck checks. Defaults to now. */
  readonly now?: Date;
  /** Where report lines go. Defaults to the console. */
  readonly log?: (line: string) => void;
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function playerFilesIn(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith(".yaml") || name.endsWith(".yml")) {
      out.set(name, readFileSync(join(dir, name), "utf8"));
    }
  }
  return out;
}

/** Writes beside the target and renames over it, so a reader never sees half a file. */
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

function idList(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(", ") : "none";
}

/** A cross-check whose entries each get their own line. */
function section(title: string, entries: readonly string[], log: (l: string) => void): void {
  if (entries.length === 0) {
    log(`  ${title}: none`);
    return;
  }
  log(`  ${title}:`);
  for (const e of entries) log(`    ${e}`);
}

function report(plan: ImportPlan, dryRun: boolean, prune: boolean, log: (l: string) => void): void {
  const would = dryRun ? "would be " : "";
  const toWrite = plan.created.length + plan.changed.length;

  log("");
  log(
    `written: ${plan.files.size} player(s) valid — ${toWrite} ${would}written ` +
      `(${plan.created.length} new, ${plan.changed.length} changed), ${plan.unchanged.length} unchanged`,
  );
  if (plan.created.length > 0) log(`  new      ${plan.created.join(", ")}`);
  if (plan.changed.length > 0) log(`  changed  ${plan.changed.join(", ")}`);

  log("");
  if (plan.skipped.length === 0) {
    log("skipped: none");
  } else {
    log(
      `skipped: ${plan.skipped.length} row(s) — not written; any existing file for them is left as it was`,
    );
    for (const s of plan.skipped) {
      log(`  row ${s.row}  ${s.playerId}`);
      for (const p of s.problems) log(`    ${p}`);
    }
  }

  if (plan.feeNeedsYear.length > 0) {
    log("");
    log(`fee needs a year: ${plan.feeNeedsYear.length} player(s) imported without a fee`);
    log(`  ${plan.feeNeedsYear.join(", ")}`);
  }

  log("");
  log("cross-checks:");
  log(`  image-log ids with no players row: ${idList(plan.imageIdsWithoutPlayer)}`);
  log(`  focus ids with no image: ${idList(plan.focusIdsWithoutImage)}`);
  log(
    `  players with no image: ${plan.withoutImage.length}${plan.withoutImage.length > 0 ? ` — ${plan.withoutImage.join(", ")}` : ""}`,
  );
  section("duplicate player_id", plan.duplicates, log);
  section("image files not in originals/ (warning)", plan.missingOriginals, log);
  if (plan.unknownFiles.length === 0) {
    log("  player files with no players.csv row: none");
  } else if (prune) {
    log(`  player files with no players.csv row, ${would}deleted (--prune):`);
    for (const f of plan.unknownFiles) log(`    ${f}`);
  } else {
    log("  player files with no players.csv row, kept (--prune deletes them):");
    for (const f of plan.unknownFiles) log(`    ${f}`);
  }
}

export function runImport(
  argv: readonly string[],
  deckDir: string = deckDirFor(packageRoot, "data"),
  opts: ImportOptions = {},
): number {
  const dryRun = argv.includes("--dry-run");
  const prune = argv.includes("--prune");
  const log = opts.log ?? ((line: string) => console.log(line));
  const playersDir = join(deckDir, "players");
  const rel = relative(process.cwd(), deckDir);
  const where = rel === "" ? "." : rel.startsWith("..") || isAbsolute(rel) ? deckDir : rel;

  log(`deck:import: ${where}${dryRun ? " (dry run — nothing will be written)" : ""}`);

  const playersCsv = readIfExists(join(deckDir, "players.csv"));
  if (playersCsv === undefined) {
    log(`\ndeck:import: no players.csv in ${where} — nothing to import`);
    return 1;
  }
  const imageLog = readIfExists(join(deckDir, "image-log.csv"));
  const focus = readIfExists(join(deckDir, "focus.csv"));
  log(`  image-log.csv ${imageLog === undefined ? "not found — no images" : "found"}`);
  log(`  focus.csv     ${focus === undefined ? "not found — default crops" : "found"}`);

  const originalsDir = join(deckDir, "originals");
  const plan = planImport({
    players: playersCsv,
    ...(imageLog !== undefined ? { imageLog } : {}),
    ...(focus !== undefined ? { focus } : {}),
    originals: existsSync(originalsDir) ? readdirSync(originalsDir) : [],
    existing: playerFilesIn(playersDir),
    now: opts.now ?? new Date(),
  });

  if (!plan.ok) {
    log("\ndeck:import: cannot read the CSVs — nothing written\n");
    for (const f of plan.fatal) log(`  ${f}`);
    return 1;
  }

  report(plan, dryRun, prune, log);

  if (!dryRun) {
    mkdirSync(playersDir, { recursive: true });
    for (const id of [...plan.created, ...plan.changed]) {
      writeAtomic(join(playersDir, `${id}.yaml`), plan.files.get(id)!);
    }
    if (prune) for (const f of plan.unknownFiles) unlinkSync(join(playersDir, f));
  }

  log("");
  if (plan.skipped.length > 0) {
    log(
      `deck:import: ${plan.skipped.length} row(s) skipped — the import is partial. Fix them and re-run.`,
    );
    return 1;
  }
  log(`deck:import: done${dryRun ? " (dry run)" : ""}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.exitCode = runImport(process.argv.slice(2));
}
