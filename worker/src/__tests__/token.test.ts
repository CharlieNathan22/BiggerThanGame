import { describe, expect, it } from "vitest";
import { hmacSha256, toBase64Url } from "../hmac.js";
import { signResult, signToken, verifyResult, verifyToken } from "../token.js";
import type { ProgressPayload, ResultPayload } from "../token.js";
import { SECRET } from "./helpers.js";

const PAYLOAD: ProgressPayload = {
  v: 1,
  runId: "20260919-00000000-0000-4000-8000-000000000001.abcdefghijklmnopqrstuv",
  mode: "endless",
  round: 3,
  streak: 2,
  anchorId: "alpha",
  challengerId: "bravo",
  stat: "caps",
  anchorValue: 100,
  issuedAt: 1_790_000_000_000,
  deadline: 1_790_000_019_480,
  nonce: "00000000-0000-4000-8000-00000000000a",
};

const RESULT: ResultPayload = {
  v: 1,
  runId: PAYLOAD.runId,
  mode: "endless",
  score: 12,
  end: "wrong",
  startedOn: "2026-09-19",
  elapsedMs: 81_234,
  endedAt: 1_790_000_100_000,
};

/** Signs any JSON under a prefix, as the server would, to test the parser's strictness. */
async function signRaw(prefix: string, payload: unknown): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${toBase64Url(await hmacSha256(SECRET, `${prefix}${body}`))}`;
}

function edit(token: string, change: (json: Record<string, unknown>) => void): string {
  const [body, sig] = token.split(".");
  const json = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  change(json);
  return `${Buffer.from(JSON.stringify(json)).toString("base64url")}.${sig}`;
}

describe("progress tokens", () => {
  it("round-trip exactly", async () => {
    const token = await signToken(SECRET, PAYLOAD);
    expect(await verifyToken(SECRET, token)).toEqual(PAYLOAD);
  });

  it("are the same bytes for the same payload, whatever order its fields came in", async () => {
    const shuffled = Object.fromEntries(Object.entries(PAYLOAD).reverse()) as ProgressPayload;
    expect(await signToken(SECRET, shuffled)).toBe(await signToken(SECRET, PAYLOAD));
  });

  it("are readable, not encrypted: the payload is plain base64url JSON", async () => {
    const token = await signToken(SECRET, PAYLOAD);
    const body = token.split(".")[0]!;
    expect(JSON.parse(Buffer.from(body, "base64url").toString("utf8"))).toEqual(PAYLOAD);
  });

  it.each([
    ["round", (j: Record<string, unknown>) => (j.round = 4)],
    ["streak", (j: Record<string, unknown>) => (j.streak = 9)],
    ["mode", (j: Record<string, unknown>) => (j.mode = "ranked")],
    ["stat", (j: Record<string, unknown>) => (j.stat = "apps")],
    ["anchor", (j: Record<string, unknown>) => (j.anchorId = "charlie")],
    ["anchor value", (j: Record<string, unknown>) => (j.anchorValue = 101)],
    ["deadline", (j: Record<string, unknown>) => (j.deadline = 9_999_999_999_999)],
    ["nonce", (j: Record<string, unknown>) => (j.nonce = "another")],
    ["run", (j: Record<string, unknown>) => (j.runId = "20260919-other")],
  ])("are refused with the %s edited", async (_name, change) => {
    const token = await signToken(SECRET, PAYLOAD);
    expect(await verifyToken(SECRET, edit(token, change))).toBeUndefined();
  });

  it("are refused with the signature edited", async () => {
    const token = await signToken(SECRET, PAYLOAD);
    const [body, sig] = token.split(".");
    const flipped = `${sig!.slice(0, -1)}${sig!.endsWith("A") ? "B" : "A"}`;
    expect(await verifyToken(SECRET, `${body}.${flipped}`)).toBeUndefined();
  });

  it("are refused under another key", async () => {
    const token = await signToken("another-secret", PAYLOAD);
    expect(await verifyToken(SECRET, token)).toBeUndefined();
  });

  it("are refused with one token's signature on another's payload", async () => {
    const a = await signToken(SECRET, PAYLOAD);
    const b = await signToken(SECRET, { ...PAYLOAD, runId: "20260919-another-run", nonce: "n" });
    expect(await verifyToken(SECRET, `${b.split(".")[0]}.${a.split(".")[1]}`)).toBeUndefined();
  });

  it("can't pass for a result, or a result for a token", async () => {
    const token = await signToken(SECRET, PAYLOAD);
    const result = await signResult(SECRET, RESULT);
    expect(await verifyResult(SECRET, token)).toBeUndefined();
    expect(await verifyToken(SECRET, result)).toBeUndefined();
  });

  it("parse strictly, even when properly signed", async () => {
    const cases: unknown[] = [
      { ...PAYLOAD, challengerValue: 88 },
      { ...PAYLOAD, v: 2 },
      { ...PAYLOAD, streak: 5 },
      { ...PAYLOAD, round: 0, streak: -1 },
      { ...PAYLOAD, stat: "goals" },
      { ...PAYLOAD, deadline: PAYLOAD.issuedAt - 1 },
      Object.fromEntries(Object.entries(PAYLOAD).filter(([key]) => key !== "nonce")),
      [PAYLOAD],
      "token",
    ];
    for (const payload of cases) {
      expect(await verifyToken(SECRET, await signRaw("token:", payload))).toBeUndefined();
    }
  });

  it("refuse junk without throwing", async () => {
    for (const junk of ["", ".", "a.b", "x".repeat(2000), "a.b.c", "!!!.???"]) {
      expect(await verifyToken(SECRET, junk)).toBeUndefined();
    }
  });
});

describe("result tokens", () => {
  it("round-trip exactly", async () => {
    expect(await verifyResult(SECRET, await signResult(SECRET, RESULT))).toEqual(RESULT);
  });

  it("are refused edited, or under another key", async () => {
    const token = await signResult(SECRET, RESULT);
    expect(
      await verifyResult(
        SECRET,
        edit(token, (j) => (j.score = 50)),
      ),
    ).toBeUndefined();
    expect(await verifyResult(SECRET, await signResult("other", RESULT))).toBeUndefined();
  });

  it("parse strictly", async () => {
    for (const payload of [
      { ...RESULT, end: "quit" },
      { ...RESULT, startedOn: "19/09/2026" },
      { ...RESULT, extra: 1 },
    ]) {
      expect(await verifyResult(SECRET, await signRaw("result:", payload))).toBeUndefined();
    }
  });
});
