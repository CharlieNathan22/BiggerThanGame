/**
 * Seed derivation. ARCHITECTURE.md §7.
 *
 *   seed(friendly, runId) = HMAC-SHA256(RUN_SECRET, "friendly:" + runId)
 *   seed(endless,  runId) = HMAC-SHA256(RUN_SECRET, "endless:"  + runId)
 *
 * `runId` here is the run's body, `YYYYMMDD-<uuid>`, without its signature. The
 * client never chooses or sees a seed. It holds a run id, and without the
 * secret it can't turn that into the sequence ahead of time.
 *
 * The engine folds the seed into 32 bits of PRNG state (`hashSeed`), so there
 * are at most 2³² runs per mode. Kept on purpose: ARCHITECTURE.md §7.
 */

import { hmacSha256, toHex } from "./hmac.js";
import type { RunMode } from "./run-id.js";

export async function friendlySeed(secret: string, runId: string): Promise<string> {
  return toHex(await hmacSha256(secret, `friendly:${runId}`));
}

export async function endlessSeed(secret: string, runId: string): Promise<string> {
  return toHex(await hmacSha256(secret, `endless:${runId}`));
}

/** The seed for a run of `mode`. */
export function seedFor(mode: RunMode, secret: string, runId: string): Promise<string> {
  return mode === "endless" ? endlessSeed(secret, runId) : friendlySeed(secret, runId);
}
