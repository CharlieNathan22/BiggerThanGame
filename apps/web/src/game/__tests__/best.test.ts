import { describe, expect, it } from "vitest";
import { BEST_KEY, readBest, saveBest } from "../best";
import type { StorageAccess } from "../best";
import { challengeUrl, readChallenge, withoutChallenge } from "../challenge";
import { RUN_ID, SIG } from "./fixtures";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  return { data, access: (() => store) as StorageAccess };
}

const throwing: StorageAccess = () => {
  throw new DOMException("denied", "SecurityError");
};

describe("local best", () => {
  it("reads and writes the number, and only the number", () => {
    const { data, access } = memory();
    expect(readBest(access)).toBe(0);
    expect(saveBest(access, 14)).toBe(true);
    expect(readBest(access)).toBe(14);
    expect([...data.entries()]).toEqual([[BEST_KEY, "14"]]);
  });

  it("reads 0 from storage that is missing, blocked or throws", () => {
    expect(readBest(() => null)).toBe(0);
    expect(readBest(throwing)).toBe(0);
    const getThrows: StorageAccess = () => ({
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {},
    });
    expect(readBest(getThrows)).toBe(0);
  });

  it("ignores anything stored that isn't a plain count", () => {
    for (const junk of ["", "abc", "-3", "1.5", "1e3", "99999", " 7"]) {
      expect(readBest(memory({ [BEST_KEY]: junk }).access), junk).toBe(0);
    }
  });

  it("reports a failed save rather than throwing: full, blocked or missing", () => {
    const full: StorageAccess = () => ({
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(saveBest(full, 3)).toBe(false);
    expect(saveBest(throwing, 3)).toBe(false);
    expect(saveBest(() => null, 3)).toBe(false);
    expect(saveBest(memory().access, -1)).toBe(false);
  });
});

describe("challenge links", () => {
  const search = `?challenge=${RUN_ID}&score=12&sig=${SIG}`;

  it("reads a well-formed link", () => {
    expect(readChallenge(search)).toEqual({
      kind: "link",
      link: { runId: RUN_ID, score: 12, sig: SIG },
    });
  });

  it("reads nothing from a page without one", () => {
    expect(readChallenge("")).toEqual({ kind: "none" });
    expect(readChallenge("?delay=800")).toEqual({ kind: "none" });
  });

  it.each([
    ["a missing sig", `?challenge=${RUN_ID}&score=12`],
    ["a missing score", `?challenge=${RUN_ID}&sig=${SIG}`],
    ["a truncated run id", `?challenge=${RUN_ID.slice(0, -3)}&score=12&sig=${SIG}`],
    ["a word for a score", `?challenge=${RUN_ID}&score=twelve&sig=${SIG}`],
    ["a score past the cap", `?challenge=${RUN_ID}&score=61&sig=${SIG}`],
    ["a padded sig", `?challenge=${RUN_ID}&score=12&sig=${SIG}=`],
  ])("calls a link with %s broken", (_, s) => {
    expect(readChallenge(s)).toEqual({ kind: "broken" });
  });

  it("round-trips through the URL it builds", () => {
    const url = challengeUrl("https://biggerthangame.com", { runId: RUN_ID, score: 7, sig: SIG });
    expect(url.startsWith("https://biggerthangame.com/?challenge=")).toBe(true);
    expect(readChallenge(new URL(url).search)).toEqual({
      kind: "link",
      link: { runId: RUN_ID, score: 7, sig: SIG },
    });
  });

  it("strips its own parameters and keeps the rest", () => {
    expect(withoutChallenge(search)).toBe("");
    expect(withoutChallenge(`${search}&delay=800`)).toBe("?delay=800");
  });
});
