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
 *
 * One-off, for originals uploaded before their current metadata:
 *
 *   pnpm images:sync --refresh-metadata          report which manifest keys need
 *                                                new metadata (reads R2, needs creds)
 *   pnpm images:sync --refresh-metadata --apply  rewrite them in place
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DECK, imagesDirFor, loadDeckForSync, manifestPathFor } from "./load.js";
import { formatImageWarnings } from "./images.js";
import { loadManifest } from "./manifest.js";
import { refreshMetadata } from "./refresh.js";
import { syncImages } from "./sync.js";
import {
  createDryRunUploader,
  createR2Uploader,
  ORIGINAL_CACHE_CONTROL,
  r2ConfigFromEnv,
} from "./upload.js";
import type { R2Config, Uploader } from "./upload.js";

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

function r2ConfigOrExplain(hint: string): R2Config | undefined {
  loadLocalEnv();
  const config = r2ConfigFromEnv(process.env);
  if (config === undefined) {
    console.error(
      "\nsync: missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,\n" +
        `R2_SECRET_ACCESS_KEY and R2_BUCKET in .env at the repo root${hint}.\n`,
    );
  }
  return config;
}

export async function runSync(
  argv: readonly string[],
  root: string = packageRoot,
): Promise<number> {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const refresh = argv.includes("--refresh-metadata");
  const apply = argv.includes("--apply");

  // --apply exists only because a refresh is a dry run by default. On a
  // normal sync it would suggest the opposite of what happens.
  if (apply && !refresh) {
    console.error("\nsync: --apply only goes with --refresh-metadata\n");
    return 1;
  }
  if (refresh && (force || (apply && dryRun))) {
    console.error(
      "\nsync: --refresh-metadata takes --apply and nothing else " +
        "(it is a dry run without it)\n",
    );
    return 1;
  }
  if (refresh) return runRefresh(root, apply);

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
  console.log(`  deck     ${loaded.source}/${DECK}`);
  console.log(`  sources  ${sourceDir}`);
  console.log(`  manifest ${manifestPath}`);

  let uploader: Uploader;
  if (dryRun) {
    console.log("  mode     dry run — nothing will be uploaded");
    uploader = createDryRunUploader();
  } else {
    const config = r2ConfigOrExplain(", or pass --dry-run");
    if (config === undefined) return 1;
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

  // Printed before any failure, and never a reason to fail: a soft photo is
  // still better than the monogram.
  const warningLines = formatImageWarnings(result.warnings);
  if (warningLines.length > 0) {
    console.warn(`\nsync: warning — ${warningLines[0]}`);
    for (const line of warningLines.slice(1)) console.warn(line);
    console.warn("");
  }

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

/**
 * `--refresh-metadata`: sets `ORIGINAL_CACHE_CONTROL` on every manifest key
 * that lacks it, keeping the content type. Needs no source photos and ignores
 * deck schema errors — it touches only what the manifest already names.
 */
async function runRefresh(root: string, apply: boolean): Promise<number> {
  const { source } = loadDeckForSync(root);
  const manifestPath = manifestPathFor(root, source);

  console.log("sync: refresh metadata on originals already in R2");
  console.log(`  deck          ${source}/${DECK}`);
  console.log(`  manifest      ${manifestPath}`);
  console.log(`  cache-control ${ORIGINAL_CACHE_CONTROL}`);

  // loadManifest treats a missing file as empty; here that would read as
  // "nothing to do" when it really means "wrong deck".
  if (!existsSync(manifestPath)) {
    console.error(`\nsync: no manifest at ${manifestPath}\n`);
    return 1;
  }

  // Even the dry run reads each object's metadata, so it needs them too.
  const config = r2ConfigOrExplain(" (a refresh dry run reads R2 as well)");
  if (config === undefined) return 1;
  console.log(`  bucket        ${config.bucket}`);
  console.log(
    apply
      ? "  mode          apply — stale objects will be rewritten"
      : "  mode          dry run — reading metadata only, nothing will be written",
  );

  const result = await refreshMetadata({
    manifest: loadManifest(manifestPath),
    store: await createR2Uploader(config),
    apply,
    log: (line) => console.log(line),
  });

  console.log(
    `sync: ${result.checked} checked, ${result.current} already current, ` +
      `${result.stale} ${apply ? "rewritten" : "would be rewritten"}`,
  );
  if (!apply && result.stale > 0) console.log("  (dry run — re-run with --apply to write)");

  if (result.missing.length > 0) {
    console.error(`\nsync: ${result.missing.length} manifest key(s) not in the bucket\n`);
    for (const m of result.missing) console.error(`  ${m}`);
    console.error("\n  run pnpm images:sync --force to upload them\n");
  }
  if (result.problems.length > 0) {
    console.error("\nsync: metadata problems\n");
    for (const p of result.problems) console.error(p);
    console.error("");
  }

  return result.missing.length > 0 || result.problems.length > 0 ? 1 : 0;
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
