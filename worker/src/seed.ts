/**
 * Seed derivation. ARCHITECTURE.md §7.
 *
 *   seed(friendly, runId) = HMAC-SHA256(RUN_SECRET, "friendly:" + runId)
 *
 * `runId` here is the run's body, `YYYYMMDD-<uuid>`, without its signature
 * (run-id.ts). The client never chooses or sees a seed. It holds a run id, and
 * without the secret it can't turn that into the sequence ahead of time.
 */

import { hmacSha256, toHex } from "./hmac.js";

export async function friendlySeed(secret: string, runId: string): Promise<string> {
  return toHex(await hmacSha256(secret, `friendly:${runId}`));
}
