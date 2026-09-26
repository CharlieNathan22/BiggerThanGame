/**
 * `pnpm scan:dist` — the leak scan over the built site (dist-scan.ts). Runs as
 * the last step of `pnpm build` and `pnpm build:prod`, so CI and every deploy
 * fail if deck data reaches `apps/web/dist`.
 *
 * Scans against the deck the build just used: `dist/deck.full.json`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Player } from "@bt/core";
import { SCANNED_EXTENSIONS, scanDist } from "./dist-scan.js";
import type { DistFile } from "./dist-scan.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const siteDir = resolve(repoRoot, process.argv[2] ?? "apps/web/dist");
const deckPath = resolve(here, "..", "dist", "deck.full.json");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function main(): number {
  if (!existsSync(siteDir)) {
    console.error(`scan:dist: ${siteDir} not found. Build the site first.`);
    return 1;
  }
  if (!existsSync(deckPath)) {
    console.error(`scan:dist: ${deckPath} not found. Build the deck first.`);
    return 1;
  }
  const players = (JSON.parse(readFileSync(deckPath, "utf8")) as { players: Player[] }).players;
  const files: DistFile[] = walk(siteDir)
    .filter((path) => SCANNED_EXTENSIONS.includes(extname(path).toLowerCase()))
    .map((path) => ({
      path: relative(siteDir, path).replace(/\\/g, "/"),
      text: readFileSync(path, "utf8"),
    }));

  console.log(
    `scan:dist: ${files.length} file(s) in ${relative(repoRoot, siteDir)} against ${players.length} players`,
  );
  const problems = scanDist(files, players, new Date());
  if (problems.length === 0) {
    console.log("  no player ids, and no stat value near a player's name");
    return 0;
  }
  console.error(`\nscan:dist: ${problems.length} leak(s) — deck data reached the built site\n`);
  for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
  if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`);
  console.error("");
  return 1;
}

process.exit(main());
