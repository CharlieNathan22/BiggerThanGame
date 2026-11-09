/**
 * The room's wire format (room-protocol.ts): the code alphabet, and client
 * messages parsed strictly.
 */

import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_MAX_QUESTION,
  ROOM_MESSAGE_MAX,
  cleanRoomCode,
  isRoomCode,
  parseClientMessage,
  roomCodeFrom,
} from "../room-protocol.js";

describe("room codes", () => {
  it("use an alphabet with nothing that reads as something else, and no vowels", () => {
    expect(ROOM_CODE_LENGTH).toBe(6);
    expect(ROOM_CODE_ALPHABET).toBe("23456789BCDFGHJKMNPQRSTVWXYZ");
    for (const banned of "01OIL") expect(ROOM_CODE_ALPHABET).not.toContain(banned);
    for (const vowel of "AEIOU") expect(ROOM_CODE_ALPHABET).not.toContain(vowel);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
    expect(ROOM_CODE_ALPHABET).toBe(ROOM_CODE_ALPHABET.toUpperCase());
  });

  it("are six characters of it, upper case", () => {
    for (const code of ["K7QM2X", "222222", "ZZZZZZ", "BCDFGH"])
      expect(isRoomCode(code)).toBe(true);
    for (const code of [
      "k7qm2x",
      "K7QM2",
      "K7QM2XX",
      "K7QM2O",
      "K7QM20",
      "K7QM21",
      "K7QMIX",
      "K7QMLX",
      "K7QMAX",
      "K7 M2X",
      "",
      7,
      null,
      undefined,
    ]) {
      expect(isRoomCode(code)).toBe(false);
    }
  });

  it("are cleaned as typed: case, spaces and dashes", () => {
    expect(cleanRoomCode(" k7q-m2x ")).toBe("K7QM2X");
    expect(cleanRoomCode("k7q m2x")).toBe("K7QM2X");
    // Cleaning doesn't make a bad code good.
    expect(isRoomCode(cleanRoomCode("k7qm2o"))).toBe(false);
  });

  it("are made from random bytes, only from the alphabet", () => {
    for (let seed = 0; seed < 500; seed++) {
      const bytes = Array.from({ length: 16 }, (_, i) => (seed * 31 + i * 97 + seed * i) % 256);
      const code = roomCodeFrom(bytes);
      if (code === undefined) continue;
      expect(isRoomCode(code)).toBe(true);
    }
    expect(roomCodeFrom([0, 1, 2, 3, 4, 5])).toBe("234567");
    expect(roomCodeFrom([27, 28, 29, 55, 56, 251])).toBe("Z23Z2Z");
  });

  it("skip bytes that would favour some characters, and say when there aren't enough", () => {
    // 252 to 255 fall unevenly on 28 characters: never used.
    expect(roomCodeFrom([252, 253, 254, 255, 0, 0, 0, 0, 0, 0])).toBe("222222");
    expect(roomCodeFrom([252, 253, 254, 255, 0, 0])).toBeUndefined();
    expect(roomCodeFrom([])).toBeUndefined();
    expect(roomCodeFrom([1, 2, 3])).toBeUndefined();
    // Every character is equally likely over the usable bytes.
    const counts = new Map<string, number>();
    for (let byte = 0; byte < 252; byte++) {
      const char = roomCodeFrom([byte, 0, 0, 0, 0, 0])![0]!;
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(28);
    expect(new Set(counts.values())).toEqual(new Set([9]));
  });
});

describe("client messages", () => {
  const parse = (value: unknown): unknown => parseClientMessage(JSON.stringify(value));

  it("reads each message of the protocol", () => {
    expect(parse({ v: 1, t: "hello", token: "abc.def" })).toEqual({
      v: 1,
      t: "hello",
      token: "abc.def",
    });
    expect(parse({ v: 1, t: "ready", ready: true })).toEqual({ v: 1, t: "ready", ready: true });
    expect(parse({ v: 1, t: "ready", ready: false })).toEqual({ v: 1, t: "ready", ready: false });
    expect(parse({ v: 1, t: "start" })).toEqual({ v: 1, t: "start" });
    expect(parse({ v: 1, t: "rematch" })).toEqual({ v: 1, t: "rematch" });
    expect(parse({ v: 1, t: "leave" })).toEqual({ v: 1, t: "leave" });
    for (const pick of ["higher", "lower", "timeout"]) {
      expect(parse({ v: 1, t: "answer", q: 7, pick })).toEqual({ v: 1, t: "answer", q: 7, pick });
    }
    // Key order doesn't matter.
    expect(parse({ pick: "lower", q: 1, t: "answer", v: 1 })).toEqual({
      v: 1,
      t: "answer",
      q: 1,
      pick: "lower",
    });
  });

  it("refuses another version, an unknown type and anything that isn't an object", () => {
    for (const value of [
      { v: 2, t: "start" },
      { v: "1", t: "start" },
      { t: "start" },
      { v: 1 },
      { v: 1, t: "reveal" },
      { v: 1, t: "question" },
      { v: 1, t: "" },
      { v: 1, t: 5 },
      [],
      [{ v: 1, t: "start" }],
      null,
      "start",
      7,
      true,
    ]) {
      expect(parse(value)).toBeUndefined();
    }
  });

  it("refuses a missing, extra or mistyped key", () => {
    for (const value of [
      { v: 1, t: "hello" },
      { v: 1, t: "hello", token: "" },
      { v: 1, t: "hello", token: 5 },
      { v: 1, t: "hello", token: "a", seat: 0 },
      { v: 1, t: "ready" },
      { v: 1, t: "ready", ready: "yes" },
      { v: 1, t: "ready", ready: 1 },
      { v: 1, t: "ready", ready: true, seat: 1 },
      { v: 1, t: "start", match: "m" },
      { v: 1, t: "start", seat: 0 },
      { v: 1, t: "rematch", now: 1 },
      { v: 1, t: "leave", seat: 1 },
      { v: 1, t: "answer", q: 1 },
      { v: 1, t: "answer", pick: "higher" },
      { v: 1, t: "answer", q: 1, pick: "higher", seat: 0 },
      { v: 1, t: "answer", q: 1, pick: "higher", correct: true },
    ]) {
      expect(parse(value)).toBeUndefined();
    }
  });

  it("holds an answer to a whole question number and a known pick", () => {
    for (const q of [0, -1, 1.5, "1", null, ROOM_MAX_QUESTION + 1, Number.MAX_SAFE_INTEGER]) {
      expect(parse({ v: 1, t: "answer", q, pick: "higher" })).toBeUndefined();
    }
    expect(parse({ v: 1, t: "answer", q: ROOM_MAX_QUESTION, pick: "higher" })).toBeDefined();
    for (const pick of ["Higher", "up", "", 1, null, true]) {
      expect(parse({ v: 1, t: "answer", q: 1, pick })).toBeUndefined();
    }
  });

  it("refuses what isn't JSON text, and anything too long", () => {
    for (const raw of ["", "{", "start", "undefined", "{v:1}", 7, null, undefined, {}]) {
      expect(parseClientMessage(raw)).toBeUndefined();
    }
    const fits = JSON.stringify({ v: 1, t: "hello", token: "a".repeat(ROOM_MESSAGE_MAX - 30) });
    expect(fits.length).toBeLessThanOrEqual(ROOM_MESSAGE_MAX);
    expect(parseClientMessage(fits)).toBeDefined();
    const long = JSON.stringify({ v: 1, t: "hello", token: "a".repeat(ROOM_MESSAGE_MAX) });
    expect(parseClientMessage(long)).toBeUndefined();
  });

  it("never reads a server's message as a client's", () => {
    for (const t of [
      "welcome",
      "players",
      "question",
      "locked",
      "reveal",
      "fulltime",
      "closed",
      "error",
    ]) {
      expect(parse({ v: 1, t })).toBeUndefined();
    }
  });
});
