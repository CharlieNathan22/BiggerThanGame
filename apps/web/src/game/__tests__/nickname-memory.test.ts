/**
 * The publish dialog's starting name: the last name published from this
 * device (`bt:nickname`), remembered only once a publish goes through; a
 * generated one the first time, with storage blocked, or when the stored
 * value no longer passes the rules.
 */

import { describe, expect, it } from "vitest";
import type { SubmitResponse } from "@bt/core";
import type { StorageAccess } from "../best";
import { NICKNAME_KEY, readNickname, saveNickname } from "../device";
import { rememberPublished, startingNickname } from "../publish";
import type { PublishOutcome } from "../publish";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  return { data, access: (() => store) as StorageAccess };
}

const blocked: StorageAccess = () => {
  throw new DOMException("denied", "SecurityError");
};

/** A storage whose reads work but whose writes throw (full, or a locked-down browser). */
function readOnly(initial: Record<string, string> = {}): StorageAccess {
  const data = new Map(Object.entries(initial));
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
  return () => store;
}

const GENERATED = "SwiftVolley42";
const generate = () => GENERATED;

/** The name the dialog opens with, with no draft typed this visit. */
const opens = (storage: StorageAccess) =>
  startingNickname(undefined, readNickname(storage), generate);

function published(nickname: string): PublishOutcome {
  const period = {
    key: "k",
    current: true,
    rank: 1,
    total: 1,
    resetsAt: 0,
    entryId: "e",
    best: 5,
    improved: true,
  };
  const response: SubmitResponse = {
    id: "e",
    nickname,
    streak: 5,
    periods: { day: period, week: period, month: period },
  };
  return { kind: "published", response };
}

describe("the publish dialog's starting name", () => {
  it("is a generated name the first time", () => {
    const { access } = memory();
    expect(opens(access)).toBe(GENERATED);
  });

  it("is the name last published from this device, the next time", () => {
    const { access, data } = memory();
    rememberPublished(access, published("Tidy Winger"));
    expect(data.get(NICKNAME_KEY)).toBe("Tidy Winger");
    expect(opens(access)).toBe("Tidy Winger");
  });

  it("keeps the remembered name when a name is refused or the dialog is cancelled", () => {
    const { access } = memory();
    rememberPublished(access, published("Tidy Winger"));
    for (const outcome of [
      { kind: "rejected" },
      { kind: "failed" },
      { kind: "checkFailed" },
      { kind: "slowDown" },
      { kind: "expired" },
      { kind: "already" },
      { kind: "unpublishable" },
    ] as const) {
      rememberPublished(access, outcome);
      expect(opens(access), outcome.kind).toBe("Tidy Winger");
    }
    // A cancel publishes nothing, so there's nothing to remember.
    expect(opens(access)).toBe("Tidy Winger");
  });

  it("remembers a shuffled, generated name once it has been published with", () => {
    const { access } = memory();
    rememberPublished(access, published("Tidy Winger"));
    rememberPublished(access, published("BoldHeader77"));
    expect(opens(access)).toBe("BoldHeader77");
  });

  it("remembers the name as the server stored it: cleaned", () => {
    const { access } = memory();
    rememberPublished(access, published("Big Sam"));
    expect(opens(access)).toBe("Big Sam");
  });

  it("is a generated name with storage blocked, and nothing throws", () => {
    expect(opens(blocked)).toBe(GENERATED);
    expect(() => rememberPublished(blocked, published("Tidy Winger"))).not.toThrow();
    expect(saveNickname(blocked, "Tidy Winger")).toBe(false);
    expect(opens(blocked)).toBe(GENERATED);
    // Reads work, writes fail: the old name stays, nothing throws.
    const stuck = readOnly({ [NICKNAME_KEY]: "Old Name" });
    expect(() => rememberPublished(stuck, published("New Name"))).not.toThrow();
    expect(opens(stuck)).toBe("Old Name");
  });

  it("ignores a stored value that no longer passes the rules", () => {
    for (const stored of ["ab", "Пеле", "x".repeat(21), "  Padded  ", "Goal ⚽", ""]) {
      const { access } = memory({ [NICKNAME_KEY]: stored });
      expect(opens(access), JSON.stringify(stored)).toBe(GENERATED);
    }
  });

  it("never saves a name that doesn't pass the rules", () => {
    const { access, data } = memory();
    expect(saveNickname(access, "ab")).toBe(false);
    expect(data.has(NICKNAME_KEY)).toBe(false);
  });

  it("gives way to a name typed and left unpublished earlier this visit", () => {
    const { access } = memory();
    rememberPublished(access, published("Tidy Winger"));
    expect(startingNickname("Half Typed", readNickname(access), generate)).toBe("Half Typed");
  });
});
