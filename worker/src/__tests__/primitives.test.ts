import { describe, expect, it } from "vitest";
import { timingSafeEqual } from "../hmac.js";
import { checkRateLimit, rateLimitKey } from "../rate-limit.js";
import { isRunDateCurrent, mintRunId, parseRunId, verifyRunId } from "../run-id.js";
import { friendlySeed } from "../seed.js";
import { uuidFrom } from "./helpers.js";

describe("run ids", () => {
  const SIG = /^[A-Za-z0-9_-]{22}$/;

  it("mint as YYYYMMDD-uuid.signature, dated in UTC", async () => {
    const id = await mintRunId(new Date("2026-01-05T23:59:59Z"), uuidFrom(1), "s");
    const [body, sig] = id.split(".");
    expect(body).toBe(`20260105-${uuidFrom(1)}`);
    expect(sig).toMatch(SIG);
  });

  it("sign with a truncated base64url HMAC-SHA256 of 'run:' + body", async () => {
    // Cross-checks the Web Crypto path against Node's own implementation.
    const { createHmac } = await import("node:crypto");
    const body = `20260919-${uuidFrom(1)}`;
    const mac = createHmac("sha256", "Jefe").update(`run:${body}`).digest();
    const expected = mac.subarray(0, 16).toString("base64url");
    expect(await mintRunId(new Date("2026-09-19T10:00:00Z"), uuidFrom(1), "Jefe")).toBe(
      `${body}.${expected}`,
    );
  });

  it("parse back to the run's day at 00:00 UTC", async () => {
    const id = await mintRunId(new Date("2026-09-19T18:00:00Z"), uuidFrom(1), "s");
    expect(parseRunId(id)).toEqual({
      body: `20260919-${uuidFrom(1)}`,
      date: new Date("2026-09-19T00:00:00.000Z"),
    });
  });

  it("verify with the secret that signed them, and no other", async () => {
    const id = await mintRunId(new Date("2026-09-19T10:00:00Z"), crypto.randomUUID(), "s");
    expect(await verifyRunId(id, "s")).toBeDefined();
    expect(await verifyRunId(id, "t")).toBeUndefined();
  });

  it.each([
    "",
    "20260919",
    `20260919-${uuidFrom(1)}`,
    `20260919-${uuidFrom(1)}.`,
    `20260919-${uuidFrom(1)}.${"A".repeat(21)}`,
    `20260919-${uuidFrom(1)}.${"A".repeat(23)}`,
    `20260919-${uuidFrom(1)}.${"A".repeat(21)}=`,
    `20260919-${uuidFrom(1)}.${"A".repeat(21)}+`,
    `2026091-${uuidFrom(1)}.${"A".repeat(22)}`,
    `20261301-${uuidFrom(1)}.${"A".repeat(22)}`,
    `20260230-${uuidFrom(1)}.${"A".repeat(22)}`,
  ])("reject %j as malformed", (id) => {
    expect(parseRunId(id)).toBeUndefined();
  });

  it("accept dates within a day of the server's date, either side", () => {
    const clock = new Date("2026-09-19T00:05:00Z");
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    expect(isRunDateCurrent(day("2026-09-18"), clock)).toBe(true);
    expect(isRunDateCurrent(day("2026-09-19"), clock)).toBe(true);
    expect(isRunDateCurrent(day("2026-09-20"), clock)).toBe(true);
    expect(isRunDateCurrent(day("2026-09-17"), clock)).toBe(false);
    expect(isRunDateCurrent(day("2026-09-21"), clock)).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it.each([
    ["abc", "abc", true],
    ["abc", "abd", false],
    ["abc", "ab", false],
    ["", "", true],
  ])("%j vs %j is %s", (a, b, expected) => {
    expect(timingSafeEqual(a, b)).toBe(expected);
  });
});

describe("friendlySeed", () => {
  it("is 64 hex characters of HMAC-SHA256", async () => {
    expect(await friendlySeed("s", "run")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("agrees with an independent HMAC-SHA256 over 'friendly:' + runId", async () => {
    // Cross-checks the Web Crypto path against Node's own implementation.
    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", "Jefe").update("friendly:abc").digest("hex");
    expect(await friendlySeed("Jefe", "abc")).toBe(expected);
  });

  it("is stable for the same secret and run", async () => {
    expect(await friendlySeed("s", "run")).toBe(await friendlySeed("s", "run"));
  });

  it("changes with the run id and with the secret", async () => {
    const base = await friendlySeed("s", "run");
    expect(await friendlySeed("s", "run2")).not.toBe(base);
    expect(await friendlySeed("t", "run")).not.toBe(base);
  });
});

describe("rateLimitKey", () => {
  it.each([
    ["an IPv4 address as-is", "203.0.113.7", "203.0.113.7"],
    ["surrounding whitespace trimmed", " 203.0.113.7 ", "203.0.113.7"],
    ["an IPv4-mapped IPv6 address as IPv4", "::ffff:203.0.113.7", "203.0.113.7"],
    [
      "a full IPv6 address to its /64",
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      "2001:db8:85a3:0::/64",
    ],
    ["a compressed IPv6 address to its /64", "2001:db8:abcd:12::1", "2001:db8:abcd:12::/64"],
    ["the whole /64 to one key", "2001:db8:abcd:12:ffff:ffff:ffff:ffff", "2001:db8:abcd:12::/64"],
    ["IPv6 case-insensitively", "2001:DB8:ABCD:12::1", "2001:db8:abcd:12::/64"],
    ["a leading :: IPv6 address", "::1", "0:0:0:0::/64"],
    ["a missing header to one shared key", null, "unknown"],
    ["an empty header to one shared key", "", "unknown"],
  ])("keys %s", (_, ip, expected) => {
    expect(rateLimitKey(ip)).toBe(expected);
  });

  it("keeps an unparseable value as its own key rather than merging it", () => {
    expect(rateLimitKey("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
  });
});

describe("checkRateLimit", () => {
  const ok = { limit: async () => ({ success: true }) };
  const tripped = { limit: async () => ({ success: false }) };

  it("allows a request under the limit", async () => {
    const limiters = { answers: ok, starts: ok, flood: ok };
    expect(await checkRateLimit(limiters, "answers", "k")).toEqual({ ok: true });
  });

  it.each([
    ["answers", 10],
    ["starts", 60],
    ["flood", 60],
  ] as const)("reports the %s window when that limit trips", async (rule, period) => {
    const limiters = { answers: ok, starts: ok, flood: ok, [rule]: tripped };
    expect(await checkRateLimit(limiters, rule, "k")).toEqual({ ok: false, retryAfter: period });
  });
});
