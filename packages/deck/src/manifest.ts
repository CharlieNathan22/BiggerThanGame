/**
 * The image manifest.
 *
 * Maps player id → the R2 key of that player's original photograph. Generated
 * by `images:sync`, committed to the private deck submodule, read by the
 * ordinary build.
 *
 * It exists so the build stays **offline and reproducible**. Keys are
 * content-hashed, so they can't be derived from the id alone; without a
 * committed record, a checkout couldn't know a player's image URL without
 * network access and credentials.
 *
 * Only originals are stored. Resizing and format conversion happen at the edge
 * through Cloudflare Image Transformations — the URL builders live in
 * `@bt/core` (`imageUrl`, `srcsetFor`) so the browser and Worker can use them.
 * See ARCHITECTURE.md §9.
 *
 * Keys are stored, never full URLs. The domain is applied at runtime from
 * config — bake it in here and changing the hostname means regenerating every
 * entry.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { PlayerImage } from "@bt/core";
import type { RawPlayer } from "./schema.js";
import type { Problem } from "./validate.js";

/**
 * One player's photo. The `PlayerImage` part (key, width, height) is exactly
 * what reaches the client in the round payload; the hash stays server-side.
 */
export interface ManifestEntry extends PlayerImage {
  /**
   * SHA-256 of the source file. Makes sync idempotent: with 300 images and one
   * changed, it uploads one rather than all of them.
   */
  readonly sourceSha256: string;
}

export interface Manifest {
  readonly version: 1;
  readonly generatedAt: string;
  readonly entries: Readonly<Record<string, ManifestEntry>>;
}

export const EMPTY_MANIFEST: Manifest = {
  version: 1,
  generatedAt: new Date(0).toISOString(),
  entries: {},
};

export function loadManifest(path: string): Manifest {
  if (!existsSync(path)) return EMPTY_MANIFEST;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Manifest;
    if (parsed.version !== 1) return EMPTY_MANIFEST;
    return parsed;
  } catch {
    return EMPTY_MANIFEST;
  }
}

export function saveManifest(path: string, manifest: Manifest): void {
  // Two-space JSON with sorted keys so diffs are readable and stable — the
  // manifest is committed, and a reordered file every sync would be noise.
  const entries = Object.fromEntries(
    Object.entries(manifest.entries).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(path, `${JSON.stringify({ ...manifest, entries }, null, 2)}\n`, "utf8");
}

/**
 * Consistency check between deck and manifest. Cheap, offline, no files
 * touched.
 *
 * Catches the two ways they drift apart: a player with an `image` block that
 * was never synced, and a manifest entry for a player who no longer exists or
 * lost their image.
 */
export function checkManifest(raws: readonly RawPlayer[], manifest: Manifest): Problem[] {
  const problems: Problem[] = [];
  const withImages = new Set<string>();

  for (const raw of raws) {
    if (raw.image === undefined) continue;
    withImages.add(raw.id);
    if (manifest.entries[raw.id] === undefined) {
      problems.push({
        playerId: raw.id,
        field: "image",
        message: "has an image block but no manifest entry — run images:sync",
      });
    }
  }

  for (const id of Object.keys(manifest.entries)) {
    if (!withImages.has(id)) {
      problems.push({
        playerId: id,
        field: "image",
        message: "has a manifest entry but no image block — stale, re-run images:sync",
      });
    }
  }

  return problems;
}
