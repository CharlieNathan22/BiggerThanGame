/**
 * Rate limiting for `/api/round/next`.
 *
 * This limit is the only thing between the deck and a scraper (DESIGN.md §3,
 * §15), so it is load-bearing rather than hygiene. It has to be invisible to a
 * fast honest player — about one answer every two seconds, nearer one a second
 * with reduced motion — while making reconstruction of the deck slow.
 *
 * Two Workers Rate Limiting bindings, configured in `wrangler.toml`. The
 * numbers live there; `RATE_LIMITS` mirrors them so code and tests can name
 * them, and a test fails if the two drift apart. Counters are per Cloudflare
 * location and deliberately approximate — this is a speed bump, not accounting.
 */

/** Structural, so this compiles under Workers types and Node test types alike. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const RATE_LIMITS = {
  /** Catches a tight loop quickly. */
  burst: { binding: "ROUND_BURST", limit: 20, period: 10 },
  /** Caps what a single client can pull per minute. */
  sustained: { binding: "ROUND_SUSTAINED", limit: 90, period: 60 },
} as const;

export interface RateLimiters {
  readonly burst: RateLimiter;
  readonly sustained: RateLimiter;
}

export type RateDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Seconds, for the `retry-after` header. */
      readonly retryAfter: number;
    };

export async function checkRateLimits(limiters: RateLimiters, key: string): Promise<RateDecision> {
  if (!(await limiters.burst.limit({ key })).success) {
    return { ok: false, retryAfter: RATE_LIMITS.burst.period };
  }
  if (!(await limiters.sustained.limit({ key })).success) {
    return { ok: false, retryAfter: RATE_LIMITS.sustained.period };
  }
  return { ok: true };
}

/**
 * The client key: the IPv4 address, or the IPv6 /64.
 *
 * Cloudflare's docs advise against IP keys because addresses are shared (CGNAT,
 * offices, schools). A stateless endpoint has nothing else to key on, which is
 * why the limits are generous. IPv6 is cut to its /64 because one subscriber is
 * usually handed a whole /64 and could otherwise rotate through it freely.
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
