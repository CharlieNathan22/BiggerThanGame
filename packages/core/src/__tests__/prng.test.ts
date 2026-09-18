import { describe, expect, it } from "vitest";
import { createRng, hashSeed } from "../prng.js";

describe("hashSeed", () => {
  it("is stable for the same input", () => {
    expect(hashSeed("ranked:142")).toBe(hashSeed("ranked:142"));
  });

  it("separates similar inputs", () => {
    expect(hashSeed("ranked:142")).not.toBe(hashSeed("ranked:143"));
  });
});

describe("createRng", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-a");
    const left = Array.from({ length: 1000 }, () => a.next());
    const right = Array.from({ length: 1000 }, () => b.next());
    expect(left).toEqual(right);
  });

  it("produces a different sequence for a different seed", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-b");
    expect(a.next()).not.toBe(b.next());
  });

  it("stays within [0, 1)", () => {
    const rng = createRng("range");
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() stays in range and covers it", () => {
    const rng = createRng("ints");
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it("int(0) is 0 rather than NaN", () => {
    expect(createRng("zero").int(0)).toBe(0);
  });

  it("pick returns undefined for an empty array", () => {
    expect(createRng("empty").pick([])).toBeUndefined();
  });

  it("shuffle keeps every element and does not mutate the input", () => {
    const rng = createRng("shuffle");
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort());
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("is uniform enough not to be obviously biased", () => {
    const rng = createRng("uniform");
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const b = rng.int(10);
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 - n / 100);
      expect(count).toBeLessThan(n / 10 + n / 100);
    }
  });
});
