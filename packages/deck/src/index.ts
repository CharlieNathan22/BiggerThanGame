/**
 * @bt/deck — schema, validation and the build pipeline.
 *
 * The player data itself is not here. It lives in a private submodule at
 * `data/players/`, with a public synthetic sample at `sample/players/` so the
 * repo runs standalone.
 */

export { ALLOWED_LICENCES, playerSchema, statsSchema, imageSchema, toPlayer } from "./schema.js";
export type { RawImage, RawPlayer } from "./schema.js";

export { loadDeck } from "./load.js";
export type { LoadedDeck } from "./load.js";

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
