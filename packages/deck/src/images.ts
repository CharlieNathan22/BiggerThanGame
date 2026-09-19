/**
 * Source image validation.
 *
 * Runs at **sync** time, against the local staging folder — not at build time.
 * The ordinary build never sees image files; it checks the committed manifest
 * instead (see `manifest.ts`).
 *
 * Kept out of `validate.ts` so that module stays pure and testable without
 * fixtures on disk.
 *
 * Reads image *headers* only, via `image-size` — no decoding, no native
 * dependency, and fast enough to run over 300 files in a second.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { imageSize } from "image-size";
import type { RawPlayer } from "./schema.js";
import type { Problem } from "./validate.js";

/**
 * Shortest edge a source image may have.
 *
 * Set below the 1600px display width on purpose. Many of the best freely
 * licensed photos of pre-2005 players are 1200–1600px, and rejecting them would
 * push those legends onto the monogram. A 1200px source still covers the 800w
 * rendition with room to spare, so phones stay sharp. The 1600w rendition is
 * requested with `fit=scale-down`, which never enlarges, so a smaller original
 * is served at its own size rather than upscaled: large retina screens get a
 * slightly soft card, which is acceptable for a darkened background layer.
 * Below 1200 even phones would suffer.
 *
 * This is the *source* minimum. What the browser receives is resized at the
 * edge by Image Transformations; see ARCHITECTURE.md §9.
 */
export const MIN_IMAGE_EDGE = 1200;

/**
 * Widest aspect ratio a source image may have, either orientation.
 *
 * The card crops to a roughly portrait frame. A panorama survives that badly —
 * you end up with a strip of grass and half a shoulder. Three to one is
 * generous; anything beyond it is the wrong photograph rather than a photograph
 * that needs cropping.
 */
export const MAX_ASPECT_RATIO = 3;

export function validateImages(raws: readonly RawPlayer[], imagesDir: string): Problem[] {
  const problems: Problem[] = [];
  const seenFiles = new Map<string, string>();

  for (const raw of raws) {
    if (raw.image === undefined) continue;
    const { file } = raw.image;
    const path = join(imagesDir, file);

    // Two players pointing at one file is nearly always a copy-paste slip.
    const previous = seenFiles.get(file);
    if (previous !== undefined) {
      problems.push({
        playerId: raw.id,
        field: "image.file",
        message: `${file} is already used by ${previous}`,
      });
    }
    seenFiles.set(file, raw.id);

    if (!existsSync(path)) {
      problems.push({
        playerId: raw.id,
        field: "image.file",
        message: `${file} does not exist in ${imagesDir}`,
      });
      continue;
    }

    // No size limit. Originals never enter git — they go straight to R2, where
    // storage is cheap and full resolution costs nothing worth counting.

    let width: number | undefined;
    let height: number | undefined;
    try {
      // image-size v2 takes bytes, not a path. Reading the whole file is
      // wasteful but harmless — this runs once per sync, not per request.
      const size = imageSize(readFileSync(path));
      width = size.width;
      height = size.height;
    } catch {
      problems.push({
        playerId: raw.id,
        field: "image.file",
        message: `${file} is not a readable image`,
      });
      continue;
    }

    if (width === undefined || height === undefined) {
      problems.push({
        playerId: raw.id,
        field: "image.file",
        message: `${file} has no readable dimensions`,
      });
      continue;
    }

    const shortest = Math.min(width, height);
    if (shortest < MIN_IMAGE_EDGE) {
      problems.push({
        playerId: raw.id,
        field: "image.file",
        message:
          `${file} is ${width}×${height} — the shortest edge must be at least ` +
          `${MIN_IMAGE_EDGE}px for the card to stay sharp`,
      });
    }

    const aspect = Math.max(width / height, height / width);
    if (aspect > MAX_ASPECT_RATIO) {
      problems.push({
        playerId: raw.id,
        field: "image.file",
        message:
          `${file} is ${aspect.toFixed(1)}:1 — too extreme to crop to a card ` +
          `(limit is ${MAX_ASPECT_RATIO}:1)`,
      });
    }
  }

  return problems;
}

/**
 * Files in the staging folder that no player references — usually a filename
 * typo in the YAML.
 */
export function orphanedImages(raws: readonly RawPlayer[], files: readonly string[]): string[] {
  const referenced = new Set(raws.filter((r) => r.image !== undefined).map((r) => r.image!.file));
  return files.filter((f) => !referenced.has(f));
}
