/**
 * `/api/feedback` over HTTP: routing, its own rate limit, body handling,
 * config, and what reaches the `send_email` binding. Bindings, Siteverify and
 * the `EmailMessage` constructor are mocked; the handler underneath is real.
 */

import { describe, expect, it, vi } from "vitest";
import type { StartResponse } from "@bt/core";
import { scanForLeakedValues } from "@bt/deck";
import { FEEDBACK_PATH, MAX_FEEDBACK_BYTES, ROUND_PATH, createApp } from "../app.js";
import type { Env, OutgoingEmail } from "../app.js";
import { FEEDBACK_SUBJECTS } from "../feedback.js";
import { RATE_LIMITS } from "../rate-limit.js";
import type { RateLimiter } from "../rate-limit.js";
import type { FetchLike } from "../turnstile.js";
import { SAMPLE_DECK, SECRET, TODAY, runDay, uuidFrom } from "./helpers.js";

const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const CRLF = "\r\n";

/** What the fake `EmailMessage` constructor was given. */
interface FakeEmail extends OutgoingEmail {
  readonly raw: string;
}

/** Siteverify, accepting every token unless a test says otherwise. */
const siteverify = vi.fn<FetchLike>(async () =>
  Response.json({ success: true, "error-codes": [] }),
);

const app = createApp({
  deck: SAMPLE_DECK,
  images: {},
  clock: () => TODAY,
  uuid: () => uuidFrom(1),
  fetch: siteverify,
  emailMessage: (from, to, raw): FakeEmail => ({ from, to, raw }),
});

function limiter(success = true): RateLimiter & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(async () => ({ success })) };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("<html>site</html>")) },
    RUN_SECRET: SECRET,
    RUN_ANSWERS: limiter(),
    RUN_STARTS: limiter(),
    ROUND_FLOOD: limiter(),
    FEEDBACK_SENDS: limiter(),
    TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
    FEEDBACK_TO: "owner@example.com",
    FEEDBACK_EMAIL: { send: vi.fn(async () => ({ messageId: "m1" })) },
    ...overrides,
  };
}

