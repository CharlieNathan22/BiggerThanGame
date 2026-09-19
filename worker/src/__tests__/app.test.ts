/**
 * The HTTP layer: routing, method, rate limiting, body handling, headers.
 * Bindings are mocked; the round logic underneath is real.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { StartResponse } from "@bt/core";
import { ROUND_PATH, createApp } from "../app.js";
import type { Env } from "../app.js";
import { RATE_LIMITS } from "../rate-limit.js";
import type { RateLimiter } from "../rate-limit.js";
import { SAMPLE_DECK, SECRET, TODAY, uuidFrom } from "./helpers.js";

const app = createApp({
  deck: SAMPLE_DECK,
  images: {},
  clock: () => TODAY,
  uuid: () => uuidFrom(1),
});

function limiter(success = true): RateLimiter & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(async () => ({ success })) };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("<html>site</html>", { status: 200 })) },
    RUN_SECRET: SECRET,
    ROUND_BURST: limiter(),
    ROUND_SUSTAINED: limiter(),
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://biggerthangame.com${ROUND_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("routing", () => {
  it("serves everything outside /api/ from static assets", async () => {
    const e = env();
    const res = await app.fetch(new Request("https://biggerthangame.com/about"), e);
    expect(await res.text()).toBe("<html>site</html>");
    expect(e.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("answers an unknown /api/ path with a JSON 404", async () => {
    const res = await app.fetch(new Request("https://biggerthangame.com/api/nope"), env());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses anything but POST on the round endpoint", async () => {
    const res = await app.fetch(new Request(`https://biggerthangame.com${ROUND_PATH}`), env());
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("starts a run", async () => {
    const res = await app.fetch(post({ mode: "friendly" }), env());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as StartResponse;
    expect(body.runId).toBe(`20260919-${uuidFrom(1)}`);
  });
});

describe("bad requests", () => {
  it("rejects a body that isn't JSON", async () => {
    const res = await app.fetch(post("{not json"), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_request" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an oversized body", async () => {
    const res = await app.fetch(post({ mode: "friendly", pad: "x".repeat(2000) }), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ detail: "body too large" });
  });

  it("maps a validation failure to 400", async () => {
    const res = await app.fetch(post({ mode: "ranked" }), env());
    expect(res.status).toBe(400);
  });

  it("fails closed without a secret rather than seeding from nothing", async () => {
    const res = await app.fetch(post({ mode: "friendly" }), env({ RUN_SECRET: "" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });
});

describe("rate limiting", () => {
  it("keys both limiters on the client IP", async () => {
    const e = env();
    await app.fetch(post({ mode: "friendly" }), e);
    expect(e.ROUND_BURST.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    expect(e.ROUND_SUSTAINED.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("returns 429 with retry-after when the burst limit trips", async () => {
    const res = await app.fetch(post({ mode: "friendly" }), env({ ROUND_BURST: limiter(false) }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(RATE_LIMITS.burst.period));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("returns 429 with retry-after when the sustained limit trips", async () => {
    const res = await app.fetch(
      post({ mode: "friendly" }),
      env({ ROUND_SUSTAINED: limiter(false) }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(RATE_LIMITS.sustained.period));
  });

  it("limits before doing any work, so rejected requests stay cheap", async () => {
    const e = env({ ROUND_BURST: limiter(false), RUN_SECRET: "" });
    const res = await app.fetch(post("{not json"), e);
    expect(res.status).toBe(429);
  });

  it("does not touch the limiters for static assets", async () => {
    const e = env();
    await app.fetch(new Request("https://biggerthangame.com/"), e);
    expect(e.ROUND_BURST.limit).not.toHaveBeenCalled();
  });

  it("matches the numbers configured in wrangler.toml", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const toml = readFileSync(resolve(root, "wrangler.toml"), "utf8");
    for (const { binding, limit, period } of Object.values(RATE_LIMITS)) {
      const block = toml.split("[[ratelimits]]").find((b) => b.includes(`name = "${binding}"`));
      expect(block, `wrangler.toml has no ${binding} binding`).toBeDefined();
      expect(block).toMatch(new RegExp(`limit = ${limit}\\b`));
      expect(block).toMatch(new RegExp(`period = ${period}\\b`));
    }
  });
});
