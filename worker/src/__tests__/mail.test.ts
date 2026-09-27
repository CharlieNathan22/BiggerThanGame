/**
 * The hand-built MIME message for the `send_email` binding: one plain-text
 * UTF-8 part, fixed headers, user text only in the base64 body.
 */

import { describe, expect, it } from "vitest";
import { buildPlainTextMime, isPlainAddress, rfc5322Date } from "../mail.js";
import type { PlainTextMail } from "../mail.js";

const MAIL: PlainTextMail = {
  from: "feedback@biggerthangame.com",
  to: "owner@example.com",
  subject: "Bigger Than: legend suggestion",
  text: "Name: Pelé ⚽\nNote:\nline one\nline two\n",
  date: new Date("2026-09-19T14:30:00Z"),
  messageId: "<00000000-0000-4000-8000-000000000001@biggerthangame.com>",
};

/** Splits a message into its headers and its decoded body. */
function parse(raw: string): { headers: Map<string, string>; body: string; rawBody: string } {
  const split = raw.indexOf("\r\n\r\n");
  const headers = new Map<string, string>();
  for (const line of raw.slice(0, split).split("\r\n")) {
    const colon = line.indexOf(":");
    headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 2));
  }
  const rawBody = raw.slice(split + 4);
  const binary = atob(rawBody.replace(/\r\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return { headers, body: new TextDecoder().decode(bytes), rawBody };
}

describe("buildPlainTextMime", () => {
  it("writes the headers a plain-text message needs, and no others", () => {
    const { headers } = parse(buildPlainTextMime(MAIL));
    expect(Object.fromEntries(headers)).toEqual({
      from: "feedback@biggerthangame.com",
      to: "owner@example.com",
      subject: "Bigger Than: legend suggestion",
      date: "Sat, 19 Sep 2026 14:30:00 +0000",
      "message-id": "<00000000-0000-4000-8000-000000000001@biggerthangame.com>",
      "mime-version": "1.0",
      "content-type": "text/plain; charset=utf-8",
      "content-transfer-encoding": "base64",
    });
  });

  it("carries the text intact, with CRLF line breaks, as base64 in short lines", () => {
    const long = { ...MAIL, text: `${"Ronaldinho ".repeat(40)}\nend` };
    const raw = buildPlainTextMime(long);
    const { body, rawBody } = parse(raw);
    expect(body).toBe(long.text.replace(/\n/g, "\r\n"));
    for (const line of rawBody.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(parse(buildPlainTextMime(MAIL)).body).toBe(MAIL.text.replace(/\n/g, "\r\n"));
  });

  it("uses CRLF everywhere and has no bare LF", () => {
    const raw = buildPlainTextMime(MAIL);
    expect(raw.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("keeps header-like user text inert inside the encoded body", () => {
    const hostile = { ...MAIL, text: "x\r\nBcc: someone@example.com\r\n\r\n<b>html</b>" };
    const raw = buildPlainTextMime(hostile);
    expect(raw).not.toContain("Bcc:");
    expect(raw).not.toContain("<b>");
    expect(parse(raw).headers.has("bcc")).toBe(false);
  });

  it.each([
    ["a subject with a line break", { subject: "Hi\r\nBcc: x@example.com" }],
    ["a non-ASCII subject", { subject: "Pelé" }],
    ["an empty subject", { subject: "" }],
    ["a destination with a line break", { to: "owner@example.com\r\nBcc: x@example.com" }],
    ["a destination with a display name", { to: "Owner <owner@example.com>" }],
    ["two destinations", { to: "a@example.com, b@example.com" }],
    ["a sender that isn't an address", { from: "feedback" }],
    ["a malformed Message-ID", { messageId: "no-brackets@example.com" }],
  ])("refuses %s", (_name, override) => {
    expect(() => buildPlainTextMime({ ...MAIL, ...override })).toThrow(/mail:/);
  });
});

describe("isPlainAddress", () => {
  it("accepts an ordinary address and refuses anything that could start a header", () => {
    expect(isPlainAddress("owner+bt@example.co.uk")).toBe(true);
    expect(isPlainAddress("owner@example.com\n")).toBe(false);
    expect(isPlainAddress(`owner${String.fromCharCode(0)}@example.com`)).toBe(false);
    expect(isPlainAddress("owner@example")).toBe(false);
    expect(isPlainAddress("")).toBe(false);
  });
});

describe("rfc5322Date", () => {
  it("writes the zone as +0000", () => {
    expect(rfc5322Date(new Date("2026-01-02T03:04:05Z"))).toBe("Fri, 02 Jan 2026 03:04:05 +0000");
  });
});
