import { describe, expect, it } from "vitest";
import { checkRateLimits, rateLimitKey } from "../rate-limit.js";
import { isRunDateCurrent, mintRunId, runDate } from "../run-id.js";
import { friendlySeed } from "../seed.js";
import { uuidFrom } from "./helpers.js";

describe("run ids", () => {
  it("mint as YYYYMMDD-uuid in UTC", () => {
    expect(mintRunId(new Date("2026-01-05T23:59:59Z"), uuidFrom(1))).toBe(
      `20260105-${uuidFrom(1)}`,
    );
  });

  it("parse back to the run's day at 00:00 UTC", () => {
    expect(runDate(`20260919-${uuidFrom(1)}`)?.toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });

  it("round-trip with crypto.randomUUID", () => {
    const id = mintRunId(new Date("2026-09-19T10:00:00Z"), crypto.randomUUID());
    expect(runDate(id)).toBeDefined();
  });

  it.each([
    "",
    "20260919",
    `2026091-${uuidFrom(1)}`,
    `20261301-${uuidFrom(1)}`,
    `20260230-${uuidFrom(1)}`,
  ])("reject %j", (id) => {
    expect(runDate(id)).toBeUndefined();
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

describe("checkRateLimits", () => {
  const ok = { limit: async () => ({ success: true }) };
  const tripped = { limit: async () => ({ success: false }) };

  it("allows a request under both limits", async () => {
    expect(await checkRateLimits({ burst: ok, sustained: ok }, "k")).toEqual({ ok: true });
  });

  it("reports the burst window when the burst limit trips", async () => {
    expect(await checkRateLimits({ burst: tripped, sustained: ok }, "k")).toEqual({
      ok: false,
      retryAfter: 10,
    });
  });

  it("reports the sustained window when the sustained limit trips", async () => {
    expect(await checkRateLimits({ burst: ok, sustained: tripped }, "k")).toEqual({
      ok: false,
      retryAfter: 60,
    });
  });
});
