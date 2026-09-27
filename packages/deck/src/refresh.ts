/**
 * `images:sync --refresh-metadata` — a one-off that brings originals already in
 * R2 up to date with the metadata `images:sync` now writes on upload.
 *
 * Works from the manifest, not the source photos: every key it names is
 * checked, and only objects whose `Cache-Control` differs are rewritten. The
 * rewrite is a metadata-only copy inside R2, so nothing is re-uploaded, and
 * the existing content type is carried across rather than re-derived.
 *
 * Dry run unless `apply` is set. Even a dry run reads from R2, because the
 * point is to report which objects actually need the change.
 */

import type { Manifest } from "./manifest.js";
import { ORIGINAL_CACHE_CONTROL } from "./upload.js";
import type { MetadataStore } from "./upload.js";

export interface RefreshOptions {
  readonly manifest: Manifest;
  readonly store: MetadataStore;
  /** Rewrite stale objects. Off, it only reports what would change. */
  readonly apply?: boolean;
  readonly log?: (line: string) => void;
}

export interface RefreshResult {
  /** Keys in the manifest. */
  readonly checked: number;
  /** Already carrying `ORIGINAL_CACHE_CONTROL`, left alone. */
  readonly current: number;
  /** Rewritten, or with `apply` off, that would be. */
  readonly stale: number;
  /** Manifest keys not in the bucket, as `id: key`. */
  readonly missing: readonly string[];
  readonly problems: readonly string[];
}

export async function refreshMetadata(opts: RefreshOptions): Promise<RefreshResult> {
  const log = opts.log ?? (() => {});
  const entries = Object.entries(opts.manifest.entries).sort(([a], [b]) => a.localeCompare(b));
  const missing: string[] = [];
  const problems: string[] = [];
  let current = 0;
  let stale = 0;

  for (const [id, { key }] of entries) {
    const before = await opts.store.head(key);
    if (before === undefined) {
      missing.push(`${id}: ${key}`);
      continue;
    }
    if (before.cacheControl === ORIGINAL_CACHE_CONTROL) {
      current += 1;
      continue;
    }
    // REPLACE sets the content type too. With nothing to carry across, any
    // value would be a guess — leave the object alone and say so.
    if (before.contentType === undefined) {
      problems.push(`  ${id}: ${key} has no content type — not touched`);
      continue;
    }

    stale += 1;
    log(`  ${id}  ${key}  cache-control: ${before.cacheControl ?? "(none)"}`);
    if (opts.apply !== true) continue;

    await opts.store.replaceMetadata(key, { ...before, cacheControl: ORIGINAL_CACHE_CONTROL });

    // Read it back: a one-off against the live bucket should prove it worked.
    const after = await opts.store.head(key);
    if (
      after?.cacheControl !== ORIGINAL_CACHE_CONTROL ||
      after.contentType !== before.contentType
    ) {
      problems.push(
        `  ${id}: ${key} reads back as content-type ${after?.contentType ?? "(none)"}, ` +
          `cache-control ${after?.cacheControl ?? "(none)"}`,
      );
    }
  }

  return { checked: entries.length, current, stale, missing, problems };
}
