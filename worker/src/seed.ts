/**
 * Seed derivation. ARCHITECTURE.md §7.
 *
 *   seed(friendly, runId) = HMAC-SHA256(RUN_SECRET, "friendly:" + runId)
 *   seed(endless,  runId) = HMAC-SHA256(RUN_SECRET, "endless:"  + runId)
 *   seed(endless-instagram, runId)
 *                         = HMAC-SHA256(RUN_SECRET, "endless:instagram:" + runId)
 *   seed(squad:<theme id>, runId)
 *                         = HMAC-SHA256(RUN_SECRET, "squad:<theme id>:" + runId)
 *   seed(ranked, gameNo)  = HMAC-SHA256(RUN_SECRET, "ranked:" + gameNo)
 *
 * Each Endless variant's domain is its `seedDomain` (variants.ts in @bt/core),
 * so no two variants' runs can share a seed even if they shared a run id.
 *
 * `runId` here is the run's body, `YYYYMMDD-<uuid>`, without its signature. The
 * client never chooses or sees a seed. It holds a run id, and without the
 * secret it can't turn that into the sequence ahead of time.
 *
 * The engine folds the seed into 32 bits of PRNG state (`hashSeed`), so there
 * are at most 2³² runs per mode. Kept on purpose: ARCHITECTURE.md §7.
 */

import { seedDomainOf } from "@bt/core";
import type { EndlessVariantId } from "@bt/core";
import { hmacSha256, toHex } from "./hmac.js";
import type { RunMode } from "./run-id.js";

export async function friendlySeed(secret: string, runId: string): Promise<string> {
  return toHex(await hmacSha256(secret, `friendly:${runId}`));
}

/** The seed for a run of an Endless variant; general Endless by default. */
export async function endlessSeed(
  secret: string,
  runId: string,
  variant: EndlessVariantId = "endless",
): Promise<string> {
  return toHex(await hmacSha256(secret, `${seedDomainOf(variant)}${runId}`));
}

/**
 * Daily Ranked's seed: the game's alone, so every player of a game gets the
 * same questions. Used once per game, when the game is frozen (daily-game.ts).
 */
export async function rankedSeed(secret: string, gameNo: number): Promise<string> {
  return toHex(await hmacSha256(secret, `ranked:${gameNo}`));
}

/** The seed for a run of `mode`. */
export function seedFor(mode: RunMode, secret: string, runId: string): Promise<string> {
  return mode === "friendly" ? friendlySeed(secret, runId) : endlessSeed(secret, runId, mode);
}
