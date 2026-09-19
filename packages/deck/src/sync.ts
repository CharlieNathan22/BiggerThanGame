/**
 * `images:sync` — uploads source photographs to R2 and records them.
 *
 * Read originals → validate → hash → upload → write the manifest.
 *
 * No resizing happens here. Cloudflare Image Transformations resize and
 * convert at the edge on first request and cache the result, so all this
 * command does is put the original somewhere durable and note where.
 *
 * Separate from `pnpm build` on purpose. The build must stay offline and
 * reproducible from a checkout; this needs network and credentials and runs a
 * few times a year. Keeping them apart is what lets CI build without R2 access.
 *
 * Idempotent: a source whose SHA-256 already matches the manifest is skipped
 * entirely, so re-running after changing one photo uploads one photo.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { imageSize } from "image-size";
import { validateImages } from "./images.js";
import { loadManifest, saveManifest } from "./manifest.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
import type { RawPlayer } from "./schema.js";
import { contentTypeFor } from "./upload.js";
import type { Uploader } from "./upload.js";
import { formatProblems } from "./validate.js";

export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Sixteen hex chars — 64 bits — is ample to keep 300 files apart. */
export function shortHash(sha256: string): string {
  return sha256.slice(0, 16);
}

/**
 * R2 key for an original: `originals/<id>.<hash16><ext>`.
 *
 * Content-hashed, so replacing a photo produces a new key and a new URL. That
 * is what makes an immutable, year-long cache header safe — there is never a
 * stale object at an old URL to purge. The id stays in the key so the bucket is
 * browsable by eye.
 */
export function originalKeyFor(playerId: string, sha256: string, ext: string): string {
  return `originals/${playerId}.${shortHash(sha256)}${ext.toLowerCase()}`;
}

/**
 * Width and height as displayed, not as stored.
 *
 * Phone photos are often stored landscape with an EXIF flag saying "rotate
 * 90°". Transformations honour the flag, so the manifest must too — otherwise
 * the reserved box is the wrong shape and the card jumps when the image lands.
 * Orientations 5–8 are the ones that swap the axes.
 */
export function displayedSize(bytes: Buffer): { width: number; height: number } {
  // Validation already proved the dimensions are readable.
  const { width, height, orientation } = imageSize(bytes);
  return orientation !== undefined && orientation >= 5
    ? { width: height, height: width }
    : { width, height };
}

export interface SyncOptions {
  readonly raws: readonly RawPlayer[];
  /** Where the source photographs live locally. */
  readonly sourceDir: string;
  readonly manifestPath: string;
  readonly uploader: Uploader;
  /** Re-check every file against R2, ignoring unchanged hashes. */
  readonly force?: boolean;
  /**
   * Write the manifest. Off for dry runs — a manifest naming keys that were
   * never uploaded would pass the build and ship broken images.
   */
  readonly write?: boolean;
  readonly log?: (line: string) => void;
}

export interface SyncResult {
  readonly processed: number;
  readonly skipped: number;
  readonly uploaded: number;
  readonly problems: readonly string[];
  readonly manifest: Manifest;
}

export async function syncImages(opts: SyncOptions): Promise<SyncResult> {
  const log = opts.log ?? (() => {});
  const withImages = opts.raws.filter((r) => r.image !== undefined);

  // Validate before doing any work — a bad image should stop the run, not
  // surface after twenty uploads.
  const problems = validateImages(opts.raws, opts.sourceDir);
  if (problems.length > 0) {
    return {
      processed: 0,
      skipped: 0,
      uploaded: 0,
      problems: formatProblems(problems).split("\n"),
      manifest: loadManifest(opts.manifestPath),
    };
  }

  const existing = loadManifest(opts.manifestPath);
  const entries: Record<string, ManifestEntry> = {};
  let processed = 0;
  let skipped = 0;
  let uploaded = 0;

  for (const raw of withImages) {
    const file = raw.image!.file;
    const source = readFileSync(join(opts.sourceDir, file));
    const sha256 = hashBytes(source);

    const previous = existing.entries[raw.id];
    if (opts.force !== true && previous?.sourceSha256 === sha256) {
      entries[raw.id] = previous;
      skipped += 1;
      continue;
    }

    log(`  ${raw.id}`);
    const key = originalKeyFor(raw.id, sha256, extname(file));

    // Content-addressed: an existing key already holds exactly these bytes.
    if (!(await opts.uploader.has(key))) {
      await opts.uploader.put({ key, bytes: source, contentType: contentTypeFor(file) });
      uploaded += 1;
    }

    entries[raw.id] = { key, ...displayedSize(source), sourceSha256: sha256 };
    processed += 1;
  }

  const manifest: Manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries,
  };
  if (opts.write !== false) saveManifest(opts.manifestPath, manifest);

  return { processed, skipped, uploaded, problems: [], manifest };
}
