import { describe, expect, it } from "vitest";
import { bestKey, readBest, saveBest } from "../best";
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

const KEY = bestKey("legends", "friendly");

describe("local best", () => {
  it("is kept per deck and mode", () => {
    expect(KEY).toBe("bt:best:legends:friendly");
    expect(bestKey("legends", "endless")).toBe("bt:best:legends:endless");
  });

  it("reads and writes the number, and only the number", () => {
    const { data, access } = memory();
    expect(readBest(access, KEY)).toBe(0);
    expect(saveBest(access, KEY, 14)).toBe(true);
    expect(readBest(access, KEY)).toBe(14);
    expect([...data.entries()]).toEqual([[KEY, "14"]]);
  });

  it("keeps one mode's best apart from another's, and ignores the old bt:best", () => {
    const { access } = memory({ "bt:best": "30" });
    expect(readBest(access, KEY)).toBe(0);
    saveBest(access, bestKey("legends", "endless"), 9);
    saveBest(access, KEY, 4);
    expect(readBest(access, KEY)).toBe(4);
    expect(readBest(access, bestKey("legends", "endless"))).toBe(9);
  });

  it("reads 0 from storage that is missing, blocked or throws", () => {
    expect(readBest(() => null, KEY)).toBe(0);
    expect(readBest(throwing, KEY)).toBe(0);
    const getThrows: StorageAccess = () => ({
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {},
    });
    expect(readBest(getThrows, KEY)).toBe(0);
  });

  it("ignores anything stored that isn't a plain count", () => {
    for (const junk of ["", "abc", "-3", "1.5", "1e3", "99999", " 7"]) {
      expect(readBest(memory({ [KEY]: junk }).access, KEY), junk).toBe(0);
    }
  });

  it("reports a failed save rather than throwing: full, blocked or missing", () => {
    const full: StorageAccess = () => ({
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(saveBest(full, KEY, 3)).toBe(false);
    expect(saveBest(throwing, KEY, 3)).toBe(false);
    expect(saveBest(() => null, KEY, 3)).toBe(false);
    expect(saveBest(memory().access, KEY, -1)).toBe(false);
  });
});

describe("challenge links", () => {
  const search = `?challenge=${RUN_ID}&score=12&sig=${SIG}`;

  it("reads a well-formed link", () => {
    expect(readChallenge(search, "friendly")).toEqual({
      kind: "link",
      link: { runId: RUN_ID, score: 12, sig: SIG },
    });
  });

  it("reads nothing from a page without one", () => {
    expect(readChallenge("", "friendly")).toEqual({ kind: "none" });
    expect(readChallenge("?delay=800", "friendly")).toEqual({ kind: "none" });
  });

  it.each([
    ["a missing sig", `?challenge=${RUN_ID}&score=12`],
    ["a missing score", `?challenge=${RUN_ID}&sig=${SIG}`],
    ["a truncated run id", `?challenge=${RUN_ID.slice(0, -3)}&score=12&sig=${SIG}`],
    ["a word for a score", `?challenge=${RUN_ID}&score=twelve&sig=${SIG}`],
    ["a score past Friendly's twenty", `?challenge=${RUN_ID}&score=21&sig=${SIG}`],
    ["a padded sig", `?challenge=${RUN_ID}&score=12&sig=${SIG}=`],
  ])("calls a link with %s broken", (_, s) => {
    expect(readChallenge(s, "friendly")).toEqual({ kind: "broken" });
  });

  it("reads a link to a won run, at twenty", () => {
    expect(readChallenge(`?challenge=${RUN_ID}&score=20&sig=${SIG}`, "friendly")).toMatchObject({
      kind: "link",
      link: { score: 20 },
    });
  });

  it("round-trips through the URL it builds, on the game page", () => {
    const url = challengeUrl("https://biggerthangame.com", { runId: RUN_ID, score: 7, sig: SIG });
    expect(
      url.startsWith(
        "https://biggerthangame.com/football-higher-or-lower/legends/friendly?challenge=",
      ),
    ).toBe(true);
    expect(readChallenge(new URL(url).search, "friendly")).toEqual({
      kind: "link",
      link: { runId: RUN_ID, score: 7, sig: SIG },
    });
  });

  it("strips its own parameters and keeps the rest", () => {
    expect(withoutChallenge(search)).toBe("");
    expect(withoutChallenge(`${search}&delay=800`)).toBe("?delay=800");
  });
});
