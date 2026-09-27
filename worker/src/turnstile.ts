/**
 * Cloudflare Turnstile, checked server-side with the Siteverify API.
 *
 * Only the secret and the token are sent. The visitor's IP (`remoteip`) is
 * optional in Siteverify and deliberately left out: the feedback endpoint
 * handles no personal data, and nothing here is logged.
 *
 * Three outcomes, because they mean different things to the player: `pass`;
 * `fail`, when Turnstile judged the token (bad, expired or already used) and
 * the form should get a fresh one; and `error`, when Siteverify itself
 * couldn't be asked or answered nonsense — our problem, not theirs.
 */

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Siteverify normally answers in milliseconds; past this, treat it as down. */
const TIMEOUT_MS = 5000;

export type TurnstileOutcome = "pass" | "fail" | "error";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function verifyTurnstile(
  token: string,
  secret: string,
  fetchFn: FetchLike,
): Promise<TurnstileOutcome> {
  let response: Response;
  try {
    response = await fetchFn(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return "error";
  }
  if (!response.ok) return "error";

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return "error";
  }
  if (typeof result !== "object" || result === null) return "error";
  const { success, "error-codes": codes } = result as Record<string, unknown>;
  if (success === true) return "pass";
  if (success !== false) return "error";
  // Turnstile's own trouble, or a misconfigured secret: not the player's fault.
  const ours = ["internal-error", "missing-input-secret", "invalid-input-secret"];
  return Array.isArray(codes) && codes.some((c) => ours.includes(String(c))) ? "error" : "fail";
}
