/**
 * Seed derivation. ARCHITECTURE.md §7.
 *
 *   seed(friendly, runId) = HMAC-SHA256(RUN_SECRET, "friendly:" + runId)
 *
 * The client never chooses or sees a seed. It holds a run id, and without the
 * secret it can't turn that into the sequence ahead of time.
 *
 * Web Crypto only, so this runs unchanged in workerd and in Node tests.
 */

export async function friendlySeed(secret: string, runId: string): Promise<string> {
  return hmacHex(secret, `friendly:${runId}`);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