function feedbackPost(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://biggerthangame.com${FEEDBACK_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "2001:db8:abcd:12:1:2:3:4",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const suggestion = { kind: "suggest", name: "Gianfranco Zola", turnstileToken: TOKEN };

function sentEmails(e: Env): FakeEmail[] {
  const send = e.FEEDBACK_EMAIL.send as ReturnType<typeof vi.fn>;
  return send.mock.calls.map(([message]) => message as FakeEmail);
}

function decodedBody(raw: string): string {
  const base64 = raw
    .slice(raw.indexOf(CRLF + CRLF) + 4)
    .split(CRLF)
    .join("");
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

function quietly(): { restore(): void; calls(): unknown[][] } {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  return { restore: () => spy.mockRestore(), calls: () => spy.mock.calls };
}

describe("POST /api/feedback", () => {
  it("emails a suggestion as plain text and answers { ok: true }", async () => {
    const e = env();
    const res = await app.fetch(feedbackPost(suggestion), e);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });

    const [email] = sentEmails(e);
    expect(email).toMatchObject({ from: "feedback@biggerthangame.com", to: "owner@example.com" });
    expect(email!.raw).toContain(`${CRLF}Subject: ${FEEDBACK_SUBJECTS.suggest}${CRLF}`);
    expect(email!.raw).toContain("Content-Type: text/plain; charset=utf-8");
    expect(email!.raw).not.toMatch(/text\/html|multipart/);
    expect(decodedBody(email!.raw)).toContain("Name: Gianfranco Zola");
  });

  it("emails a correction with the server's values, and returns none of them", async () => {
    const e = env();
    const start = await app.fetch(
      new Request(`https://biggerthangame.com${ROUND_PATH}`, {
        method: "POST",
        body: JSON.stringify({ mode: "friendly" }),
      }),
      e,
    );
    const started = (await start.json()) as StartResponse;
    const res = await app.fetch(
      feedbackPost({ kind: "correction", runId: started.runId, round: 1, turnstileToken: TOKEN }),
      e,
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toBe(JSON.stringify({ ok: true }));
    const now = runDay(started.runId);
    expect(scanForLeakedValues(text, SAMPLE_DECK, now, "feedback response")).toEqual([]);

    const [email] = sentEmails(e);
    expect(email!.raw).toContain(`Subject: ${FEEDBACK_SUBJECTS.correction}${CRLF}`);
    const body = decodedBody(email!.raw);
    expect(body).toContain(`(${started.round.anchor.id}): ${started.round.anchor.display}`);
    expect(body).toContain(`(${started.round.challenger.id}):`);
  });

  it("keys its rate limit on the IPv6 /64 and refuses with 429 before any work", async () => {
    siteverify.mockClear();
    const e = env({ FEEDBACK_SENDS: limiter(false), TURNSTILE_SECRET: "" });
    const res = await app.fetch(feedbackPost("{not json"), e);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(RATE_LIMITS.feedback.period));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(e.FEEDBACK_SENDS.limit).toHaveBeenCalledWith({ key: "2001:db8:abcd:12::/64" });
    expect(siteverify).not.toHaveBeenCalled();
    expect(e.FEEDBACK_EMAIL.send).not.toHaveBeenCalled();
  });

  it("rate-limits a problem report on the same limit, before any work", async () => {
    siteverify.mockClear();
    const problem = { kind: "problem", note: "Typo", page: "/about", turnstileToken: TOKEN };
    const allowed = env();
    expect((await app.fetch(feedbackPost(problem), allowed)).status).toBe(200);
    expect(allowed.FEEDBACK_SENDS.limit).toHaveBeenCalledWith({ key: "2001:db8:abcd:12::/64" });

    siteverify.mockClear();
    const limited = env({ FEEDBACK_SENDS: limiter(false) });
    const res = await app.fetch(feedbackPost(problem), limited);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(RATE_LIMITS.feedback.period));
    expect(siteverify).not.toHaveBeenCalled();
    expect(limited.FEEDBACK_EMAIL.send).not.toHaveBeenCalled();
  });

  it("emails a problem report as plain text with its fixed subject", async () => {
    const e = env();
    const problem = {
      kind: "problem",
      note: "Typo on credits",
      page: "/credits",
      turnstileToken: TOKEN,
    };
    const res = await app.fetch(feedbackPost(problem), e);
    expect(await res.json()).toEqual({ ok: true });
    const [email] = sentEmails(e);
    expect(email!.raw).toContain(`${CRLF}Subject: ${FEEDBACK_SUBJECTS.problem}${CRLF}`);
    expect(email!.raw).toContain("Content-Type: text/plain; charset=utf-8");
    const body = decodedBody(email!.raw);
    expect(body).toContain("Page: /credits");
    expect(body).toContain("Typo on credits");
    expect(body).not.toContain("2001:db8");
  });

  it("keys an IPv4 client on its address", async () => {
    const e = env();
    await app.fetch(feedbackPost(suggestion, { "cf-connecting-ip": "203.0.113.7" }), e);
    expect(e.FEEDBACK_SENDS.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("counts against its own limit, not the round endpoint's", async () => {
    const e = env();
    await app.fetch(feedbackPost(suggestion), e);
    expect(e.FEEDBACK_SENDS.limit).toHaveBeenCalledOnce();
    expect(e.ROUND_FLOOD.limit).not.toHaveBeenCalled();
    expect(e.RUN_STARTS.limit).not.toHaveBeenCalled();
  });

  it("refuses anything but POST", async () => {
    const res = await app.fetch(new Request(`https://biggerthangame.com${FEEDBACK_PATH}`), env());
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("refuses a body that isn't JSON with a short code", async () => {
    const res = await app.fetch(feedbackPost("{not json"), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", detail: "invalid_json" });
  });

  it("refuses an oversized body, whether or not it declares its length", async () => {
    const big = JSON.stringify({ ...suggestion, note: "x".repeat(MAX_FEEDBACK_BYTES) });
    const small = JSON.stringify(suggestion);
    for (const [body, headers] of [
      [big, {}],
      [small, { "content-length": String(MAX_FEEDBACK_BYTES + 1) }],
    ] as const) {
      const e = env();
      const res = await app.fetch(feedbackPost(body, headers), e);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request", detail: "body_too_large" });
      expect(e.FEEDBACK_EMAIL.send).not.toHaveBeenCalled();
    }
  });

  it("accepts a body at the limits of every field", async () => {
    const body = { ...suggestion, name: "é".repeat(80), note: "⚽".repeat(1000) };
    const res = await app.fetch(feedbackPost(body), env());
    expect(res.status).toBe(200);
  });

  it("refuses a validation failure with its code, before Turnstile", async () => {
    siteverify.mockClear();
    const res = await app.fetch(feedbackPost({ ...suggestion, email: "a@example.com" }), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", detail: "unexpected_key" });
    expect(siteverify).not.toHaveBeenCalled();
  });

  it("answers 403 when Turnstile says no, and sends nothing", async () => {
    siteverify.mockResolvedValueOnce(
      Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
    );
    const e = env();
    const res = await app.fetch(feedbackPost(suggestion), e);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "verification_failed" });
    expect(e.FEEDBACK_EMAIL.send).not.toHaveBeenCalled();
  });

  it("answers 502 when Siteverify is down, and sends nothing", async () => {
    siteverify.mockRejectedValueOnce(new TypeError("network down"));
    const e = env();
    const res = await app.fetch(feedbackPost(suggestion), e);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(e.FEEDBACK_EMAIL.send).not.toHaveBeenCalled();
  });

  it("answers a failed send with a calm 502 rather than crashing", async () => {
    const log = quietly();
    const e = env({
      FEEDBACK_EMAIL: {
        send: vi.fn(async () => {
          throw Object.assign(new Error("nope"), { code: "E_RATE_LIMIT_EXCEEDED" });
        }),
      },
    });
    const res = await app.fetch(feedbackPost(suggestion), e);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "send_failed" });
    log.restore();
  });

  it("fails a send cleanly outside workerd, with no EmailMessage constructor", async () => {
    const log = quietly();
    const bare = createApp({
      deck: SAMPLE_DECK,
      images: {},
      clock: () => TODAY,
      fetch: siteverify,
    });
    const res = await bare.fetch(feedbackPost(suggestion), env());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "send_failed" });
    log.restore();
  });

  it.each([
    ["TURNSTILE_SECRET", { TURNSTILE_SECRET: "" }],
    ["FEEDBACK_TO", { FEEDBACK_TO: undefined }],
    [
      "a FEEDBACK_TO that could inject a header",
      { FEEDBACK_TO: `owner@example.com${CRLF}Bcc: x@y.com` },
    ],
    ["RUN_SECRET", { RUN_SECRET: "" }],
  ])("fails closed without %s, logging names and never values", async (_name, override) => {
    const log = quietly();
    const e = env(override as Partial<Env>);
    const res = await app.fetch(feedbackPost(suggestion), e);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(e.FEEDBACK_EMAIL.send).not.toHaveBeenCalled();
    const logged = JSON.stringify(log.calls());
    expect(logged).not.toContain("owner@example.com");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("1x0000000000000000000000000000000AA");
    log.restore();
  });
});
