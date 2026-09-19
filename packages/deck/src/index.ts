/**
 * @bt/deck — schema, validation and the build pipeline.
 *
 * The player data itself is not here. It lives in a private submodule at
 * `data/players/`, with a public synthetic sample at `sample/players/` so the
 * repo runs standalone.
 */

export { ALLOWED_LICENCES, playerSchema, statsSchema, imageSchema, toPlayer } from "./schema.js";
export type { RawImage, RawPlayer } from "./schema.js";

export { imageFilesIn, imagesDirFor, loadDeck, manifestPathFor } from "./load.js";
export type { LoadedDeck } from "./load.js";

export { MAX_ASPECT_RATIO, MIN_IMAGE_EDGE, orphanedImages, validateImages } from "./images.js";

export { EMPTY_MANIFEST, checkManifest, loadManifest, saveManifest } from "./manifest.js";
export type { Manifest, ManifestEntry } from "./manifest.js";

export {
  CONTENT_TYPES,
  contentTypeFor,
  createDryRunUploader,
  createR2Uploader,
  r2ConfigFromEnv,
} from "./upload.js";
export type { R2Config, UploadItem, Uploader } from "./upload.js";

export { displayedSize, hashBytes, originalKeyFor, shortHash, syncImages } from "./sync.js";
export { runSync } from "./sync-cli.js";
export type { SyncOptions, SyncResult } from "./sync.js";

export { MIN_ELIGIBLE_STATS, formatProblems, validateDeck } from "./validate.js";
export type { Problem } from "./validate.js";

export {
  LEAK_SCAN_THRESHOLD,
  buildCredits,
  buildFullDeck,
  buildIndexes,
  scanForLeakedValues,
} from "./artifacts.js";
export type { Credit, FullDeck, Indexes } from "./artifacts.js";

export {
  CORRELATION_WARN,
  REPORT_BANDS,
  rankCorrelation,
  statViability,
  viabilityReport,
} from "./viability.js";
export type { StatViability } from "./viability.js";

export { HALF_GAP, SKILL_CEILING, pCorrect, simulate, simulationReport } from "./simulate.js";
export type { SimOptions, SimResult } from "./simulate.js";

export { runBuild } from "./build.js";
export type { BuildOptions } from "./build.js";
