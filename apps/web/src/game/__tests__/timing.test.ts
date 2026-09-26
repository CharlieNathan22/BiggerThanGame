import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TIMINGS, TIMING_TOKENS, parseTokenValue, readTimings } from "../timing";
import type { Timings } from "../timing";

const tokensCss = readFileSync(
  fileURLToPath(new URL("../../styles/tokens.css", import.meta.url)),
  "utf8",
);

/** Every custom property declared in tokens.css, last declaration wins. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1] as string, (match[2] as string).trim());
  }
  return out;
}

describe("tokens.css and the script timings", () => {
  const tokens = declarations(tokensCss);

  it.each(Object.entries(TIMING_TOKENS))("%s is %s in tokens.css", (name, property) => {
    const raw = tokens.get(property);
    expect(raw, `${property} missing from tokens.css`).toBeDefined();
    expect(parseTokenValue(raw ?? "")).toBe(TIMINGS[name as keyof Timings]);
  });

  it("reads back the fallbacks from tokens.css exactly", () => {
    expect(readTimings((p) => tokens.get(p) ?? "")).toEqual(TIMINGS);
  });

  it("keeps the verdict after the count, so the colour never lands on a moving number", () => {
    expect(TIMINGS.verdict).toBeGreaterThanOrEqual(TIMINGS.count);
  });

  it("keeps the count near 640ms — it is what masks the round trip", () => {
    expect(TIMINGS.count).toBeGreaterThanOrEqual(500);
    expect(TIMINGS.count).toBeLessThanOrEqual(800);
  });
});

describe("parseTokenValue", () => {
  it("reads milliseconds, seconds and bare numbers", () => {
    expect(parseTokenValue("480ms")).toBe(480);
    expect(parseTokenValue(" 1.3s ")).toBe(1300);
    expect(parseTokenValue("0.62")).toBe(0.62);
  });

  it("refuses anything else", () => {
    expect(parseTokenValue("")).toBeUndefined();
    expect(parseTokenValue("fast")).toBeUndefined();
    expect(parseTokenValue("-5ms")).toBeUndefined();
    expect(parseTokenValue("var(--x)")).toBeUndefined();
  });
});

describe("readTimings", () => {
  it("keeps a fallback for any token it can't read", () => {
    const read = (p: string) => (p === "--dur-spin" ? "2s" : "");
    expect(readTimings(read)).toEqual({ ...TIMINGS, spin: 2000 });
  });
});
