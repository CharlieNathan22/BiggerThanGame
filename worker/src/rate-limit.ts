/**
 * Rate limiting for `/api/round/next`.
 *
 * This limit is the only thing between the deck and a scraper (DESIGN.md §3,
 * §15), so it is load-bearing rather than hygiene. It has to be invisible to
 * honest players — including a classroom, an office or a mobile carrier's CGNAT
 * putting dozens of them behind one IP — while keeping the deck slow to pull.
 *
 * So the tight limit is on the **run**, not the IP. Answers are counted per
 * signed run id (run-id.ts): a caller can't mint a fresh id per request,
 * because only the server can sign one, and each run start is itself counted
 * per IP. The per-IP limit on everything is a generous flood backstop only.
 * ARCHITECTURE.md §12 has the numbers and the trade-off.
 *
 * Three Workers Rate Limiting bindings, configured in `wrangler.toml` (periods
 * can only be 10 or 60 seconds). The numbers live there; `RATE_LIMITS` mirrors
 * them so code and tests can name them, and a test fails if the two drift
 * apart. Counters are per Cloudflare location and deliberately approximate —
 * this is a speed bump, not accounting.
 */

/** Structural, so this compiles under Workers types and Node test types alike. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const RATE_LIMITS = {
  /** Answers per signed run id. A fast honest player answers about every two seconds. */
  answers: { binding: "RUN_ANSWERS", limit: 20, period: 10 },
  /** Run starts per IP (IPv4, or the IPv6 /64). */
  starts: { binding: "RUN_STARTS", limit: 60, period: 60 },
  /** Every request per IP. A flood backstop, sized for a full classroom. */
  flood: { binding: "ROUND_FLOOD", limit: 800, period: 60 },
} as const;

export type RateRule = keyof typeof RATE_LIMITS;

export type RateLimiters = { readonly [K in RateRule]: RateLimiter };

export type RateDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Seconds, for the `retry-after` header. */
      readonly retryAfter: number;
    };

/** One limiter, one key. Over the limit, retry after the rule's whole period. */
export async function checkRateLimit(
  limiters: RateLimiters,
  rule: RateRule,
  key: string,
): Promise<RateDecision> {
  const { success } = await limiters[rule].limit({ key });
  return success ? { ok: true } : { ok: false, retryAfter: RATE_LIMITS[rule].period };
}

/**
 * The IP key for run starts and the flood backstop: the IPv4 address, or the
 * IPv6 /64.
 *
 * Cloudflare's docs advise against IP keys because addresses are shared (CGNAT,
 * offices, schools), which is why neither IP limit is the tight one — answers
 * are limited per run. IPv6 is cut to its /64 because one subscriber is usually
 * handed a whole /64 and could otherwise rotate through it freely.
 */
export function rateLimitKey(ip: string | null): string {
  if (ip === null || ip.trim() === "") return "unknown";
  const address = ip.trim().toLowerCase();

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1] !== undefined) return mapped[1];
  if (!address.includes(":")) return address;

  return ipv6Prefix64(address) ?? address;
}

function ipv6Prefix64(address: string): string | undefined {
  const halves = address.split("::");
  if (halves.length > 2) return undefined;

  const head = halves[0] === "" ? [] : (halves[0] ?? "").split(":");
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const tail = halves[1] === "" ? [] : (halves[1] ?? "").split(":");
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return undefined;
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  }

  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}
