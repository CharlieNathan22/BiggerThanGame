/**
 * `pnpm images:sync` entry point.
 *
 * Separate from `build.ts` because this one needs network and credentials and
 * the build must not. Run it after adding or replacing photographs; commit the
 * manifest it writes.
 *
 *   pnpm images:sync            upload and write the manifest
 *   pnpm images:sync --dry-run  report what would change, no network, no creds
 *   pnpm images:sync --force    re-check everything against R2, ignoring hashes
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { imagesDirFor, loadDeckForSync, manifestPathFor } from "./load.js";
import { syncImages } from "./sync.js";
import { createDryRunUploader, createR2Uploader, r2ConfigFromEnv } from "./upload.js";
import type { Uploader } from "./upload.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");

/**
 * R2 credentials live in a gitignored `.env` at the repo root — not in
 * `.dev.vars`, which Wrangler loads into the Worker. The Worker never needs
 * write access to the bucket, so it should never see these keys.
 *
 * Variables already set in the shell win over the file.
 */
function loadLocalEnv(): void {
  const path = join(repoRoot, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

export async function runSync(
  argv: readonly string[],
  root: string = packageRoot,
): Promise<number> {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");

  // Private deck whenever it has any players, regardless of MIN_PRIVATE_DECK.
  const loaded = loadDeckForSync(root);
  if (loaded.problems.length > 0) {
    console.error("\nsync: schema errors — fix the deck first\n");
    for (const p of loaded.problems) console.error(`  ${p}`);
    return 1;
  }

  const sourceDir = imagesDirFor(root, loaded.source);
  const manifestPath = manifestPathFor(root, loaded.source);
  const withImages = loaded.raws.filter((r) => r.image !== undefined).length;

  console.log(`sync: ${withImages} of ${loaded.raws.length} players have an image block`);
  console.log(`  sources  ${sourceDir}`);
  console.log(`  manifest ${manifestPath}`);

  let uploader: Uploader;
  if (dryRun) {
    console.log("  mode     dry run — nothing will be uploaded");
    uploader = createDryRunUploader();
  } else {
    loadLocalEnv();
    const config = r2ConfigFromEnv(process.env);
    if (config === undefined) {
      console.error(
        "\nsync: missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,\n" +
          "R2_SECRET_ACCESS_KEY and R2_BUCKET in .env at the repo root, or pass --dry-run.\n",
      );
      return 1;
    }
    console.log(`  bucket   ${config.bucket}`);
    uploader = await createR2Uploader(config);
  }

  const result = await syncImages({
    raws: loaded.raws,
    sourceDir,
    manifestPath,
    uploader,
    force,
    write: !dryRun,
    log: (line) => console.log(line),
  });

  if (result.problems.length > 0) {
    console.error(`\nsync: image problems — nothing uploaded\n`);
    for (const p of result.problems) console.error(p);
    console.error("");
    return 1;
  }

  console.log(
    `sync: ${result.processed} processed, ${result.skipped} unchanged, ` +
      `${result.uploaded} original(s) ${dryRun ? "would be " : ""}uploaded`,
  );
  if (dryRun) console.log("  (dry run — nothing uploaded, manifest unchanged)");
  else if (result.processed > 0) console.log("  commit the manifest");

  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runSync(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
