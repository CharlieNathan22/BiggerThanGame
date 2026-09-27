/**
 * Siteverify, mocked: pass, fail and the ways Siteverify itself can go wrong.
 */

import { describe, expect, it, vi } from "vitest";
import { SITEVERIFY_URL, verifyTurnstile } from "../turnstile.js";
import type { FetchLike } from "../turnstile.js";

const SECRET = "1x0000000000000000000000000000000AA";

function answering(body: unknown, status = 200): FetchLike & ReturnType<typeof vi.fn> {
  return vi.fn(async () =>
    typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status }),
  );
}

describe("verifyTurnstile", () => {
  it("passes a token Siteverify accepts, sending only the secret and the token", async () => {
    const fetchFn = answering({ success: true, "error-codes": [] });
    expect(await verifyTurnstile("tok", SECRET, fetchFn)).toBe("pass");

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    const sent = new URLSearchParams(String(init.body));
    expect([...sent.keys()].sort()).toEqual(["response", "secret"]);
    expect(sent.get("secret")).toBe(SECRET);
    expect(sent.get("response")).toBe("tok");
    // No IP, ever.
    expect(sent.has("remoteip")).toBe(false);
  });

  it.each([["invalid-input-response"], ["timeout-or-duplicate"], ["bad-request"]])(
    "fails a token Siteverify rejects with %s",
    async (code) => {
      const fetchFn = answering({ success: false, "error-codes": [code] });
      expect(await verifyTurnstile("tok", SECRET, fetchFn)).toBe("fail");
    },
  );

  it.each([["internal-error"], ["invalid-input-secret"], ["missing-input-secret"]])(
    "treats %s as Siteverify's problem, not the player's",
    async (code) => {
      const fetchFn = answering({ success: false, "error-codes": [code] });
      expect(await verifyTurnstile("tok", SECRET, fetchFn)).toBe("error");
    },
  );

  it("is an error when Siteverify can't be reached", async () => {
    const fetchFn: FetchLike = async () => {
      throw new TypeError("network down");
    };
    expect(await verifyTurnstile("tok", SECRET, fetchFn)).toBe("error");
  });

  it("is an error on a 5xx", async () => {
    expect(await verifyTurnstile("tok", SECRET, answering("oops", 503))).toBe("error");
  });

  it("is an error on a body that isn't Siteverify's", async () => {
    expect(await verifyTurnstile("tok", SECRET, answering("<html>"))).toBe("error");
    expect(await verifyTurnstile("tok", SECRET, answering({ success: "yes" }))).toBe("error");
    expect(await verifyTurnstile("tok", SECRET, answering(null))).toBe("error");
  });
});
